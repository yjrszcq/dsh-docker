import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { canonicalJson } from '../../../platform/lib/canonical-json.mjs'
import { artifactForReference, parseEnvironmentManifest } from '../../../platform/lib/contracts.mjs'
import { hashTree } from '../../../platform/lib/tree-hash.mjs'

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/
const SELECTION_SCHEMA = 1
export const PROTECTED_SYSTEM_PLUGIN_IDS = Object.freeze(['platform-management'])

function assertPluginId(pluginId) {
  if (typeof pluginId !== 'string' || !PLUGIN_ID_PATTERN.test(pluginId)) {
    throw new Error('System Plugin ID is invalid')
  }
  return pluginId
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolveRun(Buffer.concat(stdout).toString('utf8'))
      else reject(new Error(`${command} failed: ${Buffer.concat(stderr).toString('utf8').trim()}`))
    })
  })
}

async function extractPackage(archive, destination) {
  const listing = (await run('tar', ['-tzf', archive])).split('\n').filter(Boolean)
  if (listing.length === 0) throw new Error('System Plugin archive is empty')
  for (const name of listing) {
    if (!name.startsWith('package/') || name.startsWith('/') || name.split('/').includes('..')) {
      throw new Error(`System Plugin archive path is unsafe: ${name}`)
    }
  }
  await mkdir(destination, { recursive: true })
  await run('tar', ['-xzf', archive, '--strip-components=1', '--no-same-owner', '--no-same-permissions', '-C', destination])
}

function validatePackage(value, pluginId) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`System Plugin ${pluginId} package.json must be an object`)
  }
  const expectedName = `@dsh-docker/${pluginId}`
  if (value.name !== expectedName) throw new Error(`System Plugin ${pluginId} package name must be ${expectedName}`)
  if (typeof value.main !== 'string' || value.main.length === 0
    || value.main.startsWith('/') || value.main.includes('\\') || value.main.split('/').includes('..')) {
    throw new Error(`System Plugin ${pluginId} package main must be a safe relative path`)
  }
  return expectedName
}

function validatePatch(value, pluginId, packageName) {
  if (!Array.isArray(value)) throw new Error(`System Plugin ${pluginId} cordis.patch.json must be an array`)
  return value.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`System Plugin ${pluginId} patch ${String(index)} must be an object`)
    }
    if (Object.keys(entry).length !== 1 || !Array.isArray(entry.insert) || entry.insert.length === 0) {
      throw new Error(`System Plugin ${pluginId} patches must contain only a non-empty insert list`)
    }
    for (const row of entry.insert) {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error(`System Plugin ${pluginId} inserted rows must be objects`)
      }
      if (typeof row.id !== 'string' || !row.id.startsWith(`dsh-docker.${pluginId}.`)) {
        throw new Error(`System Plugin ${pluginId} patch IDs must use its dsh-docker namespace`)
      }
      if (typeof row.name !== 'string' || row.name.length === 0) {
        throw new Error(`System Plugin ${pluginId} inserted rows must name a package`)
      }
      if (row.name !== packageName) {
        throw new Error(`System Plugin ${pluginId} inserted rows must load its own package`)
      }
    }
    return {
      insert: entry.insert.map(row => ({ ...row })),
    }
  })
}

async function replaceLink(root, name, version) {
  const temporary = join(root, `.${name}.${randomUUID()}.tmp`)
  await symlink(join('versions', version), temporary)
  await rename(temporary, join(root, name))
}

export async function reconcileSystemPlugins({ root, environmentVersion, plugins, artifactPath }) {
  const managedRoot = resolve(root)
  const versions = join(managedRoot, 'versions')
  const destination = join(versions, environmentVersion)
  const staging = join(versions, `.${environmentVersion}.${randomUUID()}.tmp`)
  await mkdir(staging, { recursive: true })
  const patches = []
  try {
    for (const plugin of plugins) {
      const packageRoot = join(staging, 'packages', plugin.id)
      await extractPackage(artifactPath(plugin), packageRoot)
      const metadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
      const packageName = validatePackage(metadata, plugin.id)
      const patch = JSON.parse(await readFile(join(packageRoot, 'cordis.patch.json'), 'utf8'))
      patches.push(...validatePatch(patch, plugin.id, packageName))
    }
    await writeFile(join(staging, 'cordis.patch.yml'), canonicalJson(patches), { flag: 'wx' })
    await rename(staging, destination)
    const current = await import('node:fs/promises').then(({ readlink }) => readlink(join(managedRoot, 'current')).catch(error => error.code === 'ENOENT' ? undefined : Promise.reject(error)))
    if (current !== undefined) await replaceLink(managedRoot, 'previous', current.split('/').at(-1))
    await replaceLink(managedRoot, 'current', environmentVersion)
    return destination
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

async function readOverlay(root) {
  const patch = JSON.parse(await readFile(join(root, 'cordis.patch.yml'), 'utf8'))
  if (!Array.isArray(patch)) throw new Error('System Plugin overlay patch must be an array')
  return patch
}

function defaultSelection(pluginIds, protectedIds) {
  return Object.fromEntries(pluginIds.map(id => [id, {
    installed: true,
    enabled: true,
    protected: protectedIds.has(id),
  }]))
}

function validateSelectionDocument(value, pluginIds, protectedIds) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value.schema !== SELECTION_SCHEMA
    || value.plugins === null || typeof value.plugins !== 'object' || Array.isArray(value.plugins)) {
    throw new Error('System Plugin selection state is invalid')
  }
  const selection = defaultSelection(pluginIds, protectedIds)
  for (const id of pluginIds) {
    const saved = value.plugins[id]
    if (saved === undefined) continue
    if (saved === null || typeof saved !== 'object' || Array.isArray(saved)
      || typeof saved.installed !== 'boolean' || typeof saved.enabled !== 'boolean') {
      throw new Error(`System Plugin ${id} selection state is invalid`)
    }
    if (saved.enabled && !saved.installed) {
      throw new Error(`System Plugin ${id} cannot be enabled while it is not installed`)
    }
    if (!protectedIds.has(id)) {
      selection[id] = { installed: saved.installed, enabled: saved.enabled, protected: false }
    }
  }
  return selection
}

