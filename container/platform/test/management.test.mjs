import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { JsonlLogManager } from '../../control-plane/modules/log-manager/index.mjs'
import { parseCli, resetTrust, runCli } from '../../control-plane/services/management/cli.mjs'
import { createManagementServer, listenManagement } from '../../control-plane/services/management/server.mjs'
import { LocalApiClient } from '../../control-plane/modules/updater/lib/client.mjs'
import { UpdateConflictError } from '../../control-plane/modules/updater/lib/coordinator.mjs'
import { UpdateScheduler } from '../../control-plane/modules/updater/lib/scheduler.mjs'

class Coordinator extends EventEmitter {
  constructor() {
    super()
    this.value = { status: 'idle', progress: 0 }
    this.state = { read: async () => this.value }
  }

  async publicStatus() {
    return { update: this.value, updateChannel: 'experimental', holds: [], experimentalBlocked: null, rollbackPlan: { planId: 'plan-a' } }
  }

  async check() {
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

test('management socket exposes status, check, update, logs, and local rollback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-'))
  const coordinator = new Coordinator()
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  await logs.append('gateway', 'stdout', 'ready')
  const server = createManagementServer({
    coordinator,
    logs,
    platformStatus: async () => ({ environment: 'one' }),
  })
  const socketPath = join(root, 'run', 'management.sock')
  await listenManagement(server, socketPath)
  const client = new LocalApiClient(socketPath)
  try {
    assert.equal((await client.request('GET', '/_dsh_platform/api/v1/status')).environment, 'one')
    assert.equal((await client.request('POST', '/_dsh_platform/api/v1/check')).targetSequence, 2)
    assert.deepEqual(await client.request('POST', '/_dsh_platform/api/v1/update'), { taskId: 'task-one' })
    await assert.rejects(client.request('POST', '/_dsh_platform/api/v1/update'), error => error.statusCode === 409)
    assert.equal((await client.request('GET', '/_dsh_platform/api/v1/logs?source=gateway')).entries[0].message, 'ready')
    assert.equal((await client.request('PUT', '/_dsh_platform/api/v1/channel', { channel: 'experimental' })).updateChannel, 'experimental')
    assert.equal((await client.request('POST', '/_dsh_platform/api/v1/holds/retry', { id: 'hold-a' })).retried, 'hold-a')
    assert.equal((await client.request('GET', '/_dsh_platform/api/v1/rollback-plan')).plan.planId, 'plan-a')
    coordinator.running = false
    assert.deepEqual(await client.request('POST', '/_dsh_platform/api/v1/rollback', { planId: 'plan-a' }), { taskId: 'rollback-task' })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
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
  scheduler.stop()
})
