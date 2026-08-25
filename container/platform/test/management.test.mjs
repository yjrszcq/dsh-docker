import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { request as httpRequest } from 'node:http'
import { appendFile, lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
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
import { UserPluginInventory } from '../../control-plane/modules/plugin-manager/user-inventory.mjs'
import { UserPluginJournal } from '../../control-plane/modules/plugin-manager/user-journal.mjs'
import { UserPluginSnapshots } from '../../control-plane/modules/plugin-manager/user-snapshots.mjs'
import { UserPluginSelectionStore } from '../../control-plane/modules/plugin-manager/user-state.mjs'
import { UserPluginTransactionManager } from '../../control-plane/modules/plugin-manager/user-transaction.mjs'
import { FileInventory, FileSearchManager } from '../../control-plane/modules/file-manager/index.mjs'
import { FileTransferManager } from '../../control-plane/modules/file-manager/transfers.mjs'
import { FileTaskManager } from '../../control-plane/modules/file-manager/tasks.mjs'
import { AtomicFileEditor } from '../../control-plane/modules/file-manager/editor.mjs'

const ASYNC_POLL_ATTEMPTS = 2_000
const ASYNC_POLL_INTERVAL_MS = 5

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
    const rejected = await logs.query({ sources: ['platform-management'] })
    assert.equal(rejected.some(entry => entry.message === 'management.request.failed'
      && entry.pathname === '/_dsh_platform/api/v1/update'
      && entry.level === 'warning'), true)
    assert.equal((await client.request('GET', '/_dsh_platform/api/v1/logs?source=gateway')).entries[0].message, 'ready')
    assert.equal((await client.request('PUT', '/_dsh_platform/api/v1/channel', { channel: 'experimental' })).updateChannel, 'experimental')
    assert.deepEqual(await client.request('PUT', '/_dsh_platform/api/v1/automatic-check', {
      enabled: true, intervalSeconds: 21_600, notificationsEnabled: false,
    }), { enabled: true, intervalSeconds: 21_600, notificationsEnabled: false })
    assert.equal((await client.request('POST', '/_dsh_platform/api/v1/holds/retry', { id: 'hold-a' })).retried, 'hold-a')
    assert.equal((await client.request('GET', '/_dsh_platform/api/v1/rollback-plan')).plan.planId, 'plan-a')
    coordinator.running = false
    assert.deepEqual(await client.request('POST', '/_dsh_platform/api/v1/rollback', { planId: 'plan-a' }), { taskId: 'rollback-task' })
    const audit = await logs.query({ sources: ['audit'] })
    assert.equal(audit.some(entry => entry.message === 'update.channel.changed' && entry.updateChannel === 'experimental'), true)
    assert.equal(audit.some(entry => entry.message === 'update.automatic-check.configured' && entry.intervalSeconds === 21_600), true)
    assert.equal(audit.some(entry => entry.message === 'update.hold.retried' && entry.holdId === 'hold-a'), true)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management proxies sanitized outbound configuration, Provider inventory, and structured conflicts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-outbound-proxy-'))
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  const view = {
    schema: 1, enabled: false, revision: 'revision-one', componentReady: true,
    proxy: { protocol: 'http', host: '', port: null, username: '', passwordConfigured: false, remoteDns: true },
    scopes: {}, environment: { allProxy: null }, modelApi: { default: 'direct', providers: {} },
    noProxy: { system: ['localhost'], user: [] }, bypass: { additional: [] },
    routeHealth: {}, lastTest: null, scopeCatalog: { schema: 1, entries: [] },
  }
  const providers = { schema: 1, source: 'live', providers: [{ id: 'deepseek', routingCapability: 'shared-dsh' }] }
  const updates = []
  const server = createManagementServer({
    coordinator: new Coordinator(), logs,
    getProxyConfiguration: async () => view,
    listProxyProviders: async () => providers,
    updateProxyConfiguration: async value => {
      updates.push(value)
      if (value.baseRevision !== view.revision) {
        const error = new Error('proxy configuration changed')
        error.statusCode = 409
        error.code = 'REVISION_CONFLICT'
        error.stage = 'activate'
        error.retryable = true
        error.proxyError = {
          code: error.code, message: error.message, stage: error.stage, retryable: error.retryable,
        }
        throw error
      }
      return { ...view, revision: 'revision-two' }
    },
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    assert.deepEqual(await client.request('GET', `${API_PREFIX}proxy`), view)
    assert.deepEqual(await client.request('GET', `${API_PREFIX}proxy/provider-inventory`), providers)
    const configured = await client.request('PUT', `${API_PREFIX}proxy`, {
      baseRevision: view.revision,
      value: { password: 'must-not-log' },
    })
    assert.equal(configured.revision, 'revision-two')
    assert.deepEqual(updates, [{ baseRevision: view.revision, value: { password: 'must-not-log' } }])

    const bytes = Buffer.from(JSON.stringify({ baseRevision: 'stale', value: {} }))
    const conflict = await new Promise((resolve, reject) => {
      const outgoing = httpRequest({
        socketPath, method: 'PUT', path: `${API_PREFIX}proxy`,
        headers: { 'content-type': 'application/json', 'content-length': bytes.byteLength },
      }, response => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }))
      })
      outgoing.once('error', reject)
      outgoing.end(bytes)
    })
    assert.equal(conflict.status, 409)
    assert.deepEqual(conflict.body, { error: {
      code: 'REVISION_CONFLICT', message: 'proxy configuration changed', stage: 'activate', retryable: true,
    } })
    const audit = await logs.query({ sources: ['audit'] })
    assert.equal(audit.some(entry => entry.message === 'proxy.configuration.update.completed' && entry.revision === 'revision-two'), true)
    assert.equal(audit.some(entry => entry.message === 'proxy.configuration.update.failed' && entry.code === 'REVISION_CONFLICT'), true)
    assert.equal(JSON.stringify(audit).includes('must-not-log'), false)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management exposes one reconnectable and cancellable outbound proxy test task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-proxy-test-'))
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  const taskId = '123e4567-e89b-42d3-a456-426614174000'
  let status = 'running'
  let cancelled = false
  const state = () => ({
    schema: 1, taskId, status, baseRevision: 'revision-one', candidateHash: `sha256:${'a'.repeat(64)}`,
    mode: 'proxy', currentStage: status === 'running' ? 'proxy-connect' : null,
    stages: [{ stage: 'proxy-connect', status: status === 'running' ? 'running' : 'success', durationMs: 5, errorCode: null, detail: null }],
    error: null, createdAt: '2026-08-25T00:00:00.000Z', updatedAt: new Date().toISOString(),
  })
  const server = createManagementServer({
    coordinator: new Coordinator(), logs,
    startProxyTest: async () => state(),
    getProxyTest: async requested => {
      assert.equal(requested, taskId)
      return state()
    },
    cancelProxyTest: async requested => {
      assert.equal(requested, taskId)
      cancelled = true
      status = 'cancelled'
      return state()
    },
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    assert.deepEqual(await client.request('POST', `${API_PREFIX}proxy/test`, {
      baseRevision: 'revision-one', value: {},
    }), { taskId })
    assert.equal((await client.request('GET', `${API_PREFIX}status`)).proxyTestOperation.taskId, taskId)
    assert.equal((await client.request('GET', `${API_PREFIX}proxy/test/tasks/${taskId}`)).status, 'running')
    assert.equal((await client.request('DELETE', `${API_PREFIX}proxy/test/tasks/${taskId}`)).status, 'cancelled')
    assert.equal(cancelled, true)
    await new Promise(resolve => setTimeout(resolve, 300))
    const audit = await logs.query({ sources: ['audit'] })
    assert.equal(audit.some(entry => entry.message === 'proxy.test.started'), true)
    assert.equal(audit.some(entry => entry.message === 'proxy.test.cancel-requested' && entry.taskId === taskId), true)
    assert.equal(audit.some(entry => entry.message === 'proxy.test.cancelled' && entry.taskId === taskId), true)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management exposes audited System Skill tasks through the shared runtime mutex', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-system-skills-'))
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  let complete
  const pending = new Promise(resolve => { complete = resolve })
  const calls = []
  const skills = [{
    id: 'dsh-docker-operations', sha256: 'a'.repeat(64),
    description: { zh: '容器操作手册', en: 'Container operations guide' }, installed: true, enabled: true,
  }]
  const server = createManagementServer({
    coordinator: new Coordinator(),
    logs,
    listSystemSkills: async () => skills,
    configureSystemSkill: async (skillId, action) => { calls.push({ skillId, action }); await pending },
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    assert.deepEqual((await client.request('GET', `${API_PREFIX}system-skills`)).skills, skills)
    const task = await client.request('POST', `${API_PREFIX}system-skills/action`, {
      skillId: 'dsh-docker-operations', action: 'disable',
    })
    assert.match(task.taskId, /^[0-9a-f-]{36}$/)
    await assert.rejects(client.request('POST', `${API_PREFIX}restart-dsh`), error => error.statusCode === 409)
    await assert.rejects(client.request('POST', `${API_PREFIX}system-skills/action`, {
      skillId: 'dsh-docker-operations', action: 'disable', unexpected: true,
    }), error => error.statusCode === 400)
    complete()
    let status
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS; attempt += 1) {
      status = await client.request('GET', `${API_PREFIX}status`)
      if (status.systemSkillOperation.status === 'success') break
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.equal(status.systemSkillOperation.status, 'success')
    assert.deepEqual(calls, [{ skillId: 'dsh-docker-operations', action: 'disable' }])
    const audit = await logs.query({ sources: ['audit'] })
    assert.equal(audit.some(entry => entry.message === 'system-skill.disable.started'), true)
    assert.equal(audit.some(entry => entry.message === 'system-skill.disable.completed'), true)
  } finally {
    complete()
    await new Promise(resolve => server.close(resolve))
  }
})

test('management exposes validated User Skill tasks only on the standalone API', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-user-skills-'))
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  let complete
  const pending = new Promise(resolve => { complete = resolve })
  const revision = `sha256:${'a'.repeat(64)}`
  const entryId = `sha256:${'b'.repeat(64)}`
  const inventory = {
    schema: 1, revision,
    skills: [{ entryId, entryName: 'local-guide', source: 'user-dsh', kind: 'directory', name: 'local-guide', description: 'Local guide', enabled: true, damaged: false, metadataError: null, symbolicLink: false }],
  }
  const calls = []
  const server = createManagementServer({
    coordinator: new Coordinator(),
    logs,
    listUserSkills: async () => inventory,
    validateUserSkillAction: async value => {
      if (value.revision !== revision) {
        const error = new Error('User Skill state changed')
        error.statusCode = 409
        throw error
      }
    },
    configureUserSkill: async value => {
      calls.push(value)
      if (value.action === 'delete') throw new Error('permission denied')
      await pending
    },
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    assert.deepEqual(await client.request('GET', `${API_PREFIX}user-skills`), inventory)
    await assert.rejects(client.request('POST', `${API_PREFIX}user-skills/action`, {
      entryId, revision: `sha256:${'c'.repeat(64)}`, action: 'disable',
    }), error => error.statusCode === 409)
    await assert.rejects(client.request('POST', `${API_PREFIX}user-skills/action`, {
      entryId, revision, action: 'disable', unexpected: true,
    }), error => error.statusCode === 400)
    const task = await client.request('POST', `${API_PREFIX}user-skills/action`, { entryId, revision, action: 'disable' })
    assert.match(task.taskId, /^[0-9a-f-]{36}$/)
    await assert.rejects(client.request('POST', `${API_PREFIX}restart-dsh`), error => error.statusCode === 409)
    await assert.rejects(client.request('POST', `${API_PREFIX}user-skills/action`, {
      entryId, revision, action: 'disable',
    }), error => error.statusCode === 409)
    complete()
    let status
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS; attempt += 1) {
      status = await client.request('GET', `${API_PREFIX}status`)
      if (status.userSkillOperation.status === 'success') break
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.equal(status.userSkillOperation.status, 'success')
    const failedTask = await client.request('POST', `${API_PREFIX}user-skills/action`, { entryId, revision, action: 'delete' })
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS; attempt += 1) {
      status = await client.request('GET', `${API_PREFIX}status`)
      if (status.userSkillOperation.taskId === failedTask.taskId && status.userSkillOperation.status === 'failed') break
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.equal(status.userSkillOperation.status, 'failed')
    assert.equal(status.userSkillOperation.error, 'permission denied')
    assert.deepEqual(calls, [{ entryId, revision, action: 'disable' }, { entryId, revision, action: 'delete' }])
    const audit = await logs.query({ sources: ['audit'] })
    assert.equal(audit.some(entry => entry.message === 'user-skill.disable.started'), true)
    assert.equal(audit.some(entry => entry.message === 'user-skill.disable.completed'), true)
    assert.equal(audit.some(entry => entry.message === 'user-skill.delete.started'), true)
    assert.equal(audit.some(entry => entry.message === 'user-skill.delete.failed' && entry.error === 'permission denied'), true)
  } finally {
    complete()
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
    await new Promise(resolve => setTimeout(resolve, 300))
    await appendFile(logs.currentPath('gateway'), `${JSON.stringify({
      timestamp: new Date().toISOString(), source: 'gateway', stream: 'stdout', level: 'info', message: 'must-stream',
    })}\n`)
    await Promise.race([
      live,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for live log')), 1_000)),
    ])
    assert.match(body, /must-stream/)
    assert.doesNotMatch(body, /must-not-stream/)
    assert.equal(response.headers['x-accel-buffering'], 'no')
    assert.equal(response.headers['cache-control'], 'no-cache, no-transform')
  } finally {
    request?.destroy()
    response?.destroy()
    await new Promise(resolve => server.close(resolve))
  }
})

