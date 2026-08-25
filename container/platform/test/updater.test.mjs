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
import { MetadataClient, MetadataUnavailableError, NpmRegistryClient } from '../../control-plane/modules/updater/lib/metadata.mjs'
import { TargetPreparer } from '../../control-plane/modules/updater/lib/preparer.mjs'
import { UpdateStateStore } from '../../control-plane/modules/updater/lib/state.mjs'
import { UpdateJournal } from '../../control-plane/modules/updater/lib/journal.mjs'
import {
  reconcileRecoveredState,
  recoverInterruptedUpdate,
  resumeInterruptedReconcile,
} from '../../control-plane/modules/updater/lib/recovery.mjs'
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
    version: '1.0.0',
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
      environment: { version: '1.0.0', manifestArtifactId: 'environment-manifest', signatureArtifactId: 'environment-signature' },
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
  let requestedVersion
  const ensureOfficialDsh = preparer.trust.ensureOfficialDsh
  preparer.trust.ensureOfficialDsh = version => {
    requestedVersion = version
    return ensureOfficialDsh(version)
  }
  const progress = []
  const prepared = await preparer.prepare(checked.value, { onProgress: value => { progress.push(value) } })
  assert.equal(prepared.receipts.size, 6)
  assert.equal(prepared.dsh.receipt.authorityType, 'official-dsh')
  assert.equal(prepared.receiptTokens.length, 7)
  assert.equal(requestedVersion, checked.value.desired.dsh.version)
  assert.equal([...prepared.paths.values()].every(path => path.includes('/trust/objects/')), true)
  assert.equal((await ledger.currentKeyring()).value.generation, 1)
  assert.equal((await objects.readReceipt(prepared.environment.manifestReceipt.token)).authoritySignature.keyId.length, 64)
  assert.equal(progress.at(-1).processedBytes, progress.at(-1).totalBytes)
  assert.equal(progress.at(-1).processedItems, progress.at(-1).totalItems)
  for (let index = 1; index < progress.length; index += 1) {
    assert.ok(progress[index].processedBytes >= progress[index - 1].processedBytes)
  }
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

test('reports Stable switching only after the Managed Deployment is prepared', async () => {
  const calls = []
  const record = { id: 'managed-record' }
  const activator = new PlatformActivator({
    dataRoot: '/unused',
    builder: { buildStable: async (prepared, { onProgress }) => {
      calls.push('build')
      await onProgress(87)
      return { record }
    } },
    bootstrap: {
      status: async () => ({ bootstrapVersion: '1.0.0' }),
      request: async (method, path, body) => {
        calls.push('activate')
        assert.equal(method, 'POST')
        assert.equal(path, '/v1/deployments/activate')
        assert.equal(body.record, record)
      },
    },
    stage0: {},
  })
  await activator.activate({ stable: { desired: { bootstrap: { version: '1.0.0' } } } }, {
    onProgress: async progress => { calls.push(`progress:${progress}`) },
    onSwitching: async () => { calls.push('switching') },
  })
  assert.deepEqual(calls, ['build', 'progress:87', 'switching', 'activate'])
})

test('coalesces overlapping metadata checks into one request', async () => {
  let checks = 0
  let complete
  const state = {
    value: { status: 'idle', progress: 0 },
    async read() { return this.value },
    async write(status, fields) { this.value = { ...this.value, ...fields, status }; return this.value },
  }
  const coordinator = new UpdateCoordinator({
    metadata: {
      check: () => {
        checks += 1
        return new Promise(resolve => { complete = resolve })
      },
    },
    state,
    preparer: {},
    activator: {},
  })
  const first = coordinator.check()
  const second = coordinator.check()
  assert.equal(first, second)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(checks, 1)
  complete({ value: { targetSequence: 1, desired: {
    bootstrap: { version: '1.0.0' }, environment: { version: 'env-1' }, dsh: { version: 'rc.1' },
  } } })
  await first
  assert.equal(state.value.status, 'idle')
})

test('keeps telemetry within a phase and clears it at operation and phase boundaries', async () => {
  const state = {
    value: { status: 'idle', phase: null, operation: null, progress: 0 },
    async read() { return this.value },
    async write(status, fields) { this.value = { ...this.value, ...fields, status }; return this.value },
  }
  const coordinator = new UpdateCoordinator({ metadata: {}, preparer: {}, activator: {}, state })

  await coordinator.transition('downloading', {
    operation: 'update', processedBytes: 20, totalBytes: 100,
    processedItems: 1, totalItems: 4, detail: 'downloading',
  })
  await coordinator.transition('downloading', { progress: 20, processedBytes: 40 })
  assert.equal(state.value.totalBytes, 100)
  assert.equal(state.value.processedItems, 1)
  assert.equal(state.value.detail, 'downloading')

  await coordinator.transition('building-candidate', { progress: 75 })
  assert.equal(state.value.processedBytes, null)
  assert.equal(state.value.totalBytes, null)
  assert.equal(state.value.processedItems, null)
  assert.equal(state.value.totalItems, null)
  assert.equal(state.value.detail, null)

  await coordinator.transition('building-candidate', {
    processedBytes: 75, totalBytes: 100, processedItems: 3, totalItems: 4,
  })
  await coordinator.transition('failed', { error: 'build failed' })
  assert.equal(state.value.processedBytes, 75)
  assert.equal(state.value.processedItems, 3)

  await coordinator.transition('checking', { operation: 'check', taskId: null, progress: 0 })
  assert.equal(state.value.processedBytes, null)
  assert.equal(state.value.totalBytes, null)
  assert.equal(state.value.processedItems, null)
  assert.equal(state.value.totalItems, null)
})

