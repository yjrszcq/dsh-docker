import { lchown, lstat, mkdir, readFile, readlink, rename, stat, symlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PlatformPaths, preparePersistentLayout } from '../../lib/paths.mjs'

async function exists(path) {
  return lstat(path).then(() => true, error => error?.code === 'ENOENT' ? false : Promise.reject(error))
}

function validSeedId(value, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`${label} seed ID is invalid`)
  }
  return value
}

async function seedLink(source, destination) {
  const target = resolve(source)
  const details = await lstat(target)
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error(`seed source is not a directory: ${target}`)
  await mkdir(dirname(destination), { recursive: true })
  if (await exists(destination)) {
    const destinationDetails = await lstat(destination)
    if (!destinationDetails.isSymbolicLink() || await resolves(destination)) return undefined
  }
  await replaceLink(destination, target)
  return destination
}

async function seedSlot(source, root, version) {
  const seeded = await seedLink(source, join(root, 'versions', version))
  await mkdir(root, { recursive: true })
  const current = join(root, 'current')
  if (!await exists(current) || !await resolves(current)) await replaceLink(current, join('versions', version))
  return seeded
}

async function resolves(path) {
  return stat(path).then(() => true, error => error?.code === 'ENOENT' ? false : Promise.reject(error))
}

async function replaceLink(path, target) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await symlink(target, temporary, 'dir')
  await rename(temporary, path)
}

export async function provisionPlatformSeed(seedRoot, dataRoot) {
  const paths = dataRoot instanceof PlatformPaths ? dataRoot : new PlatformPaths(dataRoot)
  await preparePersistentLayout(paths)
  const environmentSeedRoot = await exists(join(seedRoot, 'environments'))
    ? join(seedRoot, 'environments')
    : join(seedRoot, 'environment')
  const runtimeSeedRoot = await exists(join(seedRoot, 'runtimes'))
    ? join(seedRoot, 'runtimes')
    : join(seedRoot, 'runtime')
  const environmentVersion = validSeedId(
    (await readFile(join(environmentSeedRoot, 'VERSION'), 'utf8')).trim(),
    'Environment',
  )
  const runtimeVersion = validSeedId(
    (await readFile(join(runtimeSeedRoot, 'VERSION'), 'utf8')).trim(),
    'Runtime',
  )
  const seededLinks = (await Promise.all([
    seedSlot(join(environmentSeedRoot, environmentVersion), paths.environmentsRoot, environmentVersion),
    seedSlot(join(runtimeSeedRoot, runtimeVersion), paths.runtimesRoot, runtimeVersion),
    seedLink(join(seedRoot, 'pristine', runtimeVersion), join(paths.pristineRoot, runtimeVersion)),
    seedSlot(join(seedRoot, 'system-plugins', environmentVersion), paths.systemPluginsRoot, environmentVersion),
  ])).filter(Boolean)
  if (process.getuid?.() === 0) {
    const writableRoots = [
      paths.deploymentStateRoot, paths.updaterStateRoot,
      paths.environmentsRoot, join(paths.environmentsRoot, 'versions'),
      paths.pristineRoot, paths.runtimesRoot, join(paths.runtimesRoot, 'versions'), paths.systemPluginsRoot,
      join(paths.systemPluginsRoot, 'versions'), paths.snapshotsRoot, paths.cacheRoot, paths.downloadsRoot, paths.logsRoot,
    ]
    await Promise.all(writableRoots.map(path => lchown(path, 1000, 1000)))
  }
  return Object.freeze({ environmentVersion, runtimeVersion, seededLinks: Object.freeze(seededLinks) })
}

export async function currentSlot(root) {
  return basename(await readlink(join(root, 'current')))
}
