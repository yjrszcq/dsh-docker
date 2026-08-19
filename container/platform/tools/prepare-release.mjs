#!/usr/bin/env node

import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { canonicalJson } from '../lib/canonical-json.mjs'
import { parseBootstrapManifest, parseEnvironmentManifest, parseExperimentalPolicy, parseStable } from '../lib/contracts.mjs'
import { validateSupportedTarget } from '../lib/supported-target.mjs'
import { positiveSafeInteger } from '../lib/validation.mjs'
import { validateKeyringTransition, verifyRecoveryKeyring } from '../stage0/lib/keyring.mjs'
import { verifyDetached } from '../stage0/lib/signature.mjs'

const args = process.argv.slice(2)
if (args.length !== 10) {
  console.error('usage: prepare-release.mjs <supported-target.json> <environment-definition.json> <experimental-policy.json> <trust-dir> <current-release-private.pem> <dsh-tarball.tgz> <previous-release-dir|-> <target-sequence> <artifact-base-url> <output-dir>')
  process.exit(64)
}

const [targetArg, definitionArg, policyArg, trustArg, privateKeyArg, tarballArg, previousArg, sequenceArg, baseUrlArg, outputArg] = args
const platformRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const containerRoot = dirname(platformRoot)
const targetPath = resolve(targetArg)
const definitionPath = resolve(definitionArg)
const experimentalPolicy = parseExperimentalPolicy(JSON.parse(await readFile(resolve(policyArg), 'utf8')))
const trustRoot = resolve(trustArg)
const privateKeyPath = resolve(privateKeyArg)
const tarballPath = resolve(tarballArg)
const output = resolve(outputArg)
const targetSequence = positiveSafeInteger(Number(sequenceArg), 'target sequence')
const artifactBaseUrl = new URL(baseUrlArg.endsWith('/') ? baseUrlArg : `${baseUrlArg}/`)
if (artifactBaseUrl.protocol !== 'https:') throw new Error('Artifact base URL must use HTTPS')

const target = validateSupportedTarget(await readFile(targetPath), await readFile(definitionPath))
const recoveryPublicKey = (await readFile(join(trustRoot, 'recovery-root.spki.base64'), 'utf8')).trim()
const keyringBytes = await readFile(join(trustRoot, 'keyring.json'))
const keyringSignatureBytes = await readFile(join(trustRoot, 'keyring.sig.json'))
const keyring = verifyRecoveryKeyring(keyringBytes, JSON.parse(keyringSignatureBytes.toString('utf8')), recoveryPublicKey)
let previousTarget
if (previousArg === '-') {
  if (targetSequence !== 1) throw new Error('The first target sequence must be 1')
} else {
  const previousRoot = resolve(previousArg)
  const previousKeyringBytes = await readFile(join(previousRoot, 'keyring.json'))
  const previousKeyring = verifyRecoveryKeyring(
    previousKeyringBytes,
    JSON.parse(await readFile(join(previousRoot, 'keyring.sig.json'), 'utf8')),
    recoveryPublicKey,
  )
  const previousStableBytes = await readFile(join(previousRoot, 'stable.json'))
  previousTarget = parseStable(previousStableBytes)
  verifyDetached(
    previousStableBytes,
    JSON.parse(await readFile(join(previousRoot, 'stable.sig.json'), 'utf8')),
    previousKeyring.current.publicKey,
  )
  if (previousTarget.keyringGeneration !== previousKeyring.generation) {
    throw new Error('previous stable target does not match its keyring generation')
  }
  if (keyring.generation < previousTarget.keyringGeneration) {
    throw new Error('keyring generation must not roll back from the previous stable target')
  }
  if (keyring.generation === previousKeyring.generation) {
    if (!keyringBytes.equals(previousKeyringBytes)) throw new Error('same keyring generation must be byte-identical')
  } else validateKeyringTransition(previousKeyring, keyring)
  if (targetSequence <= previousTarget.targetSequence) throw new Error('target sequence must increase')
}
const privateKey = createPrivateKey(await readFile(privateKeyPath))
if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Release private key must be Ed25519')
const publicDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
const currentKeyId = createHash('sha256').update(publicDer).digest('hex')
if (currentKeyId !== keyring.current.keyId) throw new Error('Release private key is not the keyring current key')

const packageResult = spawnSync('tar', ['-xOf', tarballPath, 'package/package.json'], { encoding: 'utf8' })
if (packageResult.status !== 0) throw new Error(packageResult.stderr || 'Unable to read DSH npm package metadata')
const packageMetadata = JSON.parse(packageResult.stdout)
if (packageMetadata.name !== '@deepseek-ai/dsh' || packageMetadata.version !== target.latestSupportedDsh) {
  throw new Error('DSH npm tarball does not match the Supported Target')
}
const dshBytes = await readFile(tarballPath)
const dshIntegrity = `sha512-${createHash('sha512').update(dshBytes).digest('base64')}`

const staging = `${output}.${randomUUID()}.tmp`
const environmentOutput = join(staging, '.environment')
const metadataOutput = join(staging, '.metadata')
const releaseConfigPath = join(staging, '.release-config.json')
const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH
let issuedAt
if (sourceDateEpoch === undefined) issuedAt = new Date().toISOString()
else {
  const epoch = Number(sourceDateEpoch)
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new Error('SOURCE_DATE_EPOCH must be a non-negative safe integer')
  issuedAt = new Date(epoch * 1000).toISOString()
}

function run(command, commandArgs, label) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', env: process.env })
  if (result.status !== 0) throw new Error(result.stderr || `${label} failed`)
}