test('starts an update only after an in-flight metadata check has settled', async () => {
  let finishCheck
  const events = []
  const state = {
    value: { status: 'idle', progress: 0 },
    async read() { return this.value },
    async write(status, fields) { this.value = { ...this.value, ...fields, status }; return this.value },
  }
  const coordinator = new UpdateCoordinator({
    metadata: {
      check: () => new Promise(resolve => { finishCheck = resolve }),
    },
    state,
    preparer: {},
    activator: {},
  })
  const checking = coordinator.check('page-open')
  await new Promise(resolve => setImmediate(resolve))
  coordinator.run = async taskId => {
    events.push(['update', taskId, state.value.status])
    return coordinator.transition('success', { taskId, operation: 'update', progress: 100 })
  }
  const update = coordinator.start()
  assert.equal(coordinator.hasActiveTask(), true)
  assert.throws(() => coordinator.start(), UpdateConflictError)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events, [])

  finishCheck({ value: { targetSequence: 1, desired: {
    bootstrap: { version: '1.0.0' }, environment: { version: 'env-1' }, dsh: { version: 'rc.1' },
  } } })
  await checking
  await update.completion
  assert.deepEqual(events, [['update', update.taskId, 'idle']])
  assert.equal(state.value.status, 'success')
  assert.equal(state.value.taskId, update.taskId)
})

test('only an automatic check records update notification candidates', async () => {
  const recorded = []
  const state = {
    value: { status: 'idle' },
    async read() { return this.value },
    async write(status, fields) { this.value = { ...this.value, ...fields, status }; return this.value },
  }
  const plan = {
    action: 'experimental', updateChannel: 'experimental', aheadOfStable: false, experimentalBlocked: null, holds: [],
    current: { targetSequence: 1, dsh: '0.1.0-rc.7', environment: 'env-1', runtime: 'runtime-a' },
    supported: { dsh: '0.1.0-rc.8', environment: 'env-1' }, upstream: { version: '0.1.0-rc.10' },
    target: { targetSequence: 2, desired: {
      bootstrap: { version: '1.0.0' }, environment: { version: 'env-1' }, dsh: { version: '0.1.0-rc.8' },
    } },
  }
  const coordinator = new UpdateCoordinator({
    metadata: {}, preparer: {}, activator: {}, state, channelState: {},
    automaticChecks: { record: async value => recorded.push(value), read: async () => ({ automaticCheck: {}, latestAutomatic: {} }) },
  })
  coordinator.desiredState = async () => plan
  coordinator.rollbackPlan = async () => null

  await coordinator.check('page-open')
  assert.equal(recorded.length, 0)
  await coordinator.check('automatic')
  assert.equal(recorded.length, 1)
  assert.equal(recorded[0].upstream.version, '0.1.0-rc.10')
})

test('keeps the last verified target when a later remote check fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-check-last-verified-'))
  const state = new UpdateStateStore(join(root, 'state', 'update.json'))
  const plan = {
    action: 'experimental', updateChannel: 'experimental', aheadOfStable: false, experimentalBlocked: null, holds: [],
    current: { targetSequence: 1, dsh: '0.1.0-rc.7', environment: 'env-1', runtime: 'runtime-a' },
    supported: { dsh: '0.1.0-rc.8', environment: 'env-1' }, upstream: { version: '0.1.0-rc.10' },
    target: { targetSequence: 2, desired: {
      bootstrap: { version: '1.0.0' }, environment: { version: 'env-1' }, dsh: { version: '0.1.0-rc.8' },
    } },
  }
  const coordinator = new UpdateCoordinator({
    metadata: {}, preparer: {}, activator: {}, state, channelState: {},
    now: () => new Date('2026-08-25T00:00:00.000Z'),
  })
  coordinator.rollbackPlan = async () => null
  coordinator.desiredState = async () => plan
  await coordinator.check()
  const verified = await state.read()

  coordinator.desiredState = async () => { throw new Error('keyring.json timed out after 2 attempts') }
  await assert.rejects(coordinator.check(), /timed out/)
  const failed = await state.read()
  assert.equal(failed.status, 'idle')
  assert.deepEqual(failed.supported, verified.supported)
  assert.deepEqual(failed.upstream, verified.upstream)
  assert.deepEqual(failed.available, verified.available)
  assert.equal(failed.updateAvailable, verified.updateAvailable)
  assert.equal(failed.checkedAt, verified.checkedAt)
  assert.equal(failed.remoteCheckError, 'keyring.json timed out after 2 attempts')
  assert.equal(failed.remoteCheckFailedAt, '2026-08-25T00:00:00.000Z')
  assert.equal(failed.error, null)
})

test('reports unpublished metadata only for development images', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-development-metadata-'))
  const state = new UpdateStateStore(join(root, 'state', 'update.json'))
  const channelState = new ChannelStateStore(join(root, 'state', 'channel.json'))
  await channelState.setChannel('experimental')
  let metadataChecks = 0
  const coordinator = new UpdateCoordinator({
    metadata: { check: async () => { metadataChecks += 1; throw new MetadataUnavailableError() } },
    npm: { discover: async () => ({ version: '0.1.0-rc.10' }) },
    preparer: {}, activator: {}, state, channelState,
    allowUnavailableMetadata: true,
  })

  assert.deepEqual(await coordinator.check(), {
    unavailable: true,
    upstream: { version: '0.1.0-rc.10' },
  })
  assert.equal(metadataChecks, 0)
  const persisted = await state.read()
  assert.equal(persisted.status, 'idle')
  assert.equal(persisted.error, null)
  assert.equal(persisted.metadataUnavailable, true)
  assert.deepEqual(persisted.upstream, { version: '0.1.0-rc.10' })
})

