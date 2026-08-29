import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AccessError } from './errors.mjs'
import { createCredential, normalizeUsername, validCredential } from './credentials.mjs'

const STATES = new Set(['never-initialized', 'migration-required', 'initialized', 'recovery-required'])

function identifier(random = randomBytes) { return random(32).toString('base64url') }
function timestamp(now) { return now().toISOString() }

async function syncDirectory(root) {
  const handle = await open(root, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

async function atomicJson(path, value, mode = 0o600) {
  const temporary = join(dirname(path), `.${path.split('/').at(-1)}.${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', mode)
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
    await handle.sync()
  } finally { await handle.close() }
  await chmod(temporary, mode)
  await rename(temporary, path)
  await syncDirectory(dirname(path))
}

async function createExclusiveJson(path, value, mode = 0o600) {
  const handle = await open(path, 'wx', mode)
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
    await handle.sync()
  } finally { await handle.close() }
  await chmod(path, mode)
  await syncDirectory(dirname(path))
}

async function readJson(path) {
  try { return { exists: true, value: JSON.parse(await readFile(path, 'utf8')) } }
  catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, value: undefined }
    return { exists: true, error }
  }
}

export function validInitialization(value) {
  return value !== null && typeof value === 'object' && value.schema === 1
    && typeof value.instanceId === 'string' && Buffer.from(value.instanceId, 'base64url').byteLength === 32
    && STATES.has(value.state) && Number.isFinite(Date.parse(value.createdAt)) && Number.isFinite(Date.parse(value.updatedAt))
}

export function validAccount(value) {
  const additional = value?.managementAdditionalCredential
  const access = value?.managementAccess
  const validOrigin = origin => {
    try {
      const parsed = new URL(origin)
      return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin !== 'null'
        && parsed.username === '' && parsed.password === '' && parsed.pathname === '/'
        && parsed.search === '' && parsed.hash === '' && origin === parsed.origin
    } catch { return false }
  }
  const additionalValid = additional !== null && typeof additional === 'object'
    && typeof additional.enabled === 'boolean'
    && Number.isInteger(additional.version) && additional.version >= 1
    && Number.isFinite(Date.parse(additional.changedAt))
    && (additional.enabled ? validCredential(additional.verifier) : additional.verifier === null)
  const isolatedEntryValid = access?.mode === 'compat'
    ? access.isolatedEntry === null && access.dshPublicOrigin === null
    : access?.mode === 'isolated' && access.isolatedEntry !== null && typeof access.isolatedEntry === 'object'
      && validOrigin(access.dshPublicOrigin)
      && (access.isolatedEntry.kind === 'local-only'
        || (access.isolatedEntry.kind === 'public' && (() => {
          try {
            const parsed = new URL(access.isolatedEntry.managementPublicOrigin)
            return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin !== 'null'
              && parsed.username === '' && parsed.password === '' && parsed.pathname === '/'
              && parsed.search === '' && parsed.hash === ''
              && access.isolatedEntry.managementPublicOrigin === parsed.origin
          } catch { return false }
        })()))
  return value !== null && typeof value === 'object' && value.schema === 1
    && typeof value.revision === 'string' && Buffer.from(value.revision, 'base64url').byteLength === 32
    && typeof value.accountId === 'string' && Buffer.from(value.accountId, 'base64url').byteLength === 32
    && (() => { try { return normalizeUsername(value.username) === value.username } catch { return false } })()
    && validCredential(value.mainCredential)
    && additionalValid && isolatedEntryValid
    && Number.isInteger(access?.version) && access.version >= 1
    && Number.isFinite(Date.parse(access.changedAt))
    && Number.isFinite(Date.parse(value.createdAt)) && Number.isFinite(Date.parse(value.updatedAt))
}

function validEvidence(evidence) {
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) return false
  const entries = Object.entries(evidence)
  return entries.length > 0 && entries.every(([key, value]) => (
    /^[a-z][A-Za-z0-9]{0,63}$/.test(key) && typeof value === 'boolean'
  ))
}

export class AccessStateStore {
  constructor({ root, now = () => new Date(), random = randomBytes, createVerifier = createCredential } = {}) {
    if (typeof root !== 'string') throw new TypeError('Access state root is required')
    this.root = root
    this.initializationPath = join(root, 'initialization.json')
    this.accountPath = join(root, 'account.json')
    this.now = now
    this.random = random
    this.createVerifier = createVerifier
  }

  async prepare() {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await chmod(this.root, 0o700)
  }

  async inspect() {
    const [initialization, account] = await Promise.all([
      readJson(this.initializationPath), readJson(this.accountPath),
    ])
    return {
      initialization: initialization.error === undefined && validInitialization(initialization.value)
        ? initialization.value : undefined,
      initializationExists: initialization.exists,
      initializationDamaged: initialization.error !== undefined || (initialization.exists && !validInitialization(initialization.value)),
      account: account.error === undefined && validAccount(account.value) ? account.value : undefined,
      accountExists: account.exists,
      accountDamaged: account.error !== undefined || (account.exists && !validAccount(account.value)),
    }
  }

  async transition(initialization, state) {
    const next = { ...initialization, state, updatedAt: timestamp(this.now) }
    await atomicJson(this.initializationPath, next)
    return next
  }

  async classify(evidence) {
    if (!validEvidence(evidence)) throw new AccessError('CLASSIFICATION_EVIDENCE_INVALID', 'classification evidence is invalid')
    await this.prepare()
    const inspected = await this.inspect()
    if (inspected.initialization !== undefined) {
      if (inspected.initialization.state === 'never-initialized' && inspected.account !== undefined) {
        const initialization = await this.transition(inspected.initialization, 'initialized')
        return { initialization, account: inspected.account }
      }
      if (inspected.initialization.state === 'initialized' && inspected.account === undefined) {
        const initialization = await this.transition(inspected.initialization, 'recovery-required')
        return { initialization, account: undefined }
      }
      if (inspected.accountDamaged) {
        const initialization = inspected.initialization.state === 'recovery-required'
          ? inspected.initialization : await this.transition(inspected.initialization, 'recovery-required')
        return { initialization, account: undefined }
      }
      return { initialization: inspected.initialization, account: inspected.account }
    }
    if (inspected.initializationDamaged || inspected.accountExists) {
      const initialization = {
        schema: 1, instanceId: identifier(this.random), state: 'recovery-required',
        createdAt: timestamp(this.now), updatedAt: timestamp(this.now),
      }
      await atomicJson(this.initializationPath, initialization)
      return { initialization, account: undefined }
    }
    const initialization = {
      schema: 1,
      instanceId: identifier(this.random),
      state: Object.values(evidence).some(Boolean) ? 'migration-required' : 'never-initialized',
      createdAt: timestamp(this.now),
      updatedAt: timestamp(this.now),
    }
    try { await createExclusiveJson(this.initializationPath, initialization) }
    catch (error) {
      if (error?.code === 'EEXIST') return this.classify(evidence)
      throw error
    }
    return { initialization, account: undefined }
  }

  async state() {
    const inspected = await this.inspect()
    if (inspected.initialization === undefined) {
      return { initialization: undefined, account: undefined, state: 'recovery-required' }
    }
    if (inspected.initialization.state === 'initialized' && inspected.account === undefined) {
      return { initialization: inspected.initialization, account: undefined, state: 'recovery-required' }
    }
    return { initialization: inspected.initialization, account: inspected.account, state: inspected.initialization.state }
  }

  async createAccount({ username, password }, allowedState) {
    const current = await this.state()
    if (current.state !== allowedState) {
      throw new AccessError('ALREADY_INITIALIZED', 'administrator initialization is unavailable', 409)
    }
    const normalized = normalizeUsername(username)
    const now = timestamp(this.now)
    const verifier = await this.createVerifier(password, { now: this.now, random: this.random })
    const account = {
      schema: 1,
      revision: identifier(this.random),
      accountId: identifier(this.random),
      username: normalized,
      mainCredential: verifier,
      managementAdditionalCredential: { enabled: false, version: 1, verifier: null, changedAt: now },
      managementAccess: {
        mode: 'compat', version: 1, isolatedEntry: null, dshPublicOrigin: null, changedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    }
    await atomicJson(this.accountPath, account)
    await this.transition(current.initialization, 'initialized')
    return account
  }

  initialize(value) { return this.createAccount(value, 'never-initialized') }

  migrate(value) { return this.createAccount(value, 'migration-required') }

  async replaceAccount(account, revision) {
    const current = await this.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    if (current.account.revision !== revision) throw new AccessError('REVISION_CONFLICT', 'account revision changed', 409)
    if (!validAccount(account)) throw new AccessError('ACCOUNT_INVALID', 'account record is invalid')
    await atomicJson(this.accountPath, account)
    return account
  }

  async clear() {
    await rm(this.accountPath, { force: true })
  }
}
