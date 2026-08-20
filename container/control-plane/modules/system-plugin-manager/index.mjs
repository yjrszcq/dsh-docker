import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { canonicalJson } from '../../../platform/lib/canonical-json.mjs'
import { artifactForReference, parseEnvironmentManifest } from '../../../platform/lib/contracts.mjs'
import { hashTree } from '../../../platform/lib/tree-hash.mjs'

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
      throw new Error('existing System Plugin repair view conflicts with the current Deployment')
    }
    return destination
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
