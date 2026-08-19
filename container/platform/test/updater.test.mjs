import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { canonicalJson } from '../lib/canonical-json.mjs'
import { VerifiedObjectStore } from '../stage0/lib/artifacts.mjs'
import { TrustLedger } from '../stage0/lib/ledger.mjs'
import { UpdateConflictError, UpdateCoordinator } from '../../control-plane/modules/updater/lib/coordinator.mjs'
import { MetadataClient } from '../../control-plane/modules/updater/lib/metadata.mjs'
import { TargetPreparer } from '../../control-plane/modules/updater/lib/preparer.mjs'
import { UpdateStateStore } from '../../control-plane/modules/updater/lib/state.mjs'
import { UpdateJournal } from '../../control-plane/modules/updater/lib/journal.mjs'
import { NpmRegistryClient } from '../../control-plane/modules/updater/lib/metadata.mjs'
import { reconcileRecoveredState, recoverInterruptedUpdate } from '../../control-plane/modules/updater/lib/recovery.mjs'
import { PlatformActivator } from '../../control-plane/modules/updater/lib/activator.mjs'
import { ChannelStateStore } from '../../control-plane/modules/updater/lib/channel-state.mjs'
import { keyPair, keyring, officialDshPolicy, registryCandidate, registryKeyPair, signature } from './helpers.mjs'

function descriptor(id, bytes, mediaType = 'application/octet-stream') {
  return {
    id,
    mediaType,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
    url: `https://release.example/${id}`,
  }
}

function response(bytes, status = 200) {
  return new Response(bytes, { status })
}

async function releaseFixture() {
  const recovery = keyPair()
  const current = keyPair()
  const next = keyPair()
  const registry = registryKeyPair()
  const component = Buffer.from('component')
  const bootstrapPackage = Buffer.from('bootstrap')
  const environmentManifest = canonicalJson({
    schema: 1,
    manifestType: 'environment',
    version: '2026.08.19.1',
    keyringGeneration: 1,
    targetSequence: 1,
    issuedAt: '2026-08-19T00:00:00.000Z',
    artifacts: [descriptor('environment-component', component)],
    bootstrapApi: 1,
    components: [],
    patches: [],
    systemPlugins: [],
  })
  const bootstrapManifest = canonicalJson({
    schema: 1,
    manifestType: 'bootstrap',
    version: '1.0.0',
    keyringGeneration: 1,
    targetSequence: 1,
    issuedAt: '2026-08-19T00:00:00.000Z',
    artifacts: [descriptor('bootstrap-package', bootstrapPackage)],
    bootstrapApi: 1,
    entrypoint: '/opt/bootstrap/index.mjs',
  })
  const environmentSignature = canonicalJson(signature(environmentManifest, current))
  const bootstrapSignature = canonicalJson(signature(bootstrapManifest, current))
  const dsh = Buffer.from('dsh tarball')
  const dshCandidate = registryCandidate(registry, '0.1.0-rc.7', dsh)
  const artifacts = [
    descriptor('environment-manifest', environmentManifest, 'application/vnd.dsh-platform.manifest.v1+json'),
    descriptor('environment-signature', environmentSignature, 'application/vnd.dsh-platform.signature.v1+json'),
    descriptor('bootstrap-manifest', bootstrapManifest, 'application/vnd.dsh-platform.manifest.v1+json'),
    descriptor('bootstrap-signature', bootstrapSignature, 'application/vnd.dsh-platform.signature.v1+json'),
  ]
  const stable = canonicalJson({
    schema: 1,
    updateApi: 1,
    keyringGeneration: 1,
    targetSequence: 1,
    issuedAt: '2026-08-19T00:00:00.000Z',
    artifacts,
    desired: {
      bootstrap: { version: '1.0.0', manifestArtifactId: 'bootstrap-manifest', signatureArtifactId: 'bootstrap-signature' },
      environment: { version: '2026.08.19.1', manifestArtifactId: 'environment-manifest', signatureArtifactId: 'environment-signature' },
      dsh: {
        version: '0.1.0-rc.7',
        integrity: `sha512-${createHash('sha512').update(dsh).digest('base64')}`,
      },
    },
    officialDshPolicy: officialDshPolicy(registry),
  })
  const ring = canonicalJson(keyring(1, current, next))
  const files = new Map([
    ['https://metadata.example/keyring.json', ring],
    ['https://metadata.example/keyring.sig.json', canonicalJson(signature(ring, recovery))],
    ['https://metadata.example/stable.json', stable],
    ['https://metadata.example/stable.sig.json', canonicalJson(signature(stable, current))],
    ...artifacts.map(artifact => [artifact.url, {
      'environment-manifest': environmentManifest,
      'environment-signature': environmentSignature,
      'bootstrap-manifest': bootstrapManifest,
      'bootstrap-signature': bootstrapSignature,
    }[artifact.id]]),
    ['https://release.example/environment-component', component],
    ['https://release.example/bootstrap-package', bootstrapPackage],
    ['https://registry.npmjs.org/%40deepseek-ai%2Fdsh', Buffer.from(JSON.stringify({
      versions: { [dshCandidate.version]: dshCandidate },
    }))],
    [dshCandidate.dist.tarball, dsh],
  ])
  return { recovery, current, next, files, stable }
}