test('development images skip foreign Recovery roots while formal images reject them', async () => {
  const mismatch = Object.assign(new Error('keyring signature key is not trusted'), {
    code: 'TRUST_UNKNOWN_KEY',
    localApiPath: '/v1/keyring',
  })
  const developmentRoot = await mkdtemp(join(tmpdir(), 'dsh-development-root-mismatch-'))
  let developmentMetadataChecks = 0
  const development = new UpdateCoordinator({
    metadata: { check: async () => { developmentMetadataChecks += 1; throw mismatch } },
    preparer: {}, activator: {}, state: new UpdateStateStore(join(developmentRoot, 'state', 'update.json')),
    allowUnavailableMetadata: true,
  })
  assert.deepEqual(await development.check(), { unavailable: true, upstream: null })
  assert.equal(developmentMetadataChecks, 0)
  assert.equal((await development.state.read()).metadataUnavailable, true)

  const targetError = Object.assign(new Error('target signature key is not trusted'), {
    code: 'TRUST_UNKNOWN_KEY',
    localApiPath: '/v1/target',
  })
  const targetRoot = await mkdtemp(join(tmpdir(), 'dsh-development-target-mismatch-'))
  const invalidTarget = new UpdateCoordinator({
    metadata: { check: async () => { throw targetError } },
    preparer: {}, activator: {}, state: new UpdateStateStore(join(targetRoot, 'state', 'update.json')),
  })
  await assert.rejects(invalidTarget.check(), /target signature key is not trusted/)

  const formalRoot = await mkdtemp(join(tmpdir(), 'dsh-formal-root-mismatch-'))
  const formal = new UpdateCoordinator({
    metadata: { check: async () => { throw mismatch } },
    preparer: {}, activator: {}, state: new UpdateStateStore(join(formalRoot, 'state', 'update.json')),
  })
  await assert.rejects(formal.check(), /keyring signature key is not trusted/)
})

test('records unpublished formal metadata as a remote check failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-formal-metadata-'))
  const state = new UpdateStateStore(join(root, 'state', 'update.json'))
  const coordinator = new UpdateCoordinator({
    metadata: { check: async () => { throw new MetadataUnavailableError() } },
    preparer: {}, activator: {}, state,
  })

  await assert.rejects(coordinator.check(), MetadataUnavailableError)
  const failed = await state.read()
  assert.equal(failed.status, 'idle')
  assert.equal(failed.remoteCheckError, 'signed update metadata has not been published')
})

test('does not retry missing signed metadata files', async () => {
  let requests = 0
  const client = new MetadataClient({
    baseUrl: 'https://metadata.example/',
    trust: {},
    attempts: 3,
    retryMs: 1,
    fetchImpl: async () => { requests += 1; return response('missing', 404) },
  })
  await assert.rejects(client.check(), MetadataUnavailableError)
  assert.equal(requests, 2)
})

test('bounds stalled signed metadata and npm Registry requests', async () => {
  const stalledFetch = async (_url, options) => new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(options.signal.reason)
      return
    }
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
  })
  const metadata = new MetadataClient({
    baseUrl: 'https://metadata.example/',
    trust: {},
    fetchImpl: stalledFetch,
    attempts: 1,
    requestTimeoutMs: 10,
  })
  const npm = new NpmRegistryClient({ fetchImpl: stalledFetch, requestTimeoutMs: 10 })

  await assert.rejects(metadata.check(), error => error?.name === 'TimeoutError')
  await assert.rejects(npm.discover(), error => error?.name === 'TimeoutError')
})

test('retries only a slow metadata file with the extended retry budget', async () => {
  const fixture = await releaseFixture()
  const requests = new Map()
  const fetchImpl = async (url, options) => {
    const key = String(url)
    requests.set(key, (requests.get(key) ?? 0) + 1)
    if (key.endsWith('/keyring.json')) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 20)
        options.signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(options.signal.reason)
        }, { once: true })
      })
    }
    return response(fixture.files.get(key) ?? 'missing', fixture.files.has(key) ? 200 : 404)
  }
  const ledger = new TrustLedger(await mkdtemp(join(tmpdir(), 'dsh-metadata-retry-')), fixture.recovery.publicKey)
  const metadata = new MetadataClient({
    baseUrl: 'https://metadata.example/',
    trust: {
      acceptKeyring: (bytes, value) => ledger.acceptKeyring(bytes, value),
      acceptTarget: (bytes, value) => ledger.acceptTarget(bytes, value),
    },
    fetchImpl,
    retryMs: 1,
    requestTimeoutMs: 10,
    retryRequestTimeoutMs: 40,
  })

  assert.equal((await metadata.check()).value.targetSequence, 1)
  assert.equal(requests.get('https://metadata.example/keyring.json'), 2)
  assert.equal(requests.get('https://metadata.example/keyring.sig.json'), 1)
  assert.equal(requests.get('https://metadata.example/stable.json'), 1)
  assert.equal(requests.get('https://metadata.example/stable.sig.json'), 1)
})

