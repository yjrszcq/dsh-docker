import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { canonicalJson } from '../lib/canonical-json.mjs'
import { parseBootstrapManifest, parseComponentManifest, parseEnvironmentManifest, parseOfficialDshPolicy, parseStable } from '../lib/contracts.mjs'
import {
  deriveImageBuildId,
  deriveRecordId,
  parseArtifactReference,
  parseBootstrapRecord,
  parseDeploymentRecord,
  parseImageInventory,
  parseSlots,
  recordsFromImageInventory,
} from '../lib/deployment-contracts.mjs'
import { verifyDetached } from '../stage0/lib/signature.mjs'
import { document, officialDshPolicy, registryKeyPair, target } from './helpers.mjs'

const common = manifestType => ({
  schema: 1,
  manifestType,
  version: manifestType === 'bootstrap' ? '1.0.0' : '2026.08.19.1',
  keyringGeneration: 1,
  targetSequence: 1,
  issuedAt: '2026-08-19T00:00:00.000Z',
  artifacts: [],
})

const lifecycle = {
  prepare: null,
  preStart: null,
  postStart: null,
  preStop: null,
  stop: null,
  postStop: null,
}

test('canonical JSON recursively orders keys and rejects unsafe numbers', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 } }).toString(), '{"a":{"x":3,"y":2},"z":1}\n')
  assert.throws(() => canonicalJson({ value: 1.5 }))
})

function imageInventory(overrides = {}) {
  const content = {
    schema: 1,
    authority: 'stable',
    platformRevision: 'fixture-revision',
    targetSequence: 10,
    bootstrapApi: 1,
    updateApi: 1,
    bootstrap: { version: '1.0.0', id: 'bootstrap-fixture', sha256: '1'.repeat(64) },
    deployment: {
      id: 'deployment-fixture',
      dshVersion: '0.1.0-rc.10',
      environmentVersion: '2026.08.19.1',
      environment: { id: 'environment-fixture', sha256: '2'.repeat(64) },
      pristine: { id: 'pristine-fixture', sha256: '3'.repeat(64) },
      runtime: { id: 'runtime-fixture', sha256: '4'.repeat(64) },
      systemPlugins: { id: 'system-plugins-fixture', sha256: '5'.repeat(64) },
    },
    ...overrides,
  }
  return { ...content, imageBuildId: deriveImageBuildId(content) }
}

test('parses content-bound image inventory and derives immutable image Records', () => {
  const inventory = parseImageInventory(document(imageInventory()))
  const records = recordsFromImageInventory(inventory)
  assert.match(inventory.imageBuildId, /^sha256:[a-f0-9]{64}$/)
  assert.equal(records.bootstrap.version, '1.0.0')
  assert.equal(records.deployment.runtime.imageBuildId, inventory.imageBuildId)
  assert.equal(records.deployment.targetSequence, 10)
  assert.doesNotThrow(() => parseBootstrapRecord(records.bootstrap))
  assert.doesNotThrow(() => parseDeploymentRecord(records.deployment))

  const changed = imageInventory({ platformRevision: 'different-revision' })
  assert.notEqual(changed.imageBuildId, inventory.imageBuildId)
  assert.throws(() => parseImageInventory(document({ ...imageInventory(), targetSequence: 11 })), /imageBuildId/)
})

test('restricts inventory authority and Artifact References without accepting paths', () => {
  const development = imageInventory({ authority: 'development', targetSequence: 0 })
  development.imageBuildId = deriveImageBuildId(Object.fromEntries(Object.entries(development).filter(([key]) => key !== 'imageBuildId')))
  assert.equal(parseImageInventory(document(development)).targetSequence, 0)
  assert.throws(() => parseImageInventory(document(imageInventory({ authority: 'development' }))), /targetSequence 0/)
  assert.throws(() => parseArtifactReference({
    storage: 'store', kind: 'runtime', id: '../escape', sha256: 'a'.repeat(64),
  }), /invalid/)
  assert.throws(() => parseArtifactReference({
    storage: 'store', kind: 'runtime', id: 'runtime-one', sha256: 'a'.repeat(64), path: '/tmp/runtime',
  }), /fields/)
  assert.throws(() => parseArtifactReference({
    storage: 'image', imageBuildId: `sha256:${'b'.repeat(64)}`, kind: 'unknown', id: 'one', sha256: 'a'.repeat(64),
  }), /kind/)
})

