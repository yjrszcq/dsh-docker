import assert from 'node:assert/strict'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import WebSocket from '/run/dsh-platform/views/bootstrap/control-plane/services/management/node_modules/ws/wrapper.mjs'

const API = '/_dsh_platform/api/v1/'
const auth = `Basic ${Buffer.from('smoke-user:smoke-password').toString('base64')}`
const headers = Object.freeze({ authorization: auth, host: 'smoke.example' })

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const outgoing = httpRequest({
      host: '127.0.0.1', port: 3080, method, path,
      headers: {
        ...headers,
        ...(encoded === undefined ? {} : { 'content-type': 'application/json', 'content-length': encoded.byteLength }),
      },
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.once('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        const value = text === '' ? undefined : JSON.parse(text)
        if ((response.statusCode ?? 500) >= 400) {
          const error = new Error(value?.error ?? `HTTP ${String(response.statusCode)}`)
          error.statusCode = response.statusCode
          reject(error)
        } else resolve(value)
      })
    })
    outgoing.once('error', reject)
    outgoing.end(encoded)
  })
}

async function waitFor(check, label, attempts = 300) {
  let last
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      last = await check()
      if (last) return last
    } catch (error) {
      last = error
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`${label} timed out: ${last instanceof Error ? last.message : JSON.stringify(last)}`)
}

function connectTerminal(sessionId) {
  const socket = new WebSocket(`ws://127.0.0.1:3080${API}terminal/sessions/${sessionId}/stream`, {
    headers: { ...headers, origin: 'http://smoke.example' },
  })
  let output = ''
  const waiters = new Set()
  socket.on('message', data => {
    const message = JSON.parse(data.toString())
    if (message.type === 'output') output += message.data
    for (const waiter of waiters) waiter()
  })
  const opened = new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  const waitOutput = async (marker, occurrences = 1) => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      if (output.split(marker).length - 1 >= occurrences) return output
      await new Promise(resolve => {
        const timer = setTimeout(() => { waiters.delete(done); resolve() }, 100)
        const done = () => { clearTimeout(timer); waiters.delete(done); resolve() }
        waiters.add(done)
      })
    }
    throw new Error(`terminal output did not contain ${marker}: ${output}`)
  }
  return { socket, opened, waitOutput }
}

async function waitTask(kind, taskId, expected) {
  return waitFor(async () => {
    const status = await request('GET', `${API}status`)
    const operation = status[kind]
    return operation?.taskId === taskId && expected.includes(operation.status) ? operation : false
  }, `${kind} ${taskId}`)
}

const terminal = await request('POST', `${API}terminal/sessions`, { cols: 100, rows: 32 })
const first = connectTerminal(terminal.sessionId)
await first.opened
first.socket.send(JSON.stringify({
  type: 'input',
  data: "printf 'terminal-before-restart\\n'; printf 'uid=%s\\n' \"$(id -u)\"; printf 'gids=%s\\n' \"$(id -G)\"; printf 'cwd=%s\\n' \"$PWD\"; printf 'home=%s\\n' \"$HOME\"; printf 'dsh=%s\\n' \"$DSH_HOME\"; sudo -n true && printf 'sudo=ok\\n'\n",
}))
const identity = await first.waitOutput('sudo=ok', 3)
assert.match(identity, /terminal-before-restart/)
assert.match(identity, /uid=1000/)
assert.match(identity, /gids=.+/)
assert.match(identity, /cwd=\/workspace/)
assert.match(identity, /home=\/home\/node/)
assert.match(identity, /dsh=\/data\/dsh/)

const restart = await request('POST', `${API}restart-dsh`)
await waitTask('dshRestart', restart.taskId, ['success'])
first.socket.send(JSON.stringify({ type: 'input', data: "printf 'terminal-after-restart-中文\\n'\n" }))
await first.waitOutput('terminal-after-restart-中文', 2)
first.socket.close()
await new Promise(resolve => first.socket.once('close', resolve))

const second = connectTerminal(terminal.sessionId)
await second.opened
await second.waitOutput('terminal-after-restart-中文')
await request('DELETE', `${API}terminal/sessions/${terminal.sessionId}`)
await new Promise(resolve => second.socket.once('close', resolve))
await assert.rejects(request('GET', `${API}terminal/sessions/${terminal.sessionId}`), error => error.statusCode === 404)

