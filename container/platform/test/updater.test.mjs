import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { canonicalJson } from '../lib/canonical-json.mjs'
import { VerifiedObjectStore } from '../stage0/lib/artifacts.mjs'
import { TrustLedger } from '../stage0/lib/ledger.mjs'
import { UpdateConflictError, UpdateCoordinator } from '../updater/lib/coordinator.mjs'
import { MetadataClient } from '../updater/lib/metadata.mjs'
import { TargetPreparer } from '../updater/lib/preparer.mjs'
import { UpdateStateStore } from '../updater/lib/state.mjs'
import { keyPair, keyring, signature } from './helpers.mjs'

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
  const artifacts = [
    descriptor('environment-manifest', environmentManifest, 'application/vnd.dsh-platform.manifest.v1+json'),
    descriptor('environment-signature', environmentSignature, 'application/vnd.dsh-platform.signature.v1+json'),
    descriptor('bootstrap-manifest', bootstrapManifest, 'application/vnd.dsh-platform.manifest.v1+json'),
    descriptor('bootstrap-signature', bootstrapSignature, 'application/vnd.dsh-platform.signature.v1+json'),
    descriptor('dsh-tarball', dsh, 'application/vnd.npm.package+gzip'),
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
        tarballArtifactId: 'dsh-tarball',
        integrity: `sha512-${createHash('sha512').update(dsh).digest('base64')}`,
      },
    },
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
      'dsh-tarball': dsh,
    }[artifact.id]]),
    ['https://release.example/environment-component', component],
    ['https://release.example/bootstrap-package', bootstrapPackage],
  ])
  return { recovery, current, next, files, stable }
}

async function system() {
  const fixture = await releaseFixture()
  const root = await mkdtemp(join(tmpdir(), 'dsh-updater-'))
  const untrustedRoot = join(root, 'downloads', 'untrusted')
  await mkdir(untrustedRoot, { recursive: true })
  const ledger = new TrustLedger(join(root, 'trust'), fixture.recovery.publicKey)
  const objects = new VerifiedObjectStore({ root: join(root, 'trust'), untrustedRoot, ledger })
  const trust = {
    acceptKeyring: (bytes, value) => ledger.acceptKeyring(bytes, value),
    acceptTarget: (bytes, value) => ledger.acceptTarget(bytes, value),
    importArtifact: (id, path, parent) => parent === null
      ? objects.importFromTarget(id, path)
      : objects.importFromManifest(parent, id, path),
    acceptManifest: (token, value) => objects.acceptManifest(token, value),
    activate: tokens => objects.activate(tokens),
  }
  const fetchImpl = async url => {
    const bytes = fixture.files.get(String(url))
    return bytes === undefined ? response('missing', 404) : response(bytes)
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
  assert.equal(prepared.receipts.size, 7)
  assert.equal((await ledger.currentKeyring()).value.generation, 1)
  assert.equal((await objects.readReceipt(prepared.environment.manifestReceipt.token)).authoritySignature.keyId.length, 64)
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

test('persists a failed update and permits a later retry', async () => {
  const { root, metadata, preparer } = await system()
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
  fail = false
  await coordinator.start().completion
  assert.equal((await state.read()).status, 'success')
})
