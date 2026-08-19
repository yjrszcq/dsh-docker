import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { verifyRecoveryKeyring } from '../stage0/lib/keyring.mjs'
import { parseStable } from '../lib/contracts.mjs'
import { verifyDetached } from '../stage0/lib/signature.mjs'

function pair(root, name) {
  const value = generateKeyPairSync('ed25519')
  const privatePath = join(root, `${name}-private.pem`)
  const publicPath = join(root, `${name}-public.pem`)
  return Promise.all([
    writeFile(privatePath, value.privateKey.export({ format: 'pem', type: 'pkcs8' })),
    writeFile(publicPath, value.publicKey.export({ format: 'pem', type: 'spki' })),
  ]).then(() => ({ ...value, privatePath, publicPath }))
}

test('offline keyring tool emits a Recovery-verifiable monotonic public bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-keyring-tool-'))
  const recovery = await pair(root, 'recovery')
  const current = await pair(root, 'current')
  const next = await pair(root, 'next')
  const output = join(root, 'output')
  const result = spawnSync(process.execPath, [
    new URL('../tools/keyring.mjs', import.meta.url).pathname,
    recovery.privatePath, current.publicPath, next.publicPath, '1', output, '-',
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const bytes = await readFile(join(output, 'keyring.json'))
  const signature = JSON.parse(await readFile(join(output, 'keyring.sig.json')))
  const publicKey = (await readFile(join(output, 'recovery-root.spki.base64'), 'utf8')).trim()
  assert.equal(verifyRecoveryKeyring(bytes, signature, publicKey).generation, 1)
})

test('release tool signs an exact supported target with the configured current key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-release-tool-'))
  const release = await pair(root, 'release')
  const publicDer = release.publicKey.export({ format: 'der', type: 'spki' })
  const currentKeyId = createHash('sha256').update(publicDer).digest('hex')
  const names = ['bootstrap-manifest', 'bootstrap-signature', 'environment-manifest', 'environment-signature', 'dsh-tarball']
  const artifacts = []
  for (const id of names) {
    const path = join(root, id)
    await writeFile(path, id)
    artifacts.push({ id, path, mediaType: 'application/octet-stream' })
  }
  const dsh = await readFile(join(root, 'dsh-tarball'))
  const config = {
    currentKeyId,
    keyringGeneration: 1,
    targetSequence: 2,
    artifactBaseUrl: 'https://release.example/v2/',
    artifacts,
    desired: {
      bootstrap: { version: '1', manifestArtifactId: 'bootstrap-manifest', signatureArtifactId: 'bootstrap-signature' },
      environment: { version: '2', manifestArtifactId: 'environment-manifest', signatureArtifactId: 'environment-signature' },
      dsh: { version: 'rc.7', tarballArtifactId: 'dsh-tarball', integrity: `sha512-${createHash('sha512').update(dsh).digest('base64')}` },
    },
  }
  const configPath = join(root, 'config.json')
  const output = join(root, 'output')
  await writeFile(configPath, JSON.stringify(config))
  const result = spawnSync(process.execPath, [
    new URL('../tools/build-release.mjs', import.meta.url).pathname,
    configPath, release.privatePath, output,
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const stable = await readFile(join(output, 'stable.json'))
  assert.equal(parseStable(stable).targetSequence, 2)
  verifyDetached(stable, JSON.parse(await readFile(join(output, 'stable.sig.json'))), publicDer.toString('base64'))
})
