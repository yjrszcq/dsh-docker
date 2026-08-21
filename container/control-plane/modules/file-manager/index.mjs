import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, lstat, readFile, readdir, readlink, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, normalize, resolve } from 'node:path'

export const MAX_PATH_BYTES = 4096
export const MAX_TEXT_BYTES = 2 * 1024 * 1024
export const DEFAULT_LIST_LIMIT = 200
export const MAX_LIST_LIMIT = 1000
export const SEARCH_MAX_DEPTH = 16
export const SEARCH_MAX_SCANNED = 10_000
export const SEARCH_MAX_RESULTS = 1000

const SORTS = new Set(['name', 'size', 'type', 'modifiedAt'])
const ORDERS = new Set(['asc', 'desc'])

export class FileManagerError extends Error {
  constructor(message, statusCode = 400, code = 'FILE_INVALID') {
    super(message)
    this.name = 'FileManagerError'
    this.statusCode = statusCode
    this.code = code
  }
}

export class FileRevisionConflictError extends FileManagerError {
  constructor(message = 'file revision changed') {
    super(message, 409, 'REVISION_CONFLICT')
    this.name = 'FileRevisionConflictError'
  }
}

function statusCode(error) {
  if (['EACCES', 'EPERM', 'EROFS'].includes(error?.code)) return 403
  if (['ENOENT', 'ENOTDIR'].includes(error?.code)) return 404
  if (error?.code === 'EFBIG') return 413
  return 400
}

export function fileError(error, fallback = 'file operation failed') {
  if (error instanceof FileManagerError) return error
  const wrapped = new FileManagerError(error instanceof Error ? error.message : fallback, statusCode(error), error?.code ?? 'FILE_ERROR')
  if (error instanceof Error) wrapped.cause = error
  return wrapped
}

export function normalizeAbsolutePath(value) {
  if (typeof value !== 'string' || value.length === 0) throw new FileManagerError('path must be a non-empty string')
  if (!value.startsWith('/')) throw new FileManagerError('path must be absolute')
  if (Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES) throw new FileManagerError('path is too long')
  if(/[\u0000-\u001f\u007f]/u.test(value)) throw new FileManagerError('path contains control characters')
  const path = normalize(value)
  if (!path.startsWith('/')) throw new FileManagerError('path must be absolute')
  return path
}

export function createManagedPathMatcher(platformData = '/data/platform') {
  const data = normalizeAbsolutePath(platformData)
  const roots = Object.freeze(['/opt/dsh-platform', '/run/dsh-platform', join(data, 'state'), join(data, 'store')])
  return value => {
    const path = normalizeAbsolutePath(value)
    return roots.some(root => path === root || path.startsWith(`${root}/`))
  }
}

export const isManagedPath = createManagedPathMatcher()

export function fileManagerLocations({
  platformData = '/data/platform', dshHome = '/data/dsh', defaultWorkspace = '/workspace',
} = {}) {
  const defaultPath = normalizeAbsolutePath(defaultWorkspace)
  const shortcuts = [...new Set([defaultPath, normalizeAbsolutePath(dshHome), normalizeAbsolutePath(platformData), '/'])]
  return Object.freeze({ defaultPath, shortcuts: Object.freeze(shortcuts) })
}

function parseIdentityFile(value, idIndex) {
  const result = new Map()
  for (const line of value.split('\n')) {
    if (line === '' || line.startsWith('#')) continue
    const fields = line.split(':')
    const id = Number(fields[idIndex])
    if (fields[0] !== '' && Number.isSafeInteger(id) && id >= 0 && !result.has(id)) result.set(id, fields[0])
  }
  return result
}

export class UnixIdentityResolver {
  constructor({ passwdPath = '/etc/passwd', groupPath = '/etc/group' } = {}) {
    this.passwdPath = passwdPath
    this.groupPath = groupPath
    this.loading = undefined
  }

