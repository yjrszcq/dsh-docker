import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { request as httpRequest } from 'node:http'
import { lstat, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { JsonlLogManager } from '../../control-plane/modules/log-manager/index.mjs'
import { parseCli, recoverImageBaseline, resetTrust, runCli } from '../../control-plane/services/management/cli.mjs'
import { API_PREFIX, createManagementServer, listenManagement } from '../../control-plane/services/management/server.mjs'
import { LocalApiClient } from '../../control-plane/modules/updater/lib/client.mjs'
import { UpdateConflictError } from '../../control-plane/modules/updater/lib/coordinator.mjs'
import { UpdateScheduler } from '../../control-plane/modules/updater/lib/scheduler.mjs'
import { SettingsDocumentStore } from '../../control-plane/services/management/settings-document.mjs'

class Coordinator extends EventEmitter {
  constructor() {
    super()
    this.value = { status: 'idle', progress: 0 }
    this.state = { read: async () => this.value }
  }

  async publicStatus() {
    return { update: this.value, updateChannel: 'experimental', holds: [], experimentalBlocked: null, rollbackPlan: { planId: 'plan-a' } }
  }

  hasActiveTask() { return this.running === true }

  async check(source) {
    this.checkSource = source
    return { value: { targetSequence: 2, desired: { dsh: { version: 'rc.8' } } } }
  }

  start() {
    if (this.running) throw new UpdateConflictError('busy')
    this.running = true
    return { taskId: 'task-one', completion: new Promise(() => {}) }
  }

  startReconcile() { return this.start() }
  rollbackPlan() { return Promise.resolve({ planId: 'plan-a' }) }
  setChannel(channel) { return Promise.resolve({ updateChannel: channel, holds: [], experimentalBlocked: null }) }
  retryHold(id) { return Promise.resolve({ retried: id }) }
  startCompleteRollback(planId) {
    assert.equal(planId, 'plan-a')
    return { taskId: 'rollback-task', completion: Promise.resolve() }
  }
}

function rawRequest(socketPath, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ socketPath, path, method }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    request.once('error', reject)
    request.end()
  })
}

test('management socket exposes status, check, update, logs, and local rollback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-'))
  const coordinator = new Coordinator()
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  await logs.append('gateway', 'stdout', 'ready')
  const server = createManagementServer({
    coordinator,
    logs,
    platformStatus: async () => ({ environment: 'one' }),
    updateAutomaticCheck: async value => value,
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    const status = await client.request('GET', '/_dsh_platform/api/v1/status')
    assert.equal(status.environment, 'one')
    assert.equal((await client.request('POST', '/_dsh_platform/api/v1/check', { source: 'page-open' })).targetSequence, 2)
    assert.equal(coordinator.checkSource, 'page-open')
    assert.deepEqual(await client.request('POST', '/_dsh_platform/api/v1/update'), { taskId: 'task-one' })
    await assert.rejects(client.request('POST', '/_dsh_platform/api/v1/update'), error => error.statusCode === 409)
    assert.equal((await client.request('GET', '/_dsh_platform/api/v1/logs?source=gateway')).entries[0].message, 'ready')
    assert.equal((await client.request('PUT', '/_dsh_platform/api/v1/channel', { channel: 'experimental' })).updateChannel, 'experimental')
    assert.deepEqual(await client.request('PUT', '/_dsh_platform/api/v1/automatic-check', {
      enabled: true, intervalSeconds: 21_600, notificationsEnabled: false,
    }), { enabled: true, intervalSeconds: 21_600, notificationsEnabled: false })
    assert.equal((await client.request('POST', '/_dsh_platform/api/v1/holds/retry', { id: 'hold-a' })).retried, 'hold-a')
    assert.equal((await client.request('GET', '/_dsh_platform/api/v1/rollback-plan')).plan.planId, 'plan-a')
    coordinator.running = false
    assert.deepEqual(await client.request('POST', '/_dsh_platform/api/v1/rollback', { planId: 'plan-a' }), { taskId: 'rollback-task' })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management live logs preserve the requested source filter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-log-stream-'))
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  await logs.append('gateway', 'stdout', 'initial')
  const server = createManagementServer({ coordinator: new Coordinator(), logs })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  let request
  let response
  try {
    ({ request, response } = await new Promise((resolve, reject) => {
      const nextRequest = httpRequest({ socketPath, path: `${API_PREFIX}logs/stream?source=gateway&limit=10` }, nextResponse => {
        resolve({ request: nextRequest, response: nextResponse })
      })
      nextRequest.once('error', reject)
      nextRequest.end()
    }))
    let body = ''
    const live = new Promise(resolve => {
      response.on('data', chunk => {
        body += chunk.toString('utf8')
        if (body.includes('must-stream')) resolve()
      })
    })
    await logs.append('updater', 'stdout', 'must-not-stream')
    await logs.append('gateway', 'stdout', 'must-stream')
    await Promise.race([
      live,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for live log')), 1_000)),
    ])
    assert.match(body, /must-stream/)
    assert.doesNotMatch(body, /must-not-stream/)
  } finally {
    request?.destroy()
    response?.destroy()
    await new Promise(resolve => server.close(resolve))
  }
})