test('refetches only the metadata pair whose signature is briefly inconsistent', async () => {
  const fixture = await releaseFixture()
  const requests = new Map()
  const fetchImpl = async url => {
    const key = String(url)
    requests.set(key, (requests.get(key) ?? 0) + 1)
    if (key.endsWith('/stable.sig.json') && requests.get(key) === 1) return response('{}')
    return response(fixture.files.get(key) ?? 'missing', fixture.files.has(key) ? 200 : 404)
  }
  const ledger = new TrustLedger(await mkdtemp(join(tmpdir(), 'dsh-metadata-pair-retry-')), fixture.recovery.publicKey)
  const metadata = new MetadataClient({
    baseUrl: 'https://metadata.example/',
    trust: {
      acceptKeyring: (bytes, value) => ledger.acceptKeyring(bytes, value),
      acceptTarget: (bytes, value) => ledger.acceptTarget(bytes, value),
    },
    fetchImpl,
    retryMs: 1,
  })

  assert.equal((await metadata.check()).value.targetSequence, 1)
  assert.equal(requests.get('https://metadata.example/keyring.json'), 1)
  assert.equal(requests.get('https://metadata.example/keyring.sig.json'), 1)
  assert.equal(requests.get('https://metadata.example/stable.json'), 2)
  assert.equal(requests.get('https://metadata.example/stable.sig.json'), 2)
})

test('uses the extended retry budget for a slow npm Registry response', async () => {
  let requests = 0
  const npm = new NpmRegistryClient({
    requestTimeoutMs: 10,
    retryRequestTimeoutMs: 40,
    retryMs: 1,
    fetchImpl: async (_url, options) => {
      requests += 1
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 20)
        options.signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(options.signal.reason)
        }, { once: true })
      })
      return response(JSON.stringify({
        'dist-tags': { latest: '0.1.1-rc.1' },
        versions: { '0.1.1-rc.1': { version: '0.1.1-rc.1' } },
      }))
    },
  })

  assert.deepEqual(await npm.discover(), { version: '0.1.1-rc.1' })
  assert.equal(requests, 2)
})

test('serializes one update task and persists success progress', async () => {
  const { root, metadata, preparer } = await system()
  let activated
  const activationStates = []
  const state = new UpdateStateStore(join(root, 'state', 'update.json'))
  const coordinator = new UpdateCoordinator({
    metadata,
    preparer,
    activator: {
      activate: async (prepared, { onSwitching }) => {
        activationStates.push((await state.read()).status)
        await onSwitching()
        activationStates.push((await state.read()).status)
        activated = prepared.stable.targetSequence
      },
      health: async () => ({ healthy: true, components: [
        { id: 'gateway', healthy: true }, { id: 'dsh-runtime', healthy: true },
      ] }),
    },
    state,
  })
  const task = coordinator.start()
  assert.throws(() => coordinator.start(), UpdateConflictError)
  assert.deepEqual(await coordinator.check('page-open'), { busy: true })
  await assert.rejects(coordinator.check(), UpdateConflictError)
  const result = await task.completion
  assert.equal(result.status, 'success')
  assert.equal(activated, 1)
  assert.deepEqual(activationStates, ['building-candidate', 'switching'])
  assert.equal((await state.read()).progress, 100)
  assert.equal((await state.read()).readyServices, 2)
  assert.equal((await state.read()).totalServices, 2)
})

test('samples high-frequency Runtime copy metrics without losing final totals', async () => {
  const { root, metadata, preparer } = await system()
  const reports = []
  const coordinator = new UpdateCoordinator({
    metadata,
    preparer,
    activator: {
      activate: async (_prepared, { onProgress, onSwitching }) => {
        await onProgress(82)
        await onProgress(80)
        for (let item = 1; item <= 1_000; item += 1) {
          await onProgress({
            processedBytes: item,
            totalBytes: 1_000,
            processedItems: item,
            totalItems: 1_000,
          })
        }
        await onSwitching()
      },
      health: async () => ({ healthy: true, components: [] }),
    },
    state: new UpdateStateStore(join(root, 'state', 'update.json')),
    report: (message, fields) => { reports.push({ message, fields }) },
  })

  await coordinator.start().completion
  const buildReports = reports.filter(entry => entry.message === 'update.phase.changed'
    && entry.fields.status === 'building-candidate')
  assert.ok(buildReports.length <= 18)
  assert.deepEqual(
    buildReports.map(entry => entry.fields.progress),
    buildReports.map(entry => entry.fields.progress).toSorted((left, right) => left - right),
  )
  assert.equal(buildReports.at(-1).fields.processedBytes, 1_000)
  assert.equal(buildReports.at(-1).fields.processedItems, 1_000)
})

test('persists a failed update without activating receipts and permits a later retry', async () => {
  const { root, metadata, objects, preparer } = await system()
  let fail = true
  const reports = []
  const state = new UpdateStateStore(join(root, 'state', 'update.json'))
  const coordinator = new UpdateCoordinator({
    metadata,
    preparer,
    activator: { activate: async () => { if (fail) throw new Error('activation failed') } },
    state,
    report: (message, fields) => { reports.push({ message, fields }) },
  })
  await assert.rejects(coordinator.start().completion, /activation failed/)
  assert.equal((await state.read()).status, 'failed')
  assert.equal((await state.read()).phase, 'building-candidate')
  assert.equal((await objects.allReceipts()).every(receipt => receipt.status === 'staged'), true)
  assert.equal(reports.some(entry => entry.message === 'update.stable.failed'
    && entry.fields.error instanceof Error
    && entry.fields.taskId !== undefined), true)
  assert.equal(reports.some(entry => entry.message === 'update.phase.changed'
    && entry.fields.status === 'failed'
    && entry.fields.phase === 'building-candidate'
    && entry.fields.level === 'error'), true)
  fail = false
  await coordinator.start().completion
  assert.equal((await state.read()).status, 'success')
})

