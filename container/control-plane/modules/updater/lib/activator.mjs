import { spawn } from 'node:child_process'
import { cp, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildRuntime, RuntimeSlots } from '../../patch-manager/index.mjs'
import { reconcileSystemPlugins } from '../../system-plugin-manager/index.mjs'
import { artifactForReference, parseEnvironmentManifest } from '../../../../platform/lib/contracts.mjs'
import { LocalApiClient } from './client.mjs'

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolve(Buffer.concat(stdout))
      : reject(new Error(Buffer.concat(stderr).toString('utf8'))))
  })
}

async function exists(path) {
  return lstat(path).then(() => true, error => error?.code === 'ENOENT' ? false : Promise.reject(error))
}

export class PlatformActivator {
  constructor({
    dataRoot,
    bootstrap = new LocalApiClient(join(dataRoot, 'run', 'bootstrap.sock')),
    stage0 = new LocalApiClient(join(dataRoot, 'run', 'stage0-trust.sock')),
  }) {
    this.dataRoot = dataRoot
    this.bootstrap = bootstrap
    this.stage0 = stage0
    this.runtimeSlots = new RuntimeSlots(join(dataRoot, 'runtime'))
    this.environmentSlots = new RuntimeSlots(join(dataRoot, 'environments'))
    this.systemPluginSlots = new RuntimeSlots(join(dataRoot, 'system-plugins'))
  }

  async pristine(prepared) {
    const version = prepared.stable.desired.dsh.version
    const root = join(this.dataRoot, 'dsh', 'pristine', version)
    if (!await exists(root)) {
      const staging = `${root}.${randomUUID()}.tmp`
      await mkdir(staging, { recursive: true })
      try {
        await run('tar', ['-xzf', prepared.paths.get(prepared.stable.desired.dsh.tarballArtifactId), '-C', staging])
        await rename(staging, root)
      } catch (error) {
        await rm(staging, { recursive: true, force: true })
        throw error
      }
    }
    return join(root, 'package')
  }

