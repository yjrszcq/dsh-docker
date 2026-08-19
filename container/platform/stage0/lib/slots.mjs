import { lstat, mkdir, readlink, rename, rm, symlink } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
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

function tar(args, capture = false) {
  return new Promise((resolveTar, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout?.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolveTar(Buffer.concat(stdout).toString('utf8'))
      : reject(new Error(`Bootstrap archive failed: ${Buffer.concat(stderr).toString('utf8')}`)))
  })
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
    const source = resolve(seedPath)
    const sourceDetails = await lstat(source)
    if (!sourceDetails.isDirectory() || sourceDetails.isSymbolicLink()) {
      throw new TrustError('Bootstrap seed source must be a directory')
    }
    try {
      await lstat(destination)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      await symlink(source, destination, 'dir')
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

  async installArchive(archive, version) {
    const destination = this.versionPath(version)
    if (await lstat(destination).then(() => true, error => error?.code === 'ENOENT' ? false : Promise.reject(error))) return destination
    const temporary = `${destination}.${randomUUID()}.tmp`
    await mkdir(temporary, { recursive: true })
    try {
      const allowed = new Set(['platform', 'control-plane'])
      const entries = (await tar(['-tzf', archive], true)).split('\n').filter(Boolean)
      if (entries.length === 0 || entries.some(name => (
        name.startsWith('/')
        || name.split('/').includes('..')
        || !allowed.has(name.split('/')[0])
      ))) throw new TrustError('Bootstrap archive contains an unsafe path')
      await tar(['-xzf', archive, '--no-same-owner', '--no-same-permissions', '-C', temporary])
      await lstat(join(temporary, 'platform', 'bootstrap', 'index.mjs'))
      await rename(temporary, destination)
      return destination
    } catch (error) {
      await rm(temporary, { recursive: true, force: true })
      throw error
    }
  }
}