async function system() {
  const fixture = await releaseFixture()
  const root = await mkdtemp(join(tmpdir(), 'dsh-updater-'))
  const untrustedRoot = join(root, 'downloads', 'untrusted')
  await mkdir(untrustedRoot, { recursive: true })
  const ledger = new TrustLedger(join(root, 'trust'), fixture.recovery.publicKey)
  const fetchImpl = async url => {
    const bytes = fixture.files.get(String(url))
    return bytes === undefined ? response('missing', 404) : response(bytes)
  }
  const objects = new VerifiedObjectStore({ root: join(root, 'trust'), untrustedRoot, ledger, fetchImpl })
  const trust = {
    acceptKeyring: (bytes, value) => ledger.acceptKeyring(bytes, value),
    acceptTarget: (bytes, value) => ledger.acceptTarget(bytes, value),
    importArtifact: (id, path, parent) => parent === null
      ? objects.importFromTarget(id, path)
      : objects.importFromManifest(parent, id, path),
    acceptManifest: (token, signatureToken) => objects.acceptManifest(token, signatureToken),
    ensureOfficialDsh: version => objects.ensureOfficialDsh(version),
    activate: tokens => objects.activate(tokens),
  }
  const metadata = new MetadataClient({ baseUrl: 'https://metadata.example/', trust, fetchImpl, retryMs: 1 })
  const preparer = new TargetPreparer({ untrustedRoot, trust, fetchImpl })
  return { fixture, root, ledger, objects, trust, metadata, preparer }
}

test('checks Recovery keyring before stable and prepares the complete signed Artifact graph', async () => {
  const { metadata, preparer, ledger, objects } = await system()
  const checked = await metadata.check()
  assert.equal(checked.value.targetSequence, 1)
  const prepared = await preparer.prepare(checked.value)
  assert.equal(prepared.receipts.size, 6)
  assert.equal(prepared.dsh.receipt.authorityType, 'official-dsh')
  assert.equal(prepared.receiptTokens.length, 7)
  assert.equal([...prepared.paths.values()].every(path => path.includes('/trust/objects/')), true)
  assert.equal((await ledger.currentKeyring()).value.generation, 1)
  assert.equal((await objects.readReceipt(prepared.environment.manifestReceipt.token)).authoritySignature.keyId.length, 64)
})

test('constructs Pristine DSH only from a receipt-backed archive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-trusted-pristine-'))
  const source = join(root, 'source', 'package')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.8' }))
  const trusted = join(root, 'trust', 'objects', 'trusted-object')
  await mkdir(join(root, 'trust', 'objects'), { recursive: true })
  const archived = spawnSync('tar', ['-czf', trusted, '-C', join(root, 'source'), 'package'], { encoding: 'utf8' })
  assert.equal(archived.status, 0, archived.stderr)

  const activator = new PlatformActivator({ dataRoot: join(root, 'data'), bootstrap: {}, stage0: {} })
  const pristine = await activator.pristine('0.1.0-rc.8', { path: trusted })
  assert.equal(JSON.parse(await readFile(join(pristine, 'package.json'), 'utf8')).version, '0.1.0-rc.8')
})

