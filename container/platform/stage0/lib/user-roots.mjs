import { lchown, lstat, mkdir } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

export async function prepareUserWritableRoot(path, { uid, gid, label = 'User-writable root' } = {}) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error(`${label} must be an absolute path`)
  const root = resolve(path)
  if (root === '/') throw new Error(`${label} cannot be the filesystem root`)
  await mkdir(root, { recursive: true })
  const metadata = await lstat(root)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`${label} must be a directory`)
  if (uid !== undefined || gid !== undefined) await lchown(root, uid ?? -1, gid ?? -1)
  return root
}

export async function prepareUserWritableRoots({ dshHome, defaultWorkspace, uid, gid } = {}) {
  const roots = []
  for (const [label, path] of [['DSH_HOME', dshHome], ['DSH_DEFAULT_WORKSPACE', defaultWorkspace]]) {
    const root = resolve(path)
    if (roots.includes(root)) continue
    roots.push(await prepareUserWritableRoot(path, { uid, gid, label }))
  }
  return Object.freeze(roots)
}
