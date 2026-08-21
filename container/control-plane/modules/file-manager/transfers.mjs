import { createReadStream } from 'node:fs'
import { link, lstat, mkdir, mkdtemp, open, readlink, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import {
  FileManagerError, FileRevisionConflictError, fileError, fileManagerInternals,
  isManagedPath, normalizeAbsolutePath,
} from './index.mjs'
import { createArchive } from './archives.mjs'

function parseRange(value, size) {
  if (value === undefined) return { start: 0, end: Math.max(0, size - 1), partial: false }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (match === null || (match[1] === '' && match[2] === '')) throw new FileManagerError('range is invalid', 416, 'RANGE_INVALID')
  let start
  let end
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix < 1) throw new FileManagerError('range is invalid', 416, 'RANGE_INVALID')
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Number(match[2])
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    throw new FileManagerError('range is not satisfiable', 416, 'RANGE_INVALID')
  }
  return { start, end: Math.min(end, size - 1), partial: true }
}

function disposition(name) {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'download'
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

async function syncDirectory(path) {
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

async function existingMetadata(path, { requireFile = false } = {}) {
  try {
    const value = await stat(path, { bigint: true })
    if (requireFile && !value.isFile()) throw new FileManagerError('upload target is not a regular file', 415, 'FILE_TYPE_UNSUPPORTED')
    return value
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

function renamedPath(path, index) {
  const extension = extname(path)
  const stem = extension === '' ? path : path.slice(0, -extension.length)
  return `${stem} (${String(index)})${extension}`
}

export class FileTransferManager {
  constructor({ isManaged = isManagedPath, stagingRoot = tmpdir() } = {}) {
    this.isManaged = isManaged
    this.stagingRoot = stagingRoot
  }

  async openDownload(value, { revision, range, signal } = {}) {
    const path = normalizeAbsolutePath(value)
    let handle
    let cleanup
    try {
      const pathStats = await lstat(path, { bigint: true })
      if (pathStats.isDirectory()) {
        if (range !== undefined) throw new FileManagerError('directory downloads do not support ranges', 416, 'RANGE_INVALID')
        const actualRevision = fileManagerInternals.revisionFor(path, pathStats)
        if (revision !== undefined && revision !== '' && revision !== actualRevision) throw new FileRevisionConflictError('download revision changed')
        await mkdir(this.stagingRoot, { recursive: true })
        const staging = await mkdtemp(join(this.stagingRoot, '.dsh-directory-download-'))
        cleanup = () => rm(staging, { recursive: true, force: true })
        const name = basename(path) || 'root'
        const archive = join(staging, `${name}.zip`)
        await createArchive({ format: 'zip', sourceRoot: path === '/' ? path : dirname(path), output: archive, entries: [path === '/' ? '.' : name], signal })
        const download = await this.openDownload(archive, { signal })
        download.path = path
        download.revision = actualRevision
        download.headers['content-disposition'] = disposition(`${name}.zip`)
        download.cleanup = cleanup
        cleanup = undefined
        return download
      }
      handle = await open(path, 'r')
      const before = await handle.stat({ bigint: true })
      if (!before.isFile()) throw new FileManagerError('path is not a regular file', 415, 'FILE_TYPE_UNSUPPORTED')
      const actualRevision = fileManagerInternals.revisionFor(path, before, await readlink(path).catch(() => ''))
      if (revision !== undefined && revision !== '' && revision !== actualRevision) throw new FileRevisionConflictError('download revision changed')
      const size = Number(before.size)
      if (!Number.isSafeInteger(size)) throw new FileManagerError('file is too large', 413, 'FILE_TOO_LARGE')
      if (size === 0 && range !== undefined) throw new FileManagerError('range is not satisfiable', 416, 'RANGE_INVALID')
      const selected = size === 0 ? { start: 0, end: -1, partial: false } : parseRange(range, size)
      const length = selected.end < selected.start ? 0 : selected.end - selected.start + 1
      const stream = length === 0 ? Readable.from([]) : createReadStream(path, {
        fd: handle.fd, autoClose: false, start: selected.start, end: selected.end,
      })
      return {
        path, handle, stream, revision: actualRevision,
        status: selected.partial ? 206 : 200,
        headers: {
          'accept-ranges': 'bytes',
          'cache-control': 'no-store',
          'content-disposition': disposition(basename(path)),
          'content-length': String(length),
          'content-type': 'application/octet-stream',
          etag: `"${actualRevision}"`,
          ...(selected.partial ? { 'content-range': `bytes ${String(selected.start)}-${String(selected.end)}/${String(size)}` } : {}),
        },
      }
    } catch (error) {
      await handle?.close().catch(() => {})
      await cleanup?.().catch(() => {})
      throw fileError(error)
    }
  }

  async sendDownload(response, download, { onProgress = () => {}, signal } = {}) {
    response.writeHead(download.status, download.headers)
    let sent = 0
    download.stream.on('data', chunk => {
      sent += chunk.byteLength
      onProgress(sent, Number(download.headers['content-length']))
    })
    try {
      await pipeline(download.stream, response, { signal })
    } finally {
      await download.handle.close().catch(() => {})
      await download.cleanup?.().catch(() => {})
    }
  }

  async upload(input, value, { conflict = 'reject', contentLength, onProgress = () => {}, signal } = {}) {
    const requestedPath = normalizeAbsolutePath(value)
    if (!['reject', 'overwrite', 'rename'].includes(conflict)) throw new FileManagerError('upload conflict mode is invalid')
    const parent = dirname(requestedPath)
    const parentStats = await stat(parent).catch(error => { throw fileError(error) })
    if (!parentStats.isDirectory()) throw new FileManagerError('upload parent is not a directory', 415, 'FILE_TYPE_UNSUPPORTED')
    const staging = join(parent, `.dsh-upload-${randomUUID()}.tmp`)
    let handle
    let received = 0
    try {
      const original = await existingMetadata(requestedPath, { requireFile: conflict === 'overwrite' })
      if (original !== undefined && conflict === 'reject') throw new FileManagerError('upload target already exists', 409, 'FILE_EXISTS')
      handle = await open(staging, 'wx', 0o600)
      for await (const chunk of input) {
        signal?.throwIfAborted()
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        received += bytes.byteLength
        await handle.write(bytes)
        onProgress(received, contentLength)
      }
      if (contentLength !== undefined && received !== contentLength) throw new FileManagerError('upload size does not match Content-Length')
      await handle.sync()
      if (original === undefined) await handle.chmod(0o644)
      else {
        await handle.chmod(Number(original.mode & 0o7777n))
        const current = await handle.stat({ bigint: true })
        if (current.uid !== original.uid || current.gid !== original.gid) await handle.chown(Number(original.uid), Number(original.gid))
      }
      await handle.close()
      handle = undefined
      let path = requestedPath
      if (conflict === 'overwrite') await rename(staging, path)
      else if (conflict === 'reject') {
        await link(staging, path)
        await rm(staging)
      } else {
        let index = 0
        for (;;) {
          path = index === 0 ? requestedPath : renamedPath(requestedPath, index)
          try {
            await link(staging, path)
            await rm(staging)
            break
          } catch (error) {
            if (error?.code !== 'EEXIST') throw error
            index += 1
          }
        }
      }
      await syncDirectory(parent)
      const result = await stat(path, { bigint: true })
      return {
        path,
        size: received,
        revision: fileManagerInternals.revisionFor(path, result),
        managed: this.isManaged(path),
      }
    } catch (error) {
      await handle?.close().catch(() => {})
      await rm(staging, { force: true }).catch(() => {})
      throw fileError(error)
    }
  }
}

export const fileTransferInternals = Object.freeze({ parseRange, disposition, renamedPath })