test('serializes one update task and persists success progress', async () => {
  const { root, metadata, preparer } = await system()
  let activated
  const state = new UpdateStateStore(join(root, 'state', 'update.json'))
  const coordinator = new UpdateCoordinator({
    metadata,
    preparer,
    activator: { activate: async prepared => { activated = prepared.stable.targetSequence } },
    state,
  })
  const task = coordinator.start()
  assert.throws(() => coordinator.start(), UpdateConflictError)
  await assert.rejects(coordinator.check(), UpdateConflictError)
  const result = await task.completion
  assert.equal(result.status, 'success')
  assert.equal(activated, 1)
  assert.equal((await state.read()).progress, 100)
})

test('persists a failed update without activating receipts and permits a later retry', async () => {
  const { root, metadata, objects, preparer } = await system()
  let fail = true
  const state = new UpdateStateStore(join(root, 'state', 'update.json'))
  const coordinator = new UpdateCoordinator({
    metadata,
    preparer,
    activator: { activate: async () => { if (fail) throw new Error('activation failed') } },
    state,
  })
  await assert.rejects(coordinator.start().completion, /activation failed/)
  assert.equal((await state.read()).status, 'failed')
  assert.equal((await objects.allReceipts()).every(receipt => receipt.status === 'staged'), true)
  fail = false
  await coordinator.start().completion
  assert.equal((await state.read()).status, 'success')
})

test('rolls back the runtime switch when receipt activation fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-updater-rollback-'))
  let rolledBack = false
  const prepared = { receiptTokens: ['receipt'] }
  const coordinator = new UpdateCoordinator({
    metadata: { check: async () => ({ value: { targetSequence: 1 } }) },
    preparer: {
      prepare: async () => prepared,
      trust: { activate: async () => { throw new Error('receipt activation failed') } },
    },
    activator: {
      activate: async value => assert.equal(value, prepared),
      rollback: async value => { rolledBack = value === prepared },
    },
    state: new UpdateStateStore(join(root, 'state', 'update.json')),
  })
  await assert.rejects(coordinator.start().completion, /receipt activation failed/)
  assert.equal(rolledBack, true)
})

function experimentalSystem(root, overrides = {}) {
  const calls = []
  const stable = {
    desired: {
      bootstrap: { version: '1.0.0' },
      environment: { version: 'env-1' },
      dsh: { version: '0.1.0-rc.7' },
    },
  }
  const prepared = { receiptTokens: ['experimental-receipt'] }
  const activator = {
    bootstrap: { status: async () => ({ bootstrapVersion: '1.0.0' }) },
    currentDeployment: async () => ({
      dsh: '0.1.0-rc.7', environment: 'env-1', runtime: 'runtime-a', dataSnapshot: null, receiptTokens: ['stable-receipt'],
    }),
    prepareExperimental: async () => ({ runtimeId: 'runtime-b', environmentVersion: 'env-1', dshVersion: '0.1.0-rc.8' }),
    suspendDsh: async () => { calls.push('suspend') },
    resumeDsh: async () => { calls.push('resume') },
    switchExperimental: async id => { calls.push(`switch:${id}`) },
    health: async () => ({ healthy: true }),
    experimentalActivationTokens: async tokens => ['stable-receipt', ...tokens],
    restoreDeployment: async (from, options) => { calls.push(`restore-runtime:${from.runtime}:${String(options?.resume)}`) },
    ...overrides.activator,
  }
  const snapshots = {
    create: async value => { calls.push(`snapshot:${value.id}`); return { id: value.id } },
    restore: async id => { calls.push(`restore-data:${id}`) },
    ...overrides.snapshots,
  }
  const trust = {
    activate: async tokens => { calls.push(`activate:${tokens.join(',')}`) },
    ...overrides.trust,
  }
  const coordinator = new UpdateCoordinator({
    metadata: { check: async () => ({ value: stable }) },
    npm: { latest: async () => ({ version: '0.1.0-rc.8' }) },
    preparer: { prepareExperimental: async () => prepared, trust },
    activator,
    snapshots,
    journal: new UpdateJournal(join(root, 'state', 'transaction.json')),
    state: new UpdateStateStore(join(root, 'state', 'update.json')),
    probationSeconds: 0,
    channelState: overrides.channelState,
  })
  return { calls, coordinator }
}

