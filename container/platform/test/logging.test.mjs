import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, readdir, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { JsonlLogManager } from '../../control-plane/modules/log-manager/index.mjs'

test('writes source-separated JSONL and queries bounded chronological entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-logs-'))
  const logs = new JsonlLogManager({ root })
  await logs.append('gateway', 'stdout', 'ready')
  await logs.append('updater', 'platform', 'checked', { taskId: 'one' })
  const entries = await logs.query({ sources: ['updater'], limit: 10 })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].taskId, 'one')
  assert.deepEqual((await readdir(root)).sort(), ['gateway.jsonl', 'updater.jsonl'])
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
    platformLog: 'dsh-platform-log-v1',
  }])
  assert.deepEqual(stderr.map(line => JSON.parse(line)), [{
    timestamp: '2026-08-19T00:00:00.000Z', source: 'dsh-runtime', stream: 'stderr', message: 'failed',
    platformLog: 'dsh-platform-log-v1',
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
  assert.match(bootstrap, /acceptForwarded: source === 'platform-management'/)
})
