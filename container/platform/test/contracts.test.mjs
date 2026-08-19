import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { canonicalJson } from '../lib/canonical-json.mjs'
import { parseBootstrapManifest, parseComponentManifest, parseEnvironmentManifest, parseExperimental, parseStable } from '../lib/contracts.mjs'
import { verifyDetached } from '../stage0/lib/signature.mjs'
import { document, experimentalTarget, target } from './helpers.mjs'

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

test('parses the exact stable desired state and rejects missing referenced Artifacts', () => {
  const parsed = parseStable(document(target(1, 1)))
  assert.equal(parsed.desired.dsh.version, '0.1.0-rc.7')
  const invalid = target(1, 1)
  invalid.desired.bootstrap.manifestArtifactId = 'missing'
  assert.throws(() => parseStable(document(invalid)), /missing/)
  assert.throws(() => parseStable(document({ ...target(1, 1), unknown: true })), /fields/)
})

test('parses an exact Experimental DSH target and rejects broader authority', () => {
  const parsed = parseExperimental(document(experimentalTarget(1, 1)))
  assert.equal(parsed.desired.dsh.packageName, '@deepseek-ai/dsh')
  assert.equal(parsed.experimentalSequence, 1)
  assert.throws(() => parseExperimental(document({ ...experimentalTarget(1, 1), environment: 'untrusted' })), /fields/)
  const wrongPackage = experimentalTarget(1, 1)
  wrongPackage.desired.dsh.packageName = '@example/dsh'
  assert.throws(() => parseExperimental(document(wrongPackage)), /packageName/)
})

test('parses bootstrap and environment manifests with ordered references', () => {
  const bootstrap = { ...common('bootstrap'), bootstrapApi: 1, entrypoint: '/opt/bootstrap/index.mjs' }
  assert.equal(parseBootstrapManifest(document(bootstrap)).entrypoint, bootstrap.entrypoint)
  const environment = {
    ...common('environment'),
    bootstrapApi: 1,
    components: [{ id: 'gateway', version: '1.0.0', artifactId: 'gateway-component' }],
    patches: [{ id: 'directory-picker', version: 'r1', artifactId: 'directory-picker-patch' }],
    systemPlugins: [{ id: 'update-ui', version: '1.0.0', artifactId: 'update-ui-plugin' }],
  }
  assert.equal(parseEnvironmentManifest(document(environment)).components[0].id, 'gateway')
  assert.throws(() => parseEnvironmentManifest(document({ ...environment, components: [...environment.components, environment.components[0]] })), /unique/)
})

test('parses service, oneshot, and hook component lifecycle declarations', () => {
  const value = {
    schema: 1,
    id: 'gateway',
    version: '1.0.0',
    type: 'service',
    command: { executable: '/usr/local/bin/node', args: ['/opt/gateway/index.mjs'], timeoutSeconds: 30 },
    environment: { PLATFORM_SOCKET: '/data/run/platform.sock' },
    lifecycle,
    health: { type: 'http', host: '127.0.0.1', port: 3080, path: '/health', intervalSeconds: 1, timeoutSeconds: 5 },
    logging: { stdout: true, stderr: true },
  }
  assert.equal(parseComponentManifest(document(value)).type, 'service')
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