test('reports secondary cleanup failures without failing a successful update', async () => {
  const { root, metadata, preparer } = await system()
  const reports = []
  const coordinator = new UpdateCoordinator({
    metadata,
    preparer,
    activator: {
      activate: async () => {},
      currentDeployment: async () => ({ runtime: 'runtime-a' }),
    },
    state: new UpdateStateStore(join(root, 'state', 'update.json')),
    automaticChecks: { clearSatisfied: async () => { throw new Error('notification state is read-only') } },
    report: (message, fields) => { reports.push({ message, fields }) },
  })

  assert.equal((await coordinator.start().completion).status, 'success')
  const warning = reports.find(entry => entry.message === 'update.notifications.cleanup.failed')
  assert.equal(warning.fields.level, 'warning')
  assert.match(warning.fields.error.message, /read-only/)
})

test('treats Bootstrap-owned receipt activation failure as one failed switch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-updater-rollback-'))
  const prepared = { receiptTokens: ['receipt'] }
  const coordinator = new UpdateCoordinator({
    metadata: { check: async () => ({ value: { targetSequence: 1 } }) },
    preparer: {
      prepare: async () => prepared,
      trust: { activate: async () => { throw new Error('Updater must not activate receipts directly') } },
    },
    activator: {
      activate: async value => {
        assert.equal(value, prepared)
        throw new Error('receipt activation failed inside Bootstrap transaction')
      },
    },
    state: new UpdateStateStore(join(root, 'state', 'update.json')),
  })
  await assert.rejects(coordinator.start().completion, /receipt activation failed/)
})

function experimentalSystem(root, overrides = {}) {
  const calls = []
  const stable = {
    targetSequence: 11,
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
      authority: 'stable', targetSequence: 11,
      dsh: '0.1.0-rc.7', environment: 'env-1', runtime: 'runtime-a', dataSnapshot: null, receiptTokens: ['stable-receipt'],
    }),
    prepareExperimental: async (_prepared, options) => {
      assert.deepEqual(options, { targetSequence: 11 })
      return { runtimeId: 'runtime-b', environmentVersion: 'env-1', dshVersion: '0.1.0-rc.8' }
    },
    suspendDsh: async () => { calls.push('suspend') },
    resumeDsh: async () => { calls.push('resume') },
    switchExperimental: async id => { calls.push(`switch:${id}`) },
    commitExperimental: async id => { calls.push(`commit:${id}`) },
    health: async () => ({ healthy: true, components: [
      { id: 'gateway', healthy: true }, { id: 'dsh-runtime', healthy: true },
    ] }),
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
  const result = await coordinator.startExperimental().completion
  assert.equal(result.readyServices, 2)
  assert.equal(result.totalServices, 2)
  assert.equal((await coordinator.journal.read()).phase, 'committed')
  assert.deepEqual(calls.map(value => value.replace(/[0-9a-f-]{36}/, 'task')), [
    'suspend', 'snapshot:task', 'switch:runtime-b', 'commit:runtime-b',
  ])
  const state = await coordinator.state.read()
  assert.deepEqual(state.current, { dsh: '0.1.0-rc.8', environment: 'env-1', runtime: 'runtime-b' })
  assert.equal(state.aheadOfStable, true)
  assert.equal(state.updateAvailable, false)
  assert.equal(state.outcome, 'frozen')
  assert.equal(state.probationUntil, null)
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
  let healthChecks = 0
  const { calls, coordinator } = experimentalSystem(root, {
    activator: {
      health: async () => {
        healthChecks += 1
        return healthChecks === 1
          ? { healthy: false, components: [{ id: 'dsh-runtime', healthy: false }] }
          : { healthy: true, components: [{ id: 'dsh-runtime', healthy: true }] }
      },
    },
    snapshots: {
      restore: async (id, { onProgress } = {}) => {
        calls.push(`restore-data:${id}`)
        await onProgress?.({ processedItems: 0, totalItems: 4 })
        await onProgress?.({ processedItems: 4, totalItems: 4 })
      },
    },
  })
  const states = []
  coordinator.on('state', value => { states.push(value) })
  await assert.rejects(coordinator.startExperimental().completion, /probation/)
  assert.equal((await coordinator.journal.read()).phase, 'rolled-back')
  assert.deepEqual(calls.map(value => value.replace(/[0-9a-f-]{36}/, 'task')), [
    'suspend', 'snapshot:task', 'switch:runtime-b', 'suspend',
    'restore-runtime:runtime-a:false', 'restore-data:task', 'resume',
  ])
  assert.deepEqual(
    [...new Set(states.filter(value => value.phase === 'restoring-data').map(value => value.detail))],
    ['recovery:suspend', 'recovery:deployment', 'recovery:snapshot', 'recovery:runtime', 'recovery:health'],
  )
  assert.ok(states.some(value => (
    value.phase === 'restoring-data'
    && value.detail === 'recovery:snapshot'
    && value.processedItems === 4
    && value.totalItems === 4
  )))
  const failed = await coordinator.state.read()
  assert.equal(failed.status, 'failed')
  assert.equal(failed.phase, 'probation')
  assert.equal(failed.readyServices, 0)
  assert.equal(failed.totalServices, 1)
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

test('clears a metadata check interrupted by Management restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-check-state-recovery-'))
  const journal = new UpdateJournal(join(root, 'state', 'transaction.json'))
  const state = new UpdateStateStore(join(root, 'state', 'update.json'))
  await state.write('checking', {
    taskId: null,
    checkSource: 'page-open',
    progress: 0,
    available: { dsh: '0.1.1-rc.1' },
  })

  const recovered = await reconcileRecoveredState({ journal, state })

  assert.equal(recovered.persisted.status, 'idle')
  assert.equal(recovered.persisted.taskId, null)
  assert.equal(recovered.persisted.checkSource, null)
  assert.deepEqual(recovered.persisted.available, { dsh: '0.1.1-rc.1' })
})

