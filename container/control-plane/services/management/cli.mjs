import { access, rm } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { LocalApiClient } from '../../modules/updater/lib/client.mjs'
import { PlatformPaths } from '../../../platform/lib/paths.mjs'

const API_PREFIX = '/_dsh_platform/api/v1'

function usage() {
  return 'usage: dsh-platform status|check|update [--wait]|channel [stable|experimental]|retry|rollback|return-stable|logs [--source NAME] [--since ISO] [--limit N]|trust status|reset'
}

export function parseCli(argv) {
  const [command, ...rest] = argv
  if (['status', 'check', 'retry', 'rollback', 'return-stable'].includes(command)) {
    if (rest.length !== 0) throw new Error(usage())
    return { command }
  }
  if (command === 'channel' && (rest.length === 0 || (rest.length === 1 && ['stable', 'experimental'].includes(rest[0])))) {
    return { command, channel: rest[0] }
  }
  if (command === 'update') {
    if (rest.some(value => value !== '--wait') || rest.filter(value => value === '--wait').length > 1) throw new Error(usage())
    return { command, wait: rest.includes('--wait') }
  }
  if (command === 'logs') {
    const options = { command, sources: [] }
    for (let index = 0; index < rest.length; index += 2) {
      const name = rest[index]
      const value = rest[index + 1]
      if (value === undefined) throw new Error(usage())
      if (name === '--source') options.sources.push(value)
      else if (name === '--since') options.since = value
      else if (name === '--limit') options.limit = Number(value)
      else throw new Error(usage())
    }
    return options
  }
  if (command === 'trust' && rest.length === 1 && ['status', 'reset'].includes(rest[0])) {
    return { command, operation: rest[0] }
  }
  throw new Error(usage())
}

export async function resetTrust({
  dataRoot = '/data/platform',
  runRoot = '/run/dsh-platform',
  input = stdin,
  output = stdout,
  getuid = () => process.getuid?.(),
} = {}) {
  if (getuid() !== 0) throw new Error('trust reset must run as root from the container console')
  if (!input.isTTY || !output.isTTY) throw new Error('trust reset requires an interactive container console')
  const paths = new PlatformPaths(dataRoot, runRoot)
  const socket = paths.trustSocket
  if (await access(socket).then(() => true, () => false)) throw new Error('stop Stage-0 before resetting trust')
  const prompt = createInterface({ input, output })
  const answer = await prompt.question('Type RESET DSH TRUST to clear accepted trust state: ')
  prompt.close()
  if (answer !== 'RESET DSH TRUST') throw new Error('trust reset cancelled')
  await rm(paths.trustStateRoot, { recursive: true, force: true })
  return { status: 'reset', recoveryRoot: 'image' }
}

function queryString(options) {
  const query = new URLSearchParams()
  for (const source of options.sources ?? []) query.append('source', source)
  if (options.since !== undefined) query.set('since', options.since)
  if (options.limit !== undefined) query.set('limit', String(options.limit))
  const value = query.toString()
  return value === '' ? '' : `?${value}`
}

export async function runCli({
  argv = process.argv.slice(2),
  management = new LocalApiClient(process.env.DSH_PLATFORM_MANAGEMENT_SOCKET ?? '/run/dsh-platform/management.sock'),
  trust = new LocalApiClient(process.env.DSH_PLATFORM_TRUST_SOCKET ?? '/run/dsh-platform/stage0-trust.sock'),
  reset = resetTrust,
  write = value => process.stdout.write(`${value}\n`),
  delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  input = stdin,
  output = stdout,
} = {}) {
  const parsed = parseCli(argv)
  if (parsed.command === 'trust') {
    const value = parsed.operation === 'status' ? await trust.status() : await reset()
    write(JSON.stringify(value, null, 2))
    return 0
  }
  if (parsed.command === 'logs') {
    const value = await management.request('GET', `${API_PREFIX}/logs${queryString(parsed)}`)
    for (const entry of value.entries) write(JSON.stringify(entry))
    return 0
  }
  if (parsed.command === 'update') {
    const started = await management.request('POST', `${API_PREFIX}/update`)
    write(JSON.stringify(started, null, 2))
    if (!parsed.wait) return 0
    for (;;) {
      const value = await management.request('GET', `${API_PREFIX}/status`)
      if (['success', 'failed'].includes(value.update.status)) {
        write(JSON.stringify(value.update, null, 2))
        return value.update.status === 'success' ? 0 : 1
      }
      await delay(1_000)
    }
  }
  if (parsed.command === 'channel') {
    if (parsed.channel === undefined) {
      const value = await management.request('GET', `${API_PREFIX}/status`)
      write(value.updateChannel)
    } else {
      const value = await management.request('PUT', `${API_PREFIX}/channel`, { channel: parsed.channel })
      write(value.updateChannel)
    }
    return 0
  }
  if (parsed.command === 'retry') {
    const status = await management.request('GET', `${API_PREFIX}/status`)
    const choices = [...status.holds, ...(status.experimentalBlocked === null ? [] : [status.experimentalBlocked])]
    const unique = [...new Map(choices.map(value => [value.id, value])).values()]
    if (unique.length !== 1) throw new Error('retry requires exactly one active Hold or Blocked combination')
    const value = await management.request('POST', `${API_PREFIX}/holds/retry`, { id: unique[0].id })
    write(JSON.stringify(value, null, 2))
    return 0
  }
  if (parsed.command === 'rollback' || parsed.command === 'return-stable') {
    const { plan } = await management.request('GET', `${API_PREFIX}/rollback-plan`)
    if (plan === null) throw new Error('no complete rollback plan is available')
    let confirmDataLoss = false
    if (parsed.command === 'return-stable') {
      if (!input.isTTY || !output.isTTY) throw new Error('return-stable requires an interactive container console')
      const prompt = createInterface({ input, output })
      const answer = await prompt.question(`Restore data snapshot from ${plan.snapshot.createdAt}? Type RETURN STABLE AND LOSE NEWER DATA: `)
      prompt.close()
      if (answer !== 'RETURN STABLE AND LOSE NEWER DATA') throw new Error('return-stable cancelled')
      confirmDataLoss = true
    }
    const value = await management.request('POST', `${API_PREFIX}/${parsed.command}`, {
      planId: plan.planId,
      ...(parsed.command === 'return-stable' ? { confirmDataLoss } : {}),
    })
    write(JSON.stringify(value, null, 2))
    return 0
  }
  const method = parsed.command === 'status' ? 'GET' : 'POST'
  const value = await management.request(method, `${API_PREFIX}/${parsed.command}`)
  write(JSON.stringify(value, null, 2))
  return 0
}
