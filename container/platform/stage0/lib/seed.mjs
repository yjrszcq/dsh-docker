import { cp, lchown, lstat, mkdir, readFile, readdir, readlink, symlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

async function exists(path) {
  return lstat(path).then(() => true, error => error?.code === 'ENOENT' ? false : Promise.reject(error))
}

async function seedTree(source, destination) {
  if (await exists(destination)) return undefined
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true,
  })
  return destination
}

async function seedSlot(source, root, version) {
  const seeded = await seedTree(source, join(root, 'versions', version))
  await mkdir(root, { recursive: true })
  if (!await exists(join(root, 'current'))) await symlink(join('versions', version), join(root, 'current'))
  return seeded
}

export async function provisionPlatformSeed(seedRoot, dataRoot) {
  for (const name of ['bootstrap', 'environments', 'dsh/pristine', 'runtime', 'state', 'logs', 'downloads/untrusted', 'trust', 'run', 'snapshots', 'system-plugins']) {
    await mkdir(join(dataRoot, name), { recursive: true })
  }
  const environmentVersion = (await readFile(join(seedRoot, 'environment', 'VERSION'), 'utf8')).trim()
  const runtimeVersion = (await readFile(join(seedRoot, 'runtime', 'VERSION'), 'utf8')).trim()
  const seededTrees = (await Promise.all([
    seedSlot(join(seedRoot, 'environment', environmentVersion), join(dataRoot, 'environments'), environmentVersion),
    seedSlot(join(seedRoot, 'runtime', runtimeVersion), join(dataRoot, 'runtime'), runtimeVersion),
    seedTree(join(seedRoot, 'pristine', runtimeVersion), join(dataRoot, 'dsh', 'pristine', runtimeVersion)),
    seedSlot(join(seedRoot, 'system-plugins', environmentVersion), join(dataRoot, 'system-plugins'), environmentVersion),
  ])).filter(Boolean)
  if (process.getuid?.() === 0) {
    const writableRoots = [
      'environments', 'environments/versions', 'dsh', 'dsh/pristine',
      'runtime', 'runtime/versions', 'state', 'logs', 'downloads', 'downloads/untrusted',
      'run', 'snapshots', 'system-plugins', 'system-plugins/versions',
    ]
    await Promise.all([
      ...writableRoots.map(name => lchown(join(dataRoot, name), 1000, 1000)),
      ...seededTrees.map(path => chownTree(path, 1000, 1000)),
    ])
  }
  return Object.freeze({ environmentVersion, runtimeVersion, seededTrees: Object.freeze(seededTrees) })
}

async function chownTree(path, uid, gid) {
  await lchown(path, uid, gid)
  const details = await lstat(path)
  if (!details.isDirectory() || details.isSymbolicLink()) return
  for (const name of await readdir(path)) await chownTree(join(path, name), uid, gid)
}

export async function currentSlot(root) {
  return basename(await readlink(join(root, 'current')))
}
