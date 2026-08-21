import { link, open, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  FileManagerError, FileRevisionConflictError, MAX_TEXT_BYTES, fileError,
  fileManagerInternals, isManagedPath, normalizeAbsolutePath,
} from './index.mjs'

async function syncDirectory(path) {
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

function bytes(value) {
  if (typeof value !== 'string') throw new FileManagerError('content must be a string')
  const result = Buffer.from(value, 'utf8')
  if (result.byteLength > MAX_TEXT_BYTES) throw new FileManagerError('file is too large to edit', 413, 'FILE_TOO_LARGE')
  if (result.includes(0)) throw new FileManagerError('content contains NUL', 415, 'FILE_TYPE_UNSUPPORTED')
  return result
}

export class AtomicFileEditor {
  constructor({ isManaged = isManagedPath } = {}) {
    this.isManaged = isManaged
  }

  async write(value, content, revision, { create = false } = {}) {
    const path = normalizeAbsolutePath(value)
    const body = bytes(content)
    const parent = dirname(path)
    let original
    try {
      original = await stat(path, { bigint: true })
      if (!original.isFile()) throw new FileManagerError('path is not a regular file', 415, 'FILE_TYPE_UNSUPPORTED')
      if (create) throw new FileManagerError('file already exists', 409, 'FILE_EXISTS')
      if (typeof revision !== 'string' || revision !== fileManagerInternals.revisionFor(path, original)) {
        throw new FileRevisionConflictError()
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw fileError(error)
      if (!create) throw fileError(error)
      if (revision !== null && revision !== undefined) throw new FileManagerError('new file revision must be null')
    }
    const temporary = join(parent, `.dsh-edit-${randomUUID()}.tmp`)
    let handle
    try {
      handle = await open(temporary, 'wx', original === undefined ? 0o644 : Number(original.mode & 0o7777n))
      await handle.writeFile(body)
      await handle.sync()
      if (original !== undefined) {
        await handle.chmod(Number(original.mode & 0o7777n))
        const current = await handle.stat({ bigint: true })
        if (current.uid !== original.uid || current.gid !== original.gid) {
          try { await handle.chown(Number(original.uid), Number(original.gid)) } catch {
            throw new FileManagerError('cannot preserve file ownership; use the terminal', 403, 'OWNERSHIP_PRESERVE_FAILED')
          }
        }
      }
      await handle.close()
      handle = undefined
      if (original === undefined) {
        await link(temporary, path)
        await rm(temporary)
      } else await rename(temporary, path)
      await syncDirectory(parent)
      const saved = await stat(path, { bigint: true })
      return {
        path, revision: fileManagerInternals.revisionFor(path, saved), size: body.byteLength,
        mode: Number(saved.mode & 0o7777n), modifiedAt: new Date(Number(saved.mtimeNs / 1_000_000n)).toISOString(),
        managed: this.isManaged(path),
      }
    } catch (error) {
      await handle?.close().catch(() => {})
      await rm(temporary, { force: true }).catch(() => {})
      throw fileError(error)
    }
  }
}
