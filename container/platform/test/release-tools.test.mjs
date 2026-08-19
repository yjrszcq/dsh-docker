import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { verifyRecoveryKeyring } from '../stage0/lib/keyring.mjs'
import { parseEnvironmentManifest, parseStable } from '../lib/contracts.mjs'
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

test('prepares one flat Recovery-rooted release from the reviewed Supported Target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-prepare-release-'))
  const recovery = await pair(root, 'recovery')
  const current = await pair(root, 'current')
  const next = await pair(root, 'next')
  const trust = join(root, 'trust')
  let result = spawnSync(process.execPath, [
    new URL('../tools/keyring.mjs', import.meta.url).pathname,
    recovery.privatePath, current.publicPath, next.publicPath, '1', trust, '-',
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)

  const packageRoot = join(root, 'npm', 'package')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.7' }))
  const tarball = join(root, 'deepseek-ai-dsh-0.1.0-rc.7.tgz')
  result = spawnSync('tar', ['-czf', tarball, '-C', join(root, 'npm'), 'package'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)

  const output = join(root, 'release')
  result = spawnSync(process.execPath, [
    new URL('../tools/prepare-release.mjs', import.meta.url).pathname,
    new URL('../../../release/supported-target.json', import.meta.url).pathname,
    new URL('../../environment/definition.json', import.meta.url).pathname,
    new URL('../../../release/experimental-policy.json', import.meta.url).pathname,
    trust, current.privatePath, tarball, '-', '1', 'https://release.example/platform-1/', output,
  ], { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1787068800' } })
  assert.equal(result.status, 0, result.stderr)

  const files = await readdir(output)
  for (const name of [
    'bootstrap.tgz', 'bootstrap.manifest.json', 'bootstrap.manifest.sig.json',
    'environment.manifest.json', 'environment.manifest.sig.json',
    'stable.json', 'stable.sig.json', 'keyring.json', 'keyring.sig.json',
    'deepseek-ai-dsh-0.1.0-rc.7.tgz',
  ]) assert.ok(files.includes(name), `${name} is missing`)
  assert.equal(files.some(name => name.startsWith('.')), false)

  const bootstrapArchive = spawnSync('tar', ['-tzf', join(output, 'bootstrap.tgz')], { encoding: 'utf8' })
  assert.equal(bootstrapArchive.status, 0, bootstrapArchive.stderr)
  const bootstrapEntries = bootstrapArchive.stdout.trim().split('\n')
  for (const name of [
    'platform/bootstrap/index.mjs',
    'control-plane/definition.json',
    'control-plane/gateway/index.mjs',
    'control-plane/management/index.mjs',
  ]) assert.ok(bootstrapEntries.includes(name), `${name} is missing from bootstrap.tgz`)

  const stableBytes = await readFile(join(output, 'stable.json'))
  const stable = parseStable(stableBytes)
  const ring = JSON.parse(await readFile(join(trust, 'keyring.json'), 'utf8'))
  verifyDetached(stableBytes, JSON.parse(await readFile(join(output, 'stable.sig.json'))), ring.current.publicKey)
  assert.equal(stable.desired.dsh.version, '0.1.0-rc.7')
  assert.equal(stable.desired.environment.version, '2026.08.19.1')
  assert.equal(stable.experimentalPolicy.packageName, '@deepseek-ai/dsh')
  assert.equal(stable.artifacts.every(artifact => !artifact.url.includes('/artifacts/')), true)

  const environment = parseEnvironmentManifest(await readFile(join(output, 'environment.manifest.json')))
  assert.equal(environment.artifacts.every(artifact => !artifact.url.includes('/artifacts/')), true)
  const rollbackOutput = join(root, 'rollback-release')
  result = spawnSync(process.execPath, [
    new URL('../tools/prepare-release.mjs', import.meta.url).pathname,
    new URL('../../../release/supported-target.json', import.meta.url).pathname,
    new URL('../../environment/definition.json', import.meta.url).pathname,
    new URL('../../../release/experimental-policy.json', import.meta.url).pathname,
    trust, current.privatePath, tarball, output, '1',
    'https://release.example/platform-1-repeat/', rollbackOutput,
  ], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)

  const futureTrust = join(root, 'future-trust')
  result = spawnSync(process.execPath, [
    new URL('../tools/keyring.mjs', import.meta.url).pathname,
    recovery.privatePath, current.publicPath, next.publicPath, '2', futureTrust, '-',
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const futureRelease = join(root, 'future-release')
  await cp(output, futureRelease, { recursive: true })
  await cp(join(futureTrust, 'keyring.json'), join(futureRelease, 'keyring.json'), { force: true })
  await cp(join(futureTrust, 'keyring.sig.json'), join(futureRelease, 'keyring.sig.json'), { force: true })
  const futureStable = JSON.parse(await readFile(join(futureRelease, 'stable.json'), 'utf8'))
  futureStable.keyringGeneration = 2
  await writeFile(join(futureRelease, 'stable.json'), JSON.stringify(futureStable))
  await rm(join(futureRelease, 'stable.sig.json'))
  result = spawnSync(process.execPath, [
    new URL('../tools/sign.mjs', import.meta.url).pathname,
    'sign', current.privatePath, join(futureRelease, 'stable.json'), join(futureRelease, 'stable.sig.json'),
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  result = spawnSync(process.execPath, [
    new URL('../tools/prepare-release.mjs', import.meta.url).pathname,
    new URL('../../../release/supported-target.json', import.meta.url).pathname,
    new URL('../../environment/definition.json', import.meta.url).pathname,
    new URL('../../../release/experimental-policy.json', import.meta.url).pathname,
    trust, current.privatePath, tarball, futureRelease, '2',
    'https://release.example/platform-2/', join(root, 'generation-rollback-release'),
  ], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /keyring generation must not roll back/)

  const conflictingTrust = join(root, 'conflicting-trust')
  const conflictingNext = await pair(root, 'conflicting-next')
  result = spawnSync(process.execPath, [
    new URL('../tools/keyring.mjs', import.meta.url).pathname,
    recovery.privatePath, current.publicPath, conflictingNext.publicPath, '1', conflictingTrust, '-',
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  result = spawnSync(process.execPath, [
    new URL('../tools/prepare-release.mjs', import.meta.url).pathname,
    new URL('../../../release/supported-target.json', import.meta.url).pathname,
    new URL('../../environment/definition.json', import.meta.url).pathname,
    new URL('../../../release/experimental-policy.json', import.meta.url).pathname,
    conflictingTrust, current.privatePath, tarball, output, '2',
    'https://release.example/platform-conflict/', join(root, 'conflicting-release'),
  ], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /same keyring generation must be byte-identical/)
})