test('rejects mutated Records and invalid atomic slot generations', () => {
  const { bootstrap, deployment } = recordsFromImageInventory(parseImageInventory(document(imageInventory())))
  assert.throws(() => parseDeploymentRecord({ ...deployment, dshVersion: 'changed' }), /canonical content/)
  assert.throws(() => parseBootstrapRecord({ ...bootstrap, artifact: { ...bootstrap.artifact, id: 'changed' } }), /canonical content/)
  assert.deepEqual(parseSlots({
    schema: 1, generation: 2, current: deployment.id, previous: null,
  }, 'deployment-record'), {
    schema: 1, generation: 2, current: deployment.id, previous: null,
  })
  assert.throws(() => parseSlots({
    schema: 1, generation: 0, current: deployment.id, previous: null,
  }, 'deployment-record'), /positive/)
  assert.throws(() => parseSlots({
    schema: 1, generation: 1, current: deployment.id, previous: deployment.id,
  }, 'deployment-record'), /must differ/)
  const content = { schema: 1, authority: 'development' }
  assert.equal(deriveRecordId('fixture', content), deriveRecordId('fixture', { authority: 'development', schema: 1 }))
})

test('parses the exact stable desired state and rejects missing referenced Artifacts', () => {
  const parsed = parseStable(document(target(1, 1)))
  assert.equal(parsed.desired.dsh.version, '0.1.0-rc.7')
  const invalid = target(1, 1)
  invalid.desired.bootstrap.manifestArtifactId = 'missing'
  assert.throws(() => parseStable(document(invalid)), /missing/)
  assert.throws(() => parseStable(document({ ...target(1, 1), unknown: true })), /fields/)
})

test('parses the Release-delegated official DSH policy with Stable schema 1', () => {
  const policy = officialDshPolicy(registryKeyPair())
  assert.equal(parseOfficialDshPolicy(policy).packageName, '@deepseek-ai/dsh')
  assert.equal(parseStable(document(target(1, 1, policy))).officialDshPolicy.keys[0].keyId, policy.keys[0].keyId)
  const wrongRegistry = { ...policy, registry: 'https://registry.example/' }
  assert.throws(() => parseOfficialDshPolicy(wrongRegistry), /official npm registry/)
})

test('parses bootstrap and environment manifests with ordered references', () => {
  const bootstrap = { ...common('bootstrap'), bootstrapApi: 1, entrypoint: '/opt/bootstrap/index.mjs' }
  assert.equal(parseBootstrapManifest(document(bootstrap)).entrypoint, bootstrap.entrypoint)
  const hashes = {
    component: '1'.repeat(64),
    patch: '2'.repeat(64),
    plugin: '3'.repeat(64),
  }
  const environment = {
    ...common('environment'),
    artifacts: Object.entries(hashes).map(([id, sha256]) => ({
      id,
      mediaType: 'application/octet-stream',
      sha256,
      size: 1,
      url: `https://release.example/${id}`,
    })),
    bootstrapApi: 1,
    components: [{ id: 'gateway', sha256: hashes.component }],
    patches: [{ id: 'directory-picker', sha256: hashes.patch }],
    systemPlugins: [{ id: 'update-ui', sha256: hashes.plugin }],
  }
  assert.equal(parseEnvironmentManifest(document(environment)).components[0].id, 'gateway')
  assert.throws(() => parseEnvironmentManifest(document({ ...environment, components: [...environment.components, environment.components[0]] })), /unique/)
})

test('parses service, oneshot, and hook component lifecycle declarations', () => {
  const value = {
    schema: 1,
    id: 'gateway',
    type: 'service',
    command: { executable: '/usr/local/bin/node', args: ['/opt/gateway/index.mjs'], timeoutSeconds: 30 },
    environment: { PLATFORM_SOCKET: '/data/platform/run/platform.sock' },
    lifecycle,
    health: { type: 'http', host: '127.0.0.1', port: 3080, path: '/health', intervalSeconds: 1, timeoutSeconds: 5 },
    logging: { stdout: true, stderr: true },
  }
  assert.equal(parseComponentManifest(document(value)).type, 'service')
  assert.throws(() => parseComponentManifest(document({ ...value, version: '1.0.0' })), /fields/)
  assert.throws(() => parseComponentManifest(document({ ...value, type: 'unknown' })), /type/)
  assert.throws(() => parseComponentManifest(document({ ...value, command: { ...value.command, executable: 'node' } })), /absolute/)
})

test('offline signing tool emits a signature accepted by Stage-0', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sign-tool-'))
  const pair = generateKeyPairSync('ed25519')
  const privatePath = join(root, 'private.pem')
  const documentPath = join(root, 'document.json')
  const signaturePath = join(root, 'document.sig.json')
  await writeFile(privatePath, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })
  const bytes = canonicalJson({ stable: true })
  await writeFile(documentPath, bytes)
  const result = spawnSync(process.execPath, [
    new URL('../tools/sign.mjs', import.meta.url).pathname,
    'sign', privatePath, documentPath, signaturePath,
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  const signature = JSON.parse(await readFile(signaturePath, 'utf8'))
  assert.doesNotThrow(() => verifyDetached(bytes, signature, publicKey))
})
