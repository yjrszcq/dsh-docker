import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { canonicalJson } from '../../../platform/lib/canonical-json.mjs'
import { hashTree } from '../../../platform/lib/tree-hash.mjs'

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const STATE_SCHEMA = 1

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function skillId(value) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value) || value.length > 64) {
    throw new Error('System Skill ID is invalid')
  }
  return value
}

function description(value, label) {
  exactKeys(value, ['en', 'zh'], label)
  for (const language of ['en', 'zh']) {
    if (typeof value[language] !== 'string' || value[language].length === 0 || value[language].length > 240) {
      throw new Error(`${label}.${language} is invalid`)
    }
  }
  return Object.freeze({ en: value.en, zh: value.zh })
}

export async function readSystemSkillCatalog(root) {
  const sourceRoot = resolve(root)
  const document = JSON.parse(await readFile(join(sourceRoot, 'catalog.json'), 'utf8'))
  exactKeys(document, ['schema', 'skills'], 'System Skill catalog')
  if (document.schema !== 1 || !Array.isArray(document.skills)) throw new Error('System Skill catalog is invalid')
  const ids = new Set()
  const skills = []
  for (const entry of document.skills) {
    exactKeys(entry, ['description', 'id', 'source'], 'System Skill catalog entry')
    const id = skillId(entry.id)
    if (ids.has(id)) throw new Error(`duplicate System Skill ID ${id}`)
    ids.add(id)
    if (typeof entry.source !== 'string' || entry.source !== id) throw new Error(`System Skill ${id} source is invalid`)
    const source = resolve(sourceRoot, entry.source)
    if (!source.startsWith(`${sourceRoot}/`)) throw new Error(`System Skill ${id} source escapes its catalog`)
    const metadata = await lstat(join(source, 'SKILL.md'))
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`System Skill ${id} SKILL.md is invalid`)
    const bytes = await readFile(join(source, 'SKILL.md'), 'utf8')
    if (!bytes.startsWith('---\n') || !bytes.includes(`\nname: ${id}\n`)) {
      throw new Error(`System Skill ${id} frontmatter does not match its catalog`)
    }
    skills.push(Object.freeze({
      id,
      source,
      sha256: await hashTree(source),
      description: description(entry.description, `System Skill ${id} description`),
    }))
  }
  return Object.freeze(skills)
}

function defaults(catalog) {
  return Object.fromEntries(catalog.map(skill => [skill.id, { installed: true, enabled: true }]))
}

function normalizeState(value, catalog) {
  const fallback = defaults(catalog)
  if (value === undefined) return fallback
  exactKeys(value, ['schema', 'skills'], 'System Skill selection state')
  if (value.schema !== STATE_SCHEMA || value.skills === null || typeof value.skills !== 'object' || Array.isArray(value.skills)) {
    throw new Error('System Skill selection state is invalid')
  }
  for (const skill of catalog) {
    const saved = value.skills[skill.id]
    if (saved === undefined) continue
    exactKeys(saved, ['enabled', 'installed'], `System Skill ${skill.id} selection`)
    if (typeof saved.installed !== 'boolean' || typeof saved.enabled !== 'boolean' || (saved.enabled && !saved.installed)) {
      throw new Error(`System Skill ${skill.id} selection is invalid`)
    }
    fallback[skill.id] = { installed: saved.installed, enabled: saved.enabled }
  }
  return fallback
}

export class SystemSkillSelectionStore {
  constructor(path) {
    this.path = resolve(path)
  }

  async read(catalog) {
    let value
    try {
      value = JSON.parse(await readFile(this.path, 'utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    return normalizeState(value, catalog)
  }

  async write(catalog, state) {
    const normalized = normalizeState({ schema: STATE_SCHEMA, skills: state }, catalog)
    const document = {
      schema: STATE_SCHEMA,
      skills: Object.fromEntries(catalog.map(skill => [skill.id, normalized[skill.id]])),
    }
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${canonicalJson(document)}\n`, { flag: 'wx', mode: 0o600 })
      await rename(temporary, this.path)
    } finally {
      await rm(temporary, { force: true })
    }
    return normalized
  }
}

async function replaceSkillLink(viewRoot, skill) {
  const path = join(viewRoot, skill.id)
  const existing = await lstat(path).catch(error => error?.code === 'ENOENT' ? undefined : Promise.reject(error))
  if (existing?.isSymbolicLink() && await readlink(path) === skill.source) return
  const temporary = join(viewRoot, `.${skill.id}.${randomUUID()}.tmp`)
  try {
    await symlink(skill.source, temporary, 'dir')
    await rename(temporary, path)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function synchronizeSystemSkillView({ catalog, selection, viewRoot }) {
  const root = resolve(viewRoot)
  await mkdir(root, { recursive: true })
  const expected = new Set(catalog.filter(skill => selection[skill.id].enabled).map(skill => skill.id))
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!expected.has(entry.name)) await rm(join(root, entry.name), { recursive: true, force: true })
  }
  for (const skill of catalog) {
    if (selection[skill.id].enabled) await replaceSkillLink(root, skill)
  }
}

export class SystemSkillManager {
  constructor({ sourceRoot, viewRoot, statePath }) {
    this.sourceRoot = resolve(sourceRoot)
    this.viewRoot = resolve(viewRoot)
    this.store = new SystemSkillSelectionStore(statePath)
  }

  async initialize() {
    const catalog = await readSystemSkillCatalog(this.sourceRoot)
    const selection = await this.store.read(catalog)
    await this.store.write(catalog, selection)
    await synchronizeSystemSkillView({ catalog, selection, viewRoot: this.viewRoot })
    return this.listFrom(catalog, selection)
  }

  listFrom(catalog, selection) {
    return Object.freeze(catalog.map(skill => Object.freeze({
      id: skill.id,
      sha256: skill.sha256,
      description: skill.description,
      installed: selection[skill.id].installed,
      enabled: selection[skill.id].enabled,
    })))
  }

  async list() {
    const catalog = await readSystemSkillCatalog(this.sourceRoot)
    return this.listFrom(catalog, await this.store.read(catalog))
  }

  async configure(idValue, action) {
    const id = skillId(idValue)
    if (!['install', 'uninstall', 'enable', 'disable'].includes(action)) throw new Error('System Skill action is invalid')
    const catalog = await readSystemSkillCatalog(this.sourceRoot)
    if (!catalog.some(skill => skill.id === id)) throw new Error(`System Skill ${id} is not provided by the current Bootstrap`)
    const before = await this.store.read(catalog)
    const next = structuredClone(before)
    const current = next[id]
    if (action === 'install') next[id] = { installed: true, enabled: true }
    else if (action === 'uninstall') next[id] = { installed: false, enabled: false }
    else if (action === 'enable') {
      if (!current.installed) throw new Error(`System Skill ${id} must be installed before it can be enabled`)
      next[id] = { ...current, enabled: true }
    } else next[id] = { ...current, enabled: false }
    try {
      await this.store.write(catalog, next)
      await synchronizeSystemSkillView({ catalog, selection: next, viewRoot: this.viewRoot })
      return this.listFrom(catalog, next)
    } catch (error) {
      try {
        await this.store.write(catalog, before)
        await synchronizeSystemSkillView({ catalog, selection: before, viewRoot: this.viewRoot })
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'System Skill operation and rollback failed')
      }
      throw error
    }
  }
}