  async #identities() {
    this.loading ??= Promise.all([
      readFile(this.passwdPath, 'utf8').then(value => parseIdentityFile(value, 2), () => new Map()),
      readFile(this.groupPath, 'utf8').then(value => parseIdentityFile(value, 2), () => new Map()),
    ])
    return this.loading
  }

  async resolve(uid, gid) {
    const [users, groups] = await this.#identities()
    return { user: users.get(uid) ?? String(uid), group: groups.get(gid) ?? String(gid) }
  }

  async userId(value) { return this.#identityId(value, 0, 'user') }

  async groupId(value) { return this.#identityId(value, 1, 'group') }

  async #identityId(value, index, label) {
    if (typeof value !== 'string' || value === '' || value.length > 256 || /[:\u0000-\u001f\u007f]/u.test(value)) {
      throw new FileManagerError(`${label} is invalid`, 400, 'FILE_IDENTITY_INVALID')
    }
    if (/^[0-9]+$/u.test(value)) {
      const id = Number(value)
      if (Number.isSafeInteger(id) && id >= 0 && id < 0xffff_ffff) return id
      throw new FileManagerError(`${label} id is invalid`, 400, 'FILE_IDENTITY_INVALID')
    }
    const identities = (await this.#identities())[index]
    for (const [id, name] of identities) if (name === value) return id
    throw new FileManagerError(`${label} was not found`, 400, 'FILE_IDENTITY_INVALID')
  }
}

function kind(stats) {
  if (stats.isFile()) return 'file'
  if (stats.isDirectory()) return 'directory'
  if (stats.isSymbolicLink()) return 'symlink'
  if (stats.isBlockDevice()) return 'block-device'
  if (stats.isCharacterDevice()) return 'character-device'
  if (stats.isFIFO()) return 'fifo'
  if (stats.isSocket()) return 'socket'
  return 'unknown'
}

function metadata(stats) {
  return {
    type: kind(stats),
    size: Number(stats.size),
    mode: Number(stats.mode & 0o7777n),
    uid: Number(stats.uid),
    gid: Number(stats.gid),
    modifiedAt: new Date(Number(stats.mtimeNs / 1_000_000n)).toISOString(),
    createdAt: new Date(Number(stats.birthtimeNs / 1_000_000n)).toISOString(),
  }
}

function revisionFor(path, stats, extra = '') {
  return `sha256:${createHash('sha256').update(JSON.stringify([
    path, stats.dev.toString(), stats.ino.toString(), kind(stats), stats.size.toString(),
    stats.mode.toString(), stats.uid.toString(), stats.gid.toString(), stats.mtimeNs.toString(), stats.ctimeNs.toString(), extra,
  ])).digest('hex')}`
}

async function permissions(path) {
  const allowed = async mode => access(path, mode).then(() => true, () => false)
  const [readable, writable] = await Promise.all([allowed(constants.R_OK), allowed(constants.W_OK)])
  return { readable, writable }
}

async function symlinkDetails(path, stats) {
  if (!stats.isSymbolicLink()) return {}
  const linkTarget = await readlink(path)
  try {
    const target = await stat(path, { bigint: true })
    return { linkTarget, targetExists: true, targetType: kind(target), realPath: await realpath(path) }
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ELOOP') return { linkTarget, targetExists: false, targetType: null, realPath: null }
    throw error
  }
}

async function describe(path, stats = undefined, managed = isManagedPath, identity = new UnixIdentityResolver()) {
  const value = stats ?? await lstat(path, { bigint: true })
  const link = await symlinkDetails(path, value)
  const owner = await identity.resolve(Number(value.uid), Number(value.gid))
  return {
    name: basename(path) || '/',
    path,
    ...metadata(value),
    ...owner,
    ...await permissions(path),
    managed: managed(path),
    revision: revisionFor(path, value, link.linkTarget ?? ''),
    ...link,
  }
}

function compareEntries(left, right, sort, order) {
  if (left.type === 'directory' && right.type !== 'directory') return -1
  if (left.type !== 'directory' && right.type === 'directory') return 1
  let result
  if (sort === 'size') result = left.size - right.size
  else if (sort === 'modifiedAt') result = left.modifiedAt.localeCompare(right.modifiedAt)
  else if (sort === 'type') result = left.type.localeCompare(right.type)
  else result = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
  if (result === 0) result = left.name.localeCompare(right.name)
  return order === 'desc' ? -result : result
}

function encodeCursor(revision, offset) {
  return Buffer.from(JSON.stringify({ revision, offset })).toString('base64url')
}

function decodeCursor(value, revision) {
  if (value === undefined || value === null || value === '') return 0
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (parsed.revision !== revision) throw new FileRevisionConflictError('directory changed while paging')
    if (!Number.isSafeInteger(parsed.offset) || parsed.offset < 0) throw new Error('invalid offset')
    return parsed.offset
  } catch (error) {
    if (error instanceof FileRevisionConflictError) throw error
    throw new FileManagerError('cursor is invalid')
  }
}

