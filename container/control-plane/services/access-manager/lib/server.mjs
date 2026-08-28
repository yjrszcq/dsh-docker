import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { timingSafeEqual } from 'node:crypto'
import { AuthenticationLimiter } from './rate-limiter.mjs'
import { AccessError, accessErrorBody } from './errors.mjs'
import { normalizePassword, normalizeUsername, verifyCredential } from './credentials.mjs'
import { BrowserSessionStore } from './sessions.mjs'
import { ManagementExchangeStore } from './exchanges.mjs'
import { CapabilityStore } from './capabilities.mjs'
import { ManagementTransitionStore } from './transitions.mjs'
import { detectRuntimeCapabilities } from './runtime-capabilities.mjs'

const MAX_BODY_BYTES = 64 * 1024
function identifier() { return randomBytes(32).toString('base64url') }
function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}
function digest(value) { return createHash('sha256').update(value).digest('base64url') }

function normalizeManagementAccess(mode, entry) {
  if (!['compat', 'isolated'].includes(mode)) throw new AccessError('ACCESS_MODE_INVALID', 'management access mode is invalid')
  if (mode === 'compat') return null
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
    || !['local-only', 'public'].includes(entry.kind)) {
    throw new AccessError('ACCESS_ENTRY_INVALID', 'isolated Management entry is invalid')
  }
  if (entry.kind === 'local-only') return { kind: 'local-only' }
  try {
    const parsed = new URL(entry.managementPublicOrigin)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin === 'null'
      || parsed.username !== '' || parsed.password !== '' || parsed.pathname !== '/'
      || parsed.search !== '' || parsed.hash !== '') throw new Error('invalid origin')
    return { kind: 'public', managementPublicOrigin: parsed.origin }
  } catch {
    throw new AccessError('ACCESS_ENTRY_INVALID', 'isolated Management entry is invalid')
  }
}

function sameToken(left, right) {
  const a = Buffer.from(left ?? '')
  const b = Buffer.from(right ?? '')
  return a.byteLength === b.byteLength && a.byteLength > 0 && timingSafeEqual(a, b)
}

function send(response, status, value) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(`${JSON.stringify(value)}\n`)
}

async function body(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) throw new AccessError('REQUEST_TOO_LARGE', 'access request is too large', 413)
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new AccessError('REQUEST_INVALID', 'access request is invalid') }
}

function publicAccount(account) {
  if (account === undefined) return null
  return {
    accountId: account.accountId,
    username: account.username,
    revision: account.revision,
    mainCredentialVersion: account.mainCredential.version,
    managementAdditionalCredential: {
      enabled: account.managementAdditionalCredential.enabled,
      version: account.managementAdditionalCredential.version,
    },
    managementAccess: { ...account.managementAccess },
  }
}

export class AccessService {
  constructor({
    store,
    classificationToken,
    limiter = new AuthenticationLimiter(),
    sessions = new BrowserSessionStore(),
    exchanges = new ManagementExchangeStore(),
    capabilities = new CapabilityStore(),
    transitions,
    verify = verifyCredential,
    sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    report = async () => {},
    now = () => Date.now(),
    runtimeCapabilities = detectRuntimeCapabilities,
  }) {
    this.store = store
    this.classificationToken = classificationToken
    this.limiter = limiter
    this.sessions = sessions
    this.exchanges = exchanges
    this.capabilities = capabilities
    this.transitions = transitions ?? new ManagementTransitionStore({ now })
    this.verify = verify
    this.sleep = sleep
    this.report = report
    this.now = now
    this.runtimeCapabilities = runtimeCapabilities
    this.migrationSetup = null
    this.transition = Promise.resolve()
  }

  serialized(operation) {
    const pending = this.transition.then(operation, operation)
    this.transition = pending.catch(() => {})
    return pending
  }

  async status() {
    const current = await this.store.state()
    const capabilities = await this.runtimeCapabilities()
    return {
      componentReady: true,
      state: current.state,
      instanceId: current.initialization?.instanceId ?? null,
      account: publicAccount(current.account),
      ...capabilities,
    }
  }

