import { createHash, randomUUID } from 'node:crypto'
import { chown, lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export const MAX_SETTINGS_DOCUMENT_BYTES = 1024 * 1024
const UTF8 = new TextDecoder('utf-8', { fatal: true })

function revision(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertRegularFile(details) {
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new Error('settings document must be a regular file')
  }
}

export class SettingsDocumentConflictError extends Error {}

export class SettingsDocumentStore {
  constructor(dshHome, { maxBytes = MAX_SETTINGS_DOCUMENT_BYTES } = {}) {
    this.dshHome = resolve(dshHome)
    this.path = join(this.dshHome, 'settings.yaml')
    this.maxBytes = maxBytes
  }

  async read() {
    let details
    try {
      details = await lstat(this.path)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        const bytes = Buffer.alloc(0)
        return Object.freeze({ content: '', revision: revision(bytes), exists: false })
      }
      throw error
    }
    assertRegularFile(details)
    if (details.size > this.maxBytes) throw new Error('settings document is too large')
    const bytes = await readFile(this.path)
    if (bytes.byteLength > this.maxBytes) throw new Error('settings document is too large')
    let content
    try {
      content = UTF8.decode(bytes)
    } catch {
      throw new Error('settings document is not valid UTF-8')
    }
    return Object.freeze({ content, revision: revision(bytes), exists: true })
  }

  async write(content, expectedRevision) {
    if (typeof content !== 'string') throw new Error('settings document content must be a string')
    if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision)) {
      throw new Error('settings document revision is invalid')
    }
    const bytes = Buffer.from(content)
    if (bytes.byteLength > this.maxBytes) throw new Error('settings document is too large')
    const current = await this.read()
    if (current.revision !== expectedRevision) {
      throw new SettingsDocumentConflictError('settings document changed since it was loaded')
    }

    await mkdir(this.dshHome, { recursive: true, mode: 0o700 })
    const owner = current.exists ? await lstat(this.path) : await stat(this.dshHome)
    if (current.exists) assertRegularFile(owner)
    const temporary = join(this.dshHome, `.settings.yaml.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, bytes, {
        flag: 'wx',
        mode: current.exists ? owner.mode & 0o777 : 0o600,
      })
      if (process.getuid?.() === 0) await chown(temporary, owner.uid, owner.gid)
      if ((await this.read()).revision !== expectedRevision) {
        throw new SettingsDocumentConflictError('settings document changed while it was being saved')
      }
      await rename(temporary, this.path)
    } finally {
      await rm(temporary, { force: true })
    }
    return Object.freeze({ content, revision: revision(bytes), exists: true })
  }
}
