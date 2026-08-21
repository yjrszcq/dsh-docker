import { spawn } from 'node:child_process'
import { cp, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { RuntimeSlots } from '../../patch-manager/index.mjs'
import { PlatformPaths } from '../../../../platform/lib/paths.mjs'
import { LocalApiClient } from './client.mjs'
import { ManagedDeploymentBuilder } from './managed-store.mjs'
import { deriveRecordId, parseDeploymentRecord } from '../../../../platform/lib/deployment-contracts.mjs'

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
    runRoot = process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform',
    bootstrap,
    stage0,
    builder,
  }) {
    this.dataRoot = dataRoot
    this.paths = new PlatformPaths(dataRoot, runRoot)
    this.bootstrap = bootstrap ?? new LocalApiClient(this.paths.bootstrapSocket)
    this.stage0 = stage0 ?? new LocalApiClient(this.paths.trustSocket)
    this.builder = builder ?? new ManagedDeploymentBuilder({ paths: this.paths })
    this.runtimeSlots = new RuntimeSlots(this.paths.runtimesRoot)
    this.environmentSlots = new RuntimeSlots(this.paths.environmentsRoot)
    this.systemPluginSlots = new RuntimeSlots(this.paths.systemPluginsRoot)
    this.experimentalCandidates = new Map()
  }

  prepareManaged(prepared, options) {
    return this.builder.buildStable(prepared, options)
  }

  async pristine(version, receipt) {
    const root = join(this.paths.pristineRoot, version)
    if (!await exists(root)) {
      const staging = `${root}.${randomUUID()}.tmp`
      await mkdir(staging, { recursive: true })
      try {
        const entries = (await run('tar', ['-tzf', receipt.path])).toString('utf8').split('\n').filter(Boolean)
        if (!entries.includes('package/package.json')) throw new Error('official DSH has no package metadata')
        if (entries.some(entry => entry.startsWith('/') || !entry.startsWith('package/') || entry.split('/').includes('..'))) {
          throw new Error('official DSH archive contains an unsafe path')
        }
        await run('tar', ['-xzf', receipt.path, '-C', staging])
        await rename(staging, root)
      } catch (error) {
        await rm(staging, { recursive: true, force: true })
        throw error
      }
    }
    const packageMetadata = JSON.parse(await readFile(join(root, 'package', 'package.json'), 'utf8'))
    if (packageMetadata.name !== '@deepseek-ai/dsh' || packageMetadata.version !== version) {
      throw new Error('official DSH package metadata differs from its requested version')
    }
    return join(root, 'package')
  }

  async stageEnvironment(prepared) {
    const version = prepared.environment.manifest.version
    const versions = join(this.paths.environmentsRoot, 'versions')
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

  async activate(prepared, { onProgress = async () => {}, onSwitching = async () => {} } = {}) {
    const bootstrapStatus = await this.bootstrap.status()
    const desiredBootstrap = prepared.stable.desired.bootstrap.version
    if (bootstrapStatus.bootstrapVersion !== undefined && bootstrapStatus.bootstrapVersion !== desiredBootstrap) {
      const artifacts = prepared.bootstrap.manifest.artifacts
      if (artifacts.length !== 1) throw new Error('Bootstrap manifest must contain exactly one package')
      const receipt = prepared.receipts.get(artifacts[0].id)
      await this.stage0.stageBootstrap(receipt.token, desiredBootstrap)
      await new Promise(() => {})
    }
    const managed = await this.prepareManaged(prepared, { onProgress })
    await onSwitching()
    await this.bootstrap.request('POST', '/v1/deployments/activate', { record: managed.record })
    return managed.record
  }

  async rollback(recordId) {
    return this.bootstrap.request('POST', '/v1/deployments/rollback', recordId === undefined ? {} : { recordId })
  }

  rollbackDeployments() {
    return this.bootstrap.request('GET', '/v1/deployments/rollback-plan')
  }

  async currentDeployment() {
    const { record } = await this.bootstrap.request('GET', '/v1/deployments/current')
    if (record === null) throw new Error('current Deployment is required')
    return Object.freeze({
      dsh: record.dshVersion,
      runtime: record.id,
      environment: record.environmentVersion,
      dataSnapshot: record.snapshotId,
      receiptTokens: Object.freeze([...record.receiptTokens]),
    })
  }

  async prepareExperimental(prepared) {
    const { record: current } = await this.bootstrap.request('GET', '/v1/deployments/current')
    if (current === null) throw new Error('current Deployment is required')
    const receiptTokens = await this.experimentalActivationTokens(prepared.receiptTokens)
    const built = await this.builder.buildExperimental(prepared, current, receiptTokens)
    this.experimentalCandidates.set(built.record.id, built.record)
    return Object.freeze({
      runtimeId: built.record.id,
      environmentVersion: built.record.environmentVersion,
      dshVersion: built.record.dshVersion,
    })
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
    const record = this.experimentalCandidates.get(runtimeId)
    if (record === undefined) throw new Error('Experimental Deployment candidate is not prepared')
    return this.bootstrap.request('POST', '/v1/deployments/candidate', { record })
  }

  async bindExperimentalSnapshot(runtimeId, snapshotId) {
    const record = this.experimentalCandidates.get(runtimeId)
    if (record === undefined) throw new Error('Experimental Deployment candidate is not prepared')
    const content = { ...record, snapshotId }
    delete content.id
    const bound = parseDeploymentRecord({ ...content, id: deriveRecordId('deployment-record', content) })
    this.experimentalCandidates.delete(runtimeId)
    this.experimentalCandidates.set(bound.id, bound)
    return bound.id
  }

  async commitExperimental(runtimeId) {
    const result = await this.bootstrap.request('POST', '/v1/deployments/candidate/commit', { recordId: runtimeId })
    this.experimentalCandidates.delete(runtimeId)
    return result
  }

  async restoreDeployment(deployment, { resume = true } = {}) {
    await this.bootstrap.request('POST', '/v1/deployments/candidate/cancel')
    const { record } = await this.bootstrap.request('GET', '/v1/deployments/current')
    if (record?.id !== deployment.runtime) {
      await this.bootstrap.request('POST', '/v1/deployments/rollback', { recordId: deployment.runtime })
    }
    if (resume) await this.resumeDsh()
  }

  async cleanup() {
    const platform = await this.bootstrap.request('POST', '/v1/platform/gc')
    return Object.freeze({
      platform,
      bootstrap: await this.stage0.collectBootstrap(),
      trustedObjects: (await this.stage0.collectGarbage()).removed,
    })
  }
}