function listRevision(path, stats, entries) {
  const digest = createHash('sha256')
  for (const entry of entries) digest.update(`${entry.name}\0${entry.revision}\0`)
  return revisionFor(path, stats, digest.digest('hex'))
}

function parseLimit(value, fallback = DEFAULT_LIST_LIMIT) {
  if (value === undefined || value === null || value === '') return fallback
  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) throw new FileManagerError(`limit must be between 1 and ${MAX_LIST_LIMIT}`)
  return limit
}

export class FileInventory {
  constructor({ isManaged = isManagedPath, identity = new UnixIdentityResolver() } = {}) {
    this.isManaged = isManaged
    this.identity = identity
  }

  async stat(value) {
    const path = normalizeAbsolutePath(value)
    try {
      const item = await describe(path, undefined, this.isManaged, this.identity)
      return { ...item, realPath: item.realPath ?? await realpath(path).catch(() => path), parent: dirname(path) }
    } catch (error) {
      throw fileError(error)
    }
  }

  async list(value, { cursor, limit, sort = 'name', order = 'asc' } = {}) {
    const path = normalizeAbsolutePath(value)
    if (!SORTS.has(sort)) throw new FileManagerError('sort is invalid')
    if (!ORDERS.has(order)) throw new FileManagerError('order is invalid')
    try {
      const root = await lstat(path, { bigint: true })
      if (!root.isDirectory()) throw new FileManagerError('path is not a directory', 415, 'FILE_TYPE_UNSUPPORTED')
      const names = await readdir(path)
      const entries = await Promise.all(names.map(async name => {
        const child = resolve(path, name)
        return describe(child, undefined, this.isManaged, this.identity)
      }))
      entries.sort((left, right) => compareEntries(left, right, sort, order))
      const revision = listRevision(path, root, entries)
      const offset = decodeCursor(cursor, revision)
      const pageSize = parseLimit(limit)
      const page = entries.slice(offset, offset + pageSize)
      const nextOffset = offset + page.length
      return {
        path,
        realPath: await realpath(path),
        revision,
        entries: page,
        nextCursor: nextOffset < entries.length ? encodeCursor(revision, nextOffset) : null,
        total: entries.length,
        managed: this.isManaged(path),
      }
    } catch (error) {
      throw fileError(error)
    }
  }

