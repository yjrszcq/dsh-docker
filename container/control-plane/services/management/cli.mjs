import { access, rm } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { LocalApiClient } from '../../modules/updater/lib/client.mjs'
import { PlatformPaths } from '../../../platform/lib/paths.mjs'

const API_PREFIX = '/_dsh_platform/api/v1'

function usage() {
  return `usage: dsh-platform <command> [options]
commands:
  status
  check
  update [--wait]
  start|stop|restart [--wait]
  channel [stable|experimental]
  retry|rollback|return-stable
  recover [--image-baseline] [--main-password|--management-password|--two-factor]
  logs [--source NAME] [--since ISO] [--limit N]
  access status|reset|set-username|reset-password
  access reset-management-password|disable-management-password|generate-key
  access clear-retry [--global-only] [--two-factor]
  trust status|reset`
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
  if (command === 'recover') {
    const credentialOptions = rest.filter(value => ['--main-password', '--management-password', '--two-factor'].includes(value))
    if (new Set(rest).size !== rest.length
      || rest.some(value => !['--image-baseline', '--main-password', '--management-password', '--two-factor'].includes(value))
      || credentialOptions.length > 1) throw new Error(usage())
    return {
      command,
      imageBaseline: rest.includes('--image-baseline'),
      credential: rest.includes('--main-password')
        ? 'main' : rest.includes('--management-password') ? 'management'
          : rest.includes('--two-factor') ? 'totp' : 'all',
    }
  }
  if (['update', 'start', 'stop', 'restart'].includes(command)) {
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
  if (command === 'access' && rest.length === 1 && ['status', 'reset', 'set-username', 'reset-password', 'reset-management-password', 'disable-management-password', 'generate-key', 'clear-retry'].includes(rest[0])) {
    return { command, operation: rest[0] }
  }
  if (command === 'access' && rest[0] === 'clear-retry') {
    const options = rest.slice(1)
    if (options.length > 0 && options.length <= 2 && new Set(options).size === options.length
      && options.every(value => ['--global-only', '--two-factor'].includes(value))) {
      return {
        command,
        operation: 'clear-retry',
        ...(options.includes('--global-only') ? { globalOnly: true } : {}),
        ...(options.includes('--two-factor') ? { credential: 'totp' } : {}),
      }
    }
  }
  throw new Error(usage())
}

export async function recoverImageBaseline({
  recovery,
  input = stdin,
  output = stdout,
  getuid = () => process.getuid?.(),
  ask,
} = {}) {
  if (getuid() !== 0) throw new Error('image baseline recovery must run as root from the container console')
  if (!input.isTTY || !output.isTTY) throw new Error('image baseline recovery requires an interactive container console')
  const status = await recovery.request('GET', '/v1/status')
  const imageBuildId = status.imageBaseline?.imageBuildId
  if (typeof imageBuildId !== 'string') throw new Error('image baseline is unavailable')
  const expected = `RECOVER IMAGE BASELINE ${imageBuildId}`
  let answer
  if (ask !== undefined) answer = await ask(expected, status)
  else {
    const prompt = createInterface({ input, output })
    answer = await prompt.question(
      `Current Deployment may be incompatible with image ${status.imageBaseline.dsh}. Type ${expected}: `,
    )
    prompt.close()
  }
  if (answer !== expected) throw new Error('image baseline recovery cancelled')
  return recovery.request('POST', '/v1/recover-image-baseline', { confirm: imageBuildId })
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

function json(value) {
  return JSON.stringify(value)
}

function managementPasswordAction(value) {
  const normalized = value.trim()
  if (['', '1'].includes(normalized)) return 'preserve'
  if (normalized === '2') return 'disable'
  if (normalized === '3') return 'reset'
  throw new Error('management password choice must be 1, 2, or 3')
}

function affirmative(value, label) {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'y') return true
  if (['', 'n'].includes(normalized)) return false
  throw new Error(`${label} choice must be y or n`)
}

export async function readSecret(input, output, prompt) {
  output.write(prompt)
  if (typeof input.setRawMode !== 'function') throw new Error('password input must be an interactive TTY')
  input.setRawMode(true)
  input.resume()
  return new Promise((resolve, reject) => {
    let value = ''
    const cleanup = () => {
      input.off('data', onData)
      input.off('end', onEnd)
      input.off('error', onError)
      input.setRawMode(false)
      input.pause()
    }
    const finish = (error, result) => {
      cleanup()
      if (error === undefined) resolve(result)
      else reject(error)
    }
    const onData = chunk => {
      for (const character of String(chunk)) {
        if (character === '\r' || character === '\n') {
          output.write('\n')
          finish(undefined, value)
          return
        }
        if (character === '\u0003') {
          finish(new Error('access recovery cancelled'))
          return
        }
        if (character === '\u007f') value = value.slice(0, -1)
        else if (character >= ' ') value += character
      }
    }
    const onEnd = () => finish(new Error('password input ended before confirmation'))
    const onError = error => finish(error)
    input.on('data', onData)
    input.once('end', onEnd)
    input.once('error', onError)
  })
}

const RETRYABLE_CONTROL_PLANE_ERRORS = new Set(['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE'])

function isRetryableControlPlaneError(error) {
  return RETRYABLE_CONTROL_PLANE_ERRORS.has(error?.code)
}

export async function runCli({
  argv = process.argv.slice(2),
  management = new LocalApiClient(process.env.DSH_PLATFORM_MANAGEMENT_CLI_SOCKET ?? '/run/dsh-platform/management-cli.sock'),
  trust = new LocalApiClient(process.env.DSH_PLATFORM_TRUST_SOCKET ?? '/run/dsh-platform/stage0-trust.sock'),
  reset = resetTrust,
  recovery = new LocalApiClient(process.env.DSH_PLATFORM_RECOVERY_SOCKET ?? '/run/dsh-platform/recovery.sock'),
  access = new LocalApiClient(process.env.DSH_PLATFORM_ACCESS_RECOVERY_SOCKET ?? '/run/dsh-platform/access/recovery.sock'),
  recover = recoverImageBaseline,
  write = value => process.stdout.write(`${value}\n`),
  delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  input = stdin,
  output = stdout,
  getuid = () => process.getuid?.(),
  readPassword = readSecret,
  ask = async question => {
    const prompt = createInterface({ input, output })
    try { return await prompt.question(question) } finally { prompt.close() }
  },
} = {}) {
  const parsed = parseCli(argv)
  if (parsed.command === 'access') {
    if (getuid() !== 0) throw new Error('access recovery requires root')
    if (!input.isTTY || !output.isTTY) throw new Error('access recovery requires an interactive container console')
    const current = await access.request('GET', '/v1/recovery/status')
    if (parsed.operation === 'status') {
      write(json(current))
      return 0
    }
    const confirm = async question => affirmative(await ask(question), 'confirmation')
    const cancel = () => {
      write(json({ status: 'cancelled' }))
      return 0
    }
    if (parsed.operation === 'generate-key') {
      if (!await confirm('Generate an administrator authentication reset key? y/[n]: ')) return cancel()
      write(json(await access.request('POST', '/v1/recovery/generate-key')))
      return 0
    }
    if (parsed.operation === 'clear-retry') {
      const question = parsed.credential === 'totp'
        ? parsed.globalOnly
          ? 'Clear the instance-wide two-factor daily limit? y/[n]: '
          : 'Clear two-factor daily limits? The fixed 10-second retry remains active. y/[n]: '
        : parsed.globalOnly
          ? 'Clear instance-wide administrator login rate limits? y/[n]: '
          : 'Clear all administrator login retry limits? y/[n]: '
      if (!await confirm(question)) return cancel()
      write(json(await access.request(
        'POST',
        '/v1/recovery/clear-retry',
        {
          scope: parsed.globalOnly ? 'global' : 'all',
          ...(parsed.credential === undefined ? {} : { credential: parsed.credential }),
        },
      )))
      return 0
    }
    if (current.account === null) throw new Error('administrator account is unavailable')
    const revision = current.account.revision
    if (parsed.operation === 'set-username') {
      if (!await confirm('Change administrator username? y/[n]: ')) return cancel()
      const username = await ask('New administrator username: ')
      write(json(await access.request('POST', '/v1/recovery/set-username', { revision, username })))
      return 0
    }
    if (parsed.operation === 'disable-management-password') {
      if (!await confirm('Disable management password? y/[n]: ')) return cancel()
      write(json(await access.request('POST', '/v1/recovery/disable-management-password', { revision })))
      return 0
    }
    if (parsed.operation === 'reset') {
      let username
      let password
      if (affirmative(await ask('Change administrator username? y/[n]: '), 'username')) {
        username = await ask('New administrator username: ')
      }
      if (affirmative(await ask('Change administrator password? y/[n]: '), 'password')) {
        password = await readPassword(input, output, 'New administrator password: ')
      }
      let action = 'preserve'
      let managementPassword
      if (current.account.managementAdditionalCredential.enabled) {
        action = managementPasswordAction(await ask(
          'Management console password:\n  [1] Keep current password\n   2  Disable password\n   3  Reset password\nEnter choice [1-3] (default: 1): ',
        ))
        if (action === 'reset') {
          managementPassword = await readPassword(input, output, 'New management password: ')
        }
      }
      if (username === undefined && password === undefined && action === 'preserve') return cancel()
      write(json(await access.request('POST', '/v1/recovery/reset-access', {
        revision,
        ...(username === undefined ? {} : { username }),
        ...(password === undefined ? {} : { password }),
        managementPasswordAction: action,
        ...(managementPassword === undefined ? {} : { managementPassword }),
      })))
      return 0
    }
    const confirmed = parsed.operation === 'reset-management-password'
      ? await confirm('Set or change management password? y/[n]: ')
      : await confirm('Change administrator password? y/[n]: ')
    if (!confirmed) return cancel()
    const password = await readPassword(input, output, parsed.operation === 'reset-management-password'
      ? 'New management password: ' : 'New administrator password: ')
    const route = parsed.operation === 'reset-management-password'
      ? '/v1/recovery/reset-management-password' : '/v1/recovery/reset-password'
    const value = await access.request('POST', route, { revision, password })
    write(json(value))
    return 0
  }
  if (parsed.command === 'recover') {
    if (getuid() !== 0) throw new Error('recovery requires root')
    if (!input.isTTY || !output.isTTY) throw new Error('recovery requires an interactive container console')
    const label = parsed.credential === 'main'
      ? 'main password' : parsed.credential === 'management' ? 'Management console password'
        : parsed.credential === 'totp' ? 'two-factor daily' : 'all administrator'
    if (!affirmative(await ask(`Clear ${label} login retry limits? y/[n]: `), 'confirmation')) {
      write(json({ status: 'cancelled' }))
      return 0
    }
    const imageBaseline = parsed.imageBaseline
      ? await recover({ recovery, input, output }) : undefined
    const authenticationRetry = await access.request('POST', '/v1/recovery/clear-retry', {
      scope: 'all', credential: parsed.credential,
    })
    write(json(imageBaseline === undefined
      ? authenticationRetry : { ...imageBaseline, authenticationRetry }))
    return 0
  }
  if (parsed.command === 'trust') {
    const value = parsed.operation === 'status' ? await trust.status() : await reset()
    write(json(value))
    return 0
  }
  if (parsed.command === 'logs') {
    const value = await management.request('GET', `${API_PREFIX}/logs${queryString(parsed)}`)
    for (const entry of value.entries) write(JSON.stringify(entry))
    return 0
  }
  if (parsed.command === 'update') {
    const started = await management.request('POST', `${API_PREFIX}/update`)
    write(json(started))
    if (!parsed.wait) return 0
    let controlPlaneRestarted = false
    for (;;) {
      let value
      try {
        value = await management.request('GET', `${API_PREFIX}/status`)
      } catch (error) {
        if (!isRetryableControlPlaneError(error)) throw error
        controlPlaneRestarted = true
        await delay(1_000)
        continue
      }
      const terminal = ['success', 'failed'].includes(value.update.status)
      const sameTask = value.update.taskId === started.taskId
      const resumedTask = controlPlaneRestarted
        && value.update.taskId !== null
        && value.update.operation === 'update'
      if (terminal && (sameTask || resumedTask)) {
        write(json(value.update))
        return value.update.status === 'success' ? 0 : 1
      }
      await delay(1_000)
    }
  }
  if (['start', 'stop', 'restart'].includes(parsed.command)) {
    const started = await management.request('POST', `${API_PREFIX}/${parsed.command}-dsh`)
    write(json(started))
    if (!parsed.wait) return 0
    for (;;) {
      const value = await management.request('GET', `${API_PREFIX}/status`)
      const lifecycle = value.dshLifecycle
      const successState = parsed.command === 'stop' ? 'stopped' : 'running'
      if (lifecycle.taskId === started.taskId && [successState, 'failed'].includes(lifecycle.state)) {
        write(json(lifecycle))
        return lifecycle.state === successState ? 0 : 1
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
    write(json(value))
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
    write(json(value))
    return 0
  }
  const method = parsed.command === 'status' ? 'GET' : 'POST'
  const value = await management.request(method, `${API_PREFIX}/${parsed.command}`)
  write(json(value))
  return 0
}