  classify(value) {
    if (!sameToken(value.token, this.classificationToken)) {
      throw new AccessError('CLASSIFICATION_FORBIDDEN', 'classification is forbidden', 403)
    }
    return this.serialized(async () => {
      const classified = await this.store.classify(value.evidence)
      await this.report('access.classification.completed', { state: classified.initialization.state })
      return this.status()
    })
  }

  initialize(value) {
    return this.serialized(async () => {
      const account = await this.store.initialize(value)
      await this.report('access.initialization.completed', { accountId: account.accountId })
      return this.status()
    })
  }

  initializeDsh(value) {
    return this.serialized(async () => {
      const account = await this.store.initialize(value)
      const session = this.sessions.issue('dsh', account, { origin: value.origin })
      await this.report('access.initialization.completed', { accountId: account.accountId })
      await this.report('access.session.created', { accountId: account.accountId, kind: 'dsh' })
      return { state: 'initialized', account: publicAccount(account), session }
    })
  }

  beginMigration() {
    return this.serialized(async () => {
      const current = await this.store.state()
      if (current.state !== 'migration-required') throw new AccessError('MIGRATION_UNAVAILABLE', 'administrator migration is unavailable', 409)
      const key = `dshmk_${identifier()}`
      this.migrationSetup = { digest: digest(key), expiresAt: this.now() + 10 * 60 * 1000 }
      await this.report('access.migration.started')
      return { key, expiresAt: new Date(this.migrationSetup.expiresAt).toISOString() }
    })
  }

  migrateDsh(value) {
    return this.serialized(async () => {
      const setup = this.migrationSetup
      this.migrationSetup = null
      if (setup === null || setup.expiresAt <= this.now() || typeof value.setupKey !== 'string'
        || !sameToken(setup.digest, digest(value.setupKey))) {
        throw new AccessError('MIGRATION_KEY_INVALID', 'migration setup key is invalid or expired', 401)
      }
      const account = await this.store.migrate(value)
      const session = this.sessions.issue('dsh', account, { origin: value.origin })
      await this.report('access.migration.completed', { accountId: account.accountId })
      return { state: 'initialized', account: publicAccount(account), session }
    })
  }

  async authenticate(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const admission = this.limiter.enter(current.account.accountId)
    let authenticated = false
    try {
      if (admission.delayMs > 0) await this.sleep(admission.delayMs)
      let usernameMatches = false
      try { usernameMatches = normalizeUsername(value.username) === current.account.username } catch {}
      const passwordMatches = await this.verify(value.password, current.account.mainCredential)
      authenticated = usernameMatches && passwordMatches
      if (!authenticated) {
        await this.report('access.authentication.failed', { accountId: current.account.accountId, level: 'warning' })
        throw new AccessError('AUTHENTICATION_FAILED', 'username or password is incorrect', 401)
      }
      await this.report('access.authentication.succeeded', { accountId: current.account.accountId })
      return {
        authenticated: true,
        accountId: current.account.accountId,
        accountRevision: current.account.revision,
        mainCredentialVersion: current.account.mainCredential.version,
        managementAccessVersion: current.account.managementAccess.version,
      }
    } finally { admission.release(authenticated) }
  }

  async verifyFreshAuthentication(account, mainPassword, additionalPassword, requireAdditional) {
    const admission = this.limiter.enter(account.accountId)
    let authenticated = false
    try {
      if (admission.delayMs > 0) await this.sleep(admission.delayMs)
      const mainMatches = typeof mainPassword === 'string'
        && await this.verify(mainPassword, account.mainCredential)
      const additionalMatches = !requireAdditional || (typeof additionalPassword === 'string'
        && await this.verify(additionalPassword, account.managementAdditionalCredential.verifier))
      authenticated = mainMatches && additionalMatches
      if (!authenticated) {
        await this.report('access.fresh-authentication.failed', { accountId: account.accountId, level: 'warning' })
        throw new AccessError('FRESH_AUTH_FAILED', 'current administrator credentials are incorrect', 401)
      }
      await this.report('access.fresh-authentication.succeeded', { accountId: account.accountId })
    } finally { admission.release(authenticated) }
  }


