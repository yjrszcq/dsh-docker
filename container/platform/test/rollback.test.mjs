import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { UpdateJournal } from '../../control-plane/modules/updater/lib/journal.mjs'
import { CompleteStateRecovery } from '../../control-plane/modules/updater/lib/rollback.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-complete-rollback-'))
  const journal = new UpdateJournal(join(root, 'journal.json'))
  const from = {
    dsh: '0.1.0-rc.7', environment: 'env-1', runtime: 'runtime-a', dataSnapshot: null,
    receiptTokens: ['stable-b', 'stable-a'],
  }
  const to = { dsh: '0.1.0-rc.8', environment: 'env-1', runtime: 'runtime-b' }
  await journal.begin({ transactionId: 'transaction-a', mode: 'experimental', from, to })
  await journal.transition('candidate-ready', { receiptTokens: ['experimental'] })
  await journal.transition('suspended')
  await journal.transition('snapshot-created', { snapshotId: 'snapshot-a' })
  await journal.transition('switched')
  await journal.transition('probation', { probationUntil: '2026-08-19T00:02:00.000Z' })
  await journal.transition('committed')
  const calls = []
  const current = { ...to, dataSnapshot: null, receiptTokens: ['experimental', 'stable-a', 'stable-b'] }
  const activator = {
    currentDeployment: async () => current,
    rollbackDeployments: async () => ({
      current: {
        id: current.runtime,
        dshVersion: current.dsh,
        environmentVersion: current.environment,
        receiptTokens: current.receiptTokens,
      },
      previous: {
        id: 'runtime-a-materialized',
        dshVersion: from.dsh,
        environmentVersion: from.environment,
        receiptTokens: from.receiptTokens,
      },
    }),
    suspendDsh: async () => calls.push('suspend'),
    restoreDeployment: async (value, options) => calls.push(`restore:${value.runtime}:${String(options.resume)}`),
    resumeDsh: async () => calls.push('resume'),
  }
  const snapshots = {
    inspect: async id => ({
      id, createdAt: '2026-08-19T00:00:00.000Z', archiveSha256: 'a'.repeat(64), archiveSize: 42,
      runtimeId: from.runtime, environmentVersion: from.environment, dshVersion: from.dsh,
    }),
    restore: async id => calls.push(`data:${id}`),
  }
  return { journal, from, to, current, activator, snapshots, calls, recovery: new CompleteStateRecovery({ journal, snapshots, activator }) }
}

test('binds a complete rollback plan to current Runtime, receipts, and verified snapshot', async () => {
  const value = await fixture()
  const plan = await value.recovery.plan()
  assert.equal(plan.previous.runtime, 'runtime-a-materialized')
  assert.deepEqual(plan.previous.receiptTokens, ['stable-a', 'stable-b'])
  value.current.runtime = 'different-runtime'
  assert.equal((await value.recovery.plan()).snapshot, null)
})

test('restores the previous complete state only with the current plan ID', async () => {
  const value = await fixture()
  const plan = await value.recovery.plan()
  const progress = []
  await assert.rejects(value.recovery.restore('stale'), /stale/)
  await assert.rejects(value.recovery.restore(plan.planId, { requireConfirmation: true }), /confirmation/)
  const result = await value.recovery.restore(plan.planId, {
    requireConfirmation: true,
    confirmDataLoss: true,
    onProgress: async (phase, percent) => progress.push([phase, percent]),
  })
  assert.equal(result.status, 'rolled-back')
  assert.deepEqual(progress, [['stopping', 15], ['switching', 35], ['restoring-data', 65], ['verifying', 85]])
  assert.deepEqual(value.calls, ['suspend', 'restore:runtime-a-materialized:false', 'data:snapshot-a', 'resume'])
  assert.equal((await value.journal.read()).phase, 'rolled-back')
  assert.equal((await value.recovery.plan()).snapshot, null)
})

test('rejects a valid snapshot archive bound to a different deployment', async () => {
  const value = await fixture()
  const inspect = value.snapshots.inspect
  value.snapshots.inspect = async id => ({ ...await inspect(id), environmentVersion: 'other-env' })
  await assert.rejects(value.recovery.plan(), /does not describe/)
})

test('binds Stable rollback to the exact Bootstrap previous slot without a data snapshot', async () => {
  const calls = []
  const progress = []
  const references = {
    environment: { sha256: 'a'.repeat(64) },
    pristine: { sha256: 'b'.repeat(64) },
    runtime: { sha256: 'c'.repeat(64) },
    systemPlugins: { sha256: 'd'.repeat(64) },
  }
  const current = {
    id: 'deployment-record-current', authority: 'stable', targetSequence: 2,
    dshVersion: '0.1.0-rc.8', environmentVersion: 'env-2', receiptTokens: ['stable-2'], ...references,
  }
  const previous = {
    id: 'deployment-record-previous', authority: 'stable', targetSequence: 1,
    dshVersion: '0.1.0-rc.7', environmentVersion: 'env-1', receiptTokens: ['stable-1'], ...references,
  }
  const recovery = new CompleteStateRecovery({
    journal: { read: async () => undefined },
    snapshots: {},
    activator: {
      rollbackDeployments: async () => ({ current, previous }),
      rollback: async recordId => calls.push(recordId),
    },
  })
  const plan = await recovery.plan()
  assert.equal(plan.mode, 'stable')
  assert.equal(plan.snapshot, null)
  assert.equal(plan.previous.runtime, previous.id)
  await assert.rejects(recovery.restore(plan.planId, {
    requireConfirmation: true,
    confirmDataLoss: true,
  }), /snapshot/)
  assert.deepEqual(calls, [])
  assert.deepEqual(await recovery.restore(plan.planId, {
    onProgress: async (phase, percent) => progress.push([phase, percent]),
  }), { status: 'rolled-back', transactionId: null })
  assert.deepEqual(calls, [previous.id])
  assert.deepEqual(progress, [['switching', 35], ['verifying', 90]])
})

test('does not expose a rollback between Image and Managed Records with identical content', async () => {
  const reference = { sha256: 'a'.repeat(64) }
  const base = {
    authority: 'stable', targetSequence: 1, dshVersion: '0.1.0-rc.7', environmentVersion: 'env-1',
    environment: reference, pristine: reference, runtime: reference, systemPlugins: reference, receiptTokens: [],
  }
  const recovery = new CompleteStateRecovery({
    journal: { read: async () => undefined },
    snapshots: {},
    activator: {
      rollbackDeployments: async () => ({
        current: { ...base, id: 'deployment-record-image' },
        previous: { ...base, id: 'deployment-record-materialized' },
      }),
    },
  })
  assert.equal(await recovery.plan(), null)
})
