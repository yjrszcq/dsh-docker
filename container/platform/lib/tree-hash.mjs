import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, readlink } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalJson } from './canonical-json.mjs'
import { TrustError } from './validation.mjs'

async function entries(root, relative = '') {
  const names = await readdir(join(root, relative))
  const result = []
  for (const name of names.sort()) {
    const path = relative === '' ? name : `${relative}/${name}`
    const absolute = join(root, path)
    const details = await lstat(absolute)
    const mode = details.mode & 0o777
    if (details.isDirectory()) {
      result.push({ path, type: 'directory', mode })
      result.push(...await entries(root, path))
    } else if (details.isFile()) {
      result.push({
        path,
        type: 'file',
        mode,
        sha256: createHash('sha256').update(await readFile(absolute)).digest('hex'),
        size: details.size,
      })
    } else if (details.isSymbolicLink()) {
      const target = await readlink(absolute)
      if (target.includes('\0')) throw new TrustError(`tree symlink ${path} is invalid`)
      result.push({ path, type: 'symlink', mode, target })
    } else {
      throw new TrustError(`tree entry ${path} has an unsupported type`)
    }
  }
  return result
}

export async function hashTree(root) {
  const manifest = { schema: 1, entries: await entries(root) }
  return createHash('sha256').update(canonicalJson(manifest)).digest('hex')
}