  async loginDsh(value) {
    const authenticated = await this.authenticate(value)
    const current = await this.store.state()
    const session = this.sessions.issue('dsh', current.account, { origin: value.origin })
    await this.report('access.session.created', { accountId: authenticated.accountId, kind: 'dsh' })
    return { ...authenticated, session }
  }

  async validateSession(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) return { authenticated: false }
    const session = this.sessions.validate(value.token, value.kind, current.account, {
      origin: value.origin,
      csrfToken: value.csrfToken,
      requireCsrf: value.requireCsrf === true,
    })
    return session === undefined ? { authenticated: false } : { authenticated: true, session }
  }

  async logout(value) {
    const revoked = this.sessions.revoke(value.token)
    if (revoked) await this.report('access.session.revoked', { kind: value.kind ?? null })
    return { authenticated: false }
  }

  async managementResult(account, { origin, sourceDshOrigin = null, sourceDshSessionId = null }) {
    if (account.managementAdditionalCredential.enabled) {
      return { pending: this.exchanges.createPending(account, { targetOrigin: origin, sourceDshOrigin, sourceDshSessionId }) }
    }
    const session = this.sessions.issue('management', account, { origin, sourceDshOrigin, sourceDshSessionId })
    await this.report('access.session.created', { accountId: account.accountId, kind: 'management' })
    return { session }
  }

  async loginManagement(value) {
    await this.authenticate(value)
    const current = await this.store.state()
    return this.managementResult(current.account, { origin: value.origin })
  }

  async createManagementHandoff(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const session = this.sessions.validate(value.dshToken, 'dsh', current.account, { origin: value.dshOrigin })
    if (session === undefined) throw new AccessError('SESSION_INVALID', 'DSH session is invalid', 401)
    const handoff = this.exchanges.createHandoff(session, current.account, value.targetOrigin)
    await this.report('access.handoff.created', { accountId: current.account.accountId })
    return { handoff }
  }

  async consumeManagementHandoff(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const handoff = this.exchanges.consumeHandoff(value.token, current.account, value.origin)
    if (handoff === undefined) throw new AccessError('HANDOFF_INVALID', 'management handoff is invalid or expired', 401)
    await this.report('access.handoff.consumed', { accountId: current.account.accountId })
    return this.managementResult(current.account, {
      origin: value.origin,
      sourceDshOrigin: handoff.sourceDshOrigin,
      sourceDshSessionId: handoff.dshSessionId,
    })
  }

  async completeManagementLogin(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined
      || !current.account.managementAdditionalCredential.enabled) {
      throw new AccessError('PENDING_LOGIN_INVALID', 'management login is invalid or expired', 401)
    }
    const pending = this.exchanges.inspectPending(value.pendingToken, current.account, value.origin)
    if (pending === undefined) throw new AccessError('PENDING_LOGIN_INVALID', 'management login is invalid or expired', 401)
    const valid = await this.verify(value.password, current.account.managementAdditionalCredential.verifier)
    if (!valid) throw new AccessError('AUTHENTICATION_FAILED', 'username or password is incorrect', 401)
    this.exchanges.consumePending(pending.key)
    const session = this.sessions.issue('management', current.account, {
      origin: value.origin,
      sourceDshOrigin: pending.value.sourceDshOrigin,
      sourceDshSessionId: pending.value.sourceDshSessionId,
    })
    await this.report('access.session.created', { accountId: current.account.accountId, kind: 'management' })
    return { session }
  }

  async issueCapability(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const session = this.sessions.validate(value.managementToken, 'management', current.account, {
      origin: value.origin,
      csrfToken: value.csrfToken,
      requireCsrf: value.requireCsrf === true,
      touch: false,
    })
    if (session === undefined) throw new AccessError('SESSION_INVALID', 'Management session is invalid', 401)
    return { capability: this.capabilities.issue(session, current.account, value) }
  }

  async consumeCapability(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const capability = this.capabilities.consume(value.token, current.account, value)
    if (capability === undefined) throw new AccessError('CAPABILITY_INVALID', 'Management capability is invalid or expired', 401)
    return { authorized: true, capability }
  }

  consumeInternalCapability(value, account) {
    const authorization = this.capabilities.consume(value.internalCapability, account, {
      audience: 'management', method: value.method, target: value.target,
    })
    if (authorization === undefined) throw new AccessError('CAPABILITY_INVALID', 'Management capability is invalid', 401)
    return authorization
  }

  async authenticationSettings(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const authorization = this.consumeInternalCapability(value, current.account)
    const capabilities = await this.runtimeCapabilities()
    return {
      account: publicAccount(current.account),
      sessions: this.sessions.list(current.account, authorization.sessionId),
      ...capabilities,
    }
  }

  async revokeBrowserSessions(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const authorization = this.consumeInternalCapability(value, current.account)
    if (!['dsh', 'management'].includes(value.kind) || !['others', 'all'].includes(value.scope)) {
      throw new AccessError('SESSION_ACTION_INVALID', 'session action is invalid')
    }
    const preservedSessionId = value.kind === 'dsh'
      ? this.sessions.sourceDshSessionId(authorization.sessionId)
      : authorization.sessionId
    const revoked = value.scope === 'all'
      ? (this.sessions.list(current.account, null).filter(session => session.kind === value.kind).length)
      : this.sessions.revokeKindExcept(value.kind, preservedSessionId)
    if (value.scope === 'all') this.sessions.revokeKind(value.kind)
    await this.report('access.sessions.revoked', { kind: value.kind, scope: value.scope, revoked })
    return { revoked, currentSessionRevoked: value.scope === 'all' && value.kind === 'management' }
  }

  async recoveryStatus() {
    const current = await this.store.state()
    return {
      state: current.state,
      account: current.account === undefined ? null : {
        accountId: current.account.accountId,
        username: current.account.username,
        revision: current.account.revision,
        mainCredentialVersion: current.account.mainCredential.version,
        managementAdditionalCredential: {
          enabled: current.account.managementAdditionalCredential.enabled,
          version: current.account.managementAdditionalCredential.version,
        },
        managementAccess: { ...current.account.managementAccess },
      },
    }
  }

  async replaceRecoveryAccount(value, operation) {
    const current = await this.store.state()
    if (current.account === undefined) throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator account is unavailable', 409)
    if (value.revision !== current.account.revision) throw new AccessError('REVISION_CONFLICT', 'account revision changed', 409)
    const account = { ...current.account, revision: identifier(), updatedAt: new Date().toISOString() }
    await operation(account, current.account)
    const next = await this.store.replaceAccount(account, current.account.revision)
    this.sessions.revokeAll?.()
    this.exchanges.clear?.()
    return { account: publicAccount(next) }
  }

  async setRecoveryUsername(value) {
    const normalized = normalizeUsername(value.username)
    return this.replaceRecoveryAccount(value, async account => { account.username = normalized })
  }

  async resetRecoveryPassword(value) {
    const verifier = await this.store.createVerifier(value.password)
    return this.replaceRecoveryAccount(value, async account => {
      account.mainCredential = { ...verifier, version: account.mainCredential.version + 1 }
    })
  }

  async resetRecoveryManagementPassword(value) {
    const verifier = await this.store.createVerifier(value.password)
    return this.replaceRecoveryAccount(value, async account => {
      account.managementAdditionalCredential = {
        enabled: true,
        version: account.managementAdditionalCredential.version + 1,
        verifier: { ...verifier, version: account.managementAdditionalCredential.version + 1 },
        changedAt: new Date().toISOString(),
      }
    })
  }

  async disableRecoveryManagementPassword(value) {
    return this.replaceRecoveryAccount(value, async account => {
      account.managementAdditionalCredential = {
        enabled: false,
        version: account.managementAdditionalCredential.version + 1,
        verifier: null,
        changedAt: new Date().toISOString(),
      }
    })
  }

  async createManagementTransition(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const authorization = this.consumeInternalCapability(value, current.account)
    const session = this.sessions.details(authorization.sessionId)
    if (session?.kind !== 'management') throw new AccessError('SESSION_INVALID', 'Management session is invalid', 401)
    const isolatedEntry = normalizeManagementAccess(value.mode, value.isolatedEntry)
    const candidateOrigin = value.mode === 'isolated'
      ? (() => {
          if (isolatedEntry.kind === 'public') return isolatedEntry.managementPublicOrigin
          try {
            const parsed = new URL(value.candidateOrigin)
            if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value.candidateOrigin
              || !isLoopbackHostname(parsed.hostname)) throw new Error('not loopback')
            return parsed.origin
          } catch { throw new AccessError('ACCESS_ENTRY_INVALID', 'local Management probe origin is invalid') }
        })()
      : null
    const transition = this.transitions.create({
      account: current.account,
      instanceId: current.initialization.instanceId,
      sessionId: authorization.sessionId,
      sourceOrigin: session.origin,
      sourceDshOrigin: session.sourceDshOrigin,
      mode: value.mode,
      isolatedEntry,
      candidateOrigin,
    })
    await this.report('access.management-transition.created', { mode: value.mode })
    return { transition, instanceId: current.initialization.instanceId }
  }

  async probeManagementTransition(value) {
    const current = await this.store.state()
    const result = this.transitions.probe({
      ...value,
      instanceId: current.initialization?.instanceId,
    })
    if (result === undefined) throw new AccessError('TRANSITION_PROBE_INVALID', 'Management origin probe is invalid or expired', 401)
    await this.report('access.management-transition.probed')
    return result
  }

  async commitManagementTransition(value) {
    return this.serialized(async () => {
      const current = await this.store.state()
      if (current.state !== 'initialized' || current.account === undefined) {
        throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
      }
      const authorization = this.consumeInternalCapability(value, current.account)
      const transitionValue = {
        transitionId: value.transitionId,
        proof: value.proof,
        account: current.account,
        sessionId: authorization.sessionId,
      }
      const transition = this.transitions.consume(transitionValue)
      if (transition === undefined) throw new AccessError('TRANSITION_INVALID', 'Management origin transition is invalid or expired', 409)
      if (transition.mode !== current.account.managementAccess.mode) {
        await this.verifyFreshAuthentication(
          current.account,
          value.currentPassword,
          value.currentAdditionalPassword,
          current.account.managementAdditionalCredential.enabled,
        )
      }
      const account = {
        ...current.account,
        revision: identifier(),
        updatedAt: new Date().toISOString(),
        managementAccess: {
          mode: transition.mode,
          version: current.account.managementAccess.version + 1,
          isolatedEntry: transition.isolatedEntry,
          changedAt: new Date().toISOString(),
        },
      }
      const next = await this.store.replaceAccount(account, current.account.revision)
      const targetOrigin = transition.mode === 'isolated'
        ? (transition.isolatedEntry.kind === 'public' ? transition.candidateOrigin : null)
        : transition.sourceDshOrigin
      const continuation = this.transitions.createContinuation({
        account: next, targetOrigin, sourceDshOrigin: transition.sourceDshOrigin,
      })
      this.sessions.revokeKind('management')
      this.exchanges.clear?.()
      await this.report('access.management-origin.changed', { mode: transition.mode })
      return {
        account: publicAccount(next),
        continuation,
        targetOrigin,
        loginOrigin: transition.mode === 'isolated' ? transition.candidateOrigin : transition.sourceDshOrigin,
      }
    })
  }

  async consumeManagementContinuation(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const continuation = this.transitions.consumeContinuation({
      token: value.token, account: current.account, targetOrigin: value.origin,
    })
    if (continuation === undefined) throw new AccessError('CONTINUATION_INVALID', 'Management continuation is invalid or expired', 401)
    const session = this.sessions.issue('management', current.account, {
      origin: value.origin, sourceDshOrigin: continuation.sourceDshOrigin,
    })
    await this.report('access.management-continuation.consumed')
    return { session }
  }

  async updateAuthenticationSettings(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    this.consumeInternalCapability(value, current.account)
    const account = { ...current.account, revision: identifier(), updatedAt: new Date().toISOString() }
    const usernameChanged = value.username !== undefined && normalizeUsername(value.username) !== current.account.username
    const mainPasswordChanged = value.password !== undefined
    const additionalChanged = value.additionalPassword !== undefined
      || (value.additionalEnabled !== undefined
        && value.additionalEnabled !== current.account.managementAdditionalCredential.enabled)
    if (value.mode !== undefined || value.isolatedEntry !== undefined) {
      throw new AccessError('TRANSITION_REQUIRED', 'Management access changes require a verified transition', 409)
    }
    if (usernameChanged || mainPasswordChanged || additionalChanged) {
      await this.verifyFreshAuthentication(
        current.account,
        value.currentPassword,
        value.currentAdditionalPassword,
        additionalChanged && current.account.managementAdditionalCredential.enabled,
      )
    }
    if (value.username !== undefined) account.username = normalizeUsername(value.username)
    if (value.password !== undefined) {
      if (current.account.managementAdditionalCredential.enabled
        && value.additionalPassword === undefined
        && await this.verify(value.password, current.account.managementAdditionalCredential.verifier)) {
        throw new AccessError('PASSWORDS_MUST_DIFFER', 'main and additional passwords must differ')
      }
      const verifier = await this.store.createVerifier(value.password)
      account.mainCredential = { ...verifier, version: current.account.mainCredential.version + 1 }
    }
    if (value.additionalPassword !== undefined || value.additionalEnabled !== undefined) {
      const enabled = value.additionalEnabled === true
      if (!enabled) {
        account.managementAdditionalCredential = {
          enabled: false,
          version: current.account.managementAdditionalCredential.version + 1,
          verifier: null,
          changedAt: new Date().toISOString(),
        }
      } else if (value.additionalPassword !== undefined) {
        if (typeof value.additionalPassword !== 'string') throw new AccessError('PASSWORD_REQUIRED', 'additional password is required')
        const equalsMain = value.password !== undefined
          ? normalizePassword(value.additionalPassword) === normalizePassword(value.password)
          : await this.verify(value.additionalPassword, current.account.mainCredential)
        if (equalsMain) throw new AccessError('PASSWORDS_MUST_DIFFER', 'main and additional passwords must differ')
        const verifier = await this.store.createVerifier(value.additionalPassword)
        account.managementAdditionalCredential = {
          enabled: true,
          version: current.account.managementAdditionalCredential.version + 1,
          verifier: { ...verifier, version: current.account.managementAdditionalCredential.version + 1 },
          changedAt: new Date().toISOString(),
        }
      } else if (!current.account.managementAdditionalCredential.enabled) {
        throw new AccessError('PASSWORD_REQUIRED', 'additional password is required')
      }
    }
    const next = await this.store.replaceAccount(account, current.account.revision)
    if (mainPasswordChanged) this.sessions.revokeAll()
    else if (additionalChanged) this.sessions.revokeKind('management')
    this.exchanges.clear?.()
    await this.report('access.authentication.settings.changed', { usernameChanged })
    return {
      account: publicAccount(next),
      currentManagementSessionRevoked: mainPasswordChanged || additionalChanged,
    }
  }
}

