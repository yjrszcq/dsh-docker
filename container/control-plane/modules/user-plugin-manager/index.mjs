import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]{0,126}\/[a-z0-9][a-z0-9._-]{0,126}|[a-z0-9][a-z0-9._-]{0,213})$/i
const SELECTION_SCHEMA = 1

function packagePath(root, packageName) {
  if (!PACKAGE_NAME_PATTERN.test(packageName)) return undefined
  return join(root, 'node_modules', ...packageName.split('/'), 'package.json')
}

async function optionalBytes(path) {
  return readFile(path).then(
    bytes => ({ present: true, bytes }),
    error => error?.code === 'ENOENT' ? { present: false, bytes: Buffer.alloc(0) } : Promise.reject(error),
  )
}

function parseObject(bytes, label) {
  let value
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object`)
  }
  return value
}

function profileFields(manifest) {
  const dependencies = manifest.dependencies ?? {}
  if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    throw new Error('Web Profile dependencies must be an object')
  }
  for (const [name, spec] of Object.entries(dependencies)) {
    if (typeof spec !== 'string' || spec.length === 0) {
      throw new Error(`Web Profile dependency ${name} must have a non-empty string spec`)
    }
  }
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (!Array.isArray(bundles) || bundles.some(name => typeof name !== 'string')) {
    throw new Error('Web Profile dsh.profile.bundles must be a string array')
  }
  return { dependencies, bundles }
}

function disabledPositions(value) {
  if (value === undefined) return new Map()
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== SELECTION_SCHEMA || !Array.isArray(value.disabled)) {
    throw new Error('User Plugin selection state is invalid')
  }
  const positions = new Map()
  for (const entry of value.disabled) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
      || !PACKAGE_NAME_PATTERN.test(entry.name) || !Number.isSafeInteger(entry.index) || entry.index < 0) {
      throw new Error('User Plugin disabled-order entry is invalid')
    }
    if (positions.has(entry.name)) throw new Error(`User Plugin ${entry.name} has duplicate disabled-order entries`)
    positions.set(entry.name, entry.index)
  }
  return positions
}

function sourceForSpec(spec) {
  if (/^(?:file|link):/i.test(spec) || /^(?:\.{1,2}\/|\/)/.test(spec)) return 'file'
  if (/^(?:git(?:\+[^:]+)?|github|gitlab|bitbucket):/i.test(spec) || /\.git(?:#|$)/i.test(spec)) return 'git'
  if (/^https?:/i.test(spec)) return 'url'
  if (/^npm:/i.test(spec) || /^(?:[~^<>=*]|\d|v\d)/i.test(spec) || spec === 'latest' || spec === 'next') return 'registry'
  return 'other'
}

function updateRevision(hash, label, file) {
  hash.update(`${label}:${file.present ? '1' : '0'}:${String(file.bytes.length)}:`)
  hash.update(file.bytes)
  hash.update('\0')
}

function metadataFailure(error) {
  if (error?.code === 'ENOENT') return 'installed package metadata is missing'
  if (error instanceof SyntaxError) return 'installed package metadata is not valid JSON'
  return error instanceof Error ? error.message : String(error)
}

async function inspectDependency(profileRoot, name, spec, enabledBundles, disabled, reservedNames) {
  const path = packagePath(profileRoot, name)
  let metadata
  let metadataError = null
  if (path === undefined) {
    metadataError = 'dependency name is invalid'
  } else {
    try {
      metadata = JSON.parse(await readFile(path, 'utf8'))
      if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new Error('installed package metadata must be an object')
      }
      if (metadata.name !== name) throw new Error(`installed package name is ${String(metadata.name)}`)
    } catch (error) {
      metadataError = metadataFailure(error)
    }
  }
  if (metadataError === null && metadata.version !== undefined
    && (typeof metadata.version !== 'string' || metadata.version.length === 0)) {
    metadataError = 'installed package version is invalid'
  }
  const bundleDeclaration = metadata?.dsh?.bundle
  const patch = bundleDeclaration?.patch
  const isBundle = typeof patch === 'string' && patch.length > 0
  const reservedNameConflict = reservedNames.has(name)
  if (metadataError === null && !isBundle
    && (bundleDeclaration !== undefined || enabledBundles.has(name))) {
    metadataError = 'installed package Bundle metadata is invalid'
  }
  if (!isBundle && metadataError === null && !reservedNameConflict) return undefined
  return Object.freeze({
    name,
    spec,
    source: sourceForSpec(spec),
    version: typeof metadata?.version === 'string' ? metadata.version : null,
    description: typeof metadata?.description === 'string' && metadata.description.trim() !== '' ? metadata.description.trim() : null,
    enabled: !reservedNameConflict && enabledBundles.has(name),
    previousIndex: disabled.get(name) ?? null,
    damaged: metadataError !== null,
    metadataError,
    reservedNameConflict,
  })
}

function loadedIdentity(plugin) {
  return JSON.stringify([
    plugin.name, plugin.spec, plugin.version, plugin.enabled, plugin.damaged,
    plugin.metadataError, plugin.reservedNameConflict,
  ])
}

export function markUserPluginRestartState(current, loaded) {
  if (loaded === undefined) return current
  const loadedPlugins = new Map(loaded.plugins.map(plugin => [plugin.name, loadedIdentity(plugin)]))
  const plugins = current.plugins.map(plugin => Object.freeze({
    ...plugin,
    pendingRestart: loadedPlugins.get(plugin.name) !== loadedIdentity(plugin),
  }))
  const currentNames = new Set(current.plugins.map(plugin => plugin.name))
  const removedLoadedPlugin = loaded.plugins.some(plugin => !currentNames.has(plugin.name))
  return Object.freeze({
    ...current,
    plugins: Object.freeze(plugins),
    restartRequired: removedLoadedPlugin || plugins.some(plugin => plugin.pendingRestart),
  })
}

export class UserPluginInventory {
  constructor({ dshHome = '/data/dsh', profile = 'web', selectionPath, systemPluginNames = async () => [] } = {}) {
    if (profile !== 'web') throw new Error('Only the web DSH Profile is supported')
    this.profile = profile
    this.profileRoot = join(resolve(dshHome), 'profiles', profile)
    this.selectionPath = selectionPath === undefined
      ? join(resolve(dshHome), '..', 'platform', 'state', 'management', 'user-plugins.json')
      : resolve(selectionPath)
    this.systemPluginNames = systemPluginNames
  }

  async read() {
    const manifestPath = join(this.profileRoot, 'package.json')
    const lockfilePath = join(this.profileRoot, 'pnpm-lock.yaml')
    const [manifestBytes, lockfile, selectionFile, names] = await Promise.all([
      readFile(manifestPath),
      optionalBytes(lockfilePath),
      optionalBytes(this.selectionPath),
      this.systemPluginNames(),
    ])
    const manifest = parseObject(manifestBytes, 'Web Profile package.json')
    const { dependencies, bundles } = profileFields(manifest)
    const selection = !selectionFile.present
      ? undefined
      : parseObject(selectionFile.bytes, 'User Plugin selection state')
    const disabled = disabledPositions(selection)
    const reservedNames = new Set(names)
    if ([...reservedNames].some(name => typeof name !== 'string' || !PACKAGE_NAME_PATTERN.test(name))) {
      throw new Error('Verified System Plugin names are invalid')
    }
    const enabledBundles = new Set(bundles)
    const inspected = await Promise.all(Object.entries(dependencies).map(([name, spec]) => (
      inspectDependency(this.profileRoot, name, spec, enabledBundles, disabled, reservedNames)
    )))
    const revisionHash = createHash('sha256')
    updateRevision(revisionHash, 'manifest', { present: true, bytes: manifestBytes })
    updateRevision(revisionHash, 'lockfile', lockfile)
    updateRevision(revisionHash, 'selection', selectionFile)
    const revision = revisionHash.digest('hex')
    return Object.freeze({
      schema: 1,
      profile: this.profile,
      revision: `sha256:${revision}`,
      plugins: Object.freeze(inspected.filter(Boolean)),
    })
  }
}

export const userPluginInternals = Object.freeze({ PACKAGE_NAME_PATTERN, sourceForSpec, loadedIdentity })