function signature(document) {
  return canonicalJson({
    schema: 1,
    algorithm: 'Ed25519',
    keyId: currentKeyId,
    signature: sign(null, document, privateKey).toString('base64'),
  })
}

async function descriptor(id, path, mediaType) {
  const bytes = await readFile(path)
  return {
    id,
    mediaType,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
    url: new URL(basename(path), artifactBaseUrl).href,
  }
}

await lstat(output).then(
  () => { throw new Error('Release output already exists') },
  error => { if (error?.code !== 'ENOENT') throw error },
)
await mkdir(dirname(output), { recursive: true })
await mkdir(staging, { recursive: false })
try {
  run(process.execPath, [
    join(platformRoot, 'tools', 'package-environment.mjs'), definitionPath, environmentOutput,
    String(keyring.generation), String(targetSequence), artifactBaseUrl.href, 'flat',
  ], 'Environment packaging')
  const environmentManifestPath = join(staging, 'environment.manifest.json')
  await cp(join(environmentOutput, 'environment.manifest.json'), environmentManifestPath)
  for (const name of await readdir(join(environmentOutput, 'artifacts'))) {
    await cp(join(environmentOutput, 'artifacts', name), join(staging, name), { errorOnExist: true, force: false })
  }
  const environmentManifest = await readFile(environmentManifestPath)
  const parsedEnvironment = parseEnvironmentManifest(environmentManifest)
  if (parsedEnvironment.version !== target.environment) throw new Error('Packaged Environment does not match the Supported Target')
  await writeFile(join(staging, 'environment.manifest.sig.json'), signature(environmentManifest), { flag: 'wx', mode: 0o600 })

  const bootstrapPath = join(staging, 'bootstrap.tgz')
  run('tar', [
    '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
    '-czf', bootstrapPath, '-C', containerRoot,
    'platform/bootstrap', 'platform/lib',
    'control-plane/definition.json', 'control-plane/gateway', 'control-plane/log-manager',
    'control-plane/management', 'control-plane/patch-manager',
    'control-plane/system-plugin-manager', 'control-plane/updater',
  ], 'Bootstrap packaging')
  const bootstrapManifest = canonicalJson({
    schema: 1,
    manifestType: 'bootstrap',
    version: '1.0.0',
    keyringGeneration: keyring.generation,
    targetSequence,
    issuedAt,
    artifacts: [await descriptor('bootstrap-package', bootstrapPath, 'application/gzip')],
    bootstrapApi: 1,
    entrypoint: '/platform/bootstrap/index.mjs',
  })
  parseBootstrapManifest(bootstrapManifest)
  await writeFile(join(staging, 'bootstrap.manifest.json'), bootstrapManifest, { flag: 'wx' })
  await writeFile(join(staging, 'bootstrap.manifest.sig.json'), signature(bootstrapManifest), { flag: 'wx', mode: 0o600 })

  const dshDestination = join(staging, basename(tarballPath))
  await cp(tarballPath, dshDestination, { errorOnExist: true, force: false })
  const releaseConfig = {
    currentKeyId,
    keyringGeneration: keyring.generation,
    targetSequence,
    artifactBaseUrl: artifactBaseUrl.href,
    experimentalPolicy,
    artifacts: [
      ['environment-manifest', environmentManifestPath, 'application/vnd.dsh-platform.manifest.v1+json'],
      ['environment-signature', join(staging, 'environment.manifest.sig.json'), 'application/vnd.dsh-platform.signature.v1+json'],
      ['bootstrap-manifest', join(staging, 'bootstrap.manifest.json'), 'application/vnd.dsh-platform.manifest.v1+json'],
      ['bootstrap-signature', join(staging, 'bootstrap.manifest.sig.json'), 'application/vnd.dsh-platform.signature.v1+json'],
      ['dsh-tarball', dshDestination, 'application/vnd.npm.package+gzip'],
    ].map(([id, path, mediaType]) => ({ id, path, mediaType })),
    desired: {
      bootstrap: { version: '1.0.0', manifestArtifactId: 'bootstrap-manifest', signatureArtifactId: 'bootstrap-signature' },
      environment: { version: target.environment, manifestArtifactId: 'environment-manifest', signatureArtifactId: 'environment-signature' },
      dsh: { version: target.latestSupportedDsh, tarballArtifactId: 'dsh-tarball', integrity: dshIntegrity },
    },
  }
  await writeFile(releaseConfigPath, JSON.stringify(releaseConfig), { flag: 'wx' })
  run(process.execPath, [join(platformRoot, 'tools', 'build-release.mjs'), releaseConfigPath, privateKeyPath, metadataOutput], 'Stable metadata build')
  await cp(join(metadataOutput, 'stable.json'), join(staging, 'stable.json'))
  await cp(join(metadataOutput, 'stable.sig.json'), join(staging, 'stable.sig.json'))
  await cp(join(trustRoot, 'keyring.json'), join(staging, 'keyring.json'))
  await cp(join(trustRoot, 'keyring.sig.json'), join(staging, 'keyring.sig.json'))

  const stableBytes = await readFile(join(staging, 'stable.json'))
  const stable = parseStable(stableBytes)
  verifyDetached(stableBytes, JSON.parse(await readFile(join(staging, 'stable.sig.json'), 'utf8')), keyring.current.publicKey)
  if (stable.desired.dsh.version !== target.latestSupportedDsh || stable.desired.environment.version !== target.environment) {
    throw new Error('Generated stable metadata differs from the Supported Target')
  }
  await rm(environmentOutput, { recursive: true, force: true })
  await rm(metadataOutput, { recursive: true, force: true })
  await rm(releaseConfigPath, { force: true })
  await rename(staging, output)
} catch (error) {
  await rm(staging, { recursive: true, force: true })
  throw error
}