export function createAccessHttpServer({ service, surface = 'access' }) {
  return createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url ?? '/', 'http://access.internal').pathname
      if (request.method === 'GET' && pathname === '/v1/status') return send(response, 200, await service.status())
      if (surface === 'recovery') {
        const value = await body(request)
        if (request.method === 'GET' && pathname === '/v1/recovery/status') return send(response, 200, await service.recoveryStatus())
        if (request.method === 'POST' && pathname === '/v1/recovery/set-username') return send(response, 200, await service.setRecoveryUsername(value))
        if (request.method === 'POST' && pathname === '/v1/recovery/reset-password') return send(response, 200, await service.resetRecoveryPassword(value))
        if (request.method === 'POST' && pathname === '/v1/recovery/reset-management-password') return send(response, 200, await service.resetRecoveryManagementPassword(value))
        if (request.method === 'POST' && pathname === '/v1/recovery/disable-management-password') return send(response, 200, await service.disableRecoveryManagementPassword(value))
        if (request.method === 'POST' && pathname === '/v1/recovery/begin-migration') return send(response, 201, await service.beginMigration())
        return send(response, 404, { error: 'not found', code: 'NOT_FOUND' })
      }
      const value = await body(request)
      if (request.method === 'POST' && pathname === '/v1/classify') return send(response, 200, await service.classify(value))
      if (request.method === 'POST' && pathname === '/v1/initialize') return send(response, 201, await service.initialize(value))
      if (request.method === 'POST' && pathname === '/v1/authenticate') return send(response, 200, await service.authenticate(value))
      if (request.method === 'POST' && pathname === '/v1/dsh/initialize') return send(response, 201, await service.initializeDsh(value))
      if (request.method === 'POST' && pathname === '/v1/dsh/migrate') return send(response, 201, await service.migrateDsh(value))
      if (request.method === 'POST' && pathname === '/v1/dsh/login') return send(response, 200, await service.loginDsh(value))
      if (request.method === 'POST' && pathname === '/v1/sessions/validate') return send(response, 200, await service.validateSession(value))
      if (request.method === 'POST' && pathname === '/v1/sessions/logout') return send(response, 200, await service.logout(value))
      if (request.method === 'POST' && pathname === '/v1/management/login') return send(response, 200, await service.loginManagement(value))
      if (request.method === 'POST' && pathname === '/v1/management/handoffs') return send(response, 201, await service.createManagementHandoff(value))
      if (request.method === 'POST' && pathname === '/v1/management/handoffs/consume') return send(response, 200, await service.consumeManagementHandoff(value))
      if (request.method === 'POST' && pathname === '/v1/management/pending/complete') return send(response, 200, await service.completeManagementLogin(value))
      if (request.method === 'POST' && pathname === '/v1/capabilities') return send(response, 201, await service.issueCapability(value))
      if (request.method === 'POST' && pathname === '/v1/capabilities/consume') return send(response, 200, await service.consumeCapability(value))
      if (request.method === 'POST' && pathname === '/v1/management/settings') return send(response, 200, await service.authenticationSettings(value))
      if (request.method === 'POST' && pathname === '/v1/management/sessions/revoke') return send(response, 200, await service.revokeBrowserSessions(value))
      if (request.method === 'POST' && pathname === '/v1/management/transitions') return send(response, 201, await service.createManagementTransition(value))
      if (request.method === 'POST' && pathname === '/v1/management/transitions/probe') return send(response, 200, await service.probeManagementTransition(value))
      if (request.method === 'POST' && pathname === '/v1/management/transitions/commit') return send(response, 200, await service.commitManagementTransition(value))
      if (request.method === 'POST' && pathname === '/v1/management/continuations/consume') return send(response, 200, await service.consumeManagementContinuation(value))
      if (request.method === 'POST' && pathname === '/v1/management/auth-settings') return send(response, 200, await service.updateAuthenticationSettings(value))
      send(response, 404, { error: 'not found', code: 'NOT_FOUND' })
    })().catch(async error => {
      const status = error instanceof AccessError ? error.statusCode : 500
      if (!(error instanceof AccessError)) await service.report('access.request.failed', {
        error, method: request.method ?? null, pathname: request.url ?? null,
      })
      send(response, status, accessErrorBody(error))
    })
  })
}