test('resumes interrupted updates through channel-aware reconcile and closes audit logs', async () => {
  const completion = Promise.withResolvers()
  const reports = []
  const audits = []
  let stableStarts = 0
  let reconcileStarts = 0
  const task = resumeInterruptedReconcile({
    coordinator: {
      start: () => { stableStarts += 1 },
      startReconcile: () => {
        reconcileStarts += 1
        return { taskId: 'resumed-task', completion: completion.promise }
      },
    },
    persisted: { taskId: 'interrupted-task' },
    report: async (message, fields) => { reports.push({ message, fields }) },
    audit: async (message, fields) => { audits.push({ message, fields }) },
  })

  assert.equal(task.taskId, 'resumed-task')
  assert.equal(stableStarts, 0)
  assert.equal(reconcileStarts, 1)
  completion.resolve()
  await completion.promise
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(audits, [{
    message: 'update.failed',
    fields: {
      taskId: 'interrupted-task', outcome: 'interrupted',
      resumedByTaskId: 'resumed-task', level: 'warning',
    },
  }])
  assert.deepEqual(reports.map(value => value.message), [
    'update.resume.started',
    'update.resume.completed',
  ])
  assert.equal(reports.every(value => value.fields.taskId === 'resumed-task'), true)
  assert.equal(reports.every(value => value.fields.interruptedTaskId === 'interrupted-task'), true)
})

test('records a terminal failure when an interrupted reconcile cannot resume', async () => {
  const completion = Promise.withResolvers()
  const reports = []
  resumeInterruptedReconcile({
    coordinator: {
      startReconcile: () => ({ taskId: 'resumed-task', completion: completion.promise }),
    },
    persisted: { taskId: 'interrupted-task' },
    report: async (message, fields) => { reports.push({ message, fields }) },
    audit: async () => {},
  })
  completion.reject(new Error('resume failed'))
  await completion.promise.catch(() => {})
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(reports.map(value => value.message), [
    'update.resume.started',
    'update.resume.failed',
  ])
  assert.equal(reports[1].fields.error.message, 'resume failed')
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

test('treats an uninitialized Deployment as an empty public status without hiding read failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-uninitialized-status-'))
  const reports = []
  let fail = false
  const activator = new PlatformActivator({
    dataRoot: '/unused',
    bootstrap: { request: async (method, path) => {
      if (path === '/v1/deployments/current') {
        if (fail) throw new Error('Bootstrap socket is unavailable')
        return { record: null }
      }
      if (path === '/v1/deployments/rollback-plan') return { plan: null }
      throw new Error(`unexpected request: ${method} ${path}`)
    } },
    stage0: {},
  })
  const coordinator = new UpdateCoordinator({
    activator,
    state: new UpdateStateStore(join(root, 'state', 'update.json')),
    report: (message, fields) => { reports.push({ message, fields }) },
  })

  assert.equal((await coordinator.publicStatus()).current, null)
  assert.equal(reports.some(entry => entry.message === 'update.status.current.failed'), false)

  fail = true
  assert.equal((await coordinator.publicStatus()).current, null)
  assert.equal(reports.some(entry => (
    entry.message === 'update.status.current.failed'
    && entry.fields.level === 'warning'
    && entry.fields.error.message === 'Bootstrap socket is unavailable'
  )), true)
})

test('restores a staged complete Deployment through Bootstrap candidate cancellation', async () => {
  const calls = []
  const activator = new PlatformActivator({
    dataRoot: '/unused',
    bootstrap: { request: async (method, path) => {
      calls.push(`${method}:${path}`)
      if (path.endsWith('/cancel')) return { cancelled: true }
      if (path.endsWith('/current')) return { record: { id: 'runtime-a' } }
      return {}
    } },
    stage0: {},
  })
  await activator.restoreDeployment({
    runtime: 'runtime-a', environment: 'env-1', receiptTokens: ['stable-a'],
  }, { resume: false })
  assert.deepEqual(calls, [
    'POST:/v1/deployments/candidate/cancel',
    'GET:/v1/deployments/current',
  ])
})

test('restores the materialized previous Deployment recorded by Bootstrap slots', async () => {
  const calls = []
  const previous = {
    id: 'runtime-a-materialized', dshVersion: '0.1.0-rc.7', environmentVersion: 'env-1',
    receiptTokens: ['stable-a'],
  }
  const activator = new PlatformActivator({
    dataRoot: '/unused',
    bootstrap: { request: async (method, path, body) => {
      calls.push({ method, path, body })
      if (path.endsWith('/cancel')) return { cancelled: true }
      if (path.endsWith('/current')) return { record: { id: 'runtime-b' } }
      if (path.endsWith('/rollback-plan')) return { current: { id: 'runtime-b' }, previous }
      if (path.endsWith('/rollback')) return { slots: {} }
      throw new Error(`unexpected request: ${method} ${path}`)
    } },
    stage0: {},
  })
  await activator.restoreDeployment({
    runtime: 'runtime-a-image', dsh: '0.1.0-rc.7', environment: 'env-1', receiptTokens: ['stable-a'],
  }, { resume: false })
  assert.deepEqual(calls.at(-1), {
    method: 'POST', path: '/v1/deployments/rollback', body: { recordId: 'runtime-a-materialized' },
  })
})

