import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, rename, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { buildRuntime } from '../../patch-manager/index.mjs'
import { reconcileSystemPlugins } from '../../system-plugin-manager/index.mjs'
import { artifactForReference, parseEnvironmentManifest } from '../../../../platform/lib/contracts.mjs'
import { deriveRecordId, parseDeploymentRecord } from '../../../../platform/lib/deployment-contracts.mjs'
import { hashTree } from '../../../../platform/lib/tree-hash.mjs'

async function exists(path) {
  return lstat(path).then(() => true, error => error?.code === 'ENOENT' ? false : Promise.reject(error))
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolve(Buffer.concat(stdout).toString('utf8'))
      : reject(new Error(Buffer.concat(stderr).toString('utf8'))))
  })
}

async function verifyDirectory(path, expectedHash) {
  const details = await lstat(path)
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error(`Managed Store asset is not an immutable directory: ${path}`)
  const sha256 = await hashTree(path)
  if (expectedHash !== undefined && sha256 !== expectedHash) throw new Error(`Managed Store asset content conflicts at ${path}`)
  return sha256
}

async function publish(staging, root, id) {
  const sha256 = await hashTree(staging)
  const destination = join(root, id)
  try {
    await rename(staging, destination)
  } catch (error) {
    if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error
    await verifyDirectory(destination, sha256)
  }
  return Object.freeze({ id, sha256, path: destination })
}

function storeReference(kind, asset) {
  return Object.freeze({ storage: 'store', kind, id: asset.id, sha256: asset.sha256 })
}

export class ManagedDeploymentBuilder {
  constructor({ paths }) {
    this.paths = paths
  }

  async pristine(version, receipt) {
    const id = `pristine-npm-${receipt.objectSha256}`
    const destination = join(this.paths.pristineRoot, id)
    if (await exists(destination)) {
      const sha256 = await verifyDirectory(destination)
      return Object.freeze({ id, sha256, path: destination })
    }
    const installRoot = join(this.paths.pristineRoot, `.install.${randomUUID()}.tmp`)
    const staging = join(this.paths.pristineRoot, `.${id}.${randomUUID()}.tmp`)
    await mkdir(installRoot, { recursive: false })
    try {
      const entries = (await run('tar', ['-tzf', receipt.path])).split('\n').filter(Boolean)
      if (!entries.includes('package/package.json') || entries.some(entry => (
        entry.startsWith('/') || !entry.startsWith('package/') || entry.split('/').includes('..')
      ))) throw new Error('official DSH archive contains an unsafe path')
      const archivePath = join(installRoot, 'official-dsh.tgz')
      await symlink(receipt.path, archivePath, 'file')
      await run('npm', [
        'install', '--global', '--prefix', installRoot, '--omit=dev', '--ignore-scripts',
        '--no-audit', '--no-fund', '--cache', join(installRoot, 'npm-cache'), archivePath,
      ])
      const installed = join(installRoot, 'lib', 'node_modules', '@deepseek-ai', 'dsh')
      await rename(installed, staging)
      const metadata = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8'))
      if (metadata.name !== '@deepseek-ai/dsh' || metadata.version !== version) {
        throw new Error('official DSH package metadata differs from its requested version')
      }
      return await publish(staging, this.paths.pristineRoot, id)
    } finally {
      await rm(installRoot, { recursive: true, force: true })
      await rm(staging, { recursive: true, force: true })
    }
  }

