import { chown, cp, lstat, mkdir, readFile, readdir, readlink, symlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

async function exists(path) {
  return lstat(path).then(() => true, error => error?.code === 'ENOENT' ? false : Promise.reject(error))
}

async function seedTree(source, destination) {
  if (await exists(destination)) return false
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination, { recursive: true, errorOnExist: true, force: false })
  return true
}

async function seedSlot(source, root, version) {
  await seedTree(source, join(root, 'versions', version))
  await mkdir(root, { recursive: true })
  if (!await exists(join(root, 'current'))) await symlink(join('versions', version), join(root, 'current'))
}

export async function provisionPlatformSeed(seedRoot, dataRoot) {
  for (const name of ['bootstrap', 'environments', 'dsh/pristine', 'runtime', 'state', 'logs', 'downloads/untrusted', 'trust', 'run', 'system-plugins']) {
    await mkdir(join(dataRoot, name), { recursive: true })
  }
  const environmentVersion = (await readFile(join(seedRoot, 'environment', 'VERSION'), 'utf8')).trim()
  const runtimeVersion = (await readFile(join(seedRoot, 'runtime', 'VERSION'), 'utf8')).trim()
  await seedSlot(join(seedRoot, 'environment', environmentVersion), join(dataRoot, 'environments'), environmentVersion)
  await seedSlot(join(seedRoot, 'runtime', runtimeVersion), join(dataRoot, 'runtime'), runtimeVersion)
  await seedTree(join(seedRoot, 'pristine', runtimeVersion), join(dataRoot, 'dsh', 'pristine', runtimeVersion))
  await seedSlot(join(seedRoot, 'system-plugins', environmentVersion), join(dataRoot, 'system-plugins'), environmentVersion)
  if (process.getuid?.() === 0) {
    for (const name of ['environments', 'dsh', 'runtime', 'state', 'logs', 'downloads', 'run', 'system-plugins']) {
      await chownTree(join(dataRoot, name), 1000, 1000)
    }
  }
  return Object.freeze({ environmentVersion, runtimeVersion })
}

async function chownTree(path, uid, gid) {
  await chown(path, uid, gid)
  const details = await lstat(path)
  if (!details.isDirectory() || details.isSymbolicLink()) return
  for (const name of await readdir(path)) await chownTree(join(path, name), uid, gid)
}

export async function currentSlot(root) {
  return basename(await readlink(join(root, 'current')))
}
