import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { verifyRecoveryKeyring } from '../stage0/lib/keyring.mjs'
import { parseEnvironmentManifest, parseStable } from '../lib/contracts.mjs'
import { parseImageInventory } from '../lib/deployment-contracts.mjs'
import { verifyDetached } from '../stage0/lib/signature.mjs'
import { verifyImageRelease } from '../tools/verify-image-release.mjs'
import { createEnvironmentRelease } from '../tools/environment-release.mjs'
import { verifyManagementDependencies } from '../tools/verify-management-dependencies.mjs'
import { writeDshEntrypointFixture } from './fixtures/dsh-package.mjs'

const supportedTargetUrl = new URL('../../../release/supported-target.json', import.meta.url)
const supportedDshVersion = JSON.parse(await readFile(supportedTargetUrl, 'utf8')).latestSupportedDsh

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
  const names = ['bootstrap-manifest', 'bootstrap-signature', 'environment-manifest', 'environment-signature']
  const artifacts = []
  for (const id of names) {
    const path = join(root, id)
    await writeFile(path, id)
    artifacts.push({ id, path, mediaType: 'application/octet-stream' })
  }
  const config = {
    currentKeyId,
    keyringGeneration: 1,
    targetSequence: 2,
    artifactBaseUrl: 'https://release.example/v2/',
    artifacts,
    officialDshPolicy: JSON.parse(await readFile(new URL('../../../release/official-dsh-policy.json', import.meta.url))),
    desired: {
      bootstrap: { version: '1', manifestArtifactId: 'bootstrap-manifest', signatureArtifactId: 'bootstrap-signature' },
      environment: { version: '2', manifestArtifactId: 'environment-manifest', signatureArtifactId: 'environment-signature' },
      dsh: { version: '0.1.0-rc.7', integrity: `sha512-${Buffer.alloc(64).toString('base64')}` },
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

test('Management terminal dependencies are exact, licensed, and architecture-neutral', async () => {
  const root = new URL('../../control-plane/services/management/', import.meta.url).pathname
  const manifest = JSON.parse(await readFile(join(root, 'package.json')))
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json')))
  assert.equal(Object.hasOwn(manifest, 'version'), false)
  assert.equal(Object.hasOwn(lock, 'version'), false)
  assert.equal(Object.hasOwn(lock.packages[''], 'version'), false)
  const result = await verifyManagementDependencies(root)
  assert.deepEqual(result.packages, {
    '@xterm/addon-fit': '0.11.0', '@xterm/xterm': '6.0.0', ws: '8.21.3',
  })
  assert.equal(result.nativeModules, 0)
})

test('Environment release identity ignores target metadata but covers packaged content and official DSH policy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-environment-release-'))
  const bootstrapPath = join(root, 'bootstrap.json')
  const environmentPath = join(root, 'environment.json')
  const policyPath = new URL('../../../release/official-dsh-policy.json', import.meta.url).pathname
  const common = {
    schema: 1,
    keyringGeneration: 1,
    targetSequence: 1,
    issuedAt: '2026-08-21T00:00:00.000Z',
    artifacts: [{
      id: 'artifact', mediaType: 'application/octet-stream', sha256: 'a'.repeat(64), size: 1,
      url: 'https://release.example/targets/1/artifact',
    }],
  }
  const bootstrap = { ...common, manifestType: 'bootstrap', version: '1.0.0', bootstrapApi: 1, entrypoint: '/platform/bootstrap/index.mjs' }
  const environment = {
    ...common, manifestType: 'environment', version: '1.0.0', bootstrapApi: 1,
    components: [{ id: 'component', sha256: 'a'.repeat(64) }], patches: [], systemPlugins: [],
  }
  await writeFile(bootstrapPath, JSON.stringify(bootstrap))
  await writeFile(environmentPath, JSON.stringify(environment))
  const first = await createEnvironmentRelease({ bootstrapManifestPath: bootstrapPath, environmentManifestPath: environmentPath, officialDshPolicyPath: policyPath })

  bootstrap.targetSequence = 2
  bootstrap.issuedAt = '2026-08-22T00:00:00.000Z'
  bootstrap.artifacts[0].url = 'https://release.example/targets/2/artifact'
  environment.targetSequence = 2
  environment.issuedAt = '2026-08-22T00:00:00.000Z'
  environment.artifacts[0].url = 'https://release.example/targets/2/artifact'
  await writeFile(bootstrapPath, JSON.stringify(bootstrap))
  await writeFile(environmentPath, JSON.stringify(environment))
  const second = await createEnvironmentRelease({ bootstrapManifestPath: bootstrapPath, environmentManifestPath: environmentPath, officialDshPolicyPath: policyPath })
  assert.deepEqual(second, first)

  environment.artifacts[0].sha256 = 'b'.repeat(64)
  environment.components[0].sha256 = 'b'.repeat(64)
  await writeFile(environmentPath, JSON.stringify(environment))
  const changed = await createEnvironmentRelease({ bootstrapManifestPath: bootstrapPath, environmentManifestPath: environmentPath, officialDshPolicyPath: policyPath })
  assert.notEqual(changed.environmentContentSha256, first.environmentContentSha256)

  environment.artifacts[0].sha256 = 'a'.repeat(64)
  environment.components[0].sha256 = 'a'.repeat(64)
  await writeFile(environmentPath, JSON.stringify(environment))
  const changedPolicyPath = join(root, 'official-dsh-policy.json')
  const changedPolicy = JSON.parse(await readFile(policyPath, 'utf8'))
  changedPolicy.keys[0].expires = '2027-08-21T00:00:00.000Z'
  await writeFile(changedPolicyPath, JSON.stringify(changedPolicy))
  const policyChanged = await createEnvironmentRelease({
    bootstrapManifestPath: bootstrapPath,
    environmentManifestPath: environmentPath,
    officialDshPolicyPath: changedPolicyPath,
  })
  assert.notEqual(policyChanged.officialDshPolicySha256, first.officialDshPolicySha256)
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
  await writeDshEntrypointFixture(packageRoot)
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: supportedDshVersion }))
  const picker = join(packageRoot, 'node_modules/@deepseek-ai/dsh-host-directory-picker-browse/lib')
  const connection = join(packageRoot, 'node_modules/@deepseek-ai/dsh-client-connection/lib')
  await mkdir(picker, { recursive: true })
  await mkdir(connection, { recursive: true })
  await writeFile(join(picker, 'index.js'), 'const target = resolve(path ?? home);\n')
  await writeFile(join(connection, 'client.js'), 'isLoopback: pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),\n')
  const tarball = join(root, `deepseek-ai-dsh-${supportedDshVersion}.tgz`)
  result = spawnSync('tar', ['-czf', tarball, '-C', join(root, 'npm'), 'package'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)

  const output = join(root, 'release')
  result = spawnSync(process.execPath, [
    new URL('../tools/prepare-release.mjs', import.meta.url).pathname,
    supportedTargetUrl.pathname,
    new URL('../../environment/definition.json', import.meta.url).pathname,
    new URL('../../../release/official-dsh-policy.json', import.meta.url).pathname,
    trust, current.privatePath, tarball, '-', '1', 'https://release.example/release-channel/targets/1/', output,
  ], { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1787068800' } })
  assert.equal(result.status, 0, result.stderr)

  const files = await readdir(output)
  for (const name of [
    'bootstrap.tgz', 'bootstrap.manifest.json', 'bootstrap.manifest.sig.json',
    'environment.manifest.json', 'environment.manifest.sig.json',
    'stable.json', 'stable.sig.json', 'keyring.json', 'keyring.sig.json',
  ]) assert.ok(files.includes(name), `${name} is missing`)
  assert.equal(files.includes(`deepseek-ai-dsh-${supportedDshVersion}.tgz`), false)
  assert.equal(files.some(name => name.startsWith('.')), false)

  const bootstrapArchive = spawnSync('tar', ['-tzf', join(output, 'bootstrap.tgz')], { encoding: 'utf8' })
  assert.equal(bootstrapArchive.status, 0, bootstrapArchive.stderr)
  const bootstrapEntries = bootstrapArchive.stdout.trim().split('\n')
  for (const name of [
    'platform/bootstrap/index.mjs',
    'control-plane/definition.json',
    'control-plane/hooks/dsh-web-ready.mjs',
    'control-plane/hooks/recovery/index.mjs',
    'control-plane/services/gateway/index.mjs',
    'control-plane/services/management/index.mjs',
    'control-plane/services/management/public/index.html',
    'control-plane/services/management/package-lock.json',
    'control-plane/services/management/node_modules/ws/index.js',
    'control-plane/services/management/node_modules/ws/LICENSE',
    'control-plane/services/management/node_modules/@xterm/xterm/lib/xterm.mjs',
    'control-plane/services/management/node_modules/@xterm/xterm/css/xterm.css',
    'control-plane/services/management/node_modules/@xterm/addon-fit/lib/addon-fit.mjs',
    'control-plane/services/management/terminal/pty-helper.py',
    'control-plane/services/management/terminal/sessions.mjs',
    'control-plane/modules/file-manager/index.mjs',
    'control-plane/modules/file-manager/transfers.mjs',
    'control-plane/modules/file-manager/editor.mjs',
    'control-plane/modules/file-manager/tasks.mjs',
    'control-plane/modules/file-manager/archives.mjs',
    'control-plane/modules/skill-manager/index.mjs',
    'control-plane/skills/catalog.json',
    'control-plane/skills/dsh-docker-operations/SKILL.md',
    'control-plane/skills/dsh-docker-operations/references/diagnostics-and-boundaries.md',
  ]) assert.ok(bootstrapEntries.includes(name), `${name} is missing from bootstrap.tgz`)
  assert.equal(bootstrapEntries.some(name => name.endsWith('.node')), false)

  const stableBytes = await readFile(join(output, 'stable.json'))
  const stable = parseStable(stableBytes)
  const ring = JSON.parse(await readFile(join(trust, 'keyring.json'), 'utf8'))
  verifyDetached(stableBytes, JSON.parse(await readFile(join(output, 'stable.sig.json'))), ring.current.publicKey)
  assert.equal(stable.desired.dsh.version, supportedDshVersion)
  assert.equal(stable.desired.environment.version, '1.0.4')
  assert.equal(stable.officialDshPolicy.packageName, '@deepseek-ai/dsh')
  assert.equal(stable.artifacts.some(artifact => artifact.mediaType === 'application/vnd.npm.package+gzip'), false)
  assert.equal(stable.artifacts.every(artifact => !artifact.url.includes('/artifacts/')), true)

  const verifiedImage = await verifyImageRelease({
    releaseRoot: output,
    recoveryPublicKeyPath: join(trust, 'recovery-root.spki.base64'),
    dshTarballPath: tarball,
    supportedTargetPath: supportedTargetUrl.pathname,
    environmentDefinitionPath: new URL('../../environment/definition.json', import.meta.url).pathname,
  })
  assert.equal(verifiedImage.stable.targetSequence, 1)
  assert.equal(verifiedImage.environment.manifest.version, '1.0.4')

  const imageInput = join(root, 'image-input')
  const seedOutput = join(root, 'formal-seed')
  await mkdir(imageInput)
  await cp(output, join(imageInput, 'release'), { recursive: true })
  await cp(join(trust, 'recovery-root.spki.base64'), join(imageInput, 'recovery-root.spki.base64'))
  await cp(tarball, join(imageInput, 'dsh.tgz'))
  await cp(supportedTargetUrl, join(imageInput, 'supported-target.json'))
  await cp(new URL('../../environment/definition.json', import.meta.url), join(imageInput, 'environment-definition.json'))
  result = spawnSync(process.execPath, [
    new URL('../tools/build-seed.mjs', import.meta.url).pathname,
    packageRoot, seedOutput, imageInput, 'fixture-revision',
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const inventory = parseImageInventory(await readFile(join(seedOutput, 'inventory.json')))
  assert.equal(inventory.authority, 'stable')
  assert.equal(inventory.targetSequence, 1)
  assert.equal(inventory.deployment.dshVersion, supportedDshVersion)

  const environment = parseEnvironmentManifest(await readFile(join(output, 'environment.manifest.json')))
  assert.equal(environment.artifacts.every(artifact => !artifact.url.includes('/artifacts/')), true)
  const rollbackOutput = join(root, 'rollback-release')
  result = spawnSync(process.execPath, [
    new URL('../tools/prepare-release.mjs', import.meta.url).pathname,
    supportedTargetUrl.pathname,
    new URL('../../environment/definition.json', import.meta.url).pathname,
    new URL('../../../release/official-dsh-policy.json', import.meta.url).pathname,
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
    supportedTargetUrl.pathname,
    new URL('../../environment/definition.json', import.meta.url).pathname,
    new URL('../../../release/official-dsh-policy.json', import.meta.url).pathname,
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
    supportedTargetUrl.pathname,
    new URL('../../environment/definition.json', import.meta.url).pathname,
    new URL('../../../release/official-dsh-policy.json', import.meta.url).pathname,
    conflictingTrust, current.privatePath, tarball, output, '2',
    'https://release.example/platform-conflict/', join(root, 'conflicting-release'),
  ], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /same keyring generation must be byte-identical/)
})