  async environment(prepared) {
    const manifest = prepared.environment.manifest
    const identity = {
      schema: 1,
      version: manifest.version,
      targetSequence: prepared.stable.targetSequence,
      manifest: prepared.environment.manifestReceipt.objectSha256,
      artifacts: manifest.artifacts.map(artifact => ({ id: artifact.id, sha256: artifact.sha256 })),
    }
    const id = deriveRecordId('environment', identity)
    const destination = join(this.paths.environmentsRoot, id)
    if (await exists(destination)) {
      const sha256 = await verifyDirectory(destination)
      return Object.freeze({ id, sha256, path: destination })
    }
    const staging = join(this.paths.environmentsRoot, `.${id}.${randomUUID()}.tmp`)
    await mkdir(join(staging, 'artifacts'), { recursive: true })
    try {
      await cp(prepared.paths.get(prepared.stable.desired.environment.manifestArtifactId), join(staging, 'environment.manifest.json'))
      for (const descriptor of manifest.artifacts) {
        await cp(prepared.paths.get(descriptor.id), join(staging, 'artifacts', descriptor.id))
      }
      return await publish(staging, this.paths.environmentsRoot, id)
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }

  async runtime(prepared, pristine, environment) {
    const patches = prepared.environment.manifest.patches.map(reference => {
      const artifact = artifactForReference(prepared.environment.manifest, reference)
      return { id: reference.id, artifactId: artifact.id, sha256: artifact.sha256 }
    })
    const id = deriveRecordId('runtime', {
      schema: 1,
      pristine: pristine.sha256,
      environment: environment.sha256,
      patches,
    })
    const destination = join(this.paths.runtimesRoot, id)
    if (await exists(destination)) {
      const sha256 = await verifyDirectory(destination)
      return Object.freeze({ id, sha256, path: destination })
    }
    await buildRuntime({
      pristineRoot: pristine.path,
      versionsRoot: this.paths.runtimesRoot,
      runtimeId: id,
      patchPaths: patches.map(patch => prepared.paths.get(patch.artifactId)),
    })
    return Object.freeze({ id, sha256: await verifyDirectory(destination), path: destination })
  }

  async systemPlugins(prepared, environment) {
    const plugins = prepared.environment.manifest.systemPlugins.map(reference => {
      const artifact = artifactForReference(prepared.environment.manifest, reference)
      return { id: reference.id, artifactId: artifact.id, sha256: artifact.sha256 }
    })
    const id = deriveRecordId('system-plugins', {
      schema: 1,
      environment: environment.sha256,
      plugins,
    })
    const destination = join(this.paths.systemPluginsRoot, id)
    if (await exists(destination)) {
      const sha256 = await verifyDirectory(destination)
      return Object.freeze({ id, sha256, path: destination })
    }
    const buildRoot = join(this.paths.systemPluginsRoot, `.build.${randomUUID()}.tmp`)
    try {
      const built = await reconcileSystemPlugins({
        root: buildRoot,
        environmentVersion: id,
        plugins: prepared.environment.manifest.systemPlugins,
        artifactPath: reference => prepared.paths.get(artifactForReference(prepared.environment.manifest, reference).id),
      })
      return await publish(built, this.paths.systemPluginsRoot, id)
    } finally {
      await rm(buildRoot, { recursive: true, force: true })
    }
  }

  async buildStable(prepared) {
    const pristine = await this.pristine(prepared.dsh.version, prepared.dsh.receipt)
    const environment = await this.environment(prepared)
    const runtime = await this.runtime(prepared, pristine, environment)
    const systemPlugins = await this.systemPlugins(prepared, environment)
    const content = {
      schema: 1,
      authority: 'stable',
      targetSequence: prepared.stable.targetSequence,
      dshVersion: prepared.dsh.version,
      environmentVersion: prepared.environment.manifest.version,
      environment: storeReference('environment', environment),
      pristine: storeReference('pristine', pristine),
      runtime: storeReference('runtime', runtime),
      systemPlugins: storeReference('system-plugins', systemPlugins),
      receiptTokens: [...prepared.receiptTokens],
      snapshotId: null,
    }
    return Object.freeze({
      record: parseDeploymentRecord({ ...content, id: deriveRecordId('deployment-record', content) }),
      assets: Object.freeze({ pristine, environment, runtime, systemPlugins }),
    })
  }

  async buildExperimental(prepared, currentValue, receiptTokens) {
    const current = parseDeploymentRecord(currentValue)
    const pristine = await this.pristine(prepared.version, prepared.receipt)
    const environmentRoot = join(this.paths.viewsRoot, 'environment')
    const manifest = parseEnvironmentManifest(await readFile(join(environmentRoot, 'environment.manifest.json')))
    if (manifest.version !== current.environmentVersion) throw new Error('current Environment view differs from its Deployment Record')
    const patches = manifest.patches.map(reference => {
      const artifact = artifactForReference(manifest, reference)
      return { id: reference.id, artifactId: artifact.id, sha256: artifact.sha256 }
    })
    const runtimeId = deriveRecordId('runtime', {
      schema: 1,
      pristine: pristine.sha256,
      environment: current.environment.sha256,
      patches,
    })
    const runtimePath = join(this.paths.runtimesRoot, runtimeId)
    if (!await exists(runtimePath)) {
      await buildRuntime({
        pristineRoot: pristine.path,
        versionsRoot: this.paths.runtimesRoot,
        runtimeId,
        patchPaths: patches.map(patch => join(environmentRoot, 'artifacts', patch.artifactId)),
      })
    }
    const runtime = Object.freeze({ id: runtimeId, sha256: await verifyDirectory(runtimePath), path: runtimePath })
    const content = {
      schema: 1,
      authority: 'experimental',
      targetSequence: current.targetSequence,
      dshVersion: prepared.version,
      environmentVersion: current.environmentVersion,
      environment: current.environment,
      pristine: storeReference('pristine', pristine),
      runtime: storeReference('runtime', runtime),
      systemPlugins: current.systemPlugins,
      receiptTokens: [...receiptTokens],
      snapshotId: null,
    }
    const record = parseDeploymentRecord({ ...content, id: deriveRecordId('deployment-record', content) })
    return Object.freeze({ record, runtime })
  }
}