test('restores an equivalent materialized current Deployment without a previous slot', async () => {
  const calls = []
  const current = {
    id: 'runtime-a-materialized', dshVersion: '0.1.0-rc.7', environmentVersion: 'env-1',
    receiptTokens: ['stable-a'], snapshotId: null,
  }
  const activator = new PlatformActivator({
    dataRoot: '/unused',
    bootstrap: { request: async (method, path) => {
      calls.push(`${method}:${path}`)
      if (path.endsWith('/cancel')) return { cancelled: false }
      if (path.endsWith('/current')) return { record: current }
      throw new Error(`unexpected request: ${method} ${path}`)
    } },
    stage0: {},
  })
  await activator.restoreDeployment({
    runtime: 'runtime-a-image', dsh: '0.1.0-rc.7', environment: 'env-1',
    receiptTokens: ['stable-a'], dataSnapshot: null,
  }, { resume: false })
  assert.deepEqual(calls, [
    'POST:/v1/deployments/candidate/cancel',
    'GET:/v1/deployments/current',
  ])
})

test('rejects a materialized previous Deployment that differs from the recovery journal', async () => {
  const activator = new PlatformActivator({
    dataRoot: '/unused',
    bootstrap: { request: async (method, path) => {
      if (path.endsWith('/cancel')) return { cancelled: true }
      if (path.endsWith('/current')) return { record: { id: 'runtime-b' } }
      if (path.endsWith('/rollback-plan')) return {
        current: { id: 'runtime-b' },
        previous: {
          id: 'runtime-a-materialized', dshVersion: '0.1.0-rc.9', environmentVersion: 'env-1',
          receiptTokens: ['stable-a'],
        },
      }
      throw new Error(`unexpected request: ${method} ${path}`)
    } },
    stage0: {},
  })
  await assert.rejects(activator.restoreDeployment({
    runtime: 'runtime-a-image', dsh: '0.1.0-rc.7', environment: 'env-1', receiptTokens: ['stable-a'],
  }, { resume: false }), /differs from the recovery journal/)
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

test('treats removal of an already absent superseded snapshot as complete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-experimental-absent-snapshot-'))
  const { coordinator } = experimentalSystem(root)
  await coordinator.startExperimental().completion
  coordinator.activator.currentDeployment = async () => ({
    dsh: '0.1.0-rc.7', environment: 'env-1', runtime: 'runtime-b', dataSnapshot: null, receiptTokens: ['stable-receipt'],
  })
  coordinator.snapshots.remove = async () => false
  await coordinator.startExperimental().completion
  assert.equal((await coordinator.state.read()).status, 'success')
})

test('reads npm latest from the official packument without trusting it locally', async () => {
  const candidate = {
    name: '@deepseek-ai/dsh', version: '0.1.0-rc.8',
    dist: { integrity: `sha512-${Buffer.alloc(64).toString('base64')}`, tarball: 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.1.0-rc.8.tgz', signatures: [{ keyid: 'key', sig: 'signature' }] },
  }
  const client = new NpmRegistryClient({ fetchImpl: async () => response(JSON.stringify({
    'dist-tags': { latest: candidate.version }, versions: { [candidate.version]: candidate },
  })) })
  assert.deepEqual(await client.discover(), { version: candidate.version })
  const found = await client.latest({
    desired: { dsh: { version: '0.1.0-rc.7' } },
    officialDshPolicy: { registry: 'https://registry.npmjs.org/', packageName: '@deepseek-ai/dsh' },
  })
  assert.deepEqual(found, { version: candidate.version })
})

test('keeps the official npm version visible when it is not newer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-upstream-display-'))
  const channelState = new ChannelStateStore(join(root, 'state', 'channel.json'))
  await channelState.setChannel('experimental')
  const coordinator = new UpdateCoordinator({
    metadata: { check: async () => ({ value: {
      desired: { bootstrap: { version: '1.0.0' }, environment: { version: 'env-1' }, dsh: { version: '0.1.0-rc.7' } },
      officialDshPolicy: { registry: 'https://registry.npmjs.org/', packageName: '@deepseek-ai/dsh' },
      targetSequence: 1,
    } }) },
    npm: { discover: async () => ({ version: '0.1.0-rc.7' }) },
    activator: { currentDeployment: async () => ({
      authority: 'stable', targetSequence: 1, dsh: '0.1.0-rc.7', environment: 'env-1', runtime: 'runtime-a',
    }) },
    state: new UpdateStateStore(join(root, 'state', 'update.json')),
    channelState,
  })

  const plan = await coordinator.desiredState()
  assert.equal(plan.action, 'none')
  assert.deepEqual(plan.upstream, { version: '0.1.0-rc.7' })
  await coordinator.check()
  const status = await coordinator.publicStatus()
  assert.deepEqual(status.upstream, { version: '0.1.0-rc.7' })
  assert.equal(status.update.updateAvailable, false)

  await channelState.setChannel('stable')
  await coordinator.check()
  const stableStatus = await coordinator.publicStatus()
  assert.deepEqual(stableStatus.supported, { dsh: '0.1.0-rc.7', environment: 'env-1' })
  assert.deepEqual(stableStatus.upstream, { version: '0.1.0-rc.7' })
  assert.equal(stableStatus.update.updateAvailable, false)
})

test('does not misclassify a missing npm package as unpublished signed metadata', async () => {
  const client = new NpmRegistryClient({ fetchImpl: async () => response('missing', 404) })
  await assert.rejects(client.discover(), error => (
    !(error instanceof MetadataUnavailableError)
    && error.message === 'npm packument returned HTTP 404'
  ))
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

test('blocks a failed Experimental combination after converging a newer Stable Environment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-experimental-environment-block-'))
  const channelState = new ChannelStateStore(join(root, 'state', 'channel.json'))
  const system = experimentalSystem(root, {
    channelState,
    activator: { health: async () => ({ healthy: false }) },
  })

  await assert.rejects(
    system.coordinator.runExperimental('task-a', { blockCombination: true }),
    /probation/,
  )
  const local = await channelState.read()
  assert.equal(local.holds.length, 0)
  assert.equal(local.experimentalBlocked.type, 'combination')
  assert.equal(local.experimentalBlocked.dshVersion, '0.1.0-rc.8')
  assert.equal(local.experimentalBlocked.environmentVersion, 'env-1')
})