  async content(value) {
    const path = normalizeAbsolutePath(value)
    try {
      const before = await stat(path, { bigint: true })
      if (!before.isFile()) throw new FileManagerError('path is not a regular file', 415, 'FILE_TYPE_UNSUPPORTED')
      if (before.size > BigInt(MAX_TEXT_BYTES)) throw new FileManagerError('file is too large to edit', 413, 'FILE_TOO_LARGE')
      const bytes = await readFile(path)
      const after = await stat(path, { bigint: true })
      const beforeRevision = revisionFor(path, before)
      if (beforeRevision !== revisionFor(path, after)) throw new FileRevisionConflictError('file changed while reading')
      if (bytes.includes(0)) throw new FileManagerError('file is not UTF-8 text', 415, 'FILE_TYPE_UNSUPPORTED')
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return {
        path,
        realPath: await realpath(path),
        content,
        encoding: 'utf-8',
        newline: content.includes('\r\n') ? 'crlf' : 'lf',
        revision: beforeRevision,
        mode: Number(before.mode & 0o7777n),
        size: bytes.byteLength,
        modifiedAt: new Date(Number(before.mtimeNs / 1_000_000n)).toISOString(),
        managed: this.isManaged(path),
      }
    } catch (error) {
      throw fileError(error)
    }
  }
}

export class FileSearchManager {
  constructor({ inventory = new FileInventory(), onState = () => {} } = {}) {
    this.inventory = inventory
    this.onState = onState
    this.tasks = new Map()
  }

  start({ path: value, revision, query }) {
    const path = normalizeAbsolutePath(value)
    if (typeof query !== 'string' || query.trim().length === 0 || query.length > 256) throw new FileManagerError('search query is invalid')
    const task = {
      taskId: randomUUID(), operation: 'search', status: 'running', path, revision, query,
      scanned: 0, matches: [], truncated: false, error: null, cancelRequested: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    this.tasks.set(task.taskId, task)
    this.#publish(task)
    task.completion = this.#run(task).catch(error => {
      task.status = task.cancelRequested ? 'cancelled' : 'failed'
      task.error = error instanceof Error ? error.message : String(error)
      this.#publish(task)
    })
    return this.public(task)
  }

  get(taskId, { cursor, limit } = {}) {
    const task = this.tasks.get(taskId)
    if (task === undefined) throw new FileManagerError('file task was not found', 404, 'FILE_TASK_NOT_FOUND')
    const offset = cursor === undefined || cursor === '' ? 0 : Number(cursor)
    if (!Number.isSafeInteger(offset) || offset < 0) throw new FileManagerError('task cursor is invalid')
    const size = parseLimit(limit)
    return { ...this.public(task), results: task.matches.slice(offset, offset + size), nextCursor: offset + size < task.matches.length ? String(offset + size) : null }
  }

  list() {
    return [...this.tasks.values()].map(task => this.public(task)).reverse()
  }

  cancel(taskId) {
    const task = this.tasks.get(taskId)
    if (task === undefined) throw new FileManagerError('file task was not found', 404, 'FILE_TASK_NOT_FOUND')
    if (task.status !== 'running') throw new FileManagerError('file task is already complete', 409, 'FILE_TASK_COMPLETE')
    task.cancelRequested = true
    this.#publish(task)
    return this.public(task)
  }

  public(task) {
    const { completion, matches, cancelRequested, ...value } = task
    return { ...value, resultCount: matches.length, cancelRequested }
  }

  #publish(task) {
    task.updatedAt = new Date().toISOString()
    this.onState(this.public(task))
  }

  async #run(task) {
    const root = await this.inventory.list(task.path, { limit: 1 })
    if (task.revision !== undefined && task.revision !== null && task.revision !== root.revision) throw new FileRevisionConflictError('search root changed')
    task.revision = root.revision
    const needle = task.query.toLocaleLowerCase()
    const pending = [{ path: task.path, depth: 0 }]
    while (pending.length > 0 && task.scanned < SEARCH_MAX_SCANNED && task.matches.length < SEARCH_MAX_RESULTS) {
      if (task.cancelRequested) {
        task.status = 'cancelled'
        this.#publish(task)
        return
      }
      const current = pending.shift()
      let names
      try { names = await readdir(current.path, { withFileTypes: true }) } catch (error) {
        if (['EACCES', 'EPERM', 'ENOENT'].includes(error?.code)) continue
        throw error
      }
      for (const entry of names) {
        task.scanned += 1
        const child = resolve(current.path, entry.name)
        const relative = child.slice(task.path === '/' ? 1 : task.path.length + 1)
        if (relative.toLocaleLowerCase().includes(needle)) task.matches.push(await describe(child, undefined, this.inventory.isManaged, this.inventory.identity))
        if (entry.isDirectory() && !entry.isSymbolicLink() && current.depth < SEARCH_MAX_DEPTH) pending.push({ path: child, depth: current.depth + 1 })
        if (task.scanned >= SEARCH_MAX_SCANNED || task.matches.length >= SEARCH_MAX_RESULTS) break
      }
      this.#publish(task)
      await new Promise(resolve => setImmediate(resolve))
    }
    task.truncated = pending.length > 0 || task.scanned >= SEARCH_MAX_SCANNED || task.matches.length >= SEARCH_MAX_RESULTS
    task.status = 'success'
    this.#publish(task)
  }
}

