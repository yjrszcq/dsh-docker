import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { canonicalJson } from '../../../platform/lib/canonical-json.mjs'
import { durableReplace } from '../../../platform/lib/atomic.mjs'

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function validId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error('User Plugin snapshot ID is invalid')
  return id
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolveRun(Buffer.concat(stdout).toString('utf8'))
      : reject(new Error(`${command} failed: ${Buffer.concat(stderr).toString('utf8').trim()}`)))
  })
}

async function measure(path) {
  const handle = await open(path, 'r')
  const hash = createHash('sha256')
  let size = 0
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk)
      size += chunk.byteLength
    }
  } finally {
    await handle.close()
  }
  return { sha256: hash.digest('hex'), size }
}

async function syncDirectory(path) {
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

function parseManifest(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'archiveSha256,archiveSize,createdAt,id,schema,source'
    || value.schema !== 1 || !ID_PATTERN.test(value.id)
    || value.source !== '/data/dsh/profiles/web'
    || typeof value.createdAt !== 'string' || new Date(value.createdAt).toISOString() !== value.createdAt
    || typeof value.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.archiveSha256)
    || !Number.isSafeInteger(value.archiveSize) || value.archiveSize < 0) {
    throw new Error('User Plugin snapshot manifest is invalid')
  }
  return Object.freeze({ ...value })
}

export class UserPluginSnapshots {
  constructor({ root, profileRoot = '/data/dsh/profiles/web', now = () => new Date(), runImpl = run }) {
    this.root = resolve(root)
    this.profileRoot = resolve(profileRoot)
    this.now = now
    this.run = runImpl
  }

  path(id) { return join(this.root, validId(id)) }

  async create(id = randomUUID()) {
    validId(id)
    const details = await lstat(this.profileRoot)
    if (!details.isDirectory() || details.isSymbolicLink()) throw new Error('Web Profile must be a real directory')
    await mkdir(this.root, { recursive: true })
    const destination = this.path(id)
    await lstat(destination).then(
      () => { throw new Error(`User Plugin snapshot ${id} already exists`) },
      error => { if (error?.code !== 'ENOENT') throw error },
    )
    const staging = join(this.root, `.${id}.${randomUUID()}.tmp`)
    await mkdir(staging)
    const archive = join(staging, 'profile.tar')
    try {
      await this.run('tar', ['-cpf', archive, '-C', this.profileRoot, '.'])
      const measured = await measure(archive)
      const manifest = parseManifest({
        schema: 1,
        id,
        source: '/data/dsh/profiles/web',
        createdAt: this.now().toISOString(),
        archiveSha256: measured.sha256,
        archiveSize: measured.size,
      })
      await durableReplace(join(staging, 'manifest.json'), canonicalJson(manifest))
      await rename(staging, destination)
      await syncDirectory(this.root)
      return Object.freeze({ ...manifest, path: destination })
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
  }

  async inspect(id) {
    const root = this.path(id)
    const manifest = parseManifest(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')))
    if (manifest.id !== id) throw new Error('User Plugin snapshot ID does not match its directory')
    const archive = await lstat(join(root, 'profile.tar')).then(
      () => join(root, 'profile.tar'),
      error => error?.code === 'ENOENT' ? join(root, 'profile.tar.gz') : Promise.reject(error),
    )
    const measured = await measure(archive)
    if (measured.sha256 !== manifest.archiveSha256 || measured.size !== manifest.archiveSize) {
      throw new Error('User Plugin snapshot archive does not match its manifest')
    }
    const entries = (await this.run('tar', [archive.endsWith('.gz') ? '-tzf' : '-tf', archive])).split('\n').filter(Boolean)
    if (entries.length === 0 || entries.some(entry => entry.startsWith('/') || entry.split('/').includes('..'))) {
      throw new Error('User Plugin snapshot archive contains unsafe paths')
    }
    return Object.freeze({ ...manifest, archive })
  }

  async restore(id) {
    const snapshot = await this.inspect(id)
    await mkdir(this.profileRoot, { recursive: true })
    for (const entry of await readdir(this.profileRoot)) {
      await rm(join(this.profileRoot, entry), { recursive: true, force: true })
    }
    const ownership = process.getuid?.() === 0 ? [] : ['--no-same-owner']
    await this.run('tar', [snapshot.archive.endsWith('.gz') ? '-xzpf' : '-xpf', snapshot.archive, ...ownership, '-C', this.profileRoot])
    await syncDirectory(this.profileRoot)
    return snapshot
  }

  async remove(id) {
    validId(id)
    await rm(this.path(id), { recursive: true, force: true })
  }
}

export const userPluginSnapshotInternals = Object.freeze({ parseManifest })
