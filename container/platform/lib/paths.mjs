import { randomUUID } from 'node:crypto'
import { chmod, chown, lstat, mkdir, rename, rm, symlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const LEGACY_NAMES = Object.freeze([
  'bootstrap', 'downloads', 'dsh', 'environments', 'run', 'runtime', 'snapshots', 'system-plugins', 'trust',
])

async function exists(path) {
  return lstat(path).then(() => true, error => error?.code === 'ENOENT' ? false : Promise.reject(error))
}

export class PlatformPaths {
  constructor(dataRoot = '/data/platform', runRoot = '/run/dsh-platform') {
    this.dataRoot = resolve(dataRoot)
    this.runRoot = resolve(runRoot)
    this.stateRoot = join(this.dataRoot, 'state')
    this.storeRoot = join(this.dataRoot, 'store')
    this.cacheRoot = join(this.dataRoot, 'cache')
    this.logsRoot = join(this.dataRoot, 'logs')
    this.trustStateRoot = join(this.stateRoot, 'trust')
    this.bootstrapStateRoot = join(this.stateRoot, 'bootstrap')
    this.deploymentStateRoot = join(this.stateRoot, 'deployments')
    this.deploymentStatusPath = join(this.deploymentStateRoot, 'status.json')
    this.updaterStateRoot = join(this.stateRoot, 'updater')
    this.objectsRoot = join(this.storeRoot, 'objects')
    this.bootstrapStoreRoot = join(this.storeRoot, 'bootstrap')
    this.environmentsRoot = join(this.storeRoot, 'environments')
    this.pristineRoot = join(this.storeRoot, 'pristine')
    this.runtimesRoot = join(this.storeRoot, 'runtimes')
    this.systemPluginsRoot = join(this.storeRoot, 'system-plugins')
    this.snapshotsRoot = join(this.storeRoot, 'snapshots')
    this.downloadsRoot = join(this.cacheRoot, 'downloads')
    this.viewsRoot = join(this.runRoot, 'views')
    this.deploymentViewsRoot = join(this.runRoot, 'deployments')
    this.systemPluginViewsRoot = join(this.runRoot, 'system-plugin-views')
    this.deploymentView = join(this.runRoot, 'deployment')
    this.trustSocket = join(this.runRoot, 'stage0-trust.sock')
    this.bootstrapSocket = join(this.runRoot, 'bootstrap.sock')
    this.managementSocket = join(this.runRoot, 'management.sock')
    this.recoverySocket = join(this.runRoot, 'recovery.sock')
  }
}

export async function rejectLegacyLayout(paths) {
  const found = []
  for (const name of LEGACY_NAMES) {
    if (await exists(join(paths.dataRoot, name))) found.push(name)
  }
  if (found.length > 0) {
    throw new Error(
      `legacy DSH platform volume layout detected (${found.join(', ')}); stop the container and clear only ${paths.dataRoot}, then restart. Do not delete /data/dsh.`,
    )
  }
}

export async function preparePersistentLayout(paths) {
  await mkdir(paths.dataRoot, { recursive: true })
  await rejectLegacyLayout(paths)
  const directories = [
    paths.trustStateRoot, paths.bootstrapStateRoot, paths.deploymentStateRoot, paths.updaterStateRoot,
    paths.objectsRoot, paths.bootstrapStoreRoot, paths.environmentsRoot, paths.pristineRoot,
    paths.runtimesRoot, paths.systemPluginsRoot, paths.snapshotsRoot, paths.downloadsRoot, paths.logsRoot,
  ]
  await Promise.all(directories.map(path => mkdir(path, { recursive: true })))
  return Object.freeze([...directories])
}

export async function resetRuntimeLayout(paths) {
  if (paths.runRoot === '/' || paths.runRoot === paths.dataRoot) throw new Error('platform run root is unsafe')
  await rm(paths.runRoot, { recursive: true, force: true })
  await mkdir(paths.viewsRoot, { recursive: true })
  await mkdir(paths.deploymentViewsRoot, { recursive: true })
  await mkdir(paths.systemPluginViewsRoot, { recursive: true })
  for (const name of ['environment', 'runtime']) {
    await symlink(join('..', 'deployment', name), join(paths.viewsRoot, name), 'dir')
  }
  await symlink(join('..', 'system-plugin-views', 'current'), join(paths.viewsRoot, 'system-plugins'), 'dir')
  await symlink(join('..', 'deployment', 'system-plugins'), join(paths.systemPluginViewsRoot, 'current'), 'dir')
  if (process.getuid?.() === 0) {
    await chown(paths.runRoot, 0, 1000)
    await chmod(paths.runRoot, 0o1770)
    await chown(paths.viewsRoot, 0, 0)
    await chmod(paths.viewsRoot, 0o755)
    await chown(paths.deploymentViewsRoot, 1000, 1000)
    await chmod(paths.deploymentViewsRoot, 0o755)
    await chown(paths.systemPluginViewsRoot, 1000, 1000)
    await chmod(paths.systemPluginViewsRoot, 0o755)
  }
}

export async function replaceRuntimeView(paths, name, target) {
  if (name !== 'bootstrap') {
    throw new Error(`runtime view ${name} is invalid`)
  }
  const path = join(paths.viewsRoot, name)
  const temporary = join(dirname(path), `.${name}.${randomUUID()}.tmp`)
  await symlink(resolve(target), temporary, 'dir')
  await rename(temporary, path)
  return path
}

export async function replaceDeploymentView(paths, target) {
  const temporary = join(paths.runRoot, `.deployment.${randomUUID()}.tmp`)
  await symlink(resolve(target), temporary, 'dir')
  await rename(temporary, paths.deploymentView)
  return paths.deploymentView
}

export async function replaceSystemPluginView(paths, target = join(paths.deploymentView, 'system-plugins')) {
  const path = join(paths.systemPluginViewsRoot, 'current')
  const temporary = join(paths.systemPluginViewsRoot, `.current.${randomUUID()}.tmp`)
  await symlink(resolve(target), temporary, 'dir')
  await rename(temporary, path)
  return path
}
