import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { UpdateJournal } from '../updater/lib/journal.mjs'

const transaction = {
  transactionId: 'transaction-one',
  mode: 'experimental',
  from: {
    dsh: '0.1.0-rc.7', environment: 'env-1', runtime: 'runtime-a', dataSnapshot: null,
  },
  to: { dsh: '0.1.0-rc.8', environment: 'env-1', runtime: 'runtime-b' },
}

test('persists a complete update transaction across process restarts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-journal-'))
  const path = join(root, 'state', 'update-transaction.json')
  let tick = 0
  const now = () => new Date(Date.UTC(2026, 7, 19, 0, 0, tick++))
  const journal = new UpdateJournal(path, now)
  await journal.begin(transaction)
  await journal.transition('candidate-ready', { receiptTokens: ['receipt-one'] })
  await journal.transition('suspended')
  await journal.transition('snapshot-created', { snapshotId: 'snapshot-one' })

  const resumed = await new UpdateJournal(path, now).read()
  assert.equal(resumed.phase, 'snapshot-created')
  assert.equal(resumed.from.runtime, 'runtime-a')
  assert.equal(resumed.to.runtime, 'runtime-b')
  assert.equal(resumed.snapshotId, 'snapshot-one')
  assert.deepEqual(resumed.receiptTokens, ['receipt-one'])
})

test('rejects skipped phases and clears only terminal journals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-journal-transition-'))
  const journal = new UpdateJournal(join(root, 'state', 'update-transaction.json'))
  await journal.begin(transaction)
  await assert.rejects(journal.transition('switched'), /cannot transition/)
  await assert.rejects(journal.clear(), /nonterminal/)
  await journal.transition('failed', { error: 'candidate build failed' })
  await journal.clear()
  assert.equal(await journal.read(), undefined)
})

test('records an idempotent data-restoration phase before rollback completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-journal-restore-'))
  const path = join(root, 'state', 'update-transaction.json')
  const journal = new UpdateJournal(path)
  await journal.begin(transaction)
  await journal.transition('candidate-ready')
  await journal.transition('suspended')
  await journal.transition('snapshot-created', { snapshotId: 'snapshot-one' })
  await journal.transition('switched')
  await journal.transition('restoring-data')
  assert.equal((await new UpdateJournal(path).read()).phase, 'restoring-data')
  await journal.transition('rolled-back')
})
