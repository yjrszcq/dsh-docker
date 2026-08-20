import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, readdir, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { errorDetails, JsonlLogManager } from '../../control-plane/modules/log-manager/index.mjs'

test('writes source-separated JSONL and queries bounded chronological entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-logs-'))
  const logs = new JsonlLogManager({ root })
  await logs.append('gateway', 'stdout', 'ready')
  await logs.append('updater', 'platform', 'checked', { taskId: 'one' })
  const entries = await logs.query({ sources: ['updater'], limit: 10 })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].taskId, 'one')
  assert.equal(entries[0].level, 'info')
  assert.deepEqual((await readdir(root)).sort(), ['gateway.jsonl', 'updater.jsonl'])
  assert.equal((await logs.query({ limit: 5_000 })).length, 2)
  await assert.rejects(logs.query({ limit: 5_001 }), /log query limit is invalid/)
})

test('assigns default levels and accepts only explicit supported levels', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-log-levels-'))
  const logs = new JsonlLogManager({ root })
  await logs.append('component', 'stdout', 'ordinary')
  await logs.append('component', 'stderr', 'failed')
  await logs.append('component', 'platform', 'slow response', { level: 'warning' })
  assert.deepEqual((await logs.query()).map(entry => entry.level), ['info', 'error', 'warning'])
  await assert.rejects(logs.append('component', 'stdout', 'invalid', { level: 'fatal' }), /log level is invalid/)
})

test('applies an explicit shared-reader mode to newly created and rotated log files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-log-mode-'))
  const logs = new JsonlLogManager({ root, fileMode: 0o640, rotateBytes: 1_024 })
  await logs.append('stage0', 'platform', 'first')
  assert.equal((await stat(join(root, 'stage0.jsonl'))).mode & 0o777, 0o640)
  await logs.append('stage0', 'platform', 'x'.repeat(1_000))
  await logs.append('stage0', 'platform', 'rotated')
  assert.equal((await stat(join(root, 'stage0.jsonl'))).mode & 0o777, 0o640)
})

test('rotates files and enforces the aggregate byte budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-log-rotation-'))
  const logs = new JsonlLogManager({ root, maxBytes: 70_000, rotateBytes: 10_000 })
  for (let index = 0; index < 150; index += 1) await logs.append('gateway', 'stdout', 'x'.repeat(800))
  const files = await logs.files()
  assert.ok(files.length > 1)
  assert.ok(files.reduce((sum, file) => sum + file.details.size, 0) <= 70_000)
})

test('prunes expired logs and captures complete child output lines', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-log-retention-'))
  const logs = new JsonlLogManager({ root, retentionDays: 1 })
  await logs.append('old', 'stdout', 'expired')
  const oldPath = join(root, 'old.jsonl')
  const old = new Date(Date.now() - 2 * 86_400_000)
  await utimes(oldPath, old, old)
  await logs.prune()
  await assert.rejects(stat(oldPath), { code: 'ENOENT' })

  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  logs.capture(child, 'component', { stdout: true, stderr: false })
  child.stdout.end('one\ntwo')
  await new Promise(resolve => setImmediate(resolve))
  await logs.queue
  assert.deepEqual((await logs.query({ sources: ['component'] })).map(entry => entry.message), ['one', 'two'])
})

test('mirrors new entries to the matching container output without replaying history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-log-output-'))
  const stdout = []
  const stderr = []
  const logs = new JsonlLogManager({
    root,
    now: () => new Date('2026-08-19T00:00:00.000Z'),
    output: {
      stdout: { write: value => stdout.push(value) },
      stderr: { write: value => stderr.push(value) },
    },
  })
  await logs.append('gateway', 'stdout', 'ready')
  await logs.append('dsh-runtime', 'stderr', 'failed')
  assert.deepEqual(stdout.map(line => JSON.parse(line)), [{
    timestamp: '2026-08-19T00:00:00.000Z', source: 'gateway', stream: 'stdout', message: 'ready',
    level: 'info', platformLog: 'dsh-platform-log-v1',
  }])
  assert.deepEqual(stderr.map(line => JSON.parse(line)), [{
    timestamp: '2026-08-19T00:00:00.000Z', source: 'dsh-runtime', stream: 'stderr', message: 'failed',
    level: 'error', platformLog: 'dsh-platform-log-v1',
  }])

  const secondOutput = []
  const restarted = new JsonlLogManager({
    root,
    output: { stdout: { write: value => secondOutput.push(value) }, stderr: { write: value => secondOutput.push(value) } },
  })
  assert.equal((await restarted.query()).length, 2)
  assert.deepEqual(secondOutput, [])
})