test('runs a user-started Experimental candidate through snapshot and probation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-experimental-success-'))
  const { calls, coordinator } = experimentalSystem(root)
  await coordinator.startExperimental().completion
  assert.equal((await coordinator.journal.read()).phase, 'committed')
  assert.deepEqual(calls.map(value => value.replace(/[0-9a-f-]{36}/, 'task')), [
    'suspend', 'snapshot:task', 'switch:runtime-b', 'activate:stable-receipt,experimental-receipt',
  ])
})

test('does not switch when the mandatory snapshot fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-experimental-snapshot-fail-'))
  const { calls, coordinator } = experimentalSystem(root, {
    snapshots: { create: async () => { throw new Error('snapshot failed') } },
  })
  await assert.rejects(coordinator.startExperimental().completion, /snapshot failed/)
  assert.equal((await coordinator.journal.read()).phase, 'failed')
  assert.deepEqual(calls, ['suspend', 'resume'])
})

test('restores exact Runtime and data when Experimental probation fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-experimental-health-fail-'))
  const { calls, coordinator } = experimentalSystem(root, {
    activator: { health: async () => ({ healthy: false }) },
  })
  await assert.rejects(coordinator.startExperimental().completion, /probation/)
  assert.equal((await coordinator.journal.read()).phase, 'rolled-back')
  assert.deepEqual(calls.map(value => value.replace(/[0-9a-f-]{36}/, 'task')), [
    'suspend', 'snapshot:task', 'switch:runtime-b', 'suspend',
    'restore-runtime:runtime-a:false', 'restore-data:task', 'resume',
  ])
})

test('keeps restoration resumable when rollback itself is interrupted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-experimental-rollback-interrupted-'))
  const { coordinator } = experimentalSystem(root, {
    activator: { health: async () => ({ healthy: false }) },
    snapshots: { restore: async () => { throw new Error('restore interrupted') } },
  })
  await assert.rejects(coordinator.startExperimental().completion, /probation/)
  assert.equal((await coordinator.journal.read()).phase, 'restoring-data')
  assert.match((await coordinator.state.read()).error, /rollback failed: restore interrupted/)
})

test('restores an interrupted Experimental transaction before DSH starts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-experimental-boot-recovery-'))
  const journal = new UpdateJournal(join(root, 'state', 'transaction.json'))
  const from = {
    dsh: '0.1.0-rc.7', environment: 'env-1', runtime: 'runtime-a',
    dataSnapshot: null, receiptTokens: ['stable-receipt'],
  }
  await journal.begin({
    transactionId: 'interrupted', mode: 'experimental', from,
    to: { dsh: '0.1.0-rc.8', environment: 'env-1', runtime: 'runtime-b' },
  })
  await journal.transition('candidate-ready', { receiptTokens: ['experimental-receipt'] })
  await journal.transition('suspended')
  await journal.transition('snapshot-created', { snapshotId: 'snapshot-a' })
  await journal.transition('switched')
  await journal.transition('probation', { probationUntil: '2026-08-19T00:02:00.000Z' })
  const calls = []
  await recoverInterruptedUpdate({
    journal,
    snapshots: { restore: async id => calls.push(`restore-data:${id}`) },
    activator: {
      restoreDeployment: async (deployment, options) => calls.push(`restore-runtime:${deployment.runtime}:${String(options.resume)}`),
      suspendDsh: async () => calls.push('suspend'),
      resumeDsh: async () => calls.push('resume'),
    },
    resume: false,
  })
  assert.deepEqual(calls, ['restore-runtime:runtime-a:false', 'restore-data:snapshot-a'])
  assert.equal((await journal.read()).phase, 'rolled-back')
})

