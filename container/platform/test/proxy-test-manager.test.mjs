import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { defaultProxyConfiguration, validateProxyConfiguration } from '../../control-plane/services/outbound-proxy/lib/contracts.mjs'
import { ProxyTestManager, proxyTestInternals } from '../../control-plane/services/outbound-proxy/lib/test-manager.mjs'

function current() {
  const validated = validateProxyConfiguration(defaultProxyConfiguration())
  return Object.freeze({ revision: 'current-revision', ...validated })
}

function candidate(overrides = {}) {
  const defaults = defaultProxyConfiguration()
  return {
    ...defaults,
    ...overrides,
    proxy: { ...defaults.proxy, ...overrides.proxy },
    scopes: { ...defaults.scopes, ...overrides.scopes },
    environment: { ...defaults.environment, ...overrides.environment },
    modelApi: { ...defaults.modelApi, providers: {}, ...overrides.modelApi },
    noProxy: { user: [], ...overrides.noProxy },
    bypass: { additional: [], ...overrides.bypass },
  }
}

async function terminal(manager, taskId) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const state = manager.get(taskId)
    if (state.status !== 'running') return state
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error('proxy test did not reach a terminal state')
}

test('proxy test records real direct-route stages without changing current configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-proxy-test-direct-'))
  const manager = new ProxyTestManager({
    statePath: join(root, 'tasks.json'),
    targets: [{ id: 'unreachable', host: '127.0.0.1', port: 1, path: '/' }],
    phaseTimeoutMs: 500,
  })
  const state = current()
  const started = await manager.start({ baseRevision: state.revision, value: candidate() }, state)
  const completed = await terminal(manager, started.taskId)
  assert.equal(completed.status, 'failed')
  assert.equal(completed.mode, 'direct')
  assert.deepEqual(completed.stages.slice(0, 3).map(stage => stage.status), ['skipped', 'skipped', 'skipped'])
  assert.equal(completed.stages.find(stage => stage.stage === 'target-dns').status, 'success')
  assert.equal(completed.stages.find(stage => stage.stage === 'target-tls').status, 'failed')
  assert.equal(completed.stages.find(stage => stage.stage === 'target-http').status, 'skipped')
  assert.equal(state.configuration.enabled, false)
})

test('proxy tests allow one in-memory candidate, persist no credentials, and cancel safely', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-proxy-test-cancel-'))
  const statePath = join(root, 'tasks.json')
  const never = () => new Promise(() => {})
  const manager = new ProxyTestManager({
    statePath,
    resolve: never,
    targets: [{ id: 'blocked', host: 'blocked.example', port: 443, path: '/' }],
  })
  const state = current()
  const value = candidate({
    enabled: true,
    proxy: { host: 'proxy.example', port: 1080, username: 'alice', password: 'never-persist-this' },
    scopes: { updates: true },
  })
  const started = await manager.start({ baseRevision: state.revision, value }, state)
  await assert.rejects(manager.start({ baseRevision: state.revision, value, unexpected: true }, state), error => (
    error.code === 'INVALID_CONFIG' && error.stage === 'test'
  ))
  await assert.rejects(manager.start({ baseRevision: state.revision, value }, state), error => error.code === 'PROXY_TEST_BUSY')
  assert.equal((await readFile(statePath, 'utf8')).includes('never-persist-this'), false)
  await manager.cancel(started.taskId)
  const cancelled = await terminal(manager, started.taskId)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.error.errorCode, 'REQUEST_CANCELLED')
  assert.equal((await readFile(statePath, 'utf8')).includes('alice'), false)
})

test('proxy test reload marks an interrupted credential-free task failed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-proxy-test-reload-'))
  const statePath = join(root, 'tasks.json')
  const taskId = '123e4567-e89b-42d3-a456-426614174000'
  const timestamp = '2026-08-25T00:00:00.000Z'
  await writeFile(statePath, `${JSON.stringify({
    schema: 1,
    tasks: [{
      schema: 1, taskId, status: 'running', baseRevision: 'old-revision',
      candidateHash: `sha256:${'a'.repeat(64)}`, mode: 'proxy', currentStage: 'proxy-connect',
      stages: proxyTestInternals.STAGES.map(stage => ({
        stage, status: stage === 'proxy-connect' ? 'running' : 'pending', durationMs: null, errorCode: null, detail: null,
      })),
      error: null, createdAt: timestamp, updatedAt: timestamp,
    }],
  })}\n`)
  const manager = new ProxyTestManager({ statePath, now: () => new Date('2026-08-25T00:00:01.000Z') })
  await manager.initialize(async path => JSON.parse(await readFile(path, 'utf8')))
  const restored = manager.get(taskId)
  assert.equal(restored.status, 'failed')
  assert.equal(restored.error.errorCode, 'PROXY_TEST_INTERRUPTED')
  assert.equal(restored.stages.every(stage => !['running', 'pending'].includes(stage.status)), true)
})
