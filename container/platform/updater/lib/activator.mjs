import { spawn } from 'node:child_process'
import { cp, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildRuntime, RuntimeSlots } from '../../runtime/builder.mjs'
import { reconcileSystemPlugins } from '../../runtime/system-plugins.mjs'
import { LocalApiClient } from './client.mjs'

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    const stderr = []
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(Buffer.concat(stderr).toString('utf8'))))
  })
}

async function exists(path) {
  return lstat(path).then(() => true, error => error?.code === 'ENOENT' ? false : Promise.reject(error))
}

export class PlatformActivator {
  constructor({ dataRoot, bootstrap = new LocalApiClient(join(dataRoot, 'run', 'bootstrap.sock')) }) {
    this.dataRoot = dataRoot
    this.bootstrap = bootstrap
    this.runtimeSlots = new RuntimeSlots(join(dataRoot, 'runtime'))
    this.environmentSlots = new RuntimeSlots(join(dataRoot, 'environments'))
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
      throw new Error('Bootstrap update requires Stage-0 continuation')
    }
    const runtimeId = `${prepared.stable.desired.dsh.version}-${String(prepared.stable.targetSequence)}`
    if (!await exists(join(this.dataRoot, 'runtime', 'versions', runtimeId))) {
      const pristineRoot = await this.pristine(prepared)
      await buildRuntime({
        pristineRoot,
        versionsRoot: join(this.dataRoot, 'runtime', 'versions'),
        runtimeId,
        patchPaths: prepared.environment.manifest.patches.map(item => prepared.paths.get(item.artifactId)),
      })
    }
    const environmentVersion = await this.stageEnvironment(prepared)
    await reconcileSystemPlugins({
      root: join(this.dataRoot, 'system-plugins'),
      environmentVersion,
      plugins: prepared.environment.manifest.systemPlugins,
      artifactPath: id => prepared.paths.get(id),
    })
    await this.runtimeSlots.promote(runtimeId)
    await this.environmentSlots.promote(environmentVersion)
    try {
      await this.bootstrap.request('POST', '/v1/reload')
    } catch (error) {
      await this.environmentSlots.rollback().catch(() => {})
      await this.runtimeSlots.rollback().catch(() => {})
      await this.bootstrap.request('POST', '/v1/reload').catch(() => {})
      throw error
    }
  }

  async rollback() {
    await this.environmentSlots.rollback()
    await this.runtimeSlots.rollback()
    await this.bootstrap.request('POST', '/v1/reload')
  }
}