test('management state events keep idle proxy connections alive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-state-stream-'))
  const server = createManagementServer({
    coordinator: new Coordinator(),
    logs: new JsonlLogManager({ root: join(root, 'logs') }),
    stateHeartbeatMs: 10,
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  let request
  let response
  try {
    ({ request, response } = await new Promise((resolve, reject) => {
      const nextRequest = httpRequest({ socketPath, path: `${API_PREFIX}events` }, nextResponse => {
        resolve({ request: nextRequest, response: nextResponse })
      })
      nextRequest.once('error', reject)
      nextRequest.end()
    }))
    let body = ''
    await Promise.race([
      new Promise(resolve => {
        response.on('data', chunk => {
          body += chunk.toString('utf8')
          if (body.includes('event: heartbeat')) resolve()
        })
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for state heartbeat')), 1_000)),
    ])
    assert.match(body, /event: state/)
    assert.match(body, /event: heartbeat/)
    assert.equal(response.headers['x-accel-buffering'], 'no')
    assert.equal(response.headers['cache-control'], 'no-cache, no-transform')
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

test('management treats a page-open check during an update as an accepted no-op', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-busy-page-open-'))
  const coordinator = new Coordinator()
  coordinator.check = async () => ({ busy: true })
  const server = createManagementServer({
    coordinator,
    logs: new JsonlLogManager({ root: join(root, 'logs') }),
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  try {
    const response = await rawRequest(socketPath, `${API_PREFIX}check`, 'POST')
    assert.equal(response.status, 202)
    assert.deepEqual(JSON.parse(response.body), { busy: true })
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
  let finishLoadedStateCapture
  const loadedStateCaptureCompletion = new Promise(resolve => { finishLoadedStateCapture = resolve })
  let restarts = 0
  let loadedStateCaptures = 0
  const server = createManagementServer({
    coordinator,
    logs,
    restartDelayMs: 0,
    restartDsh: async () => {
      restarts += 1
      await restartCompletion
    },
    markUserPluginsLoaded: async () => {
      loadedStateCaptures += 1
      await loadedStateCaptureCompletion
    },
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    const task = await client.request('POST', '/_dsh_platform/api/v1/restart-dsh')
    assert.equal(typeof task.taskId, 'string')
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS && restarts === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.equal(restarts, 1)
    assert.equal((await client.request('GET', '/_dsh_platform/api/v1/status')).dshLifecycle.state, 'restarting')
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
    assert.equal(status.dshLifecycle.state, 'running')
    assert.equal(status.dshLifecycle.taskId, task.taskId)
    assert.equal(loadedStateCaptures, 1)
    finishLoadedStateCapture()
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
    restartDelayMs: 0,
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

test('management returns the restart task before the configured restart delay elapses', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-restart-delay-'))
  let restarted = false
  const server = createManagementServer({
    coordinator: new Coordinator(),
    logs: new JsonlLogManager({ root: join(root, 'logs') }),
    restartDelayMs: 40,
    restartDsh: async () => { restarted = true },
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    const task = await client.request('POST', `${API_PREFIX}restart-dsh`)
    assert.equal(typeof task.taskId, 'string')
    assert.equal(restarted, false)
    await new Promise(resolve => setTimeout(resolve, 60))
    assert.equal(restarted, true)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management starts and stops DSH through the unified lifecycle state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-lifecycle-'))
  const calls = []
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  const server = createManagementServer({
    coordinator: new Coordinator(),
    logs,
    startDsh: async () => { calls.push('start') },
    stopDsh: async () => { calls.push('stop') },
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    const stopped = await client.request('POST', `${API_PREFIX}stop-dsh`)
    let status
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS; attempt += 1) {
      status = await client.request('GET', `${API_PREFIX}status`)
      if (status.dshLifecycle.taskId === stopped.taskId && status.dshLifecycle.state === 'stopped') break
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.equal(status.dshLifecycle.state, 'stopped')
    assert.equal(status.dshLifecycle.action, null)

    const started = await client.request('POST', `${API_PREFIX}start-dsh`)
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS; attempt += 1) {
      status = await client.request('GET', `${API_PREFIX}status`)
      if (status.dshLifecycle.taskId === started.taskId && status.dshLifecycle.state === 'running') break
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.equal(status.dshLifecycle.state, 'running')
    assert.deepEqual(calls, ['stop', 'start'])
    assert.deepEqual((await logs.query({ sources: ['audit'] })).map(entry => entry.message), [
      'dsh.stop.started', 'dsh.stop.completed', 'dsh.start.started', 'dsh.start.completed',
    ])
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management preserves a completed lifecycle task until Bootstrap publishes a newer state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-lifecycle-merge-'))
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  let bootstrapLifecycle = {
    state: 'running', action: null, taskId: null, attempt: 0, maxAttempts: 3,
    error: null, updatedAt: '2026-08-22T00:00:00.000Z',
  }
  const server = createManagementServer({
    coordinator: new Coordinator(),
    logs,
    platformStatus: async () => ({ dshLifecycle: bootstrapLifecycle }),
    startDsh: async () => {},
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    const started = await client.request('POST', `${API_PREFIX}start-dsh`)
    let status
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS; attempt += 1) {
      status = await client.request('GET', `${API_PREFIX}status`)
      if (status.dshLifecycle.taskId === started.taskId && status.dshLifecycle.state === 'running') break
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.equal(status.dshLifecycle.taskId, started.taskId)

    bootstrapLifecycle = {
      ...bootstrapLifecycle,
      state: 'recovering', action: 'auto-recover', attempt: 1,
      updatedAt: '2099-08-22T00:00:00.000Z',
    }
    status = await client.request('GET', `${API_PREFIX}status`)
    assert.equal(status.dshLifecycle.state, 'recovering')
    assert.equal(status.dshLifecycle.attempt, 1)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management resets the current Runtime as an audited exclusive task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-runtime-reset-'))
  const coordinator = new Coordinator()
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  let finishReset
  const completion = new Promise(resolve => { finishReset = resolve })
  let resets = 0
  const server = createManagementServer({
    coordinator,
    logs,
    resetRuntime: async () => {
      resets += 1
      await completion
    },
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    const task = await client.request('POST', '/_dsh_platform/api/v1/runtime/reset')
    assert.equal(typeof task.taskId, 'string')
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS && resets === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.equal(resets, 1)
    assert.equal((await client.request('GET', '/_dsh_platform/api/v1/status')).runtimeReset.status, 'resetting')
    for (const path of ['runtime/reset', 'restart-dsh', 'update']) {
      await assert.rejects(
        client.request('POST', `/_dsh_platform/api/v1/${path}`),
        error => error.statusCode === 409,
      )
    }
    finishReset()
    await new Promise(resolve => setImmediate(resolve))
    await logs.queue
    const status = await client.request('GET', '/_dsh_platform/api/v1/status')
    assert.equal(status.runtimeReset.status, 'success')
    assert.equal(status.runtimeReset.taskId, task.taskId)
    assert.deepEqual(
      (await logs.query({ sources: ['audit'] })).map(entry => entry.message),
      ['runtime.reset.started', 'runtime.reset.completed'],
    )
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management exposes recoverable User Plugin tasks under the shared runtime mutex', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-user-plugins-'))
  const coordinator = new Coordinator()
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  let finish
  const completion = new Promise(resolve => { finish = resolve })
  const calls = []
  const inventory = {
    schema: 1,
    profile: 'web',
    revision: `sha256:${'a'.repeat(64)}`,
    plugins: [{ name: 'faulty-plugin', enabled: true, damaged: false }],
  }
  const server = createManagementServer({
    coordinator,
    logs,
    listUserPlugins: async () => inventory,
    validateUserPluginActions: async value => {
      calls.push(['validate', value])
      if (value.revision !== inventory.revision) {
        const error = new Error('revision changed')
        error.code = 'REVISION_CONFLICT'
        throw error
      }
      return value
    },
    applyUserPluginActions: async value => {
      calls.push(['apply', value.taskId, value.revision, value.actions])
      value.onProgress({ phase: 'paused' })
      await completion
      value.onProgress({ phase: 'completed' })
    },
  })
  const socketPath = join(root, 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    assert.deepEqual(await client.request('GET', `${API_PREFIX}user-plugins`), inventory)
    const request = {
      profile: 'web', revision: inventory.revision,
      actions: [{ name: 'faulty-plugin', action: 'disable' }],
    }
    const started = await client.request('POST', `${API_PREFIX}user-plugins/apply`, request)
    assert.match(started.taskId, /^[0-9a-f-]{36}$/)
    let status
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS; attempt += 1) {
      status = await client.request('GET', `${API_PREFIX}status`)
      if (status.userPluginOperation.phase === 'paused') break
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.equal(status.userPluginOperation.status, 'running')
    assert.equal(status.userPluginOperation.phase, 'paused')
    assert.equal((await client.request('GET', `${API_PREFIX}user-plugins/task/${started.taskId}`)).status, 'running')
    for (const [path, body] of [
      ['restart-dsh', undefined],
      ['update', undefined],
      ['bundled-plugins/action', { id: 'diagnostics', action: 'disable' }],
      ['user-plugins/apply', request],
    ]) {
      await assert.rejects(client.request('POST', `${API_PREFIX}${path}`, body), error => error.statusCode === 409)
    }
    finish()
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS; attempt += 1) {
      status = await client.request('GET', `${API_PREFIX}status`)
      if (status.userPluginOperation.status === 'success') break
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.equal(status.userPluginOperation.phase, 'completed')
    assert.equal((await client.request('GET', `${API_PREFIX}user-plugins/task/${started.taskId}`)).status, 'success')
    assert.deepEqual(calls[0], ['validate', { revision: inventory.revision, actions: request.actions }])
    assert.deepEqual(calls[1].slice(0, 3), ['apply', started.taskId, inventory.revision])
    await assert.rejects(client.request('POST', `${API_PREFIX}user-plugins/apply`, {
      ...request, revision: `sha256:${'b'.repeat(64)}`,
    }), error => error.statusCode === 409)
    await assert.rejects(
      client.request('GET', `${API_PREFIX}user-plugins/task/123e4567-e89b-42d3-a456-426614174000`),
      error => error.statusCode === 404,
    )
    await logs.queue
    assert.deepEqual((await logs.query({ sources: ['audit'] })).map(entry => entry.message), [
      'user-plugin.apply.started', 'user-plugin.apply.completed',
    ])
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management resumes a persisted User Plugin transaction after its socket is available', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-user-plugin-resume-'))
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  let recover
  const recovery = new Promise(resolve => { recover = resolve })
  const server = createManagementServer({
    coordinator: new Coordinator(),
    logs,
    recoverUserPluginTransaction: async () => recovery,
  })
  const socketPath = join(root, 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    await assert.rejects(client.request('POST', `${API_PREFIX}restart-dsh`), error => error.statusCode === 409)
    recover({
      taskId: 'resume-task', phase: 'failed', error: 'interrupted change restored', recoveryResult: 'success',
    })
    let status
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS; attempt += 1) {
      status = await client.request('GET', `${API_PREFIX}status`)
      if (status.userPluginOperation.taskId === 'resume-task') break
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.equal(status.userPluginOperation.status, 'failed')
    assert.equal(status.userPluginOperation.error, 'interrupted change restored')
    await logs.queue
    assert.equal((await logs.query({ sources: ['audit'] })).at(-1).message, 'user-plugin.recovery.completed')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('standalone Management disables a startup-faulting Bundle while DSH is already down', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-fault-plugin-'))
  const dshHome = join(root, 'dsh')
  const profileRoot = join(dshHome, 'profiles/web')
  const pluginRoot = join(profileRoot, 'node_modules/startup-fault')
  const selectionPath = join(root, 'platform/state/management/user-plugins.json')
  await mkdir(pluginRoot, { recursive: true })
  await writeFile(join(profileRoot, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: { 'startup-fault': '1.0.0' },
    dsh: { profile: { bundles: ['startup-fault'] } },
  }))
  await writeFile(join(profileRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  await writeFile(join(pluginRoot, 'package.json'), JSON.stringify({
    name: 'startup-fault', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  await writeFile(join(pluginRoot, 'cordis.patch.yml'), '- insert: [{ id: startup-fault, name: startup-fault }]\n')
  const inventory = new UserPluginInventory({ dshHome, selectionPath })
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  let paused = 0
  let restarted = 0
  const transactions = new UserPluginTransactionManager({
    inventory,
    selectionStore: new UserPluginSelectionStore(selectionPath),
    snapshots: new UserPluginSnapshots({ root: join(root, 'platform/store/snapshots/user-plugins'), profileRoot }),
    journal: new UserPluginJournal(join(root, 'platform/state/management/user-plugin-transaction.json')),
    pauseDsh: async () => { paused += 1 },
    restartDelayMs: 0,
    restartDsh: async () => {
      restarted += 1
      const manifest = JSON.parse(await readFile(join(profileRoot, 'package.json'), 'utf8'))
      if (manifest.dsh.profile.bundles.includes('startup-fault')) throw new Error('startup-fault crashed DSH')
    },
    report: (message, fields) => logs.diagnostic('user-plugin-manager', message, fields),
  })
  const server = createManagementServer({
    coordinator: new Coordinator(),
    logs,
    platformStatus: async () => ({ recoveryMode: 'startup-fault crashed DSH' }),
    listUserPlugins: () => inventory.read(),
    validateUserPluginActions: value => transactions.validate(value),
    applyUserPluginActions: value => transactions.apply(value),
  })
  const socketPath = join(root, 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    const listed = await client.request('GET', `${API_PREFIX}user-plugins`)
    assert.deepEqual(listed.plugins.map(plugin => [plugin.name, plugin.enabled]), [['startup-fault', true]])
    assert.equal((await client.request('GET', `${API_PREFIX}status`)).recoveryMode, 'startup-fault crashed DSH')
    const task = await client.request('POST', `${API_PREFIX}user-plugins/apply`, {
      profile: 'web', revision: listed.revision,
      actions: [{ name: 'startup-fault', action: 'disable' }],
    })
    let state
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS; attempt += 1) {
      state = await client.request('GET', `${API_PREFIX}user-plugins/task/${task.taskId}`)
      if (state.status !== 'running') break
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.equal(state.status, 'success')
    assert.equal(paused, 1)
    assert.equal(restarted, 1)
    const manifest = JSON.parse(await readFile(join(profileRoot, 'package.json'), 'utf8'))
    assert.deepEqual(manifest.dsh.profile.bundles, [])
    await logs.queue
    assert.deepEqual((await logs.query({ sources: ['user-plugin-manager'] })).map(entry => entry.message), [
      'user-plugin.transaction.started', 'user-plugin.transaction.completed',
    ])
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
    restartDelayMs: 0,
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
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS && calls.length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.deepEqual(calls, [['diagnostics', 'disable']])
    assert.equal((await client.request('GET', '/_dsh_platform/api/v1/status')).systemPluginOperation.status, 'running')
    assert.equal((await client.request('GET', `/_dsh_platform/api/v1/bundled-plugins/task/${task.taskId}`)).status, 'running')
    await assert.rejects(
      client.request('GET', '/_dsh_platform/api/v1/bundled-plugins/task/123e4567-e89b-42d3-a456-426614174000'),
      error => error.statusCode === 404,
    )
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
    assert.equal((await client.request('GET', `/_dsh_platform/api/v1/bundled-plugins/task/${task.taskId}`)).status, 'success')
    assert.deepEqual(
      (await logs.query({ sources: ['audit'] })).map(entry => entry.message),
      ['system-plugin.disable.started', 'system-plugin.disable.completed'],
    )
    await client.request('POST', '/_dsh_platform/api/v1/restart-dsh')
    let restarted
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS; attempt += 1) {
      restarted = await client.request('GET', '/_dsh_platform/api/v1/status')
      if (restarted.dshLifecycle.state === 'running') break
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.equal(restarted.dshLifecycle.state, 'running')
    assert.equal(restarted.systemPluginOperation.restartRequired, false)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management toggle endpoint accepts only enable and disable actions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-plugin-toggle-'))
  const calls = []
  const server = createManagementServer({
    coordinator: new Coordinator(),
    logs: new JsonlLogManager({ root: join(root, 'logs') }),
    configureBundledPlugin: async (id, action) => { calls.push([id, action]) },
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    await assert.rejects(client.request('POST', `${API_PREFIX}bundled-plugins/toggle`, {
      id: 'diagnostics', action: 'install',
    }), error => error.statusCode === 400)
    const task = await client.request('POST', `${API_PREFIX}bundled-plugins/toggle`, {
      id: 'diagnostics', action: 'disable',
    })
    assert.equal(typeof task.taskId, 'string')
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS && calls.length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.deepEqual(calls, [['diagnostics', 'disable']])
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management discards unapplied System Plugin changes and clears restart state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-plugin-discard-'))
  let discarded = 0
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  const server = createManagementServer({
    coordinator: new Coordinator(),
    logs,
    configureBundledPlugin: async () => {},
    discardBundledPluginChanges: async () => {
      discarded += 1
      return { plugins: [{ id: 'diagnostics', pendingRestart: false }] }
    },
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    await client.request('POST', `${API_PREFIX}bundled-plugins/action`, {
      id: 'diagnostics', action: 'disable',
    })
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS; attempt += 1) {
      if ((await client.request('GET', `${API_PREFIX}status`)).systemPluginOperation.restartRequired) break
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    let result
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS; attempt += 1) {
      try {
        result = await client.request('POST', `${API_PREFIX}bundled-plugins/discard`)
        break
      } catch (error) {
        if (error.statusCode !== 409) throw error
        await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
      }
    }
    assert.notEqual(result, undefined)
    assert.equal(discarded, 1)
    assert.deepEqual(result, { plugins: [{ id: 'diagnostics', pendingRestart: false }] })
    assert.equal((await client.request('GET', `${API_PREFIX}status`)).systemPluginOperation.restartRequired, false)
    assert.deepEqual((await logs.query({ sources: ['audit'] })).map(entry => entry.message), [
      'system-plugin.disable.started',
      'system-plugin.disable.completed',
      'system-plugin.changes.discarded',
    ])
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management keeps the System Plugin restart marker when DSH restart fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-plugin-restart-failure-'))
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  const server = createManagementServer({
    coordinator: new Coordinator(),
    logs,
    configureBundledPlugin: async () => {},
    restartDelayMs: 0,
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
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS; attempt += 1) {
      status = await client.request('GET', '/_dsh_platform/api/v1/status')
      if (status.systemPluginOperation.status === 'success') break
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.equal(status.systemPluginOperation.restartRequired, true)
    await client.request('POST', '/_dsh_platform/api/v1/restart-dsh')
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS; attempt += 1) {
      status = await client.request('GET', '/_dsh_platform/api/v1/status')
      if (status.dshLifecycle.state === 'failed') break
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.equal(status.dshLifecycle.state, 'failed')
    assert.equal(status.systemPluginOperation.restartRequired, true)
    await logs.queue
    assert.equal((await logs.query({ sources: ['audit'] })).find(entry => entry.message === 'dsh.restart.failed').level, 'error')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('management audit failures do not block a completed System Plugin operation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-audit-failure-'))
  let configured = false
  const logs = {
    diagnostic: () => { throw new Error('audit storage unavailable') },
    query: async () => [],
    on: () => {},
    off: () => {},
  }
  const server = createManagementServer({
    coordinator: new Coordinator(),
    logs,
    configureBundledPlugin: async () => { configured = true },
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    await client.request('POST', `${API_PREFIX}bundled-plugins/action`, {
      id: 'diagnostics', action: 'disable',
    })
    let status
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS; attempt += 1) {
      status = await client.request('GET', `${API_PREFIX}status`)
      if (status.systemPluginOperation.status === 'success') break
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
    }
    assert.equal(configured, true)
    assert.equal(status.systemPluginOperation.status, 'success')
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
    for (let attempt = 0; attempt < ASYNC_POLL_ATTEMPTS && calls.length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, ASYNC_POLL_INTERVAL_MS))
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
    const redirect = await rawRequest(socketPath, '/_dsh_platform/console')
    assert.equal(redirect.status, 308)
    assert.equal(redirect.headers.location, '/_dsh_platform/console/')
    const page = await rawRequest(socketPath, '/_dsh_platform/console/')
    assert.equal(page.status, 200)
    assert.match(page.headers['content-type'], /^text\/html/)
    assert.match(page.headers['content-security-policy'], /script-src 'self'/)
    assert.match(page.body, /DSH Management Console/)
    const script = await rawRequest(socketPath, '/_dsh_platform/console/app.js')
    assert.equal(script.status, 200)
    assert.match(script.body, /new EventSource/)
    const themeInit = await rawRequest(socketPath, '/_dsh_platform/console/theme-init.js')
    assert.equal(themeInit.status, 200)
    assert.match(themeInit.headers['content-type'], /^text\/javascript/)
    assert.match(themeInit.body, /console-theme/)
    const head = await rawRequest(socketPath, '/_dsh_platform/console/style.css', 'HEAD')
    assert.equal(head.status, 200)
    assert.equal(head.body, '')
    const xterm = await rawRequest(socketPath, '/_dsh_platform/console/vendor/xterm.mjs')
    assert.equal(xterm.status, 200)
    assert.match(xterm.headers['content-type'], /^text\/javascript/)
    assert.match(xterm.body, /export\{/)
    const fit = await rawRequest(socketPath, '/_dsh_platform/console/vendor/addon-fit.mjs')
    assert.equal(fit.status, 200)
    assert.match(fit.body, /FitAddon/)
    assert.match((await rawRequest(socketPath, '/_dsh_platform/console/vendor/xterm.css')).headers['content-type'], /^text\/css/)
    assert.equal((await rawRequest(socketPath, '/_dsh_platform/console/vendor/xterm.mjs.map')).status, 404)
    assert.equal((await rawRequest(socketPath, '/_dsh_platform/console/../server.mjs')).status, 404)
    assert.equal((await rawRequest(socketPath, '/_dsh_platform/console/app.js', 'POST')).status, 405)
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

test('standalone file task queue stays below file actions and scrolls within a fixed height', async () => {
  const publicRoot = new URL('../../control-plane/services/management/public/', import.meta.url)
  const html = await readFile(new URL('index.html', publicRoot), 'utf8')
  const script = await readFile(new URL('app.js', publicRoot), 'utf8')
  const style = await readFile(new URL('style.css', publicRoot), 'utf8')
  const browserOffset = html.indexOf('class="file-browser"')
  const selectionOffset = html.indexOf('class="file-selection"')
  const taskOffset = html.indexOf('id="file-task-state"')
  const archiveOffset = html.indexOf('id="file-archive-panel"')
  assert.equal(browserOffset < selectionOffset && selectionOffset < taskOffset && taskOffset < archiveOffset, true)
  assert.match(style, /\.file-task-list\s*\{[^}]*max-height:\s*180px;[^}]*overflow-y:\s*auto;/)
  assert.match(style, /\.file-main\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/)
  assert.match(style, /\.file-pagination\s*\{[^}]*margin-top:\s*auto;/)
  assert.match(script, /task\.status === 'failed' && Date\.parse\(task\.updatedAt\) >= recentCutoff/)
  assert.doesNotMatch(script, /\['success', 'failed', 'cancelled'\]/)
  assert.match(script, /fileUploadQueue = files\.map/)
  assert.match(script, /request\.upload\.onprogress/)
  assert.match(script, /\.\.\.fileUploadQueue, \.\.\.backend/)
  assert.match(script, /task\.local === true\) task\.cancel\(\)/)
  assert.match(script, /item\.webkitGetAsEntry\?\.\(\)/)
  assert.match(script, /collectDroppedEntry\(child, relativePath\)/)
  assert.match(script, /fileDropTarget\.addEventListener\('drop'/)
  assert.match(html, /class="file-drop-overlay"/)
  assert.match(style, /\.file-main\.file-dragging \.file-drop-overlay\s*\{[^}]*display:\s*grid;/)
  assert.match(html, /class="log-summary-row"><p id="log-summary"[\s\S]*id="auto-scroll" type="checkbox" checked/)
  assert.match(style, /\.log-auto-scroll \{[^}]*margin-left: auto;/)
  assert.match(script, /operationState === 'success' \|\| operation\?\.state === 'running'/)
  assert.match(script, /visibleOperationTasks\.delete\(taskId\)[\s\S]*3_000/)
  assert.match(script, /fileOperationTimer = window\.setTimeout\(\(\) => fileOperationMessage\(''\), 3_000\)/)
  assert.match(html, /id="file-editor-status" role="status" aria-live="polite"/)
  assert.match(script, /function renderFileEditorState\(\)[\s\S]*fileEditorSaving[\s\S]*fileEditorDirty/)
  assert.match(script, /const content = elements\['file-editor-content'\]\.value[\s\S]*body: \{ path, content, revision, create \}[\s\S]*fileEditorDirty = elements\['file-editor-content'\]\.value !== fileEditorOriginal/)
  assert.match(style, /\.file-editor-footer \{[^}]*justify-content: space-between;/)
})

test('standalone console keeps localized feature parity on the shared Management API', async () => {
  const publicRoot = new URL('../../control-plane/services/management/public/', import.meta.url)
  const html = await readFile(new URL('index.html', publicRoot), 'utf8')
  const script = await readFile(new URL('app.js', publicRoot), 'utf8')
  const style = await readFile(new URL('style.css', publicRoot), 'utf8')
  const serverSource = await readFile(new URL('../../control-plane/services/management/server.mjs', import.meta.url), 'utf8')
  const maintenanceSource = await readFile(new URL('../stage0/lib/maintenance-server.mjs', import.meta.url), 'utf8')
  const pluginSource = await readFile(new URL('../../environment/resources/plugins/platform-management/package/lib/client.js', import.meta.url), 'utf8')
  for (const panel of ['updates', 'maintenance', 'plugins', 'skills', 'user-skills', 'user-plugins', 'terminal', 'files']) {
    assert.match(html, new RegExp(`id="panel-${panel}"`))
  }
  const extensionTabs = [
    'tab-maintenance', 'tab-files', 'tab-terminal', 'tab-plugins',
    'tab-skills', 'tab-user-plugins', 'tab-user-skills', 'tab-updates',
  ]
    .map(id => html.indexOf(`id="${id}"`))
  assert.deepEqual(extensionTabs, [...extensionTabs].sort((left, right) => left - right))
  assert.match(html, /id="tab-maintenance"[^>]*aria-selected="true"/)
  assert.match(html, /id="panel-maintenance"[^>]*aria-labelledby="tab-maintenance">/)
  assert.match(html, /id="panel-updates"[^>]*hidden>/)
  assert.match(script, /void selectTab\('maintenance'\)/)
  for (const route of [
    'status', 'check', 'update', 'channel', 'automatic-check', 'holds/retry', 'rollback',
    'return-stable', 'start-dsh', 'stop-dsh', 'restart-dsh', 'runtime/reset', 'bundled-plugins', 'bundled-plugins/recovery-action',
    'bundled-plugins/discard', 'system-skills', 'system-skills/action', 'user-skills', 'user-skills/action', 'user-plugins', 'user-plugins/apply', 'user-plugins/task/', 'logs/stream',
    'terminal/sessions',
    'files/config', 'files/list', 'files/content', 'files/upload', 'files/download', 'files/tasks',
  ]) assert.match(script, new RegExp(route.replace('/', '\\/')))
  assert.match(script, /const COPY = Object\.freeze\(\{[\s\S]*zh:[\s\S]*en:/)
  assert.match(html, /<select id="language-switch"[^>]*data-i18n-aria-label="switchLanguage"/)
  assert.match(html, /<option value="zh">中文<\/option>[\s\S]*<option value="en">English<\/option>/)
  assert.match(html, /<script src="\.\/theme-init\.js"><\/script>[\s\S]*<link rel="stylesheet" href="\.\/style\.css">/)
  assert.match(html, /<button id="theme-switch" class="theme-switch"[^>]*>[\s\S]*data-theme-icon="system"[\s\S]*data-theme-icon="light"[\s\S]*data-theme-icon="dark"/)
  assert.equal((html.match(/class="theme-icon"[^>]*>[\s\S]*?<svg viewBox="0 0 24 24">/g) ?? []).length, 3)
  assert.match(script, /LANGUAGE_KEY = 'dsh-platform:console-language'/)
  assert.match(script, /THEME_KEY = 'dsh-platform:console-theme'/)
  assert.match(script, /const override = storageValue\(LANGUAGE_KEY\)[\s\S]*navigator\.language[\s\S]*=== 'zh' \? 'zh' : 'en'/)
  assert.doesNotMatch(script, /name === 'dsh_locale'/)
  assert.match(script, /switchLanguage: '语言'/)
  assert.match(script, /switchLanguage: 'Language'/)
  assert.match(script, /elements\['language-switch'\]\.value = locale/)
  assert.match(script, /elements\['language-switch'\]\.addEventListener\('change',[\s\S]*writeStorage\(LANGUAGE_KEY, event\.target\.value\)[\s\S]*window\.location\.reload\(\)/)
  assert.match(script, /THEME_ORDER = Object\.freeze\(\['system', 'light', 'dark'\]\)/)
  assert.match(script, /elements\['theme-switch'\]\.addEventListener\('click',[\s\S]*writeStorage\(THEME_KEY,[\s\S]*applyTheme\(themePreference\)[\s\S]*renderThemeControl\(\)/)
  assert.match(script, /document\.documentElement\.dataset\.theme = preference[\s\S]*delete document\.documentElement\.dataset\.theme/)
  assert.match(script, /checkUpdates\('page-open'\)/)
  assert.match(script, /if \(statusLoad !== undefined\) return statusLoad/)
  assert.match(script, /statusLoadRevision \+= 1/)
  assert.match(script, /while \(loadedRevision !== statusLoadRevision\)/)
  const statusLoader = script.slice(script.indexOf('function loadStatus()'), script.indexOf('async function discardSystemPluginDraft()'))
  assert.match(statusLoader, /next = await api\('status'\)[\s\S]*setConnection\('online'\)/)
  assert.doesNotMatch(statusLoader, /loadInventory|loadInventories/)
  assert.match(script, /if \(inventoryLoads\[key\] !== undefined\) return inventoryLoads\[key\]/)
  assert.match(script, /inventoryLoadRevisions\[key\] \+= 1[\s\S]*while \(loadedRevision !== inventoryLoadRevisions\[key\]\)/)
  const inventoryLoader = script.slice(script.indexOf('const INVENTORY_LOADERS'), script.indexOf('function loadStatus()'))
  for (const [key, route] of [['plugins', 'bundled-plugins'], ['systemSkills', 'system-skills'], ['userSkills', 'user-skills'], ['userPlugins', 'user-plugins']]) {
    assert.match(inventoryLoader, new RegExp(`${key}: Object\\.freeze\\(\\{ path: '${route}'`))
  }
  assert.match(inventoryLoader, /loader\.apply\(await api\(loader\.path\)\)[\s\S]*inventoriesLoaded\[key\] = true[\s\S]*render\(status\)/)
  assert.doesNotMatch(inventoryLoader, /Promise\.all\(\[[\s\S]*bundled-plugins[\s\S]*system-skills/)
  assert.match(script, /function renderUserSkills\(busy\)[\s\S]*userSkillInventory\.skills/)
  assert.match(script, /function renderUserSkills\(busy\)[\s\S]*row\.className = 'user-plugin-row'/)
  assert.match(script, /expandedUserSkillDescriptions\.has\(skill\.entryId\)[\s\S]*description\.className = `user-plugin-description/)
  assert.match(script, /description\.scrollWidth > description\.clientWidth[\s\S]*description\.classList\.add\('expandable'\)/)
  assert.match(script, /heading\.append\(userPluginBadge\([\s\S]*identity\.append\(heading, description, metadata\)/)
  assert.match(script, /requestConfirmation\(\{[\s\S]*deleteUserSkillTitle[\s\S]*deleteUserSkillDetail/)
  assert.match(script, /runSkillTask\('user-skills\/action', \{[\s\S]*entryId: skill\.entryId, revision: userSkillInventory\.revision, action/)
  assert.match(script, /function waitForManagementTask\(taskId, operationKey\)[\s\S]*operation\?\.taskId === taskId[\s\S]*operation\.status !== 'running'/)
  assert.match(script, /function runSkillTask\(path, body, operationKey\)[\s\S]*waitForManagementTask\(task\.taskId, operationKey\)[\s\S]*refreshInventory\(operationKey === 'systemSkillOperation' \? 'systemSkills' : 'userSkills'\)/)
  assert.match(script, /system-skills\/action'[\s\S]*systemSkillOperation/)
  assert.match(script, /user-skills\/action'[\s\S]*userSkillOperation/)
  assert.match(script, /inventoryKeyForTab\(tab[\s\S]*'user-skills': 'userSkills'/)
  assert.match(script, /userSkillsTab: '用户技能'/)
  assert.match(script, /userSkillsTab: 'User skills'/)
  assert.match(script, /const inventoryKey = inventoryKeyForTab\(tab\)[\s\S]*void loadInventory\(inventoryKey\)/)
  assert.match(script, /if \(inventoriesLoaded\.plugins\) renderBundledPlugins/)
  assert.match(script, /if \(inventoriesLoaded\.userSkills\) renderUserSkills/)
  assert.match(script, /LIST_PAGE_SIZES = Object\.freeze\(\[5, 10, 20, 50\]\)/)
  assert.match(script, /LIST_PAGE_SIZE_KEY_PREFIX = 'dsh-platform:console-page-size:'/)
  assert.match(script, /function paginated\(key, values\)[\s\S]*values\.slice\(start, start \+ pageSize\)/)
  assert.match(script, /elements\[`\$\{prefix\}-pagination`\]\.hidden = false/)
  assert.match(script, /writeStorage\(`\$\{LIST_PAGE_SIZE_KEY_PREFIX\}\$\{key\}`/)
  assert.match(script, /const userPluginDraft = new Map\(\)[\s\S]*for \(const plugin of paginated\('userPlugins', filtered\)\)/)
  assert.match(script, /function filteredResources\(key, values\)[\s\S]*listQueries\[key\]/)
  assert.match(script, /function expandableResourceDescription[\s\S]*scrollWidth > description\.clientWidth/)
  assert.match(script, /function preserveScrollableAncestors\(element, update\)[\s\S]*current\.scrollTop = top[\s\S]*requestAnimationFrame/)
  assert.match(script, /function toggleExpandedElement[\s\S]*preserveScrollableAncestors\(element, \(\) =>/)
  assert.match(script, /identity\.append\(\s*heading,\s*expandableResourceDescription\(pluginDescription\(plugin\)/)
  assert.match(script, /identity\.append\(\s*heading,\s*expandableResourceDescription\(skill\.description/)
  assert.match(style, /\.plugin-identity > \.resource-description \{[^}]*display: block;[^}]*margin-top: 2px;/)
  assert.match(style, /\.user-plugin-main dl \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/)
  assert.match(style, /\.user-plugin-main > \.user-plugin-description \{[^}]*display: block;[^}]*width: 100%;[^}]*margin-top: 2px;/)
  assert.match(script, /function expandableUserMetadata\(metadata, identity, expanded\)[\s\S]*value\.scrollWidth > value\.clientWidth/)
  assert.match(script, /function toggleExpandedElement\(element, identity, expanded\)[\s\S]*classList\.toggle\('expanded', isExpanded\)/)
  assert.doesNotMatch(script, /expandedUserSkillDescriptions[\s\S]{0,300}renderUserSkills\(runtimeBusy\(\)\)/)
  assert.doesNotMatch(script, /expandedUserPluginDescriptions[\s\S]{0,300}renderUserPlugins\(runtimeBusy\(\)\)/)
  assert.match(script, /expandedUserSkillMetadata[\s\S]*expandableUserMetadata\(metadata, skill\.entryId/)
  assert.match(script, /expandedUserPluginMetadata[\s\S]*expandableUserMetadata\(metadata, plugin\.name/)
  assert.match(style, /\.user-plugin-main dt, \.user-plugin-main dd \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/)
  assert.match(style, /\.user-plugin-metadata\.expanded dd \{[^}]*overflow-wrap: anywhere;[^}]*white-space: normal;/)
  assert.equal((style.match(/\.user-plugin-main dl \{/g) ?? []).length, 1)
  for (const prefix of ['plugins', 'system-skills', 'user-skills', 'user-plugins']) {
    assert.match(html, new RegExp(`id="${prefix}-search"`))
    assert.match(html, new RegExp(`id="${prefix}-page-size"`))
    assert.match(html, new RegExp(`id="${prefix}-page-previous"`))
    assert.match(html, new RegExp(`id="${prefix}-page-next"`))
    assert.match(html, new RegExp(`id="${prefix}-page-current"`))
    assert.match(html, new RegExp(`id="${prefix}-page-jump"`))
  }
  for (const [emptyId, paginationId] of [
    ['empty-plugins', 'plugins-pagination'],
    ['empty-user-plugins', 'user-plugins-pagination'],
    ['empty-skills', 'system-skills-pagination'],
    ['empty-user-skills', 'user-skills-pagination'],
  ]) assert.equal(html.indexOf(`id="${emptyId}"`) < html.indexOf(`id="${paginationId}"`), true)
  assert.match(html, /class="management-navigation"/)
  assert.equal((html.match(/class="tab-panel resource-panel"/g) ?? []).length, 4)
  assert.match(style, /html \{[^}]*height: 100%;[^}]*overflow: hidden;/)
  assert.match(style, /body \{[^}]*height: 100dvh;[^}]*overflow: hidden;/)
  assert.match(style, /main \{[^}]*height: calc\(100dvh - 64px\);[^}]*overflow: hidden;/)
  assert.match(style, /\.management-navigation \{[^}]*width: 100%;[^}]*min-width: 0;[^}]*max-width: 100%;[^}]*flex: none;/)
  assert.match(style, /\.tab-panel \{[^}]*min-height: 0;[^}]*flex: 1;[^}]*overflow-y: auto;[^}]*scrollbar-gutter: stable;/)
  assert.match(style, /\.resource-panel \.plugin-list, \.resource-panel \.user-plugin-list \{[^}]*max-height:[^}]*overflow-y: auto;/)
  assert.match(style, /\.resource-panel \.list-pagination \{[^}]*position: static;/)
  assert.match(style, /@media \(min-width: 641px\) \{[\s\S]*?\.resource-panel \.plugin-list, \.resource-panel \.user-plugin-list \{[^}]*max-height: min\(calc\(56\.25vw - 27px\), 664px\);/)
  assert.match(script, /commitListPageJump/)
  assert.match(script, /Math\.min\(lastPage, Math\.max\(0, value - 1\)\)[\s\S]*input\.value = String\(listPages\[key\] \+ 1\)/)
  assert.match(script, /listQueries\[key\] = event\.target\.value[\s\S]*listPages\[key\] = 0/)
  assert.match(script, /connectEvents\(\)[\s\S]*void \(async \(\) => \{[\s\S]*const initial = await loadStatus\(\)/)
  assert.doesNotMatch(script, /^await /m)
  assert.match(script, /initial !== undefined && UPDATE_TERMINAL_STATES\.has/)
  assert.match(script, /discardingPluginDraft[\s\S]*renderBundledPlugins\(plugins, pluginBusy\)/)
  assert.match(script, /for \(const \[id, action\] of systemPluginDraft\) systemPluginApplyingDraft\.set\(id, action\)[\s\S]*waitForManagementTask/)
  assert.match(script, /await discardSystemPluginDraft\(\)[\s\S]*checkUpdates\('page-open'\)/)
  assert.doesNotMatch(script, /NOTICE_PREFIX|notificationCandidates|renderReminder|candidateIdentity/)
  assert.doesNotMatch(html, /id="update-reminder"|id="reminder-later"|id="reminder-dismiss"/)
  assert.doesNotMatch(style, /\.update-reminder/)
  assert.match(script, /updateNotifications: '更新提醒'/)
  assert.match(script, /updateNotifications: 'Update notifications'/)
  assert.match(script, /updateNotificationsDetail: '自动检查发现新版本时，在 DSH 页面弹窗提醒更新。'/)
  assert.match(script, /LOG_CLEAR_CUTOFF_KEY = 'dsh-platform:log-clear-cutoff'/)
  assert.match(script, /sessionStorage\.setItem\(LOG_CLEAR_CUTOFF_KEY, logClearCutoff\)/)
  assert.match(script, /timestamp <= Date\.parse\(logClearCutoff\)/)
  assert.match(script, /DEFAULT_LOG_DISPLAY_LIMIT = 500/)
  assert.match(script, /limitProcessedLogEntries\(logEntries, logDisplayLimit\)/)
  assert.match(script, /expandedLogIdentities/)
  assert.match(script, /details\.textContent = JSON\.stringify\(entry, null, 2\)/)
  assert.match(script, /article\.setAttribute\('aria-expanded'/)
  assert.match(script, /chevron\.className = 'log-chevron'/)
  assert.match(script, /meta\.append\(levelLabel, sourceLabel, time\)/)
  assert.match(script, /messageRow\.append\(message, chevron\)/)
  assert.match(script, /total: logDisplayLimit/)
  assert.match(script, /writeStorage\(LOG_DISPLAY_LIMIT_KEY, String\(value\)\)/)
  assert.match(html, /id="log-limit"/)
  assert.match(script, /tab === 'maintenance' && autoScroll[\s\S]*requestAnimationFrame[\s\S]*scrollTop = elements\['log-list'\]\.scrollHeight/)
  const checkUpdates = script.slice(script.indexOf('async function checkUpdates('), script.indexOf('async function saveAutomaticCheck('))
  assert.match(checkUpdates, /await api\('check'/)
  assert.doesNotMatch(checkUpdates, /await act\(/)
  assert.match(html, /id="plugin-restart-required"/)
  assert.match(html, /id="system-plugin-draft-summary"/)
  assert.match(html, /data-channel="stable" aria-pressed="true"/)
  assert.match(html, /id="upstream-version" hidden/)
  assert.match(html, /id="update"[^>]*disabled/)
  assert.match(html, /id="cancel-system-plugin-changes"/)
  assert.match(html, /id="apply-system-plugin-changes"/)
  assert.match(html, /id="runtime-reset"[^>]*aria-controls="runtime-reset-confirmation"[^>]*aria-expanded="false"/)
  assert.match(html, /id="runtime-reset-confirmation"[^>]*hidden/)
  assert.match(script, /runtimeReset: '重置运行时'/)
  assert.match(script, /runtimeReset: 'Reset runtime'/)
  assert.match(script, /function setRuntimeResetExpanded\(expanded\)/)
  assert.match(script, /await act\('runtime\/reset', \{ method: 'POST' \}\)/)
  assert.match(script, /next\?\.runtimeReset\?\.status === 'resetting'/)
  assert.equal(html.indexOf('id="plugin-restart-required"') < html.indexOf('id="bundled-plugins"'), true)
  assert.match(script, /plugins\.some\(plugin => plugin\.pendingRestart\)/)
  assert.match(pluginSource, /statusLoadRevision\.current \+= 1/)
  assert.match(pluginSource, /if \(statusLoad\.current !== undefined\) return statusLoad\.current/)
  assert.match(pluginSource, /while \(loadedRevision !== statusLoadRevision\.current\)/)
  assert.match(pluginSource, /const API = '\/_dsh_platform\/plugin-api\/v1'/)
  assert.match(pluginSource, /href: '\/_dsh_platform\/console'/)
  assert.doesNotMatch(pluginSource, /platformAuthRequired|platformSignIn|authRequired/)
  assert.match(script, /pluginChangesPending: '有待应用的修改'/)
  assert.match(html, /id="update-progress" class="update-progress"/)
  assert.match(html, /id="progress-stage-log" class="progress-stage-log" hidden/)
  assert.match(html, /id="progress-dismiss"[\s\S]*data-i18n="dismissProgress"/)
  assert.doesNotMatch(html, /id="progress-steps"|id="progress-metrics"|id="progress-detail"/)
  assert.match(script, /function progressStageDefinitions\(update\)/)
  assert.match(script, /function stageMetricLines\(value, stage, state\)/)
  assert.match(script, /function stageItems\(stage, update, state\)/)
  assert.match(script, /stageItemsCompleted: '已完成 \{completed\}\/\{total\} 项'/)
  assert.match(script, /itemMarker\.textContent = ''/)
  assert.match(script, /metricBytesCopied: '已复制 \{processed\} \/ \{total\}'/)
  assert.match(script, /metricArtifacts: '已验证 \{processed\} \/ \{total\} 个 Artifact'/)
  assert.match(script, /function probationRemainingSeconds\(update\)[\s\S]*probation:\(\\d\+\)/)
  assert.match(script, /metricProbationRemaining: '剩余观察 \{seconds\} 秒'/)
  assert.match(script, /taskId: String\(taskId\), operation: String\(update\.operation \?\? 'update'\), limit: '1000'/)
  assert.match(script, /function progressLogStage\(phase, update = progressLogUpdate\)/)
  assert.match(script, /function isRecoveryOperation\(operation\)[\s\S]*operation === 'return-stable'/)
  assert.match(script, /returnStableProgress: '返回稳定通道'/)
  assert.match(script, /'restoring-data': 3/)
  assert.match(script, /const UPDATE_RECOVERY_STAGE_ITEMS = Object\.freeze\(\[[\s\S]*'itemSwitchPrevious'[\s\S]*'itemRestoreSnapshot'[\s\S]*'itemStartRuntime'[\s\S]*'itemCheckHealth'/)
  assert.match(script, /phase === 'restoring-data'[\s\S]*'recovery:snapshot': 1[\s\S]*'recovery:health': 3/)
  assert.match(script, /returnStableToTarget: '返回稳定通道·\{target\}'/)
  assert.match(script, /progressLogStageExpansion\.set\(previousActiveStage, false\)/)
  assert.match(script, /function transactionStageState\(index, currentIndex, status\)[\s\S]*status === 'success'[\s\S]*return 'completed'/)
  assert.match(script, /progressLogStageExpansion\.set\(activeStage\.key, update\.status !== 'success'\)/)
  assert.match(script, /elements\.progress\.dataset\.complete = String\(progress === 100\)/)
  assert.match(script, /stageSummary\.addEventListener\('click',[\s\S]*progressLogStageTouched\.add\(group\.key\)/)
  assert.match(script, /toggle\.addEventListener\('click',[\s\S]*const nextOpen = !stageDetails\.open[\s\S]*stageDetails\.open = nextOpen/)
  assert.match(script, /stageDetails\.addEventListener\('toggle',[\s\S]*toggle\.textContent = t\(stageDetails\.open \? 'collapseStage' : 'expandStage'/)
  assert.match(script, /progressLogStageExpansion\.set\(group\.key, nextOpen\)[\s\S]*toggle\.textContent = t\(nextOpen \? 'collapseStage' : 'expandStage'/)
  assert.match(script, /if \(update\.status === 'success'\) \{\s*if \(previousStatus !== 'success'\) \{[\s\S]*progressLogStageExpansion\.set\(activeStage\.key, false\)/)
  assert.doesNotMatch(script, /if \(update\.status === 'success'\) \{\s*if \(previousStatus !== 'success'\) progressLogStageTouched\.delete\(activeStage\.key\)\s*progressLogStageExpansion\.set\(activeStage\.key, false\)/)
  assert.doesNotMatch(script, /stageDetails\.addEventListener\('toggle',[\s\S]{0,160}progressLogStageTouched\.add/)
  assert.match(script, /function progressLogPhase\(update\) \{[\s\S]*update\?\.phase[\s\S]*update\?\.operation[\s\S]*update\?\.status/)
  assert.match(script, /progressLogAutoScroll = event\.target\.checked/)
  assert.match(script, /elements\['log-search'\]\.value = String\(progressLogUpdate\.taskId\)/)
  assert.match(script, /const failedDismissed = update\.status === 'failed'[\s\S]*dismissedProgressTaskId/)
  assert.match(script, /const result = progressVisible \|\| failedDismissed \? '' : update\.error/)
  assert.match(script, /elements\['progress-dismiss'\]\.addEventListener\('click'/)
  assert.match(style, /\.progress-log-group-list[\s\S]*max-height: 250px/)
  assert.match(style, /\.progress\[data-complete='true'\] span \{ width: 100% !important; transition: none; \}/)
  assert.match(style, /\.progress-log-group-list\.populated \{ height: clamp\(160px, 24dvh, 240px\);/)
  assert.doesNotMatch(style, /\.progress-log-entry:last-child \{[^}]*border-bottom: 0;/)
  assert.match(style, /\.progress-log-entry summary[\s\S]*grid-template-columns: auto minmax\(0, 1fr\) auto/)
  assert.match(style, /\.progress-log-message \{[^}]*grid-column: 1 \/ 3;/)
  assert.match(script, /chevron\.className = 'progress-log-chevron'/)
  assert.match(style, /\.progress-log-entry\[open\] \.progress-log-chevron::before \{ transform: rotate\(180deg\); \}/)
  assert.match(script, /rollbackDetailData: '正在校验并恢复更新前的数据快照。'/)
  assert.match(style, /\.progress-stage-marker \{ --marker-size: 10px;/)
  assert.match(style, /\.progress-stage-item-marker \{ --marker-size: 10px;/)
  assert.doesNotMatch(script, /[✓⟳✗○]/u)
  assert.match(script, /pluginChangesPending: 'Changes pending'/)
  assert.match(script, /pendingSystemPluginChanges: '有 \{count\} 项修改待应用'/)
  assert.match(script, /systemPluginApplyingItem: '\{action\} @dsh-docker\/\{id\}（\{current\}\/\{total\}）'/)
  assert.match(script, /function systemPluginSummary\(\)[\s\S]*systemPluginProgress\?\.phase === 'restarting'[\s\S]*pendingSystemPluginChanges/)
  assert.match(script, /function reconcileSystemPluginProgress\(next\)[\s\S]*lifecycle\?\.taskId !== systemPluginProgress\.taskId[\s\S]*\['running', 'failed', 'stopped'\]/)
  assert.match(script, /systemPluginProgress = \{ phase: 'restarting', total: changes\.length, taskId: restart\.taskId \}/)
  assert.match(script, /systemPluginProgress = \{ phase: 'applying', id, action, current: index \+ 1, total: changes\.length \}/)
  assert.match(script, /userPluginRestartRequired: '需要重新启动 DSH'/)
  assert.match(script, /userPluginRestartRequired: 'Restart DSH required'/)
  assert.doesNotMatch(html, /id="user-plugin-restart-required"/)
  assert.match(script, /const applyingAction = userPluginApplyingDraft\.get\(plugin\.name\)[\s\S]*plugin\.pendingRestart[\s\S]*pluginPendingRestart/)
  assert.match(script, /const userPluginApplyingDraft = new Map\(\)/)
  assert.match(script, /const applyingAction = userPluginApplyingDraft\.get\(plugin\.name\)[\s\S]*statusEnabling[\s\S]*statusDisabling[\s\S]*statusUninstalling/)
  assert.match(script, /for \(const \[name, action\] of userPluginDraft\) userPluginApplyingDraft\.set\(name, action\)[\s\S]*await refreshInventory\('userPlugins'\)[\s\S]*userPluginApplyingDraft\.clear\(\)/)
  assert.match(script, /plugin\.description\?\.\[locale\]/)
  assert.match(script, /pluginPendingRestart: '待重启'/)
  assert.match(script, /PLUGIN_DRAFT_KEY = 'dsh-platform:system-plugin-draft'/)
  assert.match(script, /const systemPluginDraft = new Map\(\)/)
  assert.match(script, /function setSystemPluginDraft\(plugin, action\)[\s\S]*systemPluginDraft\.set\(plugin\.id, action\)/)
  assert.match(script, /const restartRequired = systemPluginDraft\.size > 0 \|\| values\.some\(plugin => plugin\.pendingRestart\)[\s\S]*const applyingAction = restartRequired[\s\S]*systemPluginApplyingDraft\.get\(plugin\.id\)/)
  assert.match(script, /userPluginBadge\(t\(stateKey[\s\S]*applyingAction !== undefined \|\| action !== undefined \? 'pending' : plugin\.enabled \? 'enabled'/)
  const systemPluginRenderer = script.slice(script.indexOf('function renderBundledPlugins('), script.indexOf('function renderSystemSkills('))
  assert.doesNotMatch(systemPluginRenderer, /pluginPendingRestart/)
  assert.match(systemPluginRenderer, /action !== undefined[\s\S]*pendingInstall[\s\S]*pendingUninstall[\s\S]*pendingEnable[\s\S]*pendingDisable/)
  assert.match(script, /function pluginButton\([\s\S]*setSystemPluginDraft\(plugin, action\)/)
  assert.match(script, /async function applySystemPluginDraft\(\)[\s\S]*for \(const \[id, action\] of systemPluginDraft\)[\s\S]*waitForManagementTask\(task\.taskId, 'systemPluginOperation'\)[\s\S]*api\('restart-dsh'/)
  assert.match(script, /operationKey === 'systemPluginOperation'[\s\S]*api\(`bundled-plugins\/task\/\$\{taskId\}`\)/)
  assert.match(script, /async function cancelSystemPluginDraft\(\)[\s\S]*systemPluginDraft\.clear\(\)[\s\S]*bundled-plugins\/discard/)
  assert.match(script, /function hasTaskId\(operation\)[\s\S]*typeof operation\?\.taskId === 'string'[\s\S]*operation\.taskId\.length > 0/)
  assert.match(script, /restart\.state === 'running' && hasTaskId\(restart\)[\s\S]*sessionStorage\.removeItem\(PLUGIN_DRAFT_KEY\)/)
  assert.doesNotMatch(script, /if \(hadDraft\) sessionStorage\.removeItem\(PLUGIN_DRAFT_KEY\)/)
  assert.match(script, /\(acting && !checking\)/)
  assert.match(script, /const checkingProgress = update\.operation === 'check'[\s\S]*checkingProgress[\s\S]*t\('statusChecking'\)[\s\S]*updateToTarget/)
  assert.doesNotMatch(script, /可离线恢复|Offline recovery|recovery-badge/)
  assert.doesNotMatch(script, /插件设置并重启 DSH|settings and restarting DSH/)
  assert.doesNotMatch(script, /shell\.overlay|settings\.section|dsh-platform:update-notice-owner/)
  assert.doesNotMatch(script, /^import .*vendor\/xterm\.mjs/m)
  assert.match(script, /import\('\.\/vendor\/xterm\.mjs'\)/)
  assert.match(script, /import\('\.\/vendor\/addon-fit\.mjs'\)/)
  assert.match(script, /terminalLoading: '正在加载终端组件'/)
  assert.match(script, /terminalLoading: 'Loading terminal components'/)
  assert.match(script, /cursorStyle: 'block'/)
  assert.match(script, /cursorInactiveStyle: 'outline'/)
  assert.match(style, /#terminal-screen \.xterm-viewport \{ position: static;/)
  assert.match(script, /const badge = applyingAction[\s\S]*plugin\.pendingRestart[\s\S]*plugin\.reservedNameConflict[\s\S]*plugin\.damaged[\s\S]*plugin\.enabled/)
  assert.match(script, /const applying = operation\.status === 'running'[\s\S]*hidden = count === 0 && !restartRequired && !applying/)
  assert.doesNotMatch(style, /user-plugin-badges/)
  assert.match(script, /user-plugin-draft-actions'\]\.hidden = count === 0 && !restartRequired/)
  assert.match(script, /userPluginDraft\.size === 0[\s\S]*userPluginInventory\.restartRequired === true[\s\S]*act\('restart-dsh', \{ method: 'POST' \}\)/)
  assert.match(script, /terminalEmulator\?\.focus\(\)/)
  assert.match(serverSource, /style-src 'self' 'unsafe-inline'/)
  assert.match(serverSource, /script-src 'self'; style-src/)
  assert.match(html, /id="terminal-loader"[^>]*hidden/)
  assert.doesNotMatch(html, /href="\.\/vendor\/xterm\.css"/)
  assert.match(script, /stylesheet\.href = '\.\/vendor\/xterm\.css'/)
  assert.match(script, /if \(tab === 'maintenance'\) \{\s*connectLogs\(\)/)
  assert.match(script, /function connectLogs\(\{ force = false \} = \{\}\)/)
  assert.match(script, /addEventListener\('heartbeat'/)
  assert.match(script, /Date\.now\(\) - logLastActivity > 35_000/)
  assert.match(html, /id="refresh-logs"[^>]*data-i18n="refreshLogs"/)
  assert.match(html, /id="export-logs"[^>]*data-i18n="exportLogs"/)
  assert.match(script, /function refreshLogs\(\)[\s\S]*api\(`logs\?limit=/)
  assert.match(script, /function filteredRawLogs\(\)/)
  assert.match(script, /application\/x-ndjson;charset=utf-8/)
  assert.match(script, /dsh-platform-logs-.*\.jsonl/)
  assert.match(script, /logIdentities\.has\(identity\)/)
  assert.match(script, /function scheduleLogRender\(\)/)
  assert.match(script, /maintenance: 'DSH 生命周期'/)
  assert.match(script, /maintenance: 'DSH lifecycle'/)
  assert.match(html, /id="start-dsh"[\s\S]*id="stop-dsh"[\s\S]*id="restart-dsh"/)
  assert.match(html, /id="stop-dialog"/)
  assert.match(script, /act\('start-dsh', \{ method: 'POST' \}\)/)
  assert.match(script, /act\('stop-dsh', \{ method: 'POST' \}\)/)
  assert.match(script, /TERMINAL_SESSION_KEY = 'dsh-platform:terminal-session'/)
  assert.match(script, /sessionStorage\.setItem\(TERMINAL_SESSION_KEY, value\)/)
  assert.match(script, /new WebSocket\(terminalWebSocketUrl\(sessionId\)\)/)
  assert.match(script, /terminalEmulator\.reset\(\)[\s\S]*new WebSocket/)
  assert.match(script, /terminalReconnectDeadline \?\?= Date\.now\(\) \+ 30_000/)
  assert.match(script, /terminalFit\.fit\(\)/)
  assert.match(script, /filesTab: '文件管理'/)
  assert.match(script, /filesTab: 'Files'/)
  assert.match(script, /if \(tab === 'files' && !filesLoaded\) void initializeFiles/)
  assert.match(script, /api\('files\/config'\)/)
  assert.match(script, /elements\['file-shortcuts'\]\.replaceChildren/)
  assert.doesNotMatch(html, /data-file-location="\/workspace"/)
  assert.match(script, /scrollIntoView\(\{ block: 'nearest', inline: 'nearest' \}\)/)
  assert.match(script, /new XMLHttpRequest\(\)/)
  assert.match(script, /fileClipboard = null/)
  assert.match(script, /fileOwner: '用户:用户组'/)
  assert.match(script, /fileOwner: 'User:group'/)
  assert.match(script, /operation: 'size'/)
  assert.match(script, /calculateDirectorySize/)
  assert.match(script, /operation: 'attributes'/)
  assert.match(script, /attributes: \{[\s\S]*user, group, mode,[\s\S]*recursive:/)
  assert.match(script, /FILE_ATTRIBUTES_UNSUPPORTED[^\n]*attributesUnsupported/)
  assert.match(script, /syncPermissionChecks/)
  assert.match(script, /syncModeFromPermissions/)
  assert.match(script, /elements\['file-attributes-group'\]\.value = event\.target\.value/)
  assert.match(html, /data-i18n="fileOwner"/)
  assert.match(html, /class="file-sort-arrows"/)
  assert.match(script, /function renderFileSort\(\)/)
  assert.match(script, /button\.closest\('th'\)\.setAttribute\('aria-sort'/)
  assert.match(style, /\.file-searchbar label \{[^}]*display: inline-flex;[^}]*align-items: center;/)
  assert.match(style, /\.resource-heading-detail \{[^}]*display: flex;[^}]*align-items: center;/)
  assert.match(style, /\.resource-search \{[^}]*width: min\(320px, 45%\);[^}]*margin: 0 0 0 auto;/)
  assert.match(style, /@media \(max-width: 640px\)[\s\S]*\.resource-heading-detail \{[^}]*flex-direction: column;[^}]*\}[\s\S]*\.resource-search \{[^}]*width: 100%;[^}]*margin-left: 0;/)
  assert.match(style, /\.file-table \{[^}]*min-width: 600px;/)
  assert.match(style, /button\[data-sort-order='asc'\]/)
  assert.match(script, /const visibleOperationTasks = new Set\(\)/)
  assert.match(script, /function operationResultVisible\(operation, activeStatus\)/)
  assert.match(script, /elements\['restart-state'\]\.hidden = !restartVisible/)
  assert.match(script, /elements\['runtime-reset-progress'\]\.hidden = !resetActive/)
  assert.match(script, /RUNTIME_RESET_PHASES\[next\.operation\]/)
  assert.match(script, /runtimeResetProgress = resetActive \? Math\.max\(runtimeResetProgress, resetPhase\.progress\) : 0/)
  assert.match(html, /id="runtime-reset-progress-track"[^>]*role="progressbar"/)
  assert.match(script, /elements\['runtime-reset'\]\.disabled = busy \|\| next\.current === null/)
  assert.match(html, /id="runtime-reset"[^>]*disabled/)
  assert.match(script, /elements\['plugin-operation'\]\.hidden = !pluginOperationVisible \|\| pluginOperation\.status !== 'failed'/)
  assert.match(script, /pendingInstall: '待安装'[\s\S]*statusInstalling: '安装中'[\s\S]*resourceEnabled: '已启用'/)
  assert.match(script, /heading\.append\([\s\S]*userPluginBadge\(t\(stateKey[\s\S]*name,[\s\S]*expandableResourceDescription/)
  const bundledPluginRenderer = script.slice(script.indexOf('function renderBundledPlugins('), script.indexOf('function renderSystemSkills('))
  const systemSkillRenderer = script.slice(script.indexOf('function renderSystemSkills('), script.indexOf('function userSkillSource('))
  assert.doesNotMatch(bundledPluginRenderer, /label\.textContent = projected\.enabled/)
  assert.doesNotMatch(systemSkillRenderer, /label\.textContent = skill\.enabled/)
  assert.match(html, /id="file-attributes"[^>]*aria-controls="file-attributes-panel"/)
  assert.match(html, /id="file-attributes-panel"[^>]*hidden/)
  assert.match(html, /data-permission-bit="256"/)
  assert.match(html, /id="file-attributes-recursive"/)
  assert.match(style, /\.file-permission-grid \{[\s\S]*grid-template-columns:/)
  assert.doesNotMatch(script, /window\.(?:alert|confirm|prompt)/)
  assert.match(html, /id="text-input-dialog"/)
  assert.match(html, /id="confirmation-dialog"/)
  assert.match(script, /function requestTextInput\(/)
  assert.match(script, /function requestConfirmation\(/)
  assert.match(html, /id="file-editor-lines"/)
  assert.match(html, /id="file-new"[^>]*aria-controls="file-create-panel"[^>]*aria-expanded="false"/)
  assert.match(html, /id="file-create-panel"[^>]*hidden/)
  assert.match(html, /data-file-create-kind="touch"[^>]*aria-pressed="true"/)
  assert.match(html, /data-file-create-kind="mkdir"[^>]*aria-pressed="false"/)
  assert.match(script, /function fileNameIsValid\(value\)[\s\S]*new TextEncoder\(\)\.encode\(value\)\.byteLength <= 255/)
  assert.match(script, /const destination = filePath === '\/' \? `\/\$\{name\}` : `\$\{filePath\}\/\$\{name\}`/)
  assert.doesNotMatch(script, /file-new[\s\S]{0,200}window\.prompt/)
  assert.doesNotMatch(script, /chooseConflict|window\.prompt\(t\('chooseConflict'/)
  assert.match(html, /id="file-conflict-dialog"/)
  assert.match(html, /name="file-conflict-choice" value="overwrite"/)
  assert.match(html, /name="file-conflict-choice" value="rename"/)
  assert.match(html, /name="file-conflict-choice" value="skip"/)
  assert.match(html, /id="file-conflict-all"/)
  assert.match(html, /id="file-conflict-confirm"[^>]*data-i18n="confirmChoice"/)
  assert.match(script, /error\.code === 'FILE_EXISTS'/)
  assert.match(script, /if \(decision\.applyAll\) conflictForAll = decision\.choice/)
  assert.match(style, /\.file-conflict-options \{[^}]*display: grid/)
  assert.match(style, /\.file-conflict-dialog \.confirm\[hidden\] \{ display: none; \}/)
  assert.match(maintenanceSource, /files\.\$\{operation\}\.rejected/)
  assert.match(maintenanceSource, /result\.path \?\? result\.destination \?\? result\.sources/)
  assert.match(style, /\.file-create-panel \{[^}]*grid-template-columns:/)
  assert.match(html, /id="file-back"[^>]*disabled/)
  assert.match(html, /id="file-forward"[^>]*data-i18n-title="forward"[^>]*disabled/)
  assert.match(html, /id="file-up"[^>]*disabled/)
  assert.match(script, /let fileFuture = \[\]/)
  assert.match(script, /elements\['file-forward'\]\.disabled = fileLoading \|\| fileFuture\.length === 0/)
  assert.match(script, /elements\['file-up'\]\.disabled = fileLoading \|\| filePath === '\/'/)
  assert.match(script, /fileHistory\.push\(filePath\)[\s\S]*fileFuture = \[\]/)
  assert.match(script, /elements\['file-forward'\]\.addEventListener\('click', async/)
  assert.match(style, /\.file-pathbar \.file-nav-button \{[^}]*display: grid[^}]*place-items: center[^}]*width: 34px[^}]*height: 34px/)
  assert.match(style, /\.file-nav-icon \{[^}]*width: 8px[^}]*height: 14px[^}]*clip-path: polygon/)
  assert.match(style, /\.file-editor-frame \{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\)/)
  assert.match(style, /@media \(max-width: 640px\)[\s\S]*\.file-table thead th:nth-child/)
  assert.doesNotMatch(style, /\.file-load-more \{[^}]*!important/)
  assert.doesNotMatch(pluginSource, /files\/list|filesTab|文件管理/)
  assert.match(style, /\.terminal-frame \{[\s\S]*max-height: min\(760px, 78dvh\);[\s\S]*aspect-ratio: 16 \/ 9;/)
  assert.match(style, /\.file-browser \{[^}]*max-height: min\(760px, 78dvh\);[^}]*aspect-ratio: 16 \/ 9;/)
  assert.match(style, /@media \(max-width: 640px\)[\s\S]*\.terminal-frame \{ height: clamp\(300px, 56dvh, 440px\);[^}]*aspect-ratio: auto; \}/)
  assert.match(style, /@media \(max-width: 640px\)[\s\S]*\.file-main \{[^}]*min-height: 300px;[^}]*max-height: 60dvh;/)
  assert.match(script, /userPluginsTab: '用户插件'/)
  assert.match(script, /userPluginsTab: 'User plugins'/)
  assert.match(script, /skillsTab: '系统技能'/)
  assert.match(script, /skillsTab: 'System skills'/)
  assert.match(html, /id="tab-skills"/)
  assert.match(html, /id="panel-skills"/)
  assert.match(script, /function renderSystemSkills\(values, busy\)/)
  assert.match(script, /skill\.id, action/)
  assert.match(script, /applyUserPluginChanges: '应用并重新启动 DSH'/)
  assert.match(script, /applyUserPluginChanges: 'Apply and restart DSH'/)
  assert.match(script, /const userPluginDraft = new Map\(\)/)
  assert.match(script, /expandedUserPluginDescriptions/)
  assert.match(script, /plugin\.description/)
  assert.match(script, /description\.scrollWidth > description\.clientWidth/)
  assert.match(script, /revision: userPluginInventory\.revision/)
  assert.match(script, /error\.statusCode === 409[\s\S]*userPluginDraft\.clear\(\)[\s\S]*userPluginRevisionConflict/)
  assert.match(script, /waitForUserPluginTask[\s\S]*catch \(error\)[\s\S]*lastError = error/)
  assert.match(script, /userPluginPhaseRestoring: '正在恢复 Web Profile'/)
  assert.match(script, /userPluginPhaseRestoring: 'Restoring Web Profile'/)
  assert.doesNotMatch(script, /(?:localStorage|sessionStorage).*user-plugin-draft/)
  assert.match(html, /id="user-plugin-recovery"/)
  assert.match(html, /id="user-plugin-draft-actions"[^>]*hidden/)
  assert.match(html, /id="cancel-user-plugin-changes"/)
  assert.match(html, /id="apply-user-plugin-changes"/)
  assert.match(script, /user-plugin-draft-actions'\]\.hidden = count === 0 && !restartRequired/)
  assert.doesNotMatch(style, /\.draft-actions/)
  assert.match(style, /\.tabs \{[\s\S]*width: 100%;[\s\S]*min-width: 0;[\s\S]*max-width: 100%;[\s\S]*overflow-x: auto/)
  assert.match(style, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.tabs \{ scroll-snap-type: none; \}/)
  assert.match(script, /function makeHorizontalTabStripScrollable\(tablist\)/)
  assert.match(script, /addEventListener\('wheel',[\s\S]*\{ passive: false \}\)/)
  assert.match(script, /if \(event\.deltaX !== 0\) return/)
  assert.match(script, /requestAnimationFrame\(animateWheel\)/)
  assert.match(script, /addEventListener\('pointermove'/)
  assert.match(script, /if \(Math\.abs\(distance\) >= 4 && !dragged\) \{\s*dragged = true\s*tablist\.setPointerCapture\?\.\(pointerId\)/)
  assert.doesNotMatch(script, /dragTarget = event\.target\s*tablist\.setPointerCapture/)
  assert.match(script, /const displacedClickTarget = !dragged && event\.target !== dragTarget \? dragTarget : undefined[\s\S]*displacedClickTarget\?\.click\(\)/)
  assert.match(script, /makeHorizontalTabStripScrollable\(document\.querySelector\('\.tabs'\)\)/)
  assert.match(style, /\.topbar-inner \{[\s\S]*width: min\(1180px, calc\(100% - 48px\)\)/)
  assert.match(style, /main \{[\s\S]*width: min\(1180px, calc\(100% - 48px\)\)/)
  assert.match(style, /:root\[data-theme="dark"\][\s\S]*@media \(prefers-color-scheme: dark\)[\s\S]*:root:not\(\[data-theme\]\)/)
  assert.match(style, /\.topbar-actions \{[^}]*display: flex/)
  assert.match(style, /@media \(max-width: 640px\)/)
  assert.match(style, /\.log-resize-frame \{[^}]*height: 480px;[^}]*min-height: 140px;[^}]*max-height: min\(1080px, 105dvh\);/)
  assert.match(style, /\.log-resize-handle \{[^}]*height: 16px;[^}]*cursor: ns-resize;/)
  assert.match(script, /makeLogListVerticallyResizable\(elements\['log-resize-frame'\], elements\['log-resize-handle'\]\)/)
  assert.match(script, /element\.style\.height = `\$\{String\(height\)\}px`/)
  assert.match(script, /scrollContainer\.scrollTop \+= Math\.min\(overflow, 24\)/)
  assert.match(style, /@media \(max-width: 640px\)[\s\S]*\.log-resize-frame \{ height: min\(260px, 36dvh\); \}/)
  assert.match(style, /\.log-entry \.log-details/)
  assert.match(style, /\.log-entry\[aria-expanded='true'\] \.log-chevron/)
  assert.match(style, /\.log-chevron::before \{[^}]*width: 8px[^}]*height: 5px[^}]*clip-path: polygon[^}]*transform-origin: center/)
  assert.match(style, /\.log-chevron \{[^}]*top: 2px/)
  assert.doesNotMatch(style, /\.log-chevron(?:::before)? \{[^}]*transition:/)
  assert.match(style, /\.log-entry\[aria-expanded='true'\] \.log-chevron::before \{[^}]*transform: rotate\(180deg\)/)
  assert.match(style, /\.user-plugin-description\.expanded/)
  assert.match(style, /\.resource-description\.expanded/)
  assert.match(style, /\.plugin-row \{[^}]*min-height:\s*52px/)
  assert.match(script, /function commitFilePageJump[\s\S]*Math\.min\(lastPage, Math\.max\(0, requested - 1\)\)[\s\S]*input\.value = String\(page \+ 1\)/)
  assert.match(style, /\.plugin-actions \.toggle \{ width: auto; \}/)
  assert.match(style, /\.user-plugin-row \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/)
  assert.match(style, /@media \(max-width: 640px\)[\s\S]*\.user-plugin-row \{ grid-template-columns: 1fr/)
})

test('production Management wires Runtime reset to the Bootstrap control boundary', async () => {
  const source = await readFile(new URL('../../control-plane/services/management/index.mjs', import.meta.url), 'utf8')
  const serverStart = source.indexOf('server = createManagementServer({')
  assert.notEqual(serverStart, -1)
  const serverSource = source.slice(serverStart)
  assert.match(serverSource, /resetRuntime: \(\) => bootstrap\.request\('POST', '\/v1\/deployments\/runtime\/reset'\)/)
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

test('management CLI creates an ephemeral standalone console access key', async () => {
  assert.deepEqual(parseCli(['access', 'create']), { command: 'access', operation: 'create' })
  assert.throws(() => parseCli(['access']))
  const calls = []
  const output = []
  assert.equal(await runCli({
    argv: ['access', 'create'],
    access: {
      request: async (method, path) => {
        calls.push([method, path])
        return { key: 'dshp_example', expiresAt: '2026-08-21T00:10:00.000Z' }
      },
    },
    write: line => output.push(line),
  }), 0)
  assert.deepEqual(calls, [['POST', '/v1/keys']])
  assert.deepEqual(JSON.parse(output[0]), {
    key: 'dshp_example', expiresAt: '2026-08-21T00:10:00.000Z',
  })
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
    dshLifecycle: {
      state: 'running', action: null, taskId: null, attempt: 0, maxAttempts: 3,
      error: null, updatedAt: null,
    },
  }
  assert.equal(await runCli({
    argv: ['status'],
    management: { request: async () => status },
    write: line => output.push(line),
  }), 0)
  assert.deepEqual(output, [JSON.stringify(status)])
  assert.equal(output[0].includes('\n'), false)
})

test('lifecycle CLI has a fixed DSH scope and waits only for its own task', async () => {
  assert.deepEqual(parseCli(['start']), { command: 'start', wait: false })
  assert.deepEqual(parseCli(['stop', '--wait']), { command: 'stop', wait: true })
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
    { dshLifecycle: { taskId: 'old-task', state: 'running' } },
    { dshLifecycle: { taskId: 'restart-task', state: 'restarting' } },
    { dshLifecycle: { taskId: 'restart-task', state: 'running' } },
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
  assert.match(output.at(-1), /running/)
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

test('scheduler reports a failed automatic check and continues scheduling', async () => {
  const errors = []
  const timers = []
  const scheduler = new UpdateScheduler({
    check: async () => { throw Object.assign(new Error('metadata offline'), { code: 'ENETDOWN' }) },
    onError: error => { errors.push(error) },
    intervalSeconds: 100,
    setTimer: callback => { const timer = { callback, unref() {} }; timers.push(timer); return timer },
    clearTimer: () => {},
  })
  scheduler.start()
  await timers[0].callback()
  assert.equal(errors[0].code, 'ENETDOWN')
  assert.equal(timers.length, 2)
  scheduler.stop()
})

test('management does not check metadata before the first scheduled interval', async () => {
  const source = await readFile(new URL('../../control-plane/services/management/index.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /setImmediate\(\(\) => \{ coordinator\.check\(\)\.catch/)
  assert.match(source, /check: \(\) => coordinator\.check\('automatic'\)/)
  assert.match(source, /allowUnavailableMetadata: imageInventory\.authority === 'development'/)
})

test('management exposes authenticated file inventory, search, upload, and ranged download primitives', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-files-'))
  const files = join(root, 'files')
  await mkdir(files)
  await writeFile(join(files, 'alpha.txt'), '0123456789')
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  let server
  const fileTasks = new FileTaskManager({ root: join(root, 'tasks'), onState: state => server?.emit('management-state', { fileTask: state }) })
  await fileTasks.initialize()
  server = createManagementServer({
    coordinator: new Coordinator(), logs,
    fileInventory: new FileInventory(), fileTransfers: new FileTransferManager(), fileTasks, fileEditor: new AtomicFileEditor(),
    fileLocations: { defaultPath: '/custom/workspace', shortcuts: ['/custom/workspace', '/custom/dsh', '/custom/platform', '/'] },
  })
  const socketPath = join(root, 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    assert.deepEqual(await client.request('GET', `${API_PREFIX}files/config`), {
      defaultPath: '/custom/workspace', shortcuts: ['/custom/workspace', '/custom/dsh', '/custom/platform', '/'],
    })
    const encodedRoot = encodeURIComponent(files)
    const listed = await client.request('GET', `${API_PREFIX}files/list?path=${encodedRoot}`)
    assert.deepEqual(listed.entries.map(entry => entry.name), ['alpha.txt'])
    await writeFile(join(files, 'beta.txt'), 'beta')
    const secondPage = await client.request('GET', `${API_PREFIX}files/list?path=${encodedRoot}&limit=1&offset=1`)
    assert.deepEqual(secondPage.entries.map(entry => entry.name), ['beta.txt'])
    assert.equal(await client.request('GET', `${API_PREFIX}files/stat?path=${encodeURIComponent(join(files, 'missing'))}&optional=true`), null)
    const content = await client.request('GET', `${API_PREFIX}files/content?path=${encodeURIComponent(join(files, 'alpha.txt'))}`)
    assert.equal(content.content, '0123456789')
    const saved = await client.request('PUT', `${API_PREFIX}files/content`, {
      path: join(files, 'alpha.txt'), content: 'edited', revision: content.revision,
    })
    assert.equal(saved.size, 6)
    assert.equal(await readFile(join(files, 'alpha.txt'), 'utf8'), 'edited')
    const refreshed = await client.request('GET', `${API_PREFIX}files/list?path=${encodedRoot}`)
    const search = await client.request('POST', `${API_PREFIX}files/tasks`, { operation: 'search', path: files, revision: refreshed.revision, query: 'alpha' })
    await fileTasks.completion(search.taskId)
    assert.equal((await client.request('GET', `${API_PREFIX}files/tasks/${search.taskId}`)).results[0].name, 'alpha.txt')

    const uploadPath = join(files, 'uploaded.txt')
    const uploaded = await new Promise((resolve, reject) => {
      const request = httpRequest({
        socketPath, method: 'POST',
        path: `${API_PREFIX}files/upload?path=${encodeURIComponent(uploadPath)}&conflict=reject`,
        headers: { 'content-length': '8' },
      }, response => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode, value: JSON.parse(Buffer.concat(chunks)) }))
      })
      request.once('error', reject)
      request.end('uploaded')
    })
    assert.equal(uploaded.status, 201)
    assert.equal(await readFile(uploadPath, 'utf8'), 'uploaded')
    const duplicate = await new Promise((resolve, reject) => {
      const request = httpRequest({
        socketPath, method: 'POST',
        path: `${API_PREFIX}files/upload?path=${encodeURIComponent(uploadPath)}&conflict=reject`,
        headers: { 'content-length': '9' },
      }, response => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode, value: JSON.parse(Buffer.concat(chunks)) }))
      })
      request.once('error', reject)
      request.end('duplicate')
    })
    assert.deepEqual(duplicate, { status: 409, value: { error: 'upload target already exists', code: 'FILE_EXISTS' } })
    assert.equal(await readFile(uploadPath, 'utf8'), 'uploaded')
    const downloaded = await new Promise((resolve, reject) => {
      const request = httpRequest({
        socketPath, method: 'GET',
        path: `${API_PREFIX}files/download?path=${encodeURIComponent(uploadPath)}&revision=${encodeURIComponent(uploaded.value.revision)}`,
        headers: { range: 'bytes=2-5' },
      }, response => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }))
      })
      request.once('error', reject)
      request.end()
    })
    assert.deepEqual(downloaded, { status: 206, body: 'load' })
    const downloadTask = fileTasks.list().find(task => task.operation === 'download')
    assert.notEqual(downloadTask, undefined)
    await fileTasks.completion(downloadTask.taskId)
    const transferTasks = (await client.request('GET', `${API_PREFIX}files/tasks`)).tasks
    assert.equal(transferTasks.some(task => task.operation === 'upload' && task.status === 'success' && task.processedBytes === 8), true)
    assert.equal(transferTasks.some(task => task.operation === 'upload' && task.status === 'failed' && task.errorCode === 'FILE_EXISTS'), true)
    assert.equal(transferTasks.some(task => task.operation === 'download' && task.status === 'success' && task.processedBytes === 4), true)
    await new Promise(resolve => setTimeout(resolve, 20))
    const audit = await logs.query({ sources: ['audit'] })
    assert.equal(audit.some(entry => entry.message === 'files.upload.completed' && entry.size === 8), true)
    assert.equal(audit.some(entry => entry.message === 'files.download.completed'), true)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