test('passes a platform-management envelope through without persisting it twice', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-log-forwarded-'))
  const stdout = []
  const stderr = []
  const logs = new JsonlLogManager({
    root,
    output: {
      stdout: { write: value => stdout.push(value) },
      stderr: { write: value => stderr.push(value) },
    },
  })
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  logs.capture(child, 'platform-management', { stdout: true, stderr: true }, { acceptForwarded: true })
  const audit = JSON.stringify({
    timestamp: '2026-08-19T00:00:00.000Z', source: 'audit', stream: 'audit', message: 'update.started',
    platformLog: 'dsh-platform-log-v1', taskId: 'task-one',
  })
  child.stdout.end(`${audit}\nplain output\n`)
  child.stderr.end('plain error\n')
  await new Promise(resolve => setImmediate(resolve))
  await logs.queue

  assert.equal(stdout[0], `${audit}\n`)
  assert.equal(JSON.parse(stdout[1]).source, 'platform-management')
  assert.equal(JSON.parse(stderr[0]).stream, 'stderr')
  assert.deepEqual(
    (await logs.query({ sources: ['platform-management'] })).map(entry => [entry.stream, entry.message]),
    [['stdout', 'plain output'], ['stderr', 'plain error']],
  )
  assert.deepEqual(await logs.query({ sources: ['audit'] }), [])
  const bootstrap = await readFile(new URL('../bootstrap/index.mjs', import.meta.url), 'utf8')
  assert.match(bootstrap, /acceptForwarded: \['gateway', 'platform-management'\]\.includes\(source\)/)
})

test('records bounded structured error diagnostics in JSONL and container output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-log-diagnostic-'))
  const stdout = []
  const logs = new JsonlLogManager({
    root,
    now: () => new Date('2026-08-20T00:00:00.000Z'),
    output: { stdout: { write: value => stdout.push(value) } },
  })
  const cause = Object.assign(new Error('socket unavailable'), { code: 'ECONNREFUSED' })
  const failure = new AggregateError([cause, 'secondary failure'], 'startup failed', { cause })
  await logs.diagnostic('stage0', 'bootstrap.launch.failed', { error: failure, recordId: 'bootstrap-one' })

  const [entry] = await logs.query({ sources: ['stage0'] })
  assert.equal(entry.message, 'bootstrap.launch.failed')
  assert.equal(entry.recordId, 'bootstrap-one')
  assert.equal(entry.error, 'startup failed')
  assert.equal(entry.errorCause.errorCode, 'ECONNREFUSED')
  assert.equal(entry.errors[1].error, 'secondary failure')
  assert.match(entry.errorStack, /AggregateError: startup failed/)
  assert.equal(JSON.parse(stdout[0]).platformLog, 'dsh-platform-log-v1')
})

test('falls back to container stderr when a diagnostic cannot be persisted', async () => {
  const stderr = []
  const logs = new JsonlLogManager({
    root: '/dev/null/not-a-directory',
    now: () => new Date('2026-08-20T00:00:00.000Z'),
    output: { stderr: { write: value => stderr.push(value) } },
  })
  await logs.diagnostic('updater', 'update.failed', { error: new Error('network failed'), taskId: 'one' })
  const fallback = JSON.parse(stderr[0])
  assert.equal(fallback.message, 'diagnostic.write.failed')
  assert.equal(fallback.diagnostic.message, 'update.failed')
  assert.equal(fallback.diagnostic.error, 'network failed')
  assert.equal(fallback.loggingError.errorCode, 'ENOTDIR')
})

test('bounds recursive and oversized error details', () => {
  let failure = new Error('root')
  for (let index = 0; index < 6; index += 1) failure = new Error(`level-${String(index)}`, { cause: failure })
  const details = errorDetails(new AggregateError(Array.from({ length: 10 }, (_, index) => new Error(String(index))), 'x'.repeat(20_000), { cause: failure }))
  assert.equal(details.error.endsWith('...[truncated]'), true)
  assert.equal(details.errors.length, 8)
  assert.equal(details.errorsTruncated, 2)
  assert.equal(details.errorCause.errorCause.errorCause.errorCause, undefined)
})