test('allows Stable return only to a recovery point no newer than signed Stable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-return-stable-'))
  let restored = false
  const phases = []
  const previous = { dsh: '0.1.0-rc.8', environment: 'env-1', runtime: 'runtime-a' }
  const recovery = {
    plan: async () => ({ planId: 'plan-a', previous }),
    restore: async (_planId, options) => {
      restored = true
      await options.onProgress('switching', 35)
      await options.onProgress('verifying', 90)
      return { status: 'rolled-back' }
    },
  }
  const coordinator = new UpdateCoordinator({
    metadata: { check: async () => ({ value: { desired: { dsh: { version: '0.1.0-rc.7' } } } }) },
    preparer: {}, activator: { currentDeployment: async () => previous }, completeRecovery: recovery,
    state: new UpdateStateStore(join(root, 'state', 'update.json')),
  })
  coordinator.on('state', value => {
    if (value.operation === 'return-stable' && value.status === 'restoring-data') phases.push([value.rollbackPhase, value.progress])
  })
  await assert.rejects(coordinator.startCompleteRollback('plan-a', {
    requireConfirmation: true, confirmDataLoss: true,
  }).completion, /no verified/)
  assert.equal(restored, false)
  coordinator.metadata.check = async () => ({ value: { desired: {
    dsh: { version: '0.1.0-rc.8' }, environment: { version: 'env-1' },
  } } })
  phases.length = 0
  await coordinator.startCompleteRollback('plan-a', { requireConfirmation: true, confirmDataLoss: true }).completion
  assert.equal(restored, true)
  assert.deepEqual(phases, [['preparing', 5], ['switching', 35], ['verifying', 90]])
  assert.equal((await coordinator.state.read()).operation, 'return-stable')
})

test('refreshes current and availability state after a complete rollback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-rollback-state-'))
  const state = new UpdateStateStore(join(root, 'state', 'update.json'))
  await state.write('success', {
    available: { targetSequence: 11, dsh: '0.1.1-rc.1', environment: 'env-1' },
    supported: { dsh: '0.1.1-rc.1', environment: 'env-1' },
    upstream: { version: '0.1.1-rc.2' },
    current: { dsh: '0.1.1-rc.2', environment: 'env-1', runtime: 'runtime-experimental' },
    aheadOfStable: true,
    updateAvailable: false,
  })
  const channelState = new ChannelStateStore(join(root, 'state', 'channel.json'))
  await channelState.setChannel('experimental')
  const previous = {
    authority: 'stable', targetSequence: 11,
    dsh: '0.1.1-rc.1', environment: 'env-1', runtime: 'runtime-stable',
  }
  const recovery = {
    plan: async () => ({ planId: 'plan-a', previous, snapshot: { id: 'snapshot-a' } }),
    restore: async () => ({ status: 'rolled-back' }),
  }
  const coordinator = new UpdateCoordinator({
    metadata: {}, preparer: {}, state, channelState, completeRecovery: recovery,
    activator: { currentDeployment: async () => previous },
  })

  await coordinator.startCompleteRollback('plan-a').completion

  const update = await state.read()
  assert.deepEqual(update.current, {
    dsh: '0.1.1-rc.1', environment: 'env-1', runtime: 'runtime-stable',
  })
  assert.equal(update.aheadOfStable, false)
  assert.equal(update.updateAvailable, true)
  assert.equal(update.outcome, null)
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

test('continues from Stable convergence into Experimental activation in one task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-reconcile-stable-then-experimental-'))
  const coordinator = new UpdateCoordinator({
    metadata: {}, preparer: {}, activator: {},
    state: new UpdateStateStore(join(root, 'state', 'update.json')),
  })
  const actions = []
  let planned = false
  coordinator.desiredState = async () => {
    if (!planned) {
      planned = true
      return {
        action: 'stable',
        current: { authority: 'experimental', environment: 'env-old' },
        supported: { environment: 'env-new' },
      }
    }
    return { action: 'experimental' }
  }
  coordinator.run = async (taskId, options) => { actions.push(['stable', taskId, options]) }
  coordinator.runExperimental = async (taskId, options) => { actions.push(['experimental', taskId, options]) }
  await coordinator.runReconcile('task-a')
  assert.deepEqual(actions, [
    ['stable', 'task-a', { complete: false }],
    ['experimental', 'task-a', { blockCombination: true }],
  ])
})

test('keeps ordinary Stable-to-Experimental reconciliation retryable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-reconcile-ordinary-experimental-'))
  const coordinator = new UpdateCoordinator({
    metadata: {}, preparer: {}, activator: {},
    state: new UpdateStateStore(join(root, 'state', 'update.json')),
  })
  let planned = false
  let options
  coordinator.desiredState = async () => {
    if (!planned) {
      planned = true
      return {
        action: 'stable',
        current: { authority: 'stable', environment: 'env-old' },
        supported: { environment: 'env-new' },
      }
    }
    return { action: 'experimental' }
  }
  coordinator.run = async () => {}
  coordinator.runExperimental = async (_taskId, value) => { options = value }

  await coordinator.runReconcile('task-a')
  assert.deepEqual(options, { blockCombination: false })
})