export class SystemPluginSelectionStore {
  constructor(path, { protectedIds = PROTECTED_SYSTEM_PLUGIN_IDS } = {}) {
    this.path = resolve(path)
    this.protectedIds = new Set(protectedIds)
  }

  async read(pluginIds) {
    const ids = pluginIds.map(assertPluginId)
    let value
    try {
      value = JSON.parse(await readFile(this.path, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return defaultSelection(ids, this.protectedIds)
      throw error
    }
    return validateSelectionDocument(value, ids, this.protectedIds)
  }

  async write(pluginIds, selection) {
    const ids = pluginIds.map(assertPluginId)
    const normalized = validateSelectionDocument({ schema: SELECTION_SCHEMA, plugins: selection }, ids, this.protectedIds)
    const document = {
      schema: SELECTION_SCHEMA,
      plugins: Object.fromEntries(ids.map(id => [id, {
        installed: normalized[id].installed,
        enabled: normalized[id].enabled,
      }])),
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

  async configure(pluginIds, pluginId, action) {
    const ids = pluginIds.map(assertPluginId)
    assertPluginId(pluginId)
    if (!ids.includes(pluginId)) throw new Error(`System Plugin ${pluginId} is not provided by the current Environment`)
    if (this.protectedIds.has(pluginId)) throw new Error(`System Plugin ${pluginId} is managed by the platform and cannot be changed`)
    if (!['install', 'delete', 'enable', 'disable'].includes(action)) {
      throw new Error('System Plugin action is invalid')
    }
    const selection = await this.read(ids)
    const current = selection[pluginId]
    if (action === 'install') selection[pluginId] = { ...current, installed: true, enabled: true }
    else if (action === 'delete') selection[pluginId] = { ...current, installed: false, enabled: false }
    else if (action === 'enable') {
      if (!current.installed) throw new Error(`System Plugin ${pluginId} must be installed before it can be enabled`)
      selection[pluginId] = { ...current, enabled: true }
    } else selection[pluginId] = { ...current, enabled: false }
    return this.write(ids, selection)
  }
}

async function pluginCatalog(environmentRoot) {
  const root = resolve(environmentRoot)
  const manifest = parseEnvironmentManifest(await readFile(join(root, 'environment.manifest.json')))
  return {
    root,
    plugins: manifest.systemPlugins.map(reference => ({
      id: reference.id,
      descriptor: artifactForReference(manifest, reference),
    })),
  }
}

export async function listManagedSystemPlugins({ environmentRoot, selectionStore }) {
  const catalog = await pluginCatalog(environmentRoot)
  const selection = await selectionStore.read(catalog.plugins.map(plugin => plugin.id))
  return Object.freeze(catalog.plugins.map(({ id, descriptor }) => Object.freeze({
    id,
    artifactId: descriptor.id,
    sha256: descriptor.sha256,
    installed: selection[id].installed,
    enabled: selection[id].enabled,
    protected: selection[id].protected,
    reason: null,
  })))
}

export async function materializeSystemPluginSelection({
  environmentRoot,
  sourceRoot,
  outputRoot,
  selectionStore,
}) {
  const catalog = await pluginCatalog(environmentRoot)
  const pluginIds = catalog.plugins.map(plugin => plugin.id)
  const selection = await selectionStore.read(pluginIds)
  const root = resolve(outputRoot)
  const staging = join(root, `.selection.${randomUUID()}.tmp`)
  const destination = join(root, `selection-${randomUUID()}`)
  const patches = []
  await mkdir(join(staging, 'packages'), { recursive: true })
  try {
    for (const { id } of catalog.plugins) {
      if (!selection[id].installed) continue
      const packageRoot = join(resolve(sourceRoot), 'packages', id)
      const metadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
      const packageName = validatePackage(metadata, id)
      const patch = JSON.parse(await readFile(join(packageRoot, 'cordis.patch.json'), 'utf8'))
      const validatedPatch = validatePatch(patch, id, packageName)
      await symlink(packageRoot, join(staging, 'packages', id), 'dir')
      if (selection[id].enabled) patches.push(...validatedPatch)
    }
    await writeFile(join(staging, 'cordis.patch.yml'), canonicalJson(patches), { flag: 'wx' })
    await rename(staging, destination)
    return Object.freeze({ path: destination, plugins: await listManagedSystemPlugins({ environmentRoot, selectionStore }) })
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

export async function pruneSystemPluginSelectionViews({ outputRoot, keepPath }) {
  const root = resolve(outputRoot)
  const keep = resolve(keepPath)
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.name.startsWith('selection-')) continue
    const candidate = join(root, entry.name)
    if (candidate !== keep) await rm(candidate, { recursive: true, force: true })
  }
}

export async function listBundledSystemPlugins({ environmentRoot, viewRoot }) {
  const manifest = parseEnvironmentManifest(await readFile(join(resolve(environmentRoot), 'environment.manifest.json')))
  const overlay = await readOverlay(resolve(viewRoot)).catch(() => [])
  const moduleNames = new Set(overlay.flatMap(entry => (
    Array.isArray(entry?.insert) ? entry.insert.map(row => row?.name).filter(Boolean) : []
  )))
  const result = []
  for (const reference of manifest.systemPlugins) {
    const descriptor = artifactForReference(manifest, reference)
    let installed = false
    let reason = null
    try {
      const metadata = JSON.parse(await readFile(join(resolve(viewRoot), 'packages', reference.id, 'package.json'), 'utf8'))
      const packageName = validatePackage(metadata, reference.id)
      installed = moduleNames.has(packageName)
      if (!installed) reason = 'plugin loader entry is absent'
    } catch (error) {
      reason = error instanceof Error ? error.message : 'plugin package is unavailable'
    }
    result.push(Object.freeze({
      id: reference.id,
      artifactId: descriptor.id,
      sha256: descriptor.sha256,
      installed,
      reason,
    }))
  }
  return Object.freeze(result)
}

export async function rebuildBundledSystemPluginView({
  environmentRoot,
  outputRoot,
  expectedSha256,
  requestedPluginId,
}) {
  const source = resolve(environmentRoot)
  const manifest = parseEnvironmentManifest(await readFile(join(source, 'environment.manifest.json')))
  if (!manifest.systemPlugins.some(plugin => plugin.id === requestedPluginId)) {
    throw new Error(`System Plugin ${requestedPluginId} is not bundled by the current Environment`)
  }
  const root = resolve(outputRoot)
  const destination = join(root, expectedSha256)
  try {
    const details = await lstat(destination)
    if (!details.isDirectory() || details.isSymbolicLink() || await hashTree(destination) !== expectedSha256) {
      await rm(destination, { recursive: true, force: true })
    } else {
      return destination
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const buildRoot = join(root, `.build.${randomUUID()}.tmp`)
  await mkdir(root, { recursive: true })
  try {
    const built = await reconcileSystemPlugins({
      root: buildRoot,
      environmentVersion: expectedSha256,
      plugins: manifest.systemPlugins,
      artifactPath: reference => join(source, 'artifacts', artifactForReference(manifest, reference).id),
    })
    if (await hashTree(built) !== expectedSha256) {
      throw new Error('rebuilt System Plugin view differs from the current Deployment Record')
    }
    await rename(built, destination)
    return destination
  } finally {
    await rm(buildRoot, { recursive: true, force: true })
  }
}

export async function linkSystemPluginScope({
  dshHome,
  viewRoot = '/run/dsh-platform/views/system-plugins',
}) {
  const modulesRoot = join(resolve(dshHome), 'profiles', 'node_modules')
  const scopeLink = join(modulesRoot, '@dsh-docker')
  const target = join(resolve(viewRoot), 'packages')
  await mkdir(modulesRoot, { recursive: true })
  const existing = await lstat(scopeLink).catch(error => error?.code === 'ENOENT' ? undefined : Promise.reject(error))
  if (existing !== undefined) {
    if (!existing.isSymbolicLink()) {
      throw new Error(`System Plugin scope ${scopeLink} exists and is not a symlink`)
    }
    if (await readlink(scopeLink) === target) return scopeLink
    await rm(scopeLink)
  }
  const temporary = join(modulesRoot, `.@dsh-docker.${randomUUID()}.tmp`)
  try {
    await symlink(target, temporary, 'dir')
    await rename(temporary, scopeLink)
  } finally {
    await rm(temporary, { force: true })
  }
  return scopeLink
}
