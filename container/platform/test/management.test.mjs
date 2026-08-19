import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { JsonlLogManager } from '../logging/manager.mjs'
import { parseCli, resetTrust, runCli } from '../management/cli.mjs'
import { createManagementServer, listenManagement } from '../management/server.mjs'
import { LocalApiClient } from '../updater/lib/client.mjs'
import { UpdateConflictError } from '../updater/lib/coordinator.mjs'
import { UpdateScheduler } from '../updater/lib/scheduler.mjs'

class Coordinator extends EventEmitter {
  constructor() {
    super()
    this.value = { status: 'idle', progress: 0 }
    this.state = { read: async () => this.value }
  }

  async check() {
    return { value: { targetSequence: 2, desired: { dsh: { version: 'rc.8' } } } }
  }

  start() {
    if (this.running) throw new UpdateConflictError('busy')
    this.running = true
    return { taskId: 'task-one', completion: new Promise(() => {}) }
  }
}

test('management socket exposes status, check, update, logs, and local rollback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-management-'))
  const coordinator = new Coordinator()
  const logs = new JsonlLogManager({ root: join(root, 'logs') })
  await logs.append('gateway', 'stdout', 'ready')
  let rolledBack = false
  const server = createManagementServer({
    coordinator,
    logs,
    platformStatus: async () => ({ environment: 'one' }),
    rollback: async () => { rolledBack = true },
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
    assert.equal((await client.request('POST', '/_dsh_platform/api/v1/rollback')).status, 'rolled-back')
    assert.equal(rolledBack, true)
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
    request: async (method, path) => {
      calls.push({ method, path })
      return path.endsWith('/rollback') ? { status: 'rolled-back' } : {}
    },
  }
  assert.equal(await runCli({ argv: ['rollback'], management, write: line => output.push(line) }), 0)
  assert.deepEqual(calls, [{ method: 'POST', path: '/_dsh_platform/api/v1/rollback' }])
  assert.match(output[0], /rolled-back/)
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
