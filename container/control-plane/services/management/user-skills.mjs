import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { parseDocument } from 'yaml'

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DISABLED_DIRECTORY = '.disabled'
const MAX_SKILL_BYTES = 2 * 1024 * 1024

export class UserSkillConflictError extends Error {
  constructor(message) {
    super(message)
    this.statusCode = 409
  }
}

function entryId(source, location, entryName) {
  return `sha256:${createHash('sha256').update(`${source}\0${location}\0${entryName}`).digest('hex')}`
}

function revisionFor(entries) {
  const hash = createHash('sha256')
  for (const entry of entries) {
    hash.update(`${entry.entryId}\0${entry.fingerprint}\0`)
  }
  return `sha256:${hash.digest('hex')}`
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

async function entryType(path, name) {
  const link = await lstat(path)
  let target = link
  if (link.isSymbolicLink()) target = await stat(path)
  if (target.isDirectory()) return { kind: 'directory', documentPath: join(path, 'SKILL.md'), link }
  if (target.isFile() && name.endsWith('.md')) return { kind: 'file', documentPath: path, link }
  return undefined
}

async function inspectEntry(root, source, location, entryName) {
  const path = location === 'active' ? join(root, entryName) : join(root, DISABLED_DIRECTORY, entryName)
  let type
  let bytes
  let damaged = false
  let metadataError = null
  let name = null
  let description = null
  try {
    type = await entryType(path, entryName)
    if (type === undefined) return undefined
    const metadata = await lstat(type.documentPath)
    if (!metadata.isFile() || metadata.size > MAX_SKILL_BYTES) {
      throw new Error(metadata.size > MAX_SKILL_BYTES ? 'SKILL.md is too large' : 'SKILL.md is not a regular file')
    }
    bytes = await readFile(type.documentPath)
    const text = bytes.toString('utf8')
    if (text.includes('\uFFFD') || !text.startsWith('---\n')) throw new Error('SKILL.md frontmatter is missing')
    const close = text.indexOf('\n---', 4)
    if (close < 0) throw new Error('SKILL.md frontmatter is not closed')
    const document = parseDocument(text.slice(4, close), { prettyErrors: false, strict: true })
    if (document.errors.length > 0) throw new Error(document.errors[0].message)
    const value = document.toJS()
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('SKILL.md frontmatter is invalid')
    if (typeof value.name !== 'string' || !SKILL_NAME_PATTERN.test(value.name)) throw new Error('Skill name is invalid')
    if (typeof value.description !== 'string' || value.description.trim() === '') throw new Error('Skill description is invalid')
    name = value.name
    description = value.description.trim()
  } catch (error) {
    if (error?.code === 'ENOENT' && type === undefined) return undefined
    damaged = true
    metadataError = errorMessage(error)
  }
  const link = type?.link ?? await lstat(path)
  const fingerprint = createHash('sha256')
    .update(`${link.dev}:${link.ino}:${link.mode}:${link.size}:${link.mtimeNs ?? BigInt(Math.trunc(link.mtimeMs * 1e6))}:`)
    .update(bytes ?? Buffer.alloc(0))
    .digest('hex')
  return Object.freeze({
    entryId: entryId(source, location, entryName),
    entryName,
    source,
    kind: type?.kind ?? (entryName.endsWith('.md') ? 'file' : 'directory'),
    name,
    description,
    enabled: location === 'active',
    damaged,
    metadataError,
    symbolicLink: link.isSymbolicLink(),
    path,
    root,
    fingerprint,
  })
}

async function rootEntries(root, source) {
  const result = []
  const locations = [
    { name: 'active', path: root },
    { name: 'disabled', path: join(root, DISABLED_DIRECTORY) },
  ]
  for (const location of locations) {
    let entries
    try {
      entries = await readdir(location.path, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (location.name === 'active' && (entry.name === DISABLED_DIRECTORY || (source === 'user-dsh' && entry.name === '.system'))) continue
      const inspected = await inspectEntry(root, source, location.name, entry.name)
      if (inspected !== undefined) result.push(inspected)
    }
  }
  return result
}

async function removeEntry(path) {
  const metadata = await lstat(path)
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) await rm(path, { recursive: true })
  else await rm(path)
}

export class UserSkillManager {
  constructor({ dshHome = '/data/dsh', agentsHome = '/home/node/.agents' } = {}) {
    this.roots = Object.freeze([
      Object.freeze({ source: 'user-dsh', path: join(resolve(dshHome), 'skills') }),
      Object.freeze({ source: 'user-agents', path: join(resolve(agentsHome), 'skills') }),
    ])
  }

  async inspect() {
    const entries = (await Promise.all(this.roots.map(root => rootEntries(root.path, root.source))))
      .flat()
      .sort((left, right) => left.source.localeCompare(right.source) || left.entryName.localeCompare(right.entryName) || Number(right.enabled) - Number(left.enabled))
    return Object.freeze({
      schema: 1,
      revision: revisionFor(entries),
      skills: Object.freeze(entries.map(({ path: _path, root: _root, fingerprint: _fingerprint, ...entry }) => Object.freeze(entry))),
      internal: entries,
    })
  }

  async list() {
    const { internal: _internal, ...inventory } = await this.inspect()
    return inventory
  }

  async configure({ entryId: requestedId, revision, action }) {
    if (typeof requestedId !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(requestedId)) throw new Error('User Skill entry ID is invalid')
    if (typeof revision !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(revision)) throw new Error('User Skill revision is invalid')
    if (!['enable', 'disable', 'delete'].includes(action)) throw new Error('User Skill action is invalid')
    const inventory = await this.inspect()
    if (inventory.revision !== revision) throw new UserSkillConflictError('User Skill state changed; reload and try again')
    const entry = inventory.internal.find(value => value.entryId === requestedId)
    if (entry === undefined) throw new UserSkillConflictError('User Skill entry no longer exists')
    if (action === 'enable' && entry.enabled) throw new UserSkillConflictError('User Skill is already enabled')
    if (action === 'disable' && !entry.enabled) throw new UserSkillConflictError('User Skill is already disabled')

    if (action === 'delete') {
      const trash = join(entry.root, `.user-skill-delete-${randomUUID()}`)
      await rename(entry.path, trash)
      try {
        await removeEntry(trash)
      } catch (error) {
        try {
          await rename(trash, entry.path)
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'User Skill deletion and rollback failed')
        }
        throw error
      }
    } else {
      const destination = entry.enabled
        ? join(entry.root, DISABLED_DIRECTORY, entry.entryName)
        : join(entry.root, entry.entryName)
      await mkdir(join(entry.root, DISABLED_DIRECTORY), { recursive: true })
      try {
        await lstat(destination)
        throw new UserSkillConflictError(`User Skill destination ${basename(destination)} already exists`)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      await rename(entry.path, destination)
    }
    return this.list()
  }
}

export const userSkillInternals = Object.freeze({ DISABLED_DIRECTORY, SKILL_NAME_PATTERN, entryId })