test('marks a pre-switch interruption failed without touching DSH during boot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-experimental-early-recovery-'))
  const journal = new UpdateJournal(join(root, 'state', 'transaction.json'))
  await journal.begin({
    transactionId: 'interrupted', mode: 'experimental',
    from: {
      dsh: '0.1.0-rc.7', environment: 'env-1', runtime: 'runtime-a',
      dataSnapshot: null, receiptTokens: ['stable-receipt'],
    },
    to: { dsh: '0.1.0-rc.8', environment: 'env-1', runtime: 'runtime-b' },
  })
  const calls = []
  await recoverInterruptedUpdate({
    journal,
    snapshots: { restore: async () => calls.push('restore-data') },
    activator: {
      restoreDeployment: async () => calls.push('restore-runtime'),
      suspendDsh: async () => calls.push('suspend'),
      resumeDsh: async () => calls.push('resume'),
    },
    resume: false,
  })
  assert.deepEqual(calls, [])
  assert.equal((await journal.read()).phase, 'failed')
})

test('reconciles a committed journal with a state write interrupted after activation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-experimental-state-recovery-'))
  const journal = new UpdateJournal(join(root, 'state', 'transaction.json'))
  const state = new UpdateStateStore(join(root, 'state', 'update.json'))
  await journal.begin({
    transactionId: 'task-a', mode: 'experimental',
    from: {
      dsh: '0.1.0-rc.7', environment: 'env-1', runtime: 'runtime-a',
      dataSnapshot: null, receiptTokens: ['stable-receipt'],
    },
    to: { dsh: '0.1.0-rc.8', environment: 'env-1', runtime: 'runtime-b' },
  })
  await journal.transition('candidate-ready', { receiptTokens: ['experimental-receipt'] })
  await journal.transition('suspended')
  await journal.transition('snapshot-created', { snapshotId: 'snapshot-a' })
  await journal.transition('switched')
  await journal.transition('probation', { probationUntil: '2026-08-19T00:02:00.000Z' })
  await journal.transition('committed')
  await state.write('probation', { taskId: 'task-a', progress: 85 })
  const recovered = await reconcileRecoveredState({ journal, state })
  assert.equal(recovered.persisted.status, 'success')
  assert.equal(recovered.persisted.progress, 100)

  await state.write('downloading', { taskId: 'stable-task', progress: 10 })
  const unrelated = await reconcileRecoveredState({ journal, state })
  assert.equal(unrelated.persisted.status, 'downloading')
})

test('replaces the prior official DSH authority while retaining Stable deployment receipts', async () => {
  const activator = new PlatformActivator({
    dataRoot: '/unused',
    bootstrap: {},
    stage0: {
      activeReceipts: async () => ({ receipts: [
        { token: 'stable-a', authorityType: 'stable' },
        { token: 'official-old', authorityType: 'official-dsh' },
        { token: 'stable-b', authorityType: 'stable' },
      ] }),
    },
  })
  assert.deepEqual(
    await activator.experimentalActivationTokens(['experimental-new']),
    ['stable-a', 'stable-b', 'experimental-new'],
  )
})

test('restores Runtime, Environment, System Plugins, and receipts as one deployment', async () => {
  const calls = []
  const activator = new PlatformActivator({
    dataRoot: '/unused',
    bootstrap: { request: async () => calls.push('resume') },
    stage0: { activate: async tokens => calls.push(`receipts:${tokens.join(',')}`) },
  })
  activator.runtimeSlots = { promote: async value => calls.push(`runtime:${value}`) }
  activator.environmentSlots = { promote: async value => calls.push(`environment:${value}`) }
  activator.systemPluginSlots = { promote: async value => calls.push(`plugins:${value}`) }
  await activator.restoreDeployment({
    runtime: 'runtime-a', environment: 'env-1', receiptTokens: ['stable-a'],
  }, { resume: false })
  assert.deepEqual(calls, ['runtime:runtime-a', 'environment:env-1', 'plugins:env-1', 'receipts:stable-a'])
})

test('removes the superseded snapshot only after the next Experimental commit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-experimental-retention-'))
  const { coordinator } = experimentalSystem(root)
  const removed = []
  coordinator.snapshots.remove = async id => removed.push(id)
  await coordinator.startExperimental().completion
  assert.deepEqual(removed, [])
  coordinator.activator.currentDeployment = async () => ({
    dsh: '0.1.0-rc.7', environment: 'env-1', runtime: 'runtime-b', dataSnapshot: null, receiptTokens: ['stable-receipt'],
  })
  await coordinator.startExperimental().completion
  assert.equal(removed.length, 1)
})

