import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ChannelStateStore, planDesiredState } from '../../control-plane/modules/updater/lib/channel-state.mjs'

const current = { dsh: '0.1.0-rc.7', environment: 'env-1', runtime: 'runtime-a' }
const supported = { dsh: '0.1.0-rc.7', environment: 'env-1' }

test('persists channel selection and retryable version or combination Holds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-channel-state-'))
  const store = new ChannelStateStore(join(root, 'channel.json'), () => new Date('2026-08-19T00:00:00.000Z'))
  assert.equal((await store.read()).updateChannel, 'stable')
  await store.setChannel('experimental')
  const version = await store.addHold({ type: 'version', dshVersion: '0.1.0-rc.8', reason: 'build failed' })
  const combination = await store.addHold({
    type: 'combination', dshVersion: '0.1.0-rc.9', environmentVersion: 'env-1', reason: 'health failed',
  })
  assert.deepEqual((await store.read()).holds.map(hold => hold.type), ['version', 'combination'])
  await store.retry(version.id)
  assert.deepEqual((await store.read()).holds.map(hold => hold.id), [combination.id])
})

test('plans Stable convergence before Experimental and freezes Ahead-of-Stable combinations', () => {
  const local = { updateChannel: 'experimental', holds: [], experimentalBlocked: null }
  assert.equal(planDesiredState({
    local, current: { ...current, environment: 'env-old' }, supported,
    upstream: { version: '0.1.0-rc.8' },
  }).action, 'stable')
  assert.equal(planDesiredState({
    local, current: { ...current, dsh: '0.1.0-rc.8' }, supported,
    upstream: { version: '0.1.0-rc.9' },
  }).action, 'frozen')
  assert.equal(planDesiredState({ local, current, supported, upstream: { version: '0.1.0-rc.8' } }).action, 'experimental')
})

test('suppresses only the held Experimental candidate and Environment combination', () => {
  const local = {
    updateChannel: 'experimental',
    experimentalBlocked: null,
    holds: [{
      id: 'hold', type: 'combination', dshVersion: '0.1.0-rc.8', environmentVersion: 'env-1',
      reason: 'incompatible', createdAt: '2026-08-19T00:00:00.000Z',
    }],
  }
  const plan = planDesiredState({ local, current, supported, upstream: { version: '0.1.0-rc.8' } })
  assert.equal(plan.action, 'held')
  assert.equal(plan.hold.id, 'hold')
})

test('retries an Experimental Block independently of ordinary Holds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-channel-block-'))
  const store = new ChannelStateStore(join(root, 'channel.json'), () => new Date('2026-08-19T00:00:00.000Z'))
  const blocked = await store.block({
    dshVersion: '0.1.0-rc.8', environmentVersion: 'env-2', reason: 'combination failed',
  })
  assert.equal((await store.read()).experimentalBlocked.id, blocked.experimentalBlocked.id)
  await store.retry(blocked.experimentalBlocked.id)
  assert.equal((await store.read()).experimentalBlocked, null)
})