  async stageEnvironment(prepared) {
    const version = prepared.environment.manifest.version
    const versions = join(this.dataRoot, 'environments', 'versions')
    const destination = join(versions, version)
    if (await exists(destination)) return version
    const staging = join(versions, `.${version}.${randomUUID()}.tmp`)
    await mkdir(join(staging, 'artifacts'), { recursive: true })
    try {
      await cp(prepared.paths.get(prepared.stable.desired.environment.manifestArtifactId), join(staging, 'environment.manifest.json'))
      for (const descriptor of prepared.environment.manifest.artifacts) {
        await cp(prepared.paths.get(descriptor.id), join(staging, 'artifacts', descriptor.id))
      }
      await rename(staging, destination)
      return version
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
  }

  async activate(prepared) {
    const bootstrapStatus = await this.bootstrap.status()
    const desiredBootstrap = prepared.stable.desired.bootstrap.version
    if (bootstrapStatus.bootstrapVersion !== undefined && bootstrapStatus.bootstrapVersion !== desiredBootstrap) {
      const artifacts = prepared.bootstrap.manifest.artifacts
      if (artifacts.length !== 1) throw new Error('Bootstrap manifest must contain exactly one package')
      const receipt = prepared.receipts.get(artifacts[0].id)
      await this.stage0.stageBootstrap(receipt.token, desiredBootstrap)
      await new Promise(() => {})
    }
    const runtimeId = `${prepared.stable.desired.dsh.version}-${String(prepared.stable.targetSequence)}`
    if (!await exists(join(this.dataRoot, 'runtime', 'versions', runtimeId))) {
      const pristineRoot = await this.pristine(prepared)
      await buildRuntime({
        pristineRoot,
        versionsRoot: join(this.dataRoot, 'runtime', 'versions'),
        runtimeId,
        patchPaths: prepared.environment.manifest.patches.map(item => (
          prepared.paths.get(artifactForReference(prepared.environment.manifest, item).id)
        )),
      })
    }
    const environmentVersion = await this.stageEnvironment(prepared)
    await reconcileSystemPlugins({
      root: join(this.dataRoot, 'system-plugins'),
      environmentVersion,
      plugins: prepared.environment.manifest.systemPlugins,
      artifactPath: reference => prepared.paths.get(artifactForReference(prepared.environment.manifest, reference).id),
    })
    await this.runtimeSlots.promote(runtimeId)
    await this.environmentSlots.promote(environmentVersion)
    try {
      await this.bootstrap.request('POST', '/v1/reload')
    } catch (error) {
      await this.systemPluginSlots.rollback().catch(() => {})
      await this.environmentSlots.rollback().catch(() => {})
      await this.runtimeSlots.rollback().catch(() => {})
      await this.bootstrap.request('POST', '/v1/reload').catch(() => {})
      throw error
    }
  }

  async rollback() {
    await this.systemPluginSlots.rollback()
    await this.environmentSlots.rollback()
    await this.runtimeSlots.rollback()
    await this.bootstrap.request('POST', '/v1/reload')
  }

  async currentDeployment() {
    const runtime = await this.runtimeSlots.state()
    const environment = await this.environmentSlots.state()
    if (runtime.current === undefined || environment.current === undefined) {
      throw new Error('current Runtime and Environment are required')
    }
    const packageMetadata = JSON.parse(await readFile(join(
      this.dataRoot, 'runtime', 'versions', runtime.current, 'package', 'package.json',
    ), 'utf8'))
    if (typeof packageMetadata.version !== 'string') throw new Error('current Runtime has no DSH version')
    return Object.freeze({
      dsh: packageMetadata.version,
      runtime: runtime.current,
      environment: environment.current,
      dataSnapshot: null,
      receiptTokens: Object.freeze((await this.stage0.activeReceipts()).receipts.map(receipt => receipt.token).sort()),
    })
  }

  async prepareExperimental(prepared) {
    const version = prepared.candidate.version
    const root = join(this.dataRoot, 'dsh', 'pristine', version)
    if (!await exists(root)) {
      const staging = `${root}.${randomUUID()}.tmp`
      await mkdir(staging, { recursive: true })
      try {
        const entries = (await run('tar', ['-tzf', prepared.receipt.path])).toString('utf8').split('\n').filter(Boolean)
        if (!entries.includes('package/package.json')) throw new Error('Experimental DSH has no package metadata')
        if (entries.some(entry => entry.startsWith('/') || !entry.startsWith('package/') || entry.split('/').includes('..'))) {
          throw new Error('Experimental DSH archive contains an unsafe path')
        }
        await run('tar', ['-xzf', prepared.receipt.path, '-C', staging])
        await rename(staging, root)
      } catch (error) {
        await rm(staging, { recursive: true, force: true })
        throw error
      }
    }
    const packageMetadata = JSON.parse(await readFile(join(root, 'package', 'package.json'), 'utf8'))
    if (packageMetadata.name !== prepared.candidate.name || packageMetadata.version !== version) {
      throw new Error('Experimental DSH package metadata differs from its signed registry candidate')
    }
    const environmentRoot = join(this.dataRoot, 'environments', 'current')
    const environment = parseEnvironmentManifest(await readFile(join(environmentRoot, 'environment.manifest.json')))
    const runtimeId = `${version}-experimental-${prepared.receipt.objectSha256.slice(0, 12)}`
    if (!await exists(join(this.dataRoot, 'runtime', 'versions', runtimeId))) {
      await buildRuntime({
        pristineRoot: join(root, 'package'),
        versionsRoot: join(this.dataRoot, 'runtime', 'versions'),
        runtimeId,
        patchPaths: environment.patches.map(item => (
          join(environmentRoot, 'artifacts', artifactForReference(environment, item).id)
        )),
      })
    }
    return Object.freeze({ runtimeId, environmentVersion: environment.version, dshVersion: version })
  }

  suspendDsh() { return this.bootstrap.request('POST', '/v1/components/dsh-runtime/suspend') }
  resumeDsh() { return this.bootstrap.request('POST', '/v1/components/dsh-runtime/resume') }
  health() { return this.bootstrap.request('GET', '/v1/health') }

  async experimentalActivationTokens(experimentalTokens) {
    const active = (await this.stage0.activeReceipts()).receipts
    return Object.freeze([
      ...active.filter(receipt => receipt.authorityType === 'stable').map(receipt => receipt.token),
      ...experimentalTokens,
    ])
  }

  async switchExperimental(runtimeId) {
    await this.runtimeSlots.promote(runtimeId)
    await this.resumeDsh()
  }

  async restoreDeployment(deployment, { resume = true } = {}) {
    await this.runtimeSlots.promote(deployment.runtime)
    await this.environmentSlots.promote(deployment.environment)
    await this.systemPluginSlots.promote(deployment.environment)
    if (deployment.receiptTokens.length > 0) await this.stage0.activate(deployment.receiptTokens)
    if (resume) await this.resumeDsh()
  }

  async cleanup() {
    return Object.freeze({
      runtimes: await this.runtimeSlots.prune(),
      environments: await this.environmentSlots.prune(),
      systemPlugins: await this.systemPluginSlots.prune(),
      trustedObjects: (await this.stage0.collectGarbage()).removed,
    })
  }
}
