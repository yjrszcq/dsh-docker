import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { cp, lstat, mkdir, readFile, readdir, rename, rm, symlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { TrustError } from '../../../platform/lib/validation.mjs'
import { artifactForReference, parseEnvironmentManifest } from '../../../platform/lib/contracts.mjs'

async function patchModule(path) {
  return import(`${pathToFileURL(resolve(path)).href}?runtime=${randomUUID()}`)
}

export async function verifyNpmIntegrity(path, integrity) {
  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
    throw new TrustError('npm integrity must use SHA-512')
  }
  const expected = integrity.slice('sha512-'.length)
  const bytes = await readFile(path)
  const actual = createHash('sha512').update(bytes).digest('base64')
  if (actual !== expected) throw new TrustError('npm tarball integrity mismatch', 'TRUST_ARTIFACT_MISMATCH')
  return bytes.byteLength
}

export async function applyPatchSet(dshRoot, patchPaths) {
  for (const path of patchPaths) {
    const module = await patchModule(path)
    if (typeof module.applyPatch !== 'function') {
      throw new Error(`Patch ${path} does not export applyPatch(dshRoot)`)
    }
    await module.applyPatch(dshRoot)
  }
}

export async function verifyPatchSet(dshRoot, patchPaths) {
  for (const path of patchPaths) {
    const module = await patchModule(path)
    if (typeof module.verifyPatch !== 'function') {
      throw new Error(`Patch ${path} does not export verifyPatch(dshRoot)`)
    }
    await module.verifyPatch(resolve(dshRoot))
  }
}

export async function verifyRuntimePatches({ runtimeRoot, environmentRoot }) {
  const patchSet = await loadEnvironmentPatchSet(environmentRoot)
  await verifyPatchSet(join(resolve(runtimeRoot), 'package'), patchSet.paths)
  return patchSet.ids
}

export async function loadEnvironmentPatchSet(environmentRoot) {
  const environment = resolve(environmentRoot)
  const manifest = parseEnvironmentManifest(await readFile(join(environment, 'environment.manifest.json')))
  const paths = []
  for (const reference of manifest.patches) {
    const descriptor = artifactForReference(manifest, reference)
    const path = join(environment, 'artifacts', descriptor.id)
    const bytes = await readFile(path)
    if (bytes.byteLength !== descriptor.size
      || createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) {
      throw new TrustError(`Patch Artifact ${descriptor.id} differs from the Environment Manifest`)
    }
    paths.push(path)
  }
  return Object.freeze({
    ids: Object.freeze(manifest.patches.map(reference => reference.id)),
    paths: Object.freeze(paths),
  })
}

async function measureTree(path) {
  const details = await lstat(path)
  if (details.isSymbolicLink()) return { bytes: 0, items: 1 }
  if (!details.isDirectory()) return { bytes: details.size, items: 1 }
  let bytes = 0
  let items = 0
  for (const entry of await readdir(path)) {
    const measured = await measureTree(join(path, entry))
    bytes += measured.bytes
    items += measured.items
  }
  return { bytes, items }
}

async function copyTree(source, destination, onProgress = async () => {}) {
  const details = await lstat(source)
  if (details.isSymbolicLink()) {
    await symlink(await import('node:fs/promises').then(({ readlink }) => readlink(source)), destination)
    await onProgress({ processedBytes: 0, processedItems: 1 })
    return
  }
  if (!details.isDirectory()) {
    await cp(source, destination, { preserveTimestamps: true, verbatimSymlinks: true })
    await onProgress({ processedBytes: details.size, processedItems: 1 })
    return
  }
  await mkdir(destination, { recursive: true })
  for (const entry of await readdir(source)) {
    await copyTree(join(source, entry), join(destination, entry), onProgress)
  }
}

export async function buildRuntime({ pristineRoot, versionsRoot, runtimeId, patchPaths, onProgress = async () => {} }) {
  if (typeof runtimeId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runtimeId)) {
    throw new Error('Runtime ID is invalid')
  }
  const versions = resolve(versionsRoot)
  const destination = join(versions, runtimeId)
  try {
    await lstat(destination)
    throw new Error(`Runtime ${runtimeId} already exists`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await mkdir(versions, { recursive: true })
  const staging = join(versions, `.${runtimeId}.${randomUUID()}.tmp`)
  try {
    const packageRoot = join(staging, 'package')
    await mkdir(staging)
    const total = await measureTree(pristineRoot)
    let processedBytes = 0
    let processedItems = 0
    await copyTree(pristineRoot, packageRoot, async update => {
      processedBytes += update.processedBytes
      processedItems += update.processedItems
      await onProgress({ processedBytes, totalBytes: total.bytes, processedItems, totalItems: total.items })
    })
    await applyPatchSet(packageRoot, patchPaths)
    const binTarget = join(packageRoot, 'lib', 'bin.js')
    const details = await lstat(binTarget)
    if (!details.isFile()) throw new Error('DSH Runtime has no lib/bin.js entrypoint')
    await mkdir(join(staging, 'bin'))
    await symlink('../package/lib/bin.js', join(staging, 'bin', 'dsh'))
    await rename(staging, destination)
    return destination
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

async function optionalLink(path) {
  try {
    return basename(await import('node:fs/promises').then(({ readlink }) => readlink(path)))
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

async function replaceLink(root, name, runtimeId) {
  const temporary = join(root, `.${name}.${randomUUID()}.tmp`)
  await symlink(join('versions', runtimeId), temporary)
  await rename(temporary, join(root, name))
}

export function cloneTree(source, destination) {
  return new Promise((resolveClone, reject) => {
    const child = spawn('cp', ['-a', '--reflink=auto', '--', resolve(source), resolve(destination)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const stderr = []
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolveClone(destination)
      : reject(new Error(`Platform tree copy failed: ${Buffer.concat(stderr).toString('utf8').trim()}`)))
  })
}

export class RuntimeSlots {
  constructor(root) {
    this.root = resolve(root)
  }

  async state() {
    return Object.freeze({
      current: await optionalLink(join(this.root, 'current')),
      previous: await optionalLink(join(this.root, 'previous')),
    })
  }

  async promote(runtimeId) {
    await lstat(join(this.root, 'versions', runtimeId))
    const state = await this.state()
    if (state.current !== undefined && state.current !== runtimeId) await replaceLink(this.root, 'previous', state.current)
    await replaceLink(this.root, 'current', runtimeId)
    return this.state()
  }

  async rollback() {
    const state = await this.state()
    if (state.previous === undefined) throw new Error('no previous Runtime exists')
    await replaceLink(this.root, 'current', state.previous)
    if (state.current !== undefined) await replaceLink(this.root, 'previous', state.current)
    return this.state()
  }

  async prune() {
    const state = await this.state()
    const retained = new Set([state.current, state.previous].filter(Boolean))
    let versions
    try { versions = await readdir(join(this.root, 'versions')) } catch (error) {
      if (error?.code === 'ENOENT') return Object.freeze([])
      throw error
    }
    const removed = []
    for (const version of versions) {
      if (!version.startsWith('.') && !retained.has(version)) {
        await rm(join(this.root, 'versions', version), { recursive: true, force: true })
        removed.push(version)
      }
    }
    return Object.freeze(removed.sort())
  }
}
