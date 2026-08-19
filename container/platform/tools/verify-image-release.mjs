#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBootstrapManifest, parseEnvironmentManifest, parseStable } from '../lib/contracts.mjs'
import { validateSupportedTarget } from '../lib/supported-target.mjs'
import { verifyRecoveryKeyring } from '../stage0/lib/keyring.mjs'
import { verifyDetached } from '../stage0/lib/signature.mjs'

async function verifyFile(path, descriptor, label) {
  const bytes = await readFile(path)
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (bytes.byteLength !== descriptor.size || digest !== descriptor.sha256) {
    throw new Error(`${label} does not match its signed descriptor`)
  }
  return bytes
}

function descriptorById(artifacts, id, label) {
  const descriptor = artifacts.find(candidate => candidate.id === id)
  if (descriptor === undefined) throw new Error(`${label} ${id} is missing`)
  return descriptor
}

function assetPath(root, descriptor) {
  const name = basename(new URL(descriptor.url).pathname)
  if (name === '' || name === '.' || name === '..') throw new Error(`Artifact ${descriptor.id} has no safe filename`)
  return join(root, name)
}

async function verifiedManifest({ releaseRoot, stable, desired, keyring, parser, label }) {
  const manifestDescriptor = descriptorById(stable.artifacts, desired.manifestArtifactId, `${label} manifest`)
  const signatureDescriptor = descriptorById(stable.artifacts, desired.signatureArtifactId, `${label} signature`)
  const manifestBytes = await verifyFile(assetPath(releaseRoot, manifestDescriptor), manifestDescriptor, `${label} manifest`)
  const signatureBytes = await verifyFile(assetPath(releaseRoot, signatureDescriptor), signatureDescriptor, `${label} signature`)
  verifyDetached(manifestBytes, JSON.parse(signatureBytes.toString('utf8')), keyring.current.publicKey, `${label} manifest`)
  const manifest = parser(manifestBytes)
  if (manifest.version !== desired.version
    || manifest.keyringGeneration !== stable.keyringGeneration
    || manifest.targetSequence !== stable.targetSequence) {
    throw new Error(`${label} manifest does not match Stable metadata`)
  }
  const paths = new Map()
  for (const descriptor of manifest.artifacts) {
    const path = assetPath(releaseRoot, descriptor)
    await verifyFile(path, descriptor, `${label} Artifact ${descriptor.id}`)
    paths.set(descriptor.id, path)
  }
  return Object.freeze({ manifest, manifestBytes, paths })
}

export async function verifyImageRelease({ releaseRoot, recoveryPublicKeyPath, dshTarballPath, supportedTargetPath, environmentDefinitionPath }) {
  const root = resolve(releaseRoot)
  const recoveryPublicKey = (await readFile(resolve(recoveryPublicKeyPath), 'utf8')).trim()
  const keyringBytes = await readFile(join(root, 'keyring.json'))
  const keyring = verifyRecoveryKeyring(
    keyringBytes,
    JSON.parse(await readFile(join(root, 'keyring.sig.json'), 'utf8')),
    recoveryPublicKey,
  )
  const stableBytes = await readFile(join(root, 'stable.json'))
  const stable = parseStable(stableBytes)
  verifyDetached(
    stableBytes,
    JSON.parse(await readFile(join(root, 'stable.sig.json'), 'utf8')),
    keyring.current.publicKey,
    'Stable metadata',
  )
  if (stable.keyringGeneration !== keyring.generation) throw new Error('Stable metadata does not match keyring generation')
  const target = validateSupportedTarget(
    await readFile(resolve(supportedTargetPath)),
    await readFile(resolve(environmentDefinitionPath)),
  )
  if (stable.desired.dsh.version !== target.latestSupportedDsh
    || stable.desired.environment.version !== target.environment) {
    throw new Error('Stable metadata does not match the reviewed Supported Target')
  }
  const immutableTag = `/releases/download/platform-${String(stable.targetSequence)}/`
  if (stable.artifacts.some(descriptor => !new URL(descriptor.url).pathname.includes(immutableTag))) {
    throw new Error('Stable Artifact URLs must use its immutable platform Release')
  }
  const bootstrap = await verifiedManifest({
    releaseRoot: root,
    stable,
    desired: stable.desired.bootstrap,
    keyring,
    parser: parseBootstrapManifest,
    label: 'Bootstrap',
  })
  const environment = await verifiedManifest({
    releaseRoot: root,
    stable,
    desired: stable.desired.environment,
    keyring,
    parser: parseEnvironmentManifest,
    label: 'Environment',
  })
  const dshBytes = await readFile(resolve(dshTarballPath))
  const actualIntegrity = `sha512-${createHash('sha512').update(dshBytes).digest('base64')}`
  if (actualIntegrity !== stable.desired.dsh.integrity) throw new Error('DSH tarball does not match signed npm integrity')
  return Object.freeze({ stable, keyring, bootstrap, environment, dshTarballPath: resolve(dshTarballPath) })
}

const invoked = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
  const [releaseRoot, recoveryPublicKeyPath, dshTarballPath, supportedTargetPath, environmentDefinitionPath] = process.argv.slice(2)
  if ([releaseRoot, recoveryPublicKeyPath, dshTarballPath, supportedTargetPath, environmentDefinitionPath].includes(undefined)) {
    console.error('usage: verify-image-release.mjs <release-dir> <recovery-root-public-key> <dsh-tarball> <supported-target.json> <environment-definition.json>')
    process.exit(64)
  }
  const verified = await verifyImageRelease({
    releaseRoot,
    recoveryPublicKeyPath,
    dshTarballPath,
    supportedTargetPath,
    environmentDefinitionPath,
  })
  process.stdout.write(`${JSON.stringify({
    targetSequence: verified.stable.targetSequence,
    dshVersion: verified.stable.desired.dsh.version,
    environmentVersion: verified.environment.manifest.version,
    bootstrapVersion: verified.bootstrap.manifest.version,
  })}\n`)
}
