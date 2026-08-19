import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readdir, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { JsonlLogManager } from '../logging/manager.mjs'

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
