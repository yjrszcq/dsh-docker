#!/usr/bin/env node

import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildRuntime } from '../../control-plane/modules/patch-manager/index.mjs'
import { reconcileSystemPlugins } from '../../control-plane/modules/system-plugin-manager/index.mjs'
import { artifactForReference, parseEnvironmentManifest } from '../lib/contracts.mjs'
import { canonicalJson } from '../lib/canonical-json.mjs'
import { deriveImageBuildId, deriveRecordId, parseImageInventory } from '../lib/deployment-contracts.mjs'
import { hashTree } from '../lib/tree-hash.mjs'
import { verifyImageRelease } from './verify-image-release.mjs'
import { verifyManagementDependencies } from './verify-management-dependencies.mjs'

const [installedArg, outputArg, imageInputArg = '-', platformRevisionArg = 'development'] = process.argv.slice(2)
if (installedArg === undefined || outputArg === undefined) {
  console.error('usage: build-seed.mjs <installed-dsh-root> <output> [verified-image-input-dir|-] [platform-revision]')
  process.exit(64)
}
const installed = resolve(installedArg)
const output = resolve(outputArg)
const packageMetadata = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
if (
  packageMetadata.name !== '@deepseek-ai/dsh'
  || typeof packageMetadata.version !== 'string'
  || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(packageMetadata.version)
) {
  throw new Error('installed DSH package metadata is invalid')
}
const version = packageMetadata.version
const platformRoot = resolve(new URL('..', import.meta.url).pathname)
const containerRoot = resolve(platformRoot, '..')
const imageInput = imageInputArg === '-' ? undefined : resolve(imageInputArg)
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

const bootstrapVersion = '1.0.0'
const bootstrapRoot = join(output, 'bootstrap', bootstrapVersion)
const environmentDefinition = join(containerRoot, 'environment', 'definition.json')
const environmentVersion = JSON.parse(await readFile(environmentDefinition, 'utf8')).version
const environmentOutput = join(output, 'environments', environmentVersion)
let environment
let authority = 'development'
let targetSequence = 0

if (imageInput !== undefined) {
  const verified = await verifyImageRelease({
    releaseRoot: join(imageInput, 'release'),
    recoveryPublicKeyPath: join(imageInput, 'recovery-root.spki.base64'),
    dshTarballPath: join(imageInput, 'dsh.tgz'),
    supportedTargetPath: join(imageInput, 'supported-target.json'),
    environmentDefinitionPath: join(imageInput, 'environment-definition.json'),
  })
  if (verified.stable.desired.dsh.version !== version) throw new Error('installed DSH differs from signed Stable metadata')
  if (verified.bootstrap.manifest.version !== bootstrapVersion) throw new Error('signed Bootstrap version is unsupported')
  if (verified.environment.manifest.version !== environmentVersion) throw new Error('signed Environment differs from the image definition')
  const archive = verified.bootstrap.paths.get(verified.bootstrap.manifest.artifacts[0]?.id)
  if (verified.bootstrap.manifest.artifacts.length !== 1 || archive === undefined) {
    throw new Error('signed Bootstrap must contain exactly one package')
  }
  const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' })
  if (listing.status !== 0) throw new Error(listing.stderr || 'Bootstrap archive listing failed')
  const entries = listing.stdout.split('\n').filter(Boolean)
  if (entries.length === 0 || entries.some(name => (
    name.startsWith('/') || name.split('/').includes('..') || !['platform', 'control-plane'].includes(name.split('/')[0])
  ))) throw new Error('signed Bootstrap archive contains an unsafe path')
  await mkdir(bootstrapRoot, { recursive: true })
  const extracted = spawnSync('tar', ['-xzf', archive, '--no-same-owner', '--no-same-permissions', '-C', bootstrapRoot], { encoding: 'utf8' })
  if (extracted.status !== 0) throw new Error(extracted.stderr || 'Bootstrap extraction failed')
  await mkdir(join(environmentOutput, 'artifacts'), { recursive: true })
  await writeFile(join(environmentOutput, 'environment.manifest.json'), verified.environment.manifestBytes)
  for (const descriptor of verified.environment.manifest.artifacts) {
    await cp(verified.environment.paths.get(descriptor.id), join(environmentOutput, 'artifacts', descriptor.id))
  }
  environment = verified.environment.manifest
  authority = 'stable'
  targetSequence = verified.stable.targetSequence
} else {
  for (const directory of ['bootstrap', 'lib']) {
    await cp(join(platformRoot, directory), join(bootstrapRoot, 'platform', directory), { recursive: true })
  }
  for (const directory of ['log-manager', 'patch-manager', 'system-plugin-manager', 'updater', 'user-plugin-manager']) {
    await cp(
      join(containerRoot, 'control-plane', 'modules', directory),
      join(bootstrapRoot, 'control-plane', 'modules', directory),
      { recursive: true },
    )
  }
  for (const directory of ['management', 'gateway']) {
    await cp(
      join(containerRoot, 'control-plane', 'services', directory),
      join(bootstrapRoot, 'control-plane', 'services', directory),
      { recursive: true },
    )
  }
  await cp(join(containerRoot, 'control-plane', 'hooks'), join(bootstrapRoot, 'control-plane', 'hooks'), { recursive: true })
  await cp(join(containerRoot, 'control-plane', 'definition.json'), join(bootstrapRoot, 'control-plane', 'definition.json'))
  const packaged = spawnSync(process.execPath, [
    join(platformRoot, 'tools', 'package-environment.mjs'),
    environmentDefinition,
    environmentOutput,
  ], { encoding: 'utf8' })
  if (packaged.status !== 0) throw new Error(packaged.stderr || 'Environment packaging failed')
  environment = parseEnvironmentManifest(await readFile(join(environmentOutput, 'environment.manifest.json')))
}
await verifyManagementDependencies(join(bootstrapRoot, 'control-plane', 'services', 'management'))
await writeFile(join(output, 'bootstrap', 'VERSION'), `${bootstrapVersion}\n`)
await writeFile(join(output, 'environments', 'VERSION'), `${environmentVersion}\n`)
await symlink('environments', join(output, 'environment'), 'dir')

