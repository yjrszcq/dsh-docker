import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { canonicalJson } from '../../../../platform/lib/canonical-json.mjs'
import { exactKeys, isoTimestamp, parseJsonDocument, plainObject, TrustError } from '../../../../platform/lib/validation.mjs'

function validId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new TrustError('snapshot ID is invalid')
  }
  return value
}

function version(value, label) {
  if (typeof value !== 'string' || value === '' || value.length > 128 || /[\0/\\]/.test(value)) {
    throw new TrustError(`${label} is invalid`)
  }
  return value
}

function parseManifest(bytes) {
  const value = parseJsonDocument(bytes, 'snapshot manifest')
  exactKeys(value, [
    'archiveSha256', 'archiveSize', 'createdAt', 'dshVersion', 'environmentVersion',
    'id', 'runtimeId', 'schema', 'source',
  ], 'snapshot manifest')
  if (value.schema !== 1) throw new TrustError('snapshot manifest schema must be 1')
  validId(value.id)
  if (value.source !== '/home/node/.dsh') throw new TrustError('snapshot source is invalid')
  if (typeof value.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.archiveSha256)) {
    throw new TrustError('snapshot archive SHA-256 is invalid')
  }
  if (!Number.isSafeInteger(value.archiveSize) || value.archiveSize < 0) {
    throw new TrustError('snapshot archive size is invalid')
  }
  isoTimestamp(value.createdAt, 'snapshot creation time')
  version(value.runtimeId, 'snapshot runtime ID')
  version(value.environmentVersion, 'snapshot Environment version')
  version(value.dshVersion, 'snapshot DSH version')
  return Object.freeze(value)
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

async function hashFile(path) {
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

export class PersistentStateSnapshots {
  constructor({ root, sourceRoot = '/home/node/.dsh', now = () => new Date(), runImpl = run }) {
    this.root = resolve(root)
    this.sourceRoot = resolve(sourceRoot)
    this.now = now
    this.run = runImpl
  }

  path(id) {
    return join(this.root, 'versions', validId(id))
  }

  async create({ id = randomUUID(), runtimeId, environmentVersion, dshVersion }) {
    validId(id)
    const sourceDetails = await lstat(this.sourceRoot)
    if (!sourceDetails.isDirectory() || sourceDetails.isSymbolicLink()) {
      throw new TrustError('snapshot source must be a real directory')
    }
    const versions = join(this.root, 'versions')
    const destination = this.path(id)
    await lstat(destination).then(
      () => { throw new TrustError(`snapshot ${id} already exists`) },
      error => { if (error?.code !== 'ENOENT') throw error },
    )
    await mkdir(versions, { recursive: true })
    const staging = join(versions, `.${id}.${randomUUID()}.tmp`)
    await mkdir(staging)
    const archive = join(staging, 'data.tar.gz')
    try {
      await this.run('tar', ['-czpf', archive, '-C', this.sourceRoot, '.'])
      const measured = await hashFile(archive)
      const manifest = canonicalJson({
        schema: 1,
        id,
        createdAt: this.now().toISOString(),
        source: '/home/node/.dsh',
        runtimeId: version(runtimeId, 'snapshot runtime ID'),
        environmentVersion: version(environmentVersion, 'snapshot Environment version'),
        dshVersion: version(dshVersion, 'snapshot DSH version'),
        archiveSha256: measured.sha256,
        archiveSize: measured.size,
      })
      parseManifest(manifest)
      const handle = await open(join(staging, 'manifest.json'), 'wx', 0o600)
      try { await handle.writeFile(manifest); await handle.sync() } finally { await handle.close() }
      await syncDirectory(staging)
      await rename(staging, destination)
      await syncDirectory(versions)
      return Object.freeze({ ...parseManifest(manifest), path: destination })
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
  }

  async inspect(id) {
    const root = this.path(id)
    const manifest = parseManifest(await readFile(join(root, 'manifest.json')))
    if (manifest.id !== id) throw new TrustError('snapshot manifest ID does not match its directory')
    const archive = join(root, 'data.tar.gz')
    const measured = await hashFile(archive)
    if (measured.sha256 !== manifest.archiveSha256 || measured.size !== manifest.archiveSize) {
      throw new TrustError('snapshot archive does not match its manifest', 'TRUST_ARTIFACT_MISMATCH')
    }
    const entries = (await this.run('tar', ['-tzf', archive])).split('\n').filter(Boolean)
    if (entries.length === 0) throw new TrustError('snapshot archive is empty')
    for (const entry of entries) {
      if (entry.startsWith('/') || entry.split('/').includes('..')) {
        throw new TrustError(`snapshot archive path is unsafe: ${entry}`)
      }
    }
    return Object.freeze({ ...manifest, archive })
  }

  async restore(id) {
    const snapshot = await this.inspect(id)
    await mkdir(this.sourceRoot, { recursive: true })
    for (const entry of await readdir(this.sourceRoot)) {
      await rm(join(this.sourceRoot, entry), { recursive: true, force: true })
    }
    await this.run('tar', ['-xzpf', snapshot.archive, '--no-same-owner', '-C', this.sourceRoot])
    await syncDirectory(this.sourceRoot)
    return snapshot
  }

  async list() {
    let names
    try { names = await readdir(join(this.root, 'versions')) } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    const snapshots = []
    for (const name of names.filter(name => !name.startsWith('.')).sort()) snapshots.push(await this.inspect(name))
    return Object.freeze(snapshots)
  }

  async remove(id) {
    await this.inspect(id)
    await rm(this.path(id), { recursive: true, force: true })
  }
}
