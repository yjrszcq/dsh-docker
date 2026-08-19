import { cp, lstat, mkdir, readlink, rename, rm, symlink } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { TrustError } from '../../lib/validation.mjs'

function validVersion(version) {
  if (typeof version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(version)) {
    throw new TrustError('Bootstrap version is invalid')
  }
  return version
}

async function optionalLink(path) {
  try {
    const details = await lstat(path)
    if (!details.isSymbolicLink()) throw new TrustError(`${path} must be a symbolic link`)
    return basename(await readlink(path))
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

async function replaceLink(root, name, version) {
  const temporary = join(root, `.${name}.${randomUUID()}.tmp`)
  await symlink(join('versions', validVersion(version)), temporary)
  await rename(temporary, join(root, name))
}

export class BootstrapSlots {
  constructor(root) {
    this.root = resolve(root)
  }

  versionPath(version) {
    return join(this.root, 'versions', validVersion(version))
  }

  async provisionSeed(seedPath, version) {
    const destination = this.versionPath(version)
    await mkdir(join(this.root, 'versions'), { recursive: true })
    try {
      await cp(resolve(seedPath), destination, { recursive: true, errorOnExist: true, force: false })
    } catch (error) {
      if (error?.code !== 'ERR_FS_CP_EEXIST' && error?.code !== 'EEXIST') throw error
    }
    if ((await optionalLink(join(this.root, 'current'))) === undefined) {
      await replaceLink(this.root, 'current', version)
    }
    return destination
  }

  async state() {
    return Object.freeze({
      current: await optionalLink(join(this.root, 'current')),
      previous: await optionalLink(join(this.root, 'previous')),
    })
  }

  async promote(version) {
    const state = await this.state()
    if (state.current === version) return state
    await lstat(this.versionPath(version))
    if (state.current !== undefined) await replaceLink(this.root, 'previous', state.current)
    await replaceLink(this.root, 'current', version)
    return this.state()
  }

  async rollback() {
    const state = await this.state()
    if (state.previous === undefined) throw new TrustError('no previous Bootstrap exists')
    await replaceLink(this.root, 'current', state.previous)
    if (state.current !== undefined) await replaceLink(this.root, 'previous', state.current)
    return this.state()
  }

  async discard(version) {
    const state = await this.state()
    if (state.current === version || state.previous === version) throw new TrustError('cannot discard an active Bootstrap')
    await rm(this.versionPath(version), { recursive: true, force: true })
  }
}