const profileRoot = '/data/dsh/profiles/web'
const manifestPath = join(profileRoot, 'package.json')
const faultNames = ['smoke-fault-one', 'smoke-fault-two']
const pluginRoots = new Map()
for (const name of faultNames) {
  const source = join('/workspace/smoke-user-plugin-sources', name)
  const installed = join(profileRoot, 'node_modules', name)
  pluginRoots.set(name, source)
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'package.json'), `${JSON.stringify({
    name,
    version: '1.0.0',
    type: 'module',
    main: './index.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2)}\n`)
  await writeFile(join(source, 'index.mjs'), `throw new Error('${name} startup failure')\n`)
  await writeFile(join(source, 'cordis.patch.yml'), `- insert:\n    - id: ${name}\n      name: ${JSON.stringify(`file://${join(source, 'index.mjs')}`)}\n`)
  await cp(source, installed, { recursive: true })
}
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
manifest.dependencies ??= {}
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
manifest.dsh.profile.bundles ??= []
for (const name of faultNames) {
  manifest.dependencies[name] = `file:${pluginRoots.get(name)}`
  if (!manifest.dsh.profile.bundles.includes(name)) manifest.dsh.profile.bundles.push(name)
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

const brokenRestart = await request('POST', `${API}restart-dsh`)
await waitTask('dshRestart', brokenRestart.taskId, ['failed'])
await waitFor(async () => (await request('GET', `${API}status`)).recoveryMode ?? false, 'DSH recovery mode')

let inventory = await request('GET', `${API}user-plugins`)
for (const name of faultNames) {
  const plugin = inventory.plugins.find(value => value.name === name)
  assert.equal(plugin?.enabled, true)
  assert.equal(plugin?.damaged, false)
}

const firstRecovery = await request('POST', `${API}user-plugins/apply`, {
  profile: 'web', revision: inventory.revision,
  actions: [{ name: faultNames[0], action: 'disable' }],
})
const firstOutcome = await waitTask('userPluginOperation', firstRecovery.taskId, ['failed'])
assert.match(firstOutcome.error, /failed|unavailable|ready|start/i)
inventory = await request('GET', `${API}user-plugins`)
assert.equal(inventory.plugins.find(value => value.name === faultNames[0])?.enabled, false)
assert.equal(inventory.plugins.find(value => value.name === faultNames[1])?.enabled, true)

const secondRecovery = await request('POST', `${API}user-plugins/apply`, {
  profile: 'web', revision: inventory.revision,
  actions: [{ name: faultNames[1], action: 'disable' }],
})
await waitTask('userPluginOperation', secondRecovery.taskId, ['success'])
await waitFor(async () => {
  const status = await request('GET', `${API}status`)
  return status.recoveryMode === null ? status : false
}, 'DSH recovery completion')
inventory = await request('GET', `${API}user-plugins`)
for (const name of faultNames) assert.equal(inventory.plugins.find(value => value.name === name)?.enabled, false)

const uninstall = await request('POST', `${API}user-plugins/apply`, {
  profile: 'web', revision: inventory.revision,
  actions: [{ name: faultNames[0], action: 'uninstall' }],
})
const uninstallOutcome = await waitTask('userPluginOperation', uninstall.taskId, ['success', 'failed'])
if (uninstallOutcome.status !== 'success') {
  const diagnostics = await request('GET', `${API}logs?limit=50`)
  throw new Error(JSON.stringify({
    error: uninstallOutcome.error,
    manifest: JSON.parse(await readFile(manifestPath, 'utf8')),
    logs: diagnostics.entries.slice(-10),
  }))
}
inventory = await request('GET', `${API}user-plugins`)
assert.equal(inventory.plugins.some(value => value.name === faultNames[0]), false)

const logEntries = (await request('GET', `${API}logs?limit=5000`)).entries
for (const message of [
  'terminal.session.created', 'terminal.session.connected', 'terminal.session.disconnected',
  'terminal.session.reconnected', 'terminal.session.closed', 'user-plugin.apply.started',
  'user-plugin.apply.failed', 'user-plugin.apply.completed',
]) assert.ok(logEntries.some(entry => entry.message === message), `missing platform log ${message}`)
assert.doesNotMatch(JSON.stringify(logEntries.filter(entry => entry.source === 'terminal')), /terminal-before-restart|terminal-after-restart/)

process.stdout.write(`${JSON.stringify({ terminalSession: terminal.sessionId, faultNames })}\n`)
