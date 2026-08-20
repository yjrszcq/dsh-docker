import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  AUTOMATIC_CHECK_INTERVALS,
  AutomaticCheckStateStore,
} from '../../control-plane/modules/updater/lib/automatic-check.mjs'

function target(targetSequence, dsh) {
  return {
    targetSequence,
    desired: {
      dsh: { version: dsh },
      environment: { version: '2026.08.20.1' },
    },
  }
}

test('automatic checks use persistent defaults and fixed user-facing intervals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-automatic-check-'))
  const store = new AutomaticCheckStateStore(join(root, 'automatic-check.json'))
  assert.deepEqual(AUTOMATIC_CHECK_INTERVALS, [3_600, 10_800, 21_600, 43_200, 86_400])
  assert.deepEqual(await store.read(), {
    schema: 1,
    automaticCheck: { enabled: true, intervalSeconds: 21_600, notificationsEnabled: true },
    latestAutomatic: { stable: null, upstream: null },
  })
  assert.throws(() => store.configure({ enabled: true, intervalSeconds: 60, notificationsEnabled: true }), /interval/)
})

test('automatic checks retain only the newest Stable and Upstream candidates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-automatic-candidates-'))
  const store = new AutomaticCheckStateStore(join(root, 'automatic-check.json'), () => new Date('2026-08-20T08:00:00Z'))
  const current = { targetSequence: 1, dsh: '0.1.0-rc.7', environment: '2026.08.20.1' }

  await store.record({ channel: 'experimental', current, target: target(2, '0.1.0-rc.8'), upstream: { version: '0.1.0-rc.10' }, stableAvailable: true })
  await store.record({ channel: 'experimental', current, target: target(3, '0.1.0-rc.9'), upstream: { version: '0.1.0-rc.11' }, stableAvailable: true })
  await store.record({ channel: 'experimental', current, target: target(2, '0.1.0-rc.8'), upstream: { version: '0.1.0-rc.10' }, stableAvailable: true })
  const state = await store.read()
  assert.equal(state.latestAutomatic.stable.targetSequence, 3)
  assert.equal(state.latestAutomatic.upstream.version, '0.1.0-rc.11')

  await store.clearSatisfied({ targetSequence: 3, dsh: '0.1.0-rc.11', environment: '2026.08.20.1' })
  assert.deepEqual((await store.read()).latestAutomatic, { stable: null, upstream: null })
})

test('Stable channel, Holds, and disabled settings suppress notification candidates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-automatic-suppression-'))
  const store = new AutomaticCheckStateStore(join(root, 'automatic-check.json'))
  const current = { targetSequence: 1, dsh: '0.1.0-rc.7', environment: '2026.08.20.1' }
  const stable = target(2, '0.1.0-rc.8')

  await store.record({ channel: 'experimental', current, target: stable, upstream: { version: '0.1.0-rc.10' }, stableAvailable: true })
  await store.record({ channel: 'stable', current, target: stable, upstream: { version: '0.1.0-rc.11' }, stableAvailable: true })
  assert.equal((await store.read()).latestAutomatic.upstream, null)

  await store.record({
    channel: 'experimental', current, target: stable, upstream: { version: '0.1.0-rc.11' },
    stableAvailable: true, holds: [{ type: 'version', dshVersion: '0.1.0-rc.11' }],
  })
  assert.equal((await store.read()).latestAutomatic.upstream, null)

  await store.configure({ enabled: false, intervalSeconds: 3_600, notificationsEnabled: true })
  assert.deepEqual((await store.read()).latestAutomatic, { stable: null, upstream: null })
})

test('a sequence-only metadata advance does not advertise a Stable update', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-automatic-ahead-'))
  const store = new AutomaticCheckStateStore(join(root, 'automatic-check.json'))
  await store.record({
    channel: 'experimental',
    current: { targetSequence: 2, dsh: '0.1.0-rc.10', environment: '2026.08.20.1' },
    target: target(3, '0.1.0-rc.10'),
    upstream: null,
    stableAvailable: false,
  })
  assert.equal((await store.read()).latestAutomatic.stable, null)
})
