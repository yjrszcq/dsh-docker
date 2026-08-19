import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, rename, rm, symlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { TrustError } from '../lib/validation.mjs'

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
    const module = await import(`${pathToFileURL(resolve(path)).href}?runtime=${randomUUID()}`)
    if (typeof module.applyPatch !== 'function') {
      throw new Error(`Patch ${path} does not export applyPatch(dshRoot)`)
    }
    await module.applyPatch(dshRoot)
  }
}

export async function buildRuntime({ pristineRoot, versionsRoot, runtimeId, patchPaths }) {
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
    await cp(resolve(pristineRoot), packageRoot, { recursive: true, errorOnExist: true, force: false })
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
}
