import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalJson } from '../../../../platform/lib/canonical-json.mjs'
import { durableReplace } from '../../../../platform/lib/atomic.mjs'
import { defaultProxyConfiguration, validateProxyConfiguration } from './contracts.mjs'
import { ProxyConfigurationError } from './errors.mjs'

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function syncDirectory(path) {
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

async function writeSynced(path, bytes, mode) {
  const handle = await open(path, 'wx', mode)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function revision() {
  return randomBytes(32).toString('base64url')
}

function parse(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')) } catch { throw new ProxyConfigurationError(`${label} is corrupt`, { code: 'PROXY_STATE_CORRUPT', stage: 'load' }) }
}

export class ProxyConfigurationStore {
  constructor(root, { now = () => new Date() } = {}) {
    this.root = root
    this.revisionsRoot = join(root, 'revisions')
    this.currentPath = join(root, 'current.json')
    this.now = now
    this.queue = Promise.resolve()
  }

  exclusive(operation) {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  async prepare() {
    await mkdir(this.revisionsRoot, { recursive: true, mode: 0o700 })
    await chmod(this.root, 0o700)
    await chmod(this.revisionsRoot, 0o700)
  }

  async readPointer() {
    try {
      const pointer = parse(await readFile(this.currentPath), 'proxy current pointer')
      if (pointer?.schema !== 1 || typeof pointer.revision !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pointer.revision)) {
        throw new ProxyConfigurationError('proxy current pointer is corrupt', { code: 'PROXY_STATE_CORRUPT', stage: 'load' })
      }
      return pointer.revision
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async readRevision(id) {
    const root = join(this.revisionsRoot, id)
    const [configBytes, credentialsBytes, manifestBytes] = await Promise.all([
      readFile(join(root, 'config.json')),
      readFile(join(root, 'credentials.json')),
      readFile(join(root, 'manifest.json')),
    ])
    const manifest = parse(manifestBytes, 'proxy revision manifest')
    if (
      manifest?.schema !== 1 || manifest.revision !== id
      || manifest.files?.config !== hash(configBytes)
      || manifest.files?.credentials !== hash(credentialsBytes)
    ) throw new ProxyConfigurationError('proxy revision manifest does not match its files', { code: 'PROXY_STATE_CORRUPT', stage: 'load' })
    const configuration = parse(configBytes, 'proxy configuration')
    const credentials = parse(credentialsBytes, 'proxy credentials')
    if (credentials?.schema !== 1 || credentials.username !== configuration?.proxy?.username || !('password' in credentials)) {
      throw new ProxyConfigurationError('proxy credentials do not match configuration', { code: 'PROXY_STATE_CORRUPT', stage: 'load' })
    }
    const validated = validateProxyConfiguration({
      ...configuration,
      proxy: { ...configuration.proxy, password: credentials.password },
      noProxy: { user: configuration.noProxy.user },
    })
    if (validated.configuration.proxy.passwordConfigured !== configuration.proxy.passwordConfigured) {
      throw new ProxyConfigurationError('proxy password state is inconsistent', { code: 'PROXY_STATE_CORRUPT', stage: 'load' })
    }
    return Object.freeze({ revision: id, configuration: validated.configuration, credentials: validated.credentials, createdAt: manifest.createdAt })
  }

  async recoveryCandidates() {
    const entries = await readdir(this.revisionsRoot, { withFileTypes: true })
    const candidates = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      try {
        const loaded = await this.readRevision(entry.name)
        candidates.push(loaded)
      } catch {}
    }
    return candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  async load() {
    await this.prepare()
    let current = null
    let corruptPointer = false
    try {
      current = await this.readPointer()
    } catch (error) {
      if (error?.code !== 'PROXY_STATE_CORRUPT') throw error
      corruptPointer = true
    }
    if (current !== null) {
      try { return Object.freeze({ ...(await this.readRevision(current)), recovery: 'none' }) } catch (error) {
        if (error?.code !== 'PROXY_STATE_CORRUPT' && error?.code !== 'ENOENT') throw error
      }
    }
    const recovered = (await this.recoveryCandidates())[0]
    if (recovered !== undefined) {
      await durableReplace(this.currentPath, canonicalJson({ schema: 1, revision: recovered.revision }), 0o640)
      return Object.freeze({ ...recovered, recovery: 'previous' })
    }
    const entries = await readdir(this.revisionsRoot, { withFileTypes: true })
    const hadPublishedState = corruptPointer || entries.some(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    if (corruptPointer) {
      await rename(this.currentPath, join(this.root, `current.corrupt.${randomUUID()}.json`))
      await syncDirectory(this.root)
    }
    const initialized = await this.commit({ baseRevision: null, value: defaultProxyConfiguration() })
    return Object.freeze({ ...initialized, recovery: hadPublishedState ? 'reset-disabled' : 'none' })
  }

  commit(request) {
    return this.exclusive(() => this.commitUnlocked(request))
  }

  async commitUnlocked({ baseRevision, value }) {
    await this.prepare()
    let current = null
    try { current = await this.loadCurrentWithoutRecovery() } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if ((current?.revision ?? null) !== baseRevision) {
      throw new ProxyConfigurationError('proxy configuration changed', {
        code: 'REVISION_CONFLICT', statusCode: 409, stage: 'activate',
      })
    }
    const validated = validateProxyConfiguration(value, { existingPassword: current?.credentials.password ?? null })
    const id = revision()
    const staging = join(this.revisionsRoot, `.${id}.${randomUUID()}.tmp`)
    const published = join(this.revisionsRoot, id)
    await mkdir(staging, { mode: 0o700 })
    try {
      const configBytes = canonicalJson(validated.configuration)
      const credentialsBytes = canonicalJson({ schema: 1, ...validated.credentials })
      const manifestBytes = canonicalJson({
        schema: 1,
        revision: id,
        createdAt: this.now().toISOString(),
        files: { config: hash(configBytes), credentials: hash(credentialsBytes) },
      })
      await writeSynced(join(staging, 'config.json'), configBytes, 0o640)
      await writeSynced(join(staging, 'credentials.json'), credentialsBytes, 0o600)
      await writeSynced(join(staging, 'manifest.json'), manifestBytes, 0o640)
      await syncDirectory(staging)
      await rename(staging, published)
      await syncDirectory(this.revisionsRoot)
      const candidate = await this.readRevision(id)
      await durableReplace(this.currentPath, canonicalJson({ schema: 1, revision: id }), 0o640)
      return candidate
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
  }

  async loadCurrentWithoutRecovery() {
    const current = await this.readPointer()
    if (current === null) {
      const error = new Error('proxy configuration is not initialized')
      error.code = 'ENOENT'
      throw error
    }
    return this.readRevision(current)
  }
}