await cp(installed, join(output, 'pristine', version), { recursive: true, verbatimSymlinks: true })
await buildRuntime({
  pristineRoot: installed,
  versionsRoot: join(output, 'runtimes'),
  runtimeId: version,
  patchPaths: environment.patches.map(reference => (
    join(environmentOutput, 'artifacts', artifactForReference(environment, reference).id)
  )),
})
await writeFile(join(output, 'runtimes', 'VERSION'), `${version}\n`)
await symlink('runtimes', join(output, 'runtime'), 'dir')

const pluginRoot = join(output, 'system-plugins', environmentVersion)
const pluginBuildRoot = join(output, '.system-plugin-build')
await reconcileSystemPlugins({
  root: pluginBuildRoot,
  environmentVersion,
  plugins: environment.systemPlugins,
  artifactPath: reference => join(environmentOutput, 'artifacts', artifactForReference(environment, reference).id),
})
await cp(join(pluginBuildRoot, 'versions', environmentVersion), pluginRoot, { recursive: true })
await rm(pluginBuildRoot, { recursive: true, force: true })

await cp(join(platformRoot, 'seed', 'trust'), join(output, 'trust'), { recursive: true })

const bootstrapSha256 = await hashTree(bootstrapRoot)
const environmentSha256 = await hashTree(environmentOutput)
const pristineSha256 = await hashTree(join(output, 'pristine', version))
const runtimeSha256 = await hashTree(join(output, 'runtimes', version))
const systemPluginsSha256 = await hashTree(pluginRoot)
const deploymentIdentity = {
  authority,
  targetSequence,
  dshVersion: version,
  environmentVersion,
  environmentSha256,
  pristineSha256,
  runtimeSha256,
  systemPluginsSha256,
}
const inventoryContent = {
  schema: 1,
  authority,
  platformRevision: platformRevisionArg,
  targetSequence,
  bootstrapApi: 1,
  updateApi: 1,
  bootstrap: { version: bootstrapVersion, id: bootstrapVersion, sha256: bootstrapSha256 },
  deployment: {
    id: deriveRecordId('image-deployment', deploymentIdentity),
    dshVersion: version,
    environmentVersion,
    environment: { id: environmentVersion, sha256: environmentSha256 },
    pristine: { id: version, sha256: pristineSha256 },
    runtime: { id: version, sha256: runtimeSha256 },
    systemPlugins: { id: environmentVersion, sha256: systemPluginsSha256 },
  },
}
const inventory = { ...inventoryContent, imageBuildId: deriveImageBuildId(inventoryContent) }
parseImageInventory(inventory)
await writeFile(join(output, 'inventory.json'), canonicalJson(inventory))
