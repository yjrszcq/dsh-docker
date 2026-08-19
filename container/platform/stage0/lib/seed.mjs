import { lchown, lstat, mkdir, readFile, readlink, symlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

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
  if (await exists(destination)) return undefined
  const target = resolve(source)
  const details = await lstat(target)
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error(`seed source is not a directory: ${target}`)
  await mkdir(dirname(destination), { recursive: true })
  await symlink(target, destination, 'dir')
  return destination
}

async function seedSlot(source, root, version) {
  const seeded = await seedLink(source, join(root, 'versions', version))
  await mkdir(root, { recursive: true })
  if (!await exists(join(root, 'current'))) await symlink(join('versions', version), join(root, 'current'))
  return seeded
}

export async function provisionPlatformSeed(seedRoot, dataRoot) {
  for (const name of ['bootstrap', 'environments', 'dsh/pristine', 'runtime', 'state', 'logs', 'downloads/untrusted', 'trust', 'run', 'snapshots', 'system-plugins']) {
    await mkdir(join(dataRoot, name), { recursive: true })
  }
  const environmentVersion = validSeedId(
    (await readFile(join(seedRoot, 'environment', 'VERSION'), 'utf8')).trim(),
    'Environment',
  )
  const runtimeVersion = validSeedId(
    (await readFile(join(seedRoot, 'runtime', 'VERSION'), 'utf8')).trim(),
    'Runtime',
  )
  const seededLinks = (await Promise.all([
    seedSlot(join(seedRoot, 'environment', environmentVersion), join(dataRoot, 'environments'), environmentVersion),
    seedSlot(join(seedRoot, 'runtime', runtimeVersion), join(dataRoot, 'runtime'), runtimeVersion),
    seedLink(join(seedRoot, 'pristine', runtimeVersion), join(dataRoot, 'dsh', 'pristine', runtimeVersion)),
    seedSlot(join(seedRoot, 'system-plugins', environmentVersion), join(dataRoot, 'system-plugins'), environmentVersion),
  ])).filter(Boolean)
  if (process.getuid?.() === 0) {
    const writableRoots = [
      'environments', 'environments/versions', 'dsh', 'dsh/pristine',
      'runtime', 'runtime/versions', 'state', 'logs', 'downloads', 'downloads/untrusted',
      'run', 'snapshots', 'system-plugins', 'system-plugins/versions',
    ]
    await Promise.all(writableRoots.map(name => lchown(join(dataRoot, name), 1000, 1000)))
  }
  return Object.freeze({ environmentVersion, runtimeVersion, seededLinks: Object.freeze(seededLinks) })
}

export async function currentSlot(root) {
  return basename(await readlink(join(root, 'current')))
}