test('management reports unpublished development metadata without an HTTP error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-unpublished-'))
  const coordinator = new Coordinator()
  coordinator.check = async () => ({ unavailable: true, upstream: { version: 'rc.10' } })
  const server = createManagementServer({
    coordinator,
    logs: new JsonlLogManager({ root: join(root, 'logs') }),
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  try {
    assert.deepEqual(await new LocalApiClient(socketPath).request('POST', '/_dsh_platform/api/v1/check'), {
      available: false,
      upstream: { version: 'rc.10' },
    })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management edits only the fixed settings document with optimistic revisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-settings-document-'))
  const dshHome = join(root, 'dsh')
  const settingsDocument = new SettingsDocumentStore(dshHome)
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  const server = createManagementServer({ coordinator: new Coordinator(), logs, settingsDocument })
  const socketPath = join(root, 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    const empty = await client.request('GET', `${API_PREFIX}settings-document`)
    assert.equal(empty.content, '')
    assert.equal(empty.exists, false)
    assert.match(empty.revision, /^[a-f0-9]{64}$/)
    const saved = await client.request('PUT', `${API_PREFIX}settings-document`, {
      content: 'language: zh\n', revision: empty.revision,
    })
    assert.equal(saved.exists, true)
    assert.equal(await readFile(join(dshHome, 'settings.yaml'), 'utf8'), 'language: zh\n')
    assert.equal((await lstat(join(dshHome, 'settings.yaml'))).isFile(), true)
    await assert.rejects(client.request('PUT', `${API_PREFIX}settings-document`, {
      content: 'language: en\n', revision: empty.revision, path: '/etc/passwd',
    }), error => error.statusCode === 400)
    await assert.rejects(client.request('PUT', `${API_PREFIX}settings-document`, {
      content: 'language: en\n', revision: empty.revision,
    }), error => error.statusCode === 409)
    assert.equal(await readFile(join(dshHome, 'settings.yaml'), 'utf8'), 'language: zh\n')
    assert.deepEqual((await logs.query({ sources: ['audit'] })).map(entry => entry.message), ['settings-document.saved'])
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('settings document editing rejects symbolic links, invalid UTF-8, and oversized content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-settings-unsafe-'))
  const dshHome = join(root, 'dsh')
  await import('node:fs/promises').then(({ mkdir }) => mkdir(dshHome))
  const target = join(root, 'outside.yaml')
  await writeFile(target, 'outside: true\n')
  await symlink(target, join(dshHome, 'settings.yaml'))
  const store = new SettingsDocumentStore(dshHome, { maxBytes: 8 })
  await assert.rejects(store.read(), /regular file/)
  await import('node:fs/promises').then(({ rm }) => rm(join(dshHome, 'settings.yaml')))
  await writeFile(join(dshHome, 'settings.yaml'), Buffer.from([0xc3, 0x28]))
  await assert.rejects(store.read(), /not valid UTF-8/)
  await assert.rejects(store.write('123456789', '0'.repeat(64)), /too large/)
  assert.equal(await readFile(target, 'utf8'), 'outside: true\n')
})

test('management restarts only DSH as an audited task and excludes update activation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-restart-'))
  const coordinator = new Coordinator()
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  let finishRestart
  const restartCompletion = new Promise(resolve => { finishRestart = resolve })
  let restarts = 0
  const server = createManagementServer({
    coordinator,
    logs,
    restartDsh: async () => {
      restarts += 1
      await restartCompletion
    },
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    const task = await client.request('POST', '/_dsh_platform/api/v1/restart-dsh')
    assert.equal(typeof task.taskId, 'string')
    for (let attempt = 0; attempt < 100 && restarts === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal(restarts, 1)
    assert.equal((await client.request('GET', '/_dsh_platform/api/v1/status')).dshRestart.status, 'restarting')
    await assert.rejects(
      client.request('POST', '/_dsh_platform/api/v1/restart-dsh'),
      error => error.statusCode === 409,
    )
    await assert.rejects(
      client.request('POST', '/_dsh_platform/api/v1/update'),
      error => error.statusCode === 409,
    )
    finishRestart()
    await new Promise(resolve => setImmediate(resolve))
    await logs.queue
    const status = await client.request('GET', '/_dsh_platform/api/v1/status')
    assert.equal(status.dshRestart.status, 'success')
    assert.equal(status.dshRestart.taskId, task.taskId)
    assert.deepEqual(
      (await logs.query({ sources: ['audit'] })).map(entry => entry.message),
      ['dsh.restart.started', 'dsh.restart.completed'],
    )
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management rejects DSH restart while an update task is active', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-restart-conflict-'))
  const coordinator = new Coordinator()
  coordinator.running = true
  const server = createManagementServer({
    coordinator,
    logs: new JsonlLogManager({ root: join(root, 'logs') }),
    restartDsh: async () => {},
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  try {
    await assert.rejects(
      new LocalApiClient(socketPath).request('POST', '/_dsh_platform/api/v1/restart-dsh'),
      error => error.statusCode === 409,
    )
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management changes a bundled plugin as an audited task and excludes runtime changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-plugin-action-'))
  const coordinator = new Coordinator()
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  let finish
  const completion = new Promise(resolve => { finish = resolve })
  const calls = []
  const server = createManagementServer({
    coordinator,
    logs,
    listBundledPlugins: async () => [{ id: 'diagnostics', installed: true, enabled: true, protected: false }],
    configureBundledPlugin: async (id, action) => {
      calls.push([id, action])
      await completion
    },
    restartDsh: async () => {},
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    assert.deepEqual((await client.request('GET', '/_dsh_platform/api/v1/bundled-plugins')).plugins, [{
      id: 'diagnostics', installed: true, enabled: true, protected: false,
    }])
    const task = await client.request('POST', '/_dsh_platform/api/v1/bundled-plugins/action', {
      id: 'diagnostics', action: 'disable',
    })
    assert.equal(typeof task.taskId, 'string')
    for (let attempt = 0; attempt < 100 && calls.length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.deepEqual(calls, [['diagnostics', 'disable']])
    assert.equal((await client.request('GET', '/_dsh_platform/api/v1/status')).systemPluginOperation.status, 'running')
    for (const [method, path, body] of [
      ['POST', '/_dsh_platform/api/v1/bundled-plugins/action', { id: 'diagnostics', action: 'uninstall' }],
      ['POST', '/_dsh_platform/api/v1/restart-dsh'],
      ['POST', '/_dsh_platform/api/v1/update'],
    ]) {
      await assert.rejects(client.request(method, path, body), error => error.statusCode === 409)
    }
    finish()
    await new Promise(resolve => setImmediate(resolve))
    await logs.queue
    const changed = await client.request('GET', '/_dsh_platform/api/v1/status')
    assert.equal(changed.systemPluginOperation.status, 'success')
    assert.equal(changed.systemPluginOperation.restartRequired, true)
    assert.deepEqual(
      (await logs.query({ sources: ['audit'] })).map(entry => entry.message),
      ['system-plugin.disable.started', 'system-plugin.disable.completed'],
    )
    await client.request('POST', '/_dsh_platform/api/v1/restart-dsh')
    let restarted
    for (let attempt = 0; attempt < 100; attempt += 1) {
      restarted = await client.request('GET', '/_dsh_platform/api/v1/status')
      if (restarted.dshRestart.status === 'success') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal(restarted.dshRestart.status, 'success')
    assert.equal(restarted.systemPluginOperation.restartRequired, false)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management keeps the System Plugin restart marker when DSH restart fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-plugin-restart-failure-'))
  const server = createManagementServer({
    coordinator: new Coordinator(),
    logs: new JsonlLogManager({ root: join(root, 'logs') }),
    configureBundledPlugin: async () => {},
    restartDsh: async () => { throw new Error('restart failed') },
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    await client.request('POST', '/_dsh_platform/api/v1/bundled-plugins/action', {
      id: 'diagnostics', action: 'disable',
    })
    let status
    for (let attempt = 0; attempt < 100; attempt += 1) {
      status = await client.request('GET', '/_dsh_platform/api/v1/status')
      if (status.systemPluginOperation.status === 'success') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal(status.systemPluginOperation.restartRequired, true)
    await client.request('POST', '/_dsh_platform/api/v1/restart-dsh')
    for (let attempt = 0; attempt < 100; attempt += 1) {
      status = await client.request('GET', '/_dsh_platform/api/v1/status')
      if (status.dshRestart.status === 'failed') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal(status.dshRestart.status, 'failed')
    assert.equal(status.systemPluginOperation.restartRequired, true)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management exposes a dedicated recovery action only for Platform Management', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-plugin-recovery-'))
  const calls = []
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  const server = createManagementServer({
    coordinator: new Coordinator(),
    logs,
    recoverBundledPlugin: async (id, action) => { calls.push([id, action]) },
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    await assert.rejects(client.request('POST', `${API_PREFIX}bundled-plugins/recovery-action`, {
      id: 'diagnostics', action: 'uninstall',
    }), error => error.statusCode === 400)
    const task = await client.request('POST', `${API_PREFIX}bundled-plugins/recovery-action`, {
      id: 'platform-management', action: 'disable',
    })
    assert.equal(typeof task.taskId, 'string')
    for (let attempt = 0; attempt < 100 && calls.length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.deepEqual(calls, [['platform-management', 'disable']])
    await new Promise(resolve => setImmediate(resolve))
    await logs.queue
    assert.deepEqual(
      (await logs.query({ sources: ['audit'] })).map(entry => entry.message),
      ['system-plugin.recovery.disable.started', 'system-plugin.recovery.disable.completed'],
    )
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management separates a known Stable target from update availability', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-current-'))
  const coordinator = new Coordinator()
  coordinator.check = async () => ({
    value: { targetSequence: 2, desired: { dsh: { version: 'rc.7' } } },
    updateAvailable: false,
  })
  const server = createManagementServer({
    coordinator,
    logs: new JsonlLogManager({ root: join(root, 'logs') }),
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  try {
    assert.deepEqual(await new LocalApiClient(socketPath).request('POST', '/_dsh_platform/api/v1/check'), {
      available: false,
      targetSequence: 2,
      desired: { dsh: { version: 'rc.7' } },
    })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management records a completion audit for a successful update task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-audit-'))
  const coordinator = new Coordinator()
  coordinator.startReconcile = () => ({ taskId: 'task-success', completion: Promise.resolve() })
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  const server = createManagementServer({ coordinator, logs })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  try {
    const client = new LocalApiClient(socketPath)
    await client.request('POST', '/_dsh_platform/api/v1/update')
    await new Promise(resolve => setImmediate(resolve))
    await logs.queue
    assert.deepEqual(
      (await logs.query({ sources: ['audit'] })).map(entry => [entry.message, entry.taskId]),
      [['update.started', 'task-success'], ['update.completed', 'task-success']],
    )
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management serves only the fixed persistent Platform Management assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-console-'))
  const coordinator = new Coordinator()
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  const server = createManagementServer({ coordinator, logs })
  const socketPath = join(root, 'management.sock')
  await listenManagement(server, socketPath)
  try {
    const redirect = await rawRequest(socketPath, '/_dsh_platform/ui')
    assert.equal(redirect.status, 308)
    assert.equal(redirect.headers.location, '/_dsh_platform/ui/')
    const page = await rawRequest(socketPath, '/_dsh_platform/ui/')
    assert.equal(page.status, 200)
    assert.match(page.headers['content-type'], /^text\/html/)
    assert.match(page.headers['content-security-policy'], /script-src 'self'/)
    assert.match(page.body, /DSH Platform Management/)
    const script = await rawRequest(socketPath, '/_dsh_platform/ui/app.js')
    assert.equal(script.status, 200)
    assert.match(script.body, /new EventSource/)
    const head = await rawRequest(socketPath, '/_dsh_platform/ui/style.css', 'HEAD')
    assert.equal(head.status, 200)
    assert.equal(head.body, '')
    assert.equal((await rawRequest(socketPath, '/_dsh_platform/ui/../server.mjs')).status, 404)
    assert.equal((await rawRequest(socketPath, '/_dsh_platform/ui/app.js', 'POST')).status, 405)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('Platform Management script references only DOM IDs declared by its document', async () => {
  const publicRoot = new URL('../../control-plane/services/management/public/', import.meta.url)
  const html = await readFile(new URL('index.html', publicRoot), 'utf8')
  const script = await readFile(new URL('app.js', publicRoot), 'utf8')
  const ids = new Set([...html.matchAll(/\bid="([a-z0-9-]+)"/g)].map(match => match[1]))
  const references = [...script.matchAll(/elements(?:\.([A-Za-z][A-Za-z0-9]*)|\[['"]([a-z0-9-]+)['"]\])/g)]
    .map(match => match[1] ?? match[2])
  assert.equal(references.length > 0, true)
  for (const id of references) assert.equal(ids.has(id), true, `Console element ${id} is not declared`)
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML/)
})

test('standalone console keeps localized feature parity on the shared Management API', async () => {
  const publicRoot = new URL('../../control-plane/services/management/public/', import.meta.url)
  const html = await readFile(new URL('index.html', publicRoot), 'utf8')
  const script = await readFile(new URL('app.js', publicRoot), 'utf8')
  const style = await readFile(new URL('style.css', publicRoot), 'utf8')
  for (const panel of ['updates', 'maintenance', 'plugins']) {
    assert.match(html, new RegExp(`id="panel-${panel}"`))
  }
  for (const route of [
    'status', 'check', 'update', 'channel', 'automatic-check', 'holds/retry', 'rollback',
    'return-stable', 'restart-dsh', 'bundled-plugins', 'bundled-plugins/recovery-action', 'logs/stream',
  ]) assert.match(script, new RegExp(route.replace('/', '\\/')))
  assert.match(script, /const COPY = Object\.freeze\(\{[\s\S]*zh:[\s\S]*en:/)
  assert.match(script, /name === 'dsh_locale'/)
  assert.match(script, /navigator\.languages/)
  assert.match(script, /checkUpdates\('page-open'\)/)
  assert.match(script, /NOTICE_PREFIX = 'dsh-platform:console-update-notice'/)
  assert.doesNotMatch(script, /shell\.overlay|settings\.section|dsh-platform:update-notice-owner/)
  assert.match(style, /\.tabs \{[\s\S]*overflow-x: auto/)
  assert.match(style, /\.topbar-inner \{[\s\S]*width: min\(780px, calc\(100% - 40px\)\)/)
  assert.match(style, /@media \(max-width: 640px\)/)
  assert.match(style, /\.log-list \{[\s\S]*max-height: min\(320px, 42dvh\)/)
})

test('CLI parser keeps rollback local and update wait behavior explicit', async () => {
  assert.deepEqual(parseCli(['update', '--wait']), { command: 'update', wait: true })
  assert.deepEqual(parseCli(['trust', 'status']), { command: 'trust', operation: 'status' })
  assert.throws(() => parseCli(['update', '--force']))
  const calls = []
  const output = []
  const management = {
    request: async (method, path, body) => {
      calls.push({ method, path, body })
      if (path.endsWith('/rollback-plan')) return { plan: { planId: 'plan-a' } }
      return path.endsWith('/rollback') ? { taskId: 'rollback-task' } : {}
    },
  }
  assert.equal(await runCli({ argv: ['rollback'], management, write: line => output.push(line) }), 0)
  assert.deepEqual(calls, [
    { method: 'GET', path: '/_dsh_platform/api/v1/rollback-plan', body: undefined },
    { method: 'POST', path: '/_dsh_platform/api/v1/rollback', body: { planId: 'plan-a' } },
  ])
  assert.match(output[0], /rollback-task/)
})

test('update wait ignores a terminal state from an older task', async () => {
  const output = []
  const statuses = [
    { update: { taskId: 'old-task', status: 'failed' } },
    { update: { taskId: 'new-task', status: 'planning' } },
    { update: { taskId: 'new-task', status: 'success' } },
  ]
  const management = {
    request: async (method, path) => {
      if (method === 'POST' && path.endsWith('/update')) return { taskId: 'new-task' }
      return statuses.shift()
    },
  }
  let waits = 0
  const exitCode = await runCli({
    argv: ['update', '--wait'],
    management,
    write: line => output.push(line),
    delay: async () => { waits += 1 },
  })
  assert.equal(exitCode, 0)
  assert.equal(waits, 2)
  assert.match(output.at(-1), /new-task/)
})

test('management CLI emits each JSON result as one log-safe line', async () => {
  const output = []
  const status = {
    officialDshVersion: null,
    dshRestart: { status: 'idle', taskId: null, error: null, updatedAt: null },
  }
  assert.equal(await runCli({
    argv: ['status'],
    management: { request: async () => status },
    write: line => output.push(line),
  }), 0)
  assert.deepEqual(output, [JSON.stringify(status)])
  assert.equal(output[0].includes('\n'), false)
})

test('restart CLI has a fixed DSH scope and waits only for its own task', async () => {
  assert.deepEqual(parseCli(['restart']), { command: 'restart', wait: false })
  assert.deepEqual(parseCli(['restart', '--wait']), { command: 'restart', wait: true })
  assert.throws(() => parseCli(['restart', 'gateway']))
  assert.throws(() => parseCli(['restart', '--component', 'gateway']))
  const immediateCalls = []
  assert.equal(await runCli({
    argv: ['restart'],
    management: {
      request: async (method, path) => {
        immediateCalls.push([method, path])
        return { taskId: 'immediate-task' }
      },
    },
    write: () => {},
  }), 0)
  assert.deepEqual(immediateCalls, [['POST', '/_dsh_platform/api/v1/restart-dsh']])
  const output = []
  const statuses = [
    { dshRestart: { taskId: 'old-task', status: 'success' } },
    { dshRestart: { taskId: 'restart-task', status: 'restarting' } },
    { dshRestart: { taskId: 'restart-task', status: 'success' } },
  ]
  const calls = []
  const management = {
    request: async (method, path) => {
      calls.push([method, path])
      if (method === 'POST') return { taskId: 'restart-task' }
      return statuses.shift()
    },
  }
  let waits = 0
  const exitCode = await runCli({
    argv: ['restart', '--wait'],
    management,
    write: line => output.push(line),
    delay: async () => { waits += 1 },
  })
  assert.equal(exitCode, 0)
  assert.equal(waits, 2)
  assert.deepEqual(calls[0], ['POST', '/_dsh_platform/api/v1/restart-dsh'])
  assert.match(output[0], /restart-task/)
  assert.match(output.at(-1), /success/)
})

test('CLI parses channel controls and refuses noninteractive Stable return', async () => {
  assert.deepEqual(parseCli(['channel', 'experimental']), { command: 'channel', channel: 'experimental' })
  assert.deepEqual(parseCli(['retry']), { command: 'retry' })
  assert.deepEqual(parseCli(['return-stable']), { command: 'return-stable' })
  const management = {
    request: async () => ({ plan: { planId: 'plan-a', snapshot: { createdAt: '2026-08-19T00:00:00.000Z' } } }),
  }
  await assert.rejects(runCli({
    argv: ['return-stable'], management, input: { isTTY: false }, output: { isTTY: false }, write: () => {},
  }), /interactive/)
})

test('trust reset refuses non-root and non-interactive callers before mutation', async () => {
  await assert.rejects(resetTrust({ getuid: () => 1000 }), /root/)
  await assert.rejects(resetTrust({ getuid: () => 0, input: { isTTY: false }, output: { isTTY: false } }), /interactive/)
})

test('image baseline recovery is root/TTY-only and requires the complete image identity', async () => {
  assert.deepEqual(parseCli(['recover', '--image-baseline']), { command: 'recover', imageBaseline: true })
  const calls = []
  const recovery = {
    request: async (method, path, body) => {
      calls.push({ method, path, body })
      if (method === 'GET') return { imageBaseline: { imageBuildId: `sha256:${'a'.repeat(64)}`, dsh: '0.1.0-rc.10' } }
      return { status: 'recovered' }
    },
  }
  await assert.rejects(recoverImageBaseline({ recovery, getuid: () => 1000 }), /root/)
  await assert.rejects(recoverImageBaseline({
    recovery, getuid: () => 0, input: { isTTY: false }, output: { isTTY: false },
  }), /interactive/)
  const expected = `RECOVER IMAGE BASELINE sha256:${'a'.repeat(64)}`
  const value = await recoverImageBaseline({
    recovery,
    getuid: () => 0,
    input: { isTTY: true },
    output: { isTTY: true },
    ask: async prompt => prompt,
  })
  assert.equal(value.status, 'recovered')
  assert.deepEqual(calls, [
    { method: 'GET', path: '/v1/status', body: undefined },
    { method: 'POST', path: '/v1/recover-image-baseline', body: { confirm: expected.slice('RECOVER IMAGE BASELINE '.length) } },
  ])
})

test('scheduler applies bounded jitter and performs checks without activating updates', async () => {
  let delay
  let callback
  let checks = 0
  const scheduler = new UpdateScheduler({
    check: async () => { checks += 1 },
    intervalSeconds: 100,
    random: () => 0,
    setTimer: (fn, milliseconds) => { callback = fn; delay = milliseconds; return { unref() {} } },
    clearTimer: () => {},
  })
  scheduler.start()
  assert.equal(delay, 90_000)
  await callback()
  assert.equal(checks, 1)
  scheduler.configure({ enabled: false, intervalSeconds: 3_600 })
  assert.equal(scheduler.timer, undefined)
  scheduler.configure({ enabled: true, intervalSeconds: 3_600 })
  assert.equal(delay, 3_240_000)
  scheduler.stop()
})

test('scheduler configuration during a running check does not revive an old timer', async () => {
  const timers = []
  let finish
  const scheduler = new UpdateScheduler({
    check: () => new Promise(resolve => { finish = resolve }),
    intervalSeconds: 100,
    setTimer: callback => { const timer = { callback, unref() {} }; timers.push(timer); return timer },
    clearTimer: () => {},
  })
  scheduler.start()
  const running = timers[0].callback()
  scheduler.configure({ enabled: false, intervalSeconds: 3_600 })
  finish()
  await running
  assert.equal(timers.length, 1)
  assert.equal(scheduler.timer, undefined)
})

test('management does not check metadata before the first scheduled interval', async () => {
  const source = await readFile(new URL('../../control-plane/services/management/index.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /setImmediate\(\(\) => \{ coordinator\.check\(\)\.catch/)
  assert.match(source, /check: \(\) => coordinator\.check\('automatic'\)/)
  assert.match(source, /allowUnavailableMetadata: imageInventory\.authority === 'development'/)
})