test('reads npm latest from the official packument without trusting it locally', async () => {
  const candidate = {
    name: '@deepseek-ai/dsh', version: '0.1.0-rc.8',
    dist: { integrity: `sha512-${Buffer.alloc(64).toString('base64')}`, tarball: 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.1.0-rc.8.tgz', signatures: [{ keyid: 'key', sig: 'signature' }] },
  }
  const client = new NpmRegistryClient({ fetchImpl: async () => response(JSON.stringify({
    'dist-tags': { latest: candidate.version }, versions: { [candidate.version]: candidate },
  })) })
  const found = await client.latest({
    desired: { dsh: { version: '0.1.0-rc.7' } },
    officialDshPolicy: { registry: 'https://registry.npmjs.org/', packageName: '@deepseek-ai/dsh' },
  })
  assert.equal(found.version, candidate.version)
})

test('records candidate and combination Holds without holding snapshot failures', async () => {
  const candidateRoot = await mkdtemp(join(tmpdir(), 'dsh-experimental-candidate-hold-'))
  const candidateState = new ChannelStateStore(join(candidateRoot, 'state', 'channel.json'))
  const candidate = experimentalSystem(candidateRoot, {
    channelState: candidateState,
  })
  candidate.coordinator.preparer.prepareExperimental = async () => { throw new Error('static validation failed') }
  await assert.rejects(candidate.coordinator.startExperimental().completion, /static validation/)
  assert.equal((await candidateState.read()).holds[0].type, 'version')

  const combinationRoot = await mkdtemp(join(tmpdir(), 'dsh-experimental-combination-hold-'))
  const combinationState = new ChannelStateStore(join(combinationRoot, 'state', 'channel.json'))
  const combination = experimentalSystem(combinationRoot, {
    channelState: combinationState,
    activator: { health: async () => ({ healthy: false }) },
  })
  await assert.rejects(combination.coordinator.startExperimental().completion, /probation/)
  assert.equal((await combinationState.read()).holds[0].type, 'combination')

  const snapshotRoot = await mkdtemp(join(tmpdir(), 'dsh-experimental-no-snapshot-hold-'))
  const snapshotState = new ChannelStateStore(join(snapshotRoot, 'state', 'channel.json'))
  const snapshot = experimentalSystem(snapshotRoot, {
    channelState: snapshotState,
    snapshots: { create: async () => { throw new Error('disk full') } },
  })
  await assert.rejects(snapshot.coordinator.startExperimental().completion, /disk full/)
  assert.equal((await snapshotState.read()).holds.length, 0)
})

test('allows Stable return only to a recovery point no newer than signed Stable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-return-stable-'))
  let restored = false
  const recovery = {
    plan: async () => ({ planId: 'plan-a', previous: { dsh: '0.1.0-rc.8' } }),
    restore: async () => { restored = true; return { status: 'rolled-back' } },
  }
  const coordinator = new UpdateCoordinator({
    metadata: { check: async () => ({ value: { desired: { dsh: { version: '0.1.0-rc.7' } } } }) },
    preparer: {}, activator: {}, completeRecovery: recovery,
    state: new UpdateStateStore(join(root, 'state', 'update.json')),
  })
  await assert.rejects(coordinator.startCompleteRollback('plan-a', {
    requireConfirmation: true, confirmDataLoss: true,
  }).completion, /no verified/)
  assert.equal(restored, false)
  coordinator.metadata.check = async () => ({ value: { desired: { dsh: { version: '0.1.0-rc.8' } } } })
  await coordinator.startCompleteRollback('plan-a', { requireConfirmation: true, confirmDataLoss: true }).completion
  assert.equal(restored, true)
})

test('persists a planner failure started through the selected channel', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-reconcile-planning-failure-'))
  const state = new UpdateStateStore(join(root, 'state', 'update.json'))
  const coordinator = new UpdateCoordinator({
    metadata: { check: async () => { throw new Error('metadata unavailable') } },
    preparer: {}, activator: {}, state,
    channelState: { read: async () => ({ updateChannel: 'experimental', holds: [], experimentalBlocked: null }) },
  })
  await assert.rejects(coordinator.startReconcile().completion, /metadata unavailable/)
  assert.equal((await state.read()).status, 'failed')
  assert.match((await state.read()).error, /metadata unavailable/)
})