export class FileSizeManager {
  constructor({ inventory = new FileInventory(), onState = () => {} } = {}) {
    this.inventory = inventory
    this.onState = onState
    this.tasks = new Map()
  }

  start({ path: value, revision } = {}) {
    const path = normalizeAbsolutePath(value)
    const task = {
      taskId: randomUUID(), operation: 'size', status: 'running', path, revision,
      bytes: 0, entries: 0, error: null, cancelRequested: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    this.tasks.set(task.taskId, task)
    this.#publish(task)
    task.completion = this.#run(task).catch(error => {
      task.status = task.cancelRequested ? 'cancelled' : 'failed'
      task.error = error instanceof Error ? error.message : String(error)
      this.#publish(task)
    })
    return this.public(task)
  }

  get(taskId) {
    const task = this.tasks.get(taskId)
    if (task === undefined) throw new FileManagerError('file task was not found', 404, 'FILE_TASK_NOT_FOUND')
    return this.public(task)
  }

  list() { return [...this.tasks.values()].map(task => this.public(task)).reverse() }

  cancel(taskId) {
    const task = this.tasks.get(taskId)
    if (task === undefined) throw new FileManagerError('file task was not found', 404, 'FILE_TASK_NOT_FOUND')
    if (task.status !== 'running') throw new FileManagerError('file task is already complete', 409, 'FILE_TASK_COMPLETE')
    task.cancelRequested = true
    this.#publish(task)
    return this.public(task)
  }

  public(task) {
    const { completion, cancelRequested, ...value } = task
    return { ...value, cancelRequested }
  }

  #publish(task) {
    task.updatedAt = new Date().toISOString()
    this.onState(this.public(task))
  }

  async #run(task) {
    const root = await this.inventory.stat(task.path)
    if (root.type !== 'directory') throw new FileManagerError('size target is not a directory', 415, 'FILE_TYPE_UNSUPPORTED')
    if (typeof task.revision !== 'string' || task.revision !== root.revision) throw new FileRevisionConflictError('size target changed')
    const pending = [task.path]
    while (pending.length > 0) {
      if (task.cancelRequested) {
        task.status = 'cancelled'
        this.#publish(task)
        return
      }
      const directory = pending.pop()
      for (const name of await readdir(directory)) {
        const path = resolve(directory, name)
        const details = await lstat(path, { bigint: true })
        task.entries += 1
        if (details.isDirectory() && !details.isSymbolicLink()) pending.push(path)
        else if (details.isFile()) task.bytes += Number(details.size)
      }
      this.#publish(task)
      await new Promise(resolveTask => setImmediate(resolveTask))
    }
    task.status = 'success'
    this.#publish(task)
  }
}

export const fileManagerInternals = Object.freeze({ describe, revisionFor, parseIdentityFile, parseLimit })
