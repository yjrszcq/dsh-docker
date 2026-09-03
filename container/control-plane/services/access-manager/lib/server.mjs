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
import { TotpFlowStore, TotpRetryLimiter, totpUri, verifyTotpCode } from './totp.mjs'

const MAX_BODY_BYTES = 64 * 1024
const RECOVERY_OPERATIONS = new Map([
  ['/v1/recovery/set-username', 'set-username'],
  ['/v1/recovery/reset-access', 'reset-access'],
  ['/v1/recovery/reset-password', 'reset-password'],
  ['/v1/recovery/reset-management-password', 'reset-management-password'],
  ['/v1/recovery/disable-management-password', 'disable-management-password'],
  ['/v1/recovery/generate-key', 'generate-key'],
  ['/v1/recovery/clear-retry', 'clear-retry'],
])
function identifier() { return randomBytes(32).toString('base64url') }
function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}
function digest(value) { return createHash('sha256').update(value).digest('base64url') }

function accountTotp(account) {
  return account?.totp ?? { enabled: false, version: 0, secret: null, changedAt: null }
}

function authenticationSource(value) {
  if (typeof value?.authenticationSource === 'string'
    && /^[A-Za-z0-9:_-]{1,128}$/.test(value.authenticationSource)) return value.authenticationSource
  const ip = value?.client?.ip
  return typeof ip === 'string' && ip.length > 0 && ip.length <= 128
    ? `ip:${digest(ip)}` : 'unknown'
}

function enforceAuthenticationRetry(retry) {
  if (retry?.retryAfterSeconds <= 0) return
  throw new AccessError(
    'AUTHENTICATION_RETRY_REQUIRED',
    `authentication retry is available in ${retry.retryAfterSeconds} seconds`,
    429,
    { retryAfterSeconds: retry.retryAfterSeconds },
  )
}

function releaseAuthentication(admission, authenticated) {
  const retry = admission.release(authenticated)
  if (!authenticated) enforceAuthenticationRetry(retry)
}

function normalizeManagementAccess(mode, entry) {
  if (!['compat', 'isolated'].includes(mode)) throw new AccessError('ACCESS_MODE_INVALID', 'management access mode is invalid')
  if (mode === 'compat') return null
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
    || !['local-only', 'public'].includes(entry.kind)) {
    throw new AccessError('ACCESS_ENTRY_INVALID', 'isolated Management entry is invalid')
  }
  if (entry.kind === 'local-only') {
    try {
      const origin = entry.managementLocalOrigin
      const parsed = new URL(origin)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin
        || !isLoopbackHostname(parsed.hostname)) throw new Error('not loopback')
      return { kind: 'local-only', managementLocalOrigin: parsed.origin }
    } catch { throw new AccessError('ACCESS_ENTRY_INVALID', 'local Management origin is invalid') }
  }
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

function send(response, status, value, headers = {}) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    ...headers,
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
    totp: {
      enabled: accountTotp(account).enabled,
      version: accountTotp(account).version,
    },
    managementAccess: { ...account.managementAccess },
  }
}

export class AccessService {
  constructor({
    store,
    classificationToken,
    limiter = new AuthenticationLimiter(),
    sessions = null,
    exchanges = new ManagementExchangeStore(),
    capabilities = new CapabilityStore(),
    transitions,
    totpFlows,
    totpLimiter,
    verifyTotp = verifyTotpCode,
    verify = verifyCredential,
    report = async () => {},
    now = () => Date.now(),
    runtimeCapabilities = detectRuntimeCapabilities,
    authenticationEpoch = identifier(),
  }) {
    this.store = store
    this.classificationToken = classificationToken
    this.limiter = limiter
    this.sessions = sessions ?? new BrowserSessionStore()
    this.exchanges = exchanges
    this.capabilities = capabilities
    this.transitions = transitions ?? new ManagementTransitionStore({ now })
    this.totpFlows = totpFlows ?? new TotpFlowStore({ now })
    this.totpLimiter = totpLimiter ?? new TotpRetryLimiter({ now })
    this.verifyTotp = verifyTotp
    this.verify = verify
    this.report = report
    this.sessions.setEventSink?.((message, fields) => {
      void Promise.resolve(this.report(message, fields)).catch(() => {})
    })
    this.now = now
    this.runtimeCapabilities = runtimeCapabilities
    this.authenticationEpoch = authenticationEpoch
    this.authenticationReset = null
    this.transition = Promise.resolve()
  }

  authenticationContext(current) {
    const revision = current.account?.revision ?? current.initialization?.instanceId ?? current.state
    return `${this.authenticationEpoch}.${revision}`
  }

  requireAuthenticationContext(value, current) {
    if (!sameToken(value.authenticationContext, this.authenticationContext(current))) {
      throw new AccessError('AUTHENTICATION_CONTEXT_STALE', 'authentication context is stale', 409)
    }
  }

  serialized(operation) {
    const pending = this.transition.then(operation, operation)
    this.transition = pending.catch(() => {})
    return pending
  }

  reconcileRuntimePolicy() {
    return this.serialized(async () => {
      const [current, runtimeCapabilities] = await Promise.all([
        this.store.state(),
        this.runtimeCapabilities(),
      ])
      if (current.state !== 'initialized' || current.account === undefined
        || runtimeCapabilities.dshRootCapabilityEffective !== true
        || current.account.managementAccess.mode === 'compat') {
        return { changed: false, account: publicAccount(current.account), ...runtimeCapabilities }
      }
      const changedAt = new Date(this.now()).toISOString()
      const account = {
        ...current.account,
        revision: identifier(),
        updatedAt: changedAt,
        managementAccess: {
          mode: 'compat',
          version: current.account.managementAccess.version + 1,
          isolatedEntry: null,
          dshPublicOrigin: null,
          changedAt,
        },
      }
      const next = await this.store.replaceAccount(account, current.account.revision)
      const revokedSessions = this.sessions.revokeAll()
      this.exchanges.clear?.()
      await this.report('access.management-origin.reconciled', {
        mode: 'compat', reason: 'dsh-root-capability', revokedSessions,
      })
      return { changed: true, account: publicAccount(next), ...runtimeCapabilities }
    })
  }

  async status() {
    const current = await this.store.state()
    const capabilities = await this.runtimeCapabilities()
    return {
      componentReady: true,
      state: current.state,
      instanceId: current.initialization?.instanceId ?? null,
      authenticationContext: this.authenticationContext(current),
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
      const session = this.sessions.issue('dsh', account, {
        origin: value.origin,
        client: value.client,
        authenticationSource: authenticationSource(value),
      })
      await this.report('access.initialization.completed', { accountId: account.accountId })
      await this.report('access.session.created', { accountId: account.accountId, kind: 'dsh' })
      return { state: 'initialized', account: publicAccount(account), session }
    })
  }

  generateAuthenticationResetKey() {
    return this.serialized(async () => {
      const current = await this.store.state()
      if (!['migration-required', 'recovery-required'].includes(current.state)) {
        throw new AccessError('AUTHENTICATION_RESET_UNAVAILABLE', 'administrator authentication reset is unavailable', 409)
      }
      const key = `dshak_${identifier()}`
      this.authenticationReset = { digest: digest(key), expiresAt: this.now() + 10 * 60 * 1000 }
      await this.report('access.authentication-reset-key.generated', { state: current.state })
      return { key, expiresAt: new Date(this.authenticationReset.expiresAt).toISOString() }
    })
  }

  resetDshAuthentication(value) {
    return this.serialized(async () => {
      const setup = this.authenticationReset
      if (setup === null || setup.expiresAt <= this.now() || typeof value.setupKey !== 'string'
        || !sameToken(setup.digest, digest(value.setupKey))) {
        if (setup !== null && setup.expiresAt <= this.now()) this.authenticationReset = null
        throw new AccessError('AUTHENTICATION_RESET_KEY_INVALID', 'authentication reset key is invalid or expired', 401)
      }
      const current = await this.store.state()
      let account
      if (current.state === 'migration-required') account = await this.store.migrate(value)
      else if (current.state === 'recovery-required') account = await this.store.recover(value)
      else throw new AccessError('AUTHENTICATION_RESET_UNAVAILABLE', 'administrator authentication reset is unavailable', 409)
      this.authenticationReset = null
      const session = this.sessions.issue('dsh', account, {
        origin: value.origin,
        client: value.client,
        authenticationSource: authenticationSource(value),
      })
      await this.report('access.authentication-reset.completed', { accountId: account.accountId, previousState: current.state })
      return { state: 'initialized', account: publicAccount(account), session }
    })
  }

  async authenticate(value, suppliedCurrent) {
    const current = suppliedCurrent ?? await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const admission = this.limiter.enter(current.account.accountId, authenticationSource(value))
    let authenticated = false
    try {
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
    } finally { releaseAuthentication(admission, authenticated) }
  }

  async verifyFreshAuthentication(account, mainPassword, sourceId = 'unknown') {
    const mainMatches = typeof mainPassword === 'string'
      && await this.verify(mainPassword, account.mainCredential)
    if (!mainMatches) {
      await this.report('access.fresh-authentication.failed', { accountId: account.accountId, level: 'warning' })
      throw new AccessError('FRESH_AUTH_FAILED', 'current administrator credentials are incorrect', 401)
    }
    await this.report('access.fresh-authentication.succeeded', { accountId: account.accountId })
  }


  async loginDsh(value) {
    const current = await this.store.state()
    this.requireAuthenticationContext(value, current)
    const authenticated = await this.authenticate(value, current)
    if (accountTotp(current.account).enabled) {
      const challenge = this.totpFlows.createLogin(current.account, {
        origin: value.origin,
        client: value.client,
        authenticationSource: authenticationSource(value),
      })
      return { ...authenticated, totpRequired: true, challenge }
    }
    const session = this.sessions.issue('dsh', current.account, {
      origin: value.origin,
      client: value.client,
      authenticationSource: authenticationSource(value),
    })
    await this.report('access.session.created', { accountId: authenticated.accountId, kind: 'dsh' })
    return { ...authenticated, session }
  }

  async verifyTotpAuthentication(account, code, source, secret = accountTotp(account).secret) {
    const currentRetry = this.totpLimiter.retry(account.accountId, source)
    if (currentRetry.retryAfterSeconds > 0) {
      throw new AccessError(
        currentRetry.kind === 'rate' ? 'TOTP_RATE_LIMITED' : 'TOTP_RETRY_REQUIRED',
        currentRetry.kind === 'rate'
          ? 'too many two-factor authentication attempts'
          : 'two-factor authentication retry is required',
        429,
        { retryAfterSeconds: currentRetry.retryAfterSeconds },
      )
    }
    const valid = this.verifyTotp(code, secret, { now: this.now() })
    if (!valid) {
      const retry = this.totpLimiter.fail(account.accountId, source)
      await this.report('access.totp.failed', { accountId: account.accountId, level: 'warning' })
      if (retry.retryAfterSeconds > 0) {
        throw new AccessError(
          retry.kind === 'rate' ? 'TOTP_RATE_LIMITED' : 'TOTP_RETRY_REQUIRED',
          retry.kind === 'rate'
            ? 'too many two-factor authentication attempts'
            : 'two-factor authentication retry is required',
          429,
          { retryAfterSeconds: retry.retryAfterSeconds },
        )
      }
      throw new AccessError('TOTP_INVALID', 'two-factor authentication code is invalid', 401)
    }
    this.totpLimiter.succeed(account.accountId, source)
    await this.report('access.totp.succeeded', { accountId: account.accountId })
  }

  async completeDshTotp(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined || !accountTotp(current.account).enabled) {
      throw new AccessError('TOTP_LOGIN_INVALID', 'two-factor authentication login is invalid or expired', 401)
    }
    this.requireAuthenticationContext(value, current)
    const pending = this.totpFlows.login(value.challengeToken, current.account)
    if (pending === undefined || pending.value.origin !== value.origin
      || pending.value.authenticationSource !== authenticationSource(value)) {
      throw new AccessError('TOTP_LOGIN_INVALID', 'two-factor authentication login is invalid or expired', 401)
    }
    await this.verifyTotpAuthentication(
      current.account,
      value.code,
      pending.value.authenticationSource,
    )
    this.totpFlows.consumeLogin(pending.key)
    const session = this.sessions.issue('dsh', current.account, {
      origin: pending.value.origin,
      client: pending.value.client,
      authenticationSource: pending.value.authenticationSource,
    })
    await this.report('access.session.created', { accountId: current.account.accountId, kind: 'dsh' })
    return { authenticated: true, session }
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

  async logoutDshBrowser(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    if (!['management', 'all'].includes(value.scope)) {
      throw new AccessError('SESSION_ACTION_INVALID', 'session action is invalid')
    }
    const session = this.sessions.validate(value.dshToken, 'dsh', current.account, {
      origin: value.dshOrigin,
      touch: false,
    })
    if (session === undefined) throw new AccessError('SESSION_INVALID', 'DSH session is invalid', 401)
    let managementRevoked = this.sessions.revokeManagementFromDsh(session.sessionId)
    if (typeof value.managementToken === 'string' && this.sessions.revoke(value.managementToken)) {
      managementRevoked += 1
    }
    const dshRevoked = value.scope === 'all' && this.sessions.revoke(value.dshToken)
    await this.report('access.browser-sessions.logged-out', {
      scope: value.scope,
      dshRevoked,
      managementRevoked,
    })
    return { authenticated: value.scope !== 'all', dshRevoked, managementRevoked }
  }

  async managementResult(account, { origin, sourceDshOrigin, sourceDshSessionId }) {
    if (account.managementAdditionalCredential.enabled) {
      return { pending: this.exchanges.createPending(account, { targetOrigin: origin, sourceDshOrigin, sourceDshSessionId }) }
    }
    const session = this.sessions.issue('management', account, { origin, sourceDshOrigin, sourceDshSessionId })
    await this.report('access.session.created', { accountId: account.accountId, kind: 'management' })
    return { session }
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
    const source = this.sessions.details(handoff.dshSessionId)
    if (source?.kind !== 'dsh' || source.origin !== handoff.sourceDshOrigin) {
      throw new AccessError('HANDOFF_INVALID', 'management handoff is invalid or expired', 401)
    }
    await this.report('access.handoff.consumed', { accountId: current.account.accountId })
    return this.managementResult(current.account, {
      origin: value.origin,
      sourceDshOrigin: handoff.sourceDshOrigin,
      sourceDshSessionId: handoff.dshSessionId,
    })
  }

  async completeManagementLogin(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('PENDING_LOGIN_INVALID', 'management login is invalid or expired', 401)
    }
    this.requireAuthenticationContext(value, current)
    if (!current.account.managementAdditionalCredential.enabled) {
      throw new AccessError('PENDING_LOGIN_INVALID', 'management login is invalid or expired', 401)
    }
    const source = this.sessions.details(
      this.exchanges.peekPendingSource(value.pendingToken, current.account, value.origin) ?? '',
    )
    const sourceId = source?.authenticationSource ?? 'unknown'
    this.limiter.checkRetry(current.account.accountId, sourceId, 'management')
    const pending = this.exchanges.inspectPending(value.pendingToken, current.account, value.origin)
    if (pending === undefined) throw new AccessError('PENDING_LOGIN_INVALID', 'management login is invalid or expired', 401)
    const validatedSource = this.sessions.details(pending.value.sourceDshSessionId)
    if (validatedSource?.kind !== 'dsh' || validatedSource.origin !== pending.value.sourceDshOrigin) {
      this.exchanges.consumePending(pending.key)
      throw new AccessError('PENDING_LOGIN_INVALID', 'management login is invalid or expired', 401)
    }
    const admission = this.limiter.enter(current.account.accountId, sourceId, 'management')
    let valid = false
    try {
      valid = await this.verify(value.password, current.account.managementAdditionalCredential.verifier)
      if (!valid) {
        await this.report('access.authentication.failed', {
          accountId: current.account.accountId, kind: 'management', level: 'warning',
        })
        throw new AccessError('AUTHENTICATION_FAILED', 'username or password is incorrect', 401)
      }
      await this.report('access.authentication.succeeded', {
        accountId: current.account.accountId, kind: 'management',
      })
    } finally { releaseAuthentication(admission, valid) }
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

  async issuePluginCapability(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const session = this.sessions.validate(value.dshToken, 'dsh', current.account, {
      origin: value.origin,
      csrfToken: value.csrfToken,
      requireCsrf: value.requireCsrf === true,
      touch: false,
    })
    if (session === undefined) throw new AccessError('SESSION_INVALID', 'DSH session is invalid', 401)
    return {
      capability: this.capabilities.issue(session, current.account, {
        audience: 'plugin', method: value.method, target: value.target,
      }),
    }
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

  async beginTotpEnrollment(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const authorization = this.consumeInternalCapability(value, current.account)
    if (accountTotp(current.account).enabled) {
      throw new AccessError('TOTP_ALREADY_ENABLED', 'two-factor authentication is already enabled', 409)
    }
    const username = value.username === undefined ? current.account.username : normalizeUsername(value.username)
    const enrollment = this.totpFlows.createEnrollment(current.account, authorization.sessionId)
    await this.report('access.totp.enrollment.created', { accountId: current.account.accountId })
    return {
      enrollmentToken: enrollment.token,
      secret: enrollment.secret,
      uri: totpUri({ secret: enrollment.secret, username }),
      expiresAt: enrollment.expiresAt,
    }
  }

  async cancelTotpEnrollment(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const authorization = this.consumeInternalCapability(value, current.account)
    const canceled = this.totpFlows.cancelEnrollment(value.enrollmentToken, current.account, authorization.sessionId)
    if (canceled) await this.report('access.totp.enrollment.canceled', { accountId: current.account.accountId })
    return { canceled }
  }

  async confirmTotpEnrollment(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const authorization = this.consumeInternalCapability(value, current.account)
    const enrollment = this.totpFlows.enrollment(value.enrollmentToken, current.account, authorization.sessionId)
    if (enrollment === undefined) {
      throw new AccessError('TOTP_ENROLLMENT_INVALID', 'two-factor authentication enrollment is invalid or expired', 401)
    }
    const managementSession = this.sessions.details(authorization.sessionId)
    const sourceSession = this.sessions.details(managementSession?.sourceDshSessionId)
    await this.verifyTotpAuthentication(
      current.account,
      value.totpCode,
      sourceSession?.authenticationSource ?? 'unknown',
      enrollment.value.secret,
    )
    if (!this.totpFlows.confirmEnrollment(enrollment.key)) {
      throw new AccessError('TOTP_ENROLLMENT_INVALID', 'two-factor authentication enrollment is invalid or expired', 401)
    }
    await this.report('access.totp.enrollment.confirmed', { accountId: current.account.accountId })
    return { confirmed: true, expiresAt: new Date(enrollment.value.expiresAt).toISOString() }
  }

  async beginTotpDisableConfirmation(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const authorization = this.consumeInternalCapability(value, current.account)
    if (!accountTotp(current.account).enabled) {
      throw new AccessError('TOTP_NOT_ENABLED', 'two-factor authentication is not enabled', 409)
    }
    const confirmation = this.totpFlows.createDisableConfirmation(current.account, authorization.sessionId)
    await this.report('access.totp.disable-confirmation.created', { accountId: current.account.accountId })
    return { confirmationToken: confirmation.token, expiresAt: confirmation.expiresAt }
  }

  async cancelTotpDisableConfirmation(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const authorization = this.consumeInternalCapability(value, current.account)
    const canceled = this.totpFlows.cancelDisableConfirmation(
      value.confirmationToken,
      current.account,
      authorization.sessionId,
    )
    if (canceled) await this.report('access.totp.disable-confirmation.canceled', { accountId: current.account.accountId })
    return { canceled }
  }

  async confirmTotpDisable(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const authorization = this.consumeInternalCapability(value, current.account)
    const confirmation = this.totpFlows.disableConfirmation(
      value.confirmationToken,
      current.account,
      authorization.sessionId,
    )
    if (confirmation === undefined) {
      throw new AccessError('TOTP_DISABLE_CONFIRMATION_INVALID', 'two-factor disable confirmation is invalid or expired', 401)
    }
    const managementSession = this.sessions.details(authorization.sessionId)
    const sourceSession = this.sessions.details(managementSession?.sourceDshSessionId)
    await this.verifyTotpAuthentication(
      current.account,
      value.totpCode,
      sourceSession?.authenticationSource ?? 'unknown',
    )
    if (!this.totpFlows.confirmDisable(confirmation.key)) {
      throw new AccessError('TOTP_DISABLE_CONFIRMATION_INVALID', 'two-factor disable confirmation is invalid or expired', 401)
    }
    await this.report('access.totp.disable-confirmation.confirmed', { accountId: current.account.accountId })
    return { confirmed: true, expiresAt: new Date(confirmation.value.expiresAt).toISOString() }
  }

  async revokeBrowserSessions(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const authorization = this.consumeInternalCapability(value, current.account)
    if (typeof value.sessionId !== 'string' || value.sessionId.length === 0 || value.sessionId.length > 128) {
      throw new AccessError('SESSION_ACTION_INVALID', 'session action is invalid')
    }
    const currentDshSessionId = this.sessions.sourceDshSessionId(authorization.sessionId)
    const revoked = this.sessions.revokeDshSession(value.sessionId, current.account.accountId)
    if (!revoked) throw new AccessError('SESSION_NOT_FOUND', 'browser session was not found', 404)
    const currentSessionRevoked = value.sessionId === currentDshSessionId
    await this.report('access.sessions.revoked', { sessionId: value.sessionId, currentSessionRevoked })
    return { revoked: 1, currentSessionRevoked }
  }

  async recoveryStatus() {
    const current = await this.store.state()
    return {
      state: current.state,
      authenticationRetry: current.account === undefined
        ? null : this.limiter.status(current.account.accountId),
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

  async clearAuthenticationRetry(value = {}) {
    const current = await this.store.state()
    if (current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator account is unavailable', 409)
    }
    const scope = value.scope ?? 'all'
    const credential = value.credential ?? 'all'
    if (!['all', 'global'].includes(scope)) {
      throw new AccessError('REQUEST_INVALID', 'authentication retry clear scope is invalid')
    }
    if (!['all', 'main', 'management', 'totp'].includes(credential)) {
      throw new AccessError('REQUEST_INVALID', 'authentication retry credential is invalid')
    }
    let result
    if (credential === 'totp') {
      result = this.totpLimiter.clearDailyLimits(current.account.accountId, { globalOnly: scope === 'global' })
    }
    else if (credential === 'all') {
      const passwordResult = scope === 'global'
        ? this.limiter.clearGlobal('all')
        : this.limiter.clear(current.account.accountId, 'all')
      const totpResult = this.totpLimiter.clearDailyLimits(current.account.accountId, { globalOnly: scope === 'global' })
      result = { ...passwordResult, twoFactorDailyCleared: totpResult.cleared }
    } else {
      result = scope === 'global'
        ? this.limiter.clearGlobal(credential)
        : this.limiter.clear(current.account.accountId, credential)
    }
    await this.report('access.authentication-retry.cleared', {
      accountId: current.account.accountId,
      scope,
      credential,
      cleared: result.cleared,
    })
    return { status: 'cleared', scope, credential, ...result }
  }

  async authenticationRetryStatus(value = {}) {
    const current = await this.store.state()
    if (current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator account is unavailable', 409)
    }
    if (value.credential !== 'totp' || typeof value.source !== 'string'
      || value.source.length === 0 || value.source.length > 128) {
      throw new AccessError('REQUEST_INVALID', 'authentication retry status request is invalid')
    }
    return this.totpLimiter.retry(current.account.accountId, value.source)
  }

  async replaceRecoveryAccount(value, operation, { revoke = 'none', auditOperation } = {}) {
    const current = await this.store.state()
    if (current.account === undefined) throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator account is unavailable', 409)
    if (value.revision !== current.account.revision) throw new AccessError('REVISION_CONFLICT', 'account revision changed', 409)
    const account = { ...current.account, revision: identifier(), updatedAt: new Date().toISOString() }
    await operation(account, current.account)
    const next = await this.store.replaceAccount(account, current.account.revision)
    const managementSessionsBefore = this.sessions.countKind?.('management') ?? 0
    const allSessionsRevoked = revoke === 'all'
    const managementSessionsRevoked = revoke === 'management'
      ? this.sessions.revokeKind('management')
      : allSessionsRevoked ? managementSessionsBefore : 0
    if (allSessionsRevoked) this.sessions.revokeAll()
    if (allSessionsRevoked) this.exchanges.clear?.()
    const result = {
      account: publicAccount(next),
      currentManagementSessionRevoked: managementSessionsRevoked > 0,
      managementSessionsRevoked,
      allSessionsRevoked,
    }
    await this.report('access.recovery-account.changed', {
      operation: auditOperation,
      managementSessionsRevoked,
      allSessionsRevoked,
    })
    return result
  }

  async setRecoveryUsername(value) {
    const normalized = normalizeUsername(value.username)
    return this.replaceRecoveryAccount(value, async account => { account.username = normalized }, {
      auditOperation: 'set-username',
    })
  }

  async resetRecoveryPassword(value) {
    const verifier = await this.store.createVerifier(value.password)
    return this.replaceRecoveryAccount(value, async account => {
      account.mainCredential = { ...verifier, version: account.mainCredential.version + 1 }
    }, { revoke: 'all', auditOperation: 'reset-password' })
  }

  async resetRecoveryAccess(value) {
    const action = value.managementPasswordAction
    if (!['preserve', 'disable', 'reset'].includes(action)) {
      throw new AccessError('REQUEST_INVALID', 'management password action is invalid')
    }
    const username = value.username === undefined ? null : normalizeUsername(value.username)
    const mainPassword = value.password === undefined ? null : normalizePassword(value.password)
    const managementPassword = action === 'reset' ? normalizePassword(value.managementPassword) : null
    if (username === null && mainPassword === null && action === 'preserve') {
      throw new AccessError('REQUEST_INVALID', 'no access changes were selected')
    }
    if (managementPassword !== null && mainPassword !== null && managementPassword === mainPassword) {
      throw new AccessError('PASSWORDS_MUST_DIFFER', 'main and Management console passwords must differ')
    }
    const revoke = mainPassword !== null ? 'all' : action === 'preserve' ? 'none' : 'management'
    return this.replaceRecoveryAccount(value, async (account, current) => {
      if (managementPassword !== null && mainPassword === null
        && await verifyCredential(managementPassword, current.mainCredential)) {
        throw new AccessError('PASSWORDS_MUST_DIFFER', 'main and Management console passwords must differ')
      }
      if (username !== null) account.username = username
      if (mainPassword !== null) {
        const verifier = await this.store.createVerifier(mainPassword)
        account.mainCredential = { ...verifier, version: account.mainCredential.version + 1 }
      }
      if (action === 'preserve') return
      const version = account.managementAdditionalCredential.version + 1
      account.managementAdditionalCredential = action === 'disable'
        ? { enabled: false, version, verifier: null, changedAt: new Date().toISOString() }
        : {
            enabled: true,
            version,
            verifier: { ...await this.store.createVerifier(managementPassword), version },
            changedAt: new Date().toISOString(),
          }
    }, { revoke, auditOperation: 'reset-access' })
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
    }, { revoke: 'management', auditOperation: 'reset-management-password' })
  }

  async disableRecoveryManagementPassword(value) {
    return this.replaceRecoveryAccount(value, async account => {
      account.managementAdditionalCredential = {
        enabled: false,
        version: account.managementAdditionalCredential.version + 1,
        verifier: null,
        changedAt: new Date().toISOString(),
      }
    }, { revoke: 'management', auditOperation: 'disable-management-password' })
  }

  async createManagementTransition(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const authorization = this.consumeInternalCapability(value, current.account)
    const session = this.sessions.details(authorization.sessionId)
    if (session?.kind !== 'management') throw new AccessError('SESSION_INVALID', 'Management session is invalid', 401)
    const runtimeCapabilities = await this.runtimeCapabilities()
    if (runtimeCapabilities.dshRootCapabilityEffective === true
      && value.mode !== current.account.managementAccess.mode) {
      throw new AccessError('ACCESS_MODE_LOCKED', 'Management access mode cannot change while DSH Root capability is enabled', 409)
    }
    const isolatedEntry = normalizeManagementAccess(value.mode, value.mode === 'isolated'
      && value.isolatedEntry?.kind === 'local-only'
      ? { ...value.isolatedEntry, managementLocalOrigin: value.isolatedEntry.managementLocalOrigin ?? value.candidateOrigin }
      : value.isolatedEntry)
    const candidateOrigin = value.mode === 'isolated'
      ? (() => {
          if (isolatedEntry.kind === 'public') return isolatedEntry.managementPublicOrigin
          try {
            const parsed = new URL(value.candidateOrigin)
            if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value.candidateOrigin
              || !isLoopbackHostname(parsed.hostname)) throw new Error('not loopback')
            return parsed.origin
          } catch { throw new AccessError('ACCESS_ENTRY_INVALID', 'local Management origin is invalid') }
        })()
      : null
    const transition = this.transitions.create({
      account: current.account,
      instanceId: current.initialization.instanceId,
      sessionId: authorization.sessionId,
      sourceOrigin: session.origin,
      sourceDshOrigin: session.sourceDshOrigin,
      sourceDshSessionId: session.sourceDshSessionId,
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
      const sourceDshSession = this.sessions.details(transition.sourceDshSessionId)
      if (sourceDshSession?.kind !== 'dsh' || sourceDshSession.origin !== transition.sourceDshOrigin) {
        throw new AccessError('SESSION_INVALID', 'source DSH session is invalid', 401)
      }
      const account = {
        ...current.account,
        revision: identifier(),
        updatedAt: new Date().toISOString(),
        managementAccess: {
          mode: transition.mode,
          version: current.account.managementAccess.version + 1,
          isolatedEntry: transition.isolatedEntry,
          dshPublicOrigin: transition.mode === 'isolated' ? transition.sourceDshOrigin : null,
          changedAt: new Date().toISOString(),
        },
      }
      const next = await this.store.replaceAccount(account, current.account.revision)
      this.sessions.refreshDshSession(transition.sourceDshSessionId, next)
      const targetOrigin = transition.mode === 'isolated'
        ? (transition.isolatedEntry.kind === 'public' ? transition.candidateOrigin : null)
        : transition.sourceDshOrigin
      const continuation = this.transitions.createContinuation({
        account: next,
        targetOrigin,
        sourceDshOrigin: transition.sourceDshOrigin,
        sourceDshSessionId: transition.sourceDshSessionId,
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
    const source = this.sessions.details(continuation.sourceDshSessionId)
    if (source?.kind !== 'dsh' || source.origin !== continuation.sourceDshOrigin) {
      throw new AccessError('CONTINUATION_INVALID', 'Management continuation is invalid or expired', 401)
    }
    const session = this.sessions.issue('management', current.account, {
      origin: value.origin,
      sourceDshOrigin: continuation.sourceDshOrigin,
      sourceDshSessionId: continuation.sourceDshSessionId,
    })
    await this.report('access.management-continuation.consumed')
    return { session }
  }

  async updateAuthenticationSettings(value) {
    const current = await this.store.state()
    if (current.state !== 'initialized' || current.account === undefined) {
      throw new AccessError('ACCESS_NOT_INITIALIZED', 'administrator access is not initialized', 409)
    }
    const authorization = this.consumeInternalCapability(value, current.account)
    const account = { ...current.account, revision: identifier(), updatedAt: new Date().toISOString() }
    const usernameChanged = value.username !== undefined && normalizeUsername(value.username) !== current.account.username
    const mainPasswordChanged = value.password !== undefined
    const additionalChanged = value.additionalPassword !== undefined
      || (value.additionalEnabled !== undefined
        && value.additionalEnabled !== current.account.managementAdditionalCredential.enabled)
    if (value.totpEnabled !== undefined && typeof value.totpEnabled !== 'boolean') {
      throw new AccessError('REQUEST_INVALID', 'two-factor authentication setting is invalid')
    }
    const totpChanged = value.totpEnabled !== undefined
      && value.totpEnabled !== accountTotp(current.account).enabled
    if (value.mode !== undefined || value.isolatedEntry !== undefined) {
      throw new AccessError('TRANSITION_REQUIRED', 'Management access changes require a verified transition', 409)
    }
    if (!usernameChanged && !mainPasswordChanged && !additionalChanged && !totpChanged) {
      return {
        account: publicAccount(current.account),
        changed: false,
        currentManagementSessionRevoked: false,
        managementSessionsRevoked: 0,
        allSessionsRevoked: false,
      }
    }
    const managementSession = this.sessions.details(authorization.sessionId)
    const sourceSession = this.sessions.details(managementSession?.sourceDshSessionId)
    const authenticationSourceId = sourceSession?.authenticationSource ?? 'unknown'
    if (mainPasswordChanged || additionalChanged || totpChanged) {
      await this.verifyFreshAuthentication(
        current.account,
        value.currentPassword,
        authenticationSourceId,
      )
    }
    let enrollment
    let disableConfirmation
    if (totpChanged && value.totpEnabled === true) {
      enrollment = this.totpFlows.enrollment(value.totpEnrollmentToken, current.account, authorization.sessionId)
      if (enrollment === undefined) {
        throw new AccessError('TOTP_ENROLLMENT_INVALID', 'two-factor authentication enrollment is invalid or expired', 401)
      }
      if (enrollment.value.confirmed !== true) {
        throw new AccessError('TOTP_ENROLLMENT_UNCONFIRMED', 'two-factor authentication enrollment is not confirmed', 409)
      }
    } else if (totpChanged) {
      disableConfirmation = this.totpFlows.disableConfirmation(
        value.totpDisableConfirmationToken,
        current.account,
        authorization.sessionId,
      )
      if (disableConfirmation === undefined) {
        throw new AccessError('TOTP_DISABLE_CONFIRMATION_INVALID', 'two-factor disable confirmation is invalid or expired', 401)
      }
      if (disableConfirmation.value.confirmed !== true) {
        throw new AccessError('TOTP_DISABLE_CONFIRMATION_UNCONFIRMED', 'two-factor disable confirmation is not confirmed', 409)
      }
    }
    if (value.username !== undefined) account.username = normalizeUsername(value.username)
    if (value.password !== undefined) {
      if (current.account.managementAdditionalCredential.enabled
        && value.additionalPassword === undefined
        && await this.verify(value.password, current.account.managementAdditionalCredential.verifier)) {
        throw new AccessError('PASSWORDS_MUST_DIFFER', 'main and Management console passwords must differ')
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
        if (typeof value.additionalPassword !== 'string') throw new AccessError('PASSWORD_REQUIRED', 'Management console password is required')
        const equalsMain = value.password !== undefined
          ? normalizePassword(value.additionalPassword) === normalizePassword(value.password)
          : await this.verify(value.additionalPassword, current.account.mainCredential)
        if (equalsMain) throw new AccessError('PASSWORDS_MUST_DIFFER', 'main and Management console passwords must differ')
        const verifier = await this.store.createVerifier(value.additionalPassword)
        account.managementAdditionalCredential = {
          enabled: true,
          version: current.account.managementAdditionalCredential.version + 1,
          verifier: { ...verifier, version: current.account.managementAdditionalCredential.version + 1 },
          changedAt: new Date().toISOString(),
        }
      } else if (!current.account.managementAdditionalCredential.enabled) {
        throw new AccessError('PASSWORD_REQUIRED', 'Management console password is required')
      }
    }
    if (totpChanged) {
      const version = accountTotp(current.account).version + 1
      account.totp = value.totpEnabled
        ? { enabled: true, version, secret: enrollment.value.secret, changedAt: new Date().toISOString() }
        : { enabled: false, version, secret: null, changedAt: new Date().toISOString() }
    }
    const next = await this.store.replaceAccount(account, current.account.revision)
    if (enrollment !== undefined) this.totpFlows.consumeEnrollment(enrollment.key)
    if (disableConfirmation !== undefined) this.totpFlows.consumeDisableConfirmation(disableConfirmation.key)
    const allSessionsRevoked = mainPasswordChanged
    const revokedSessionCount = allSessionsRevoked
      ? this.sessions.revokeAll()
      : additionalChanged ? this.sessions.revokeKind('management') : 0
    this.exchanges.clear?.()
    if (allSessionsRevoked) this.totpFlows.clear()
    await this.report('access.authentication.settings.changed', { usernameChanged })
    return {
      account: publicAccount(next),
      changed: true,
      currentManagementSessionRevoked: allSessionsRevoked || additionalChanged,
      managementSessionsRevoked: allSessionsRevoked || additionalChanged ? revokedSessionCount : 0,
      allSessionsRevoked,
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
        if (request.method === 'POST' && pathname === '/v1/recovery/reset-access') return send(response, 200, await service.resetRecoveryAccess(value))
        if (request.method === 'POST' && pathname === '/v1/recovery/reset-password') return send(response, 200, await service.resetRecoveryPassword(value))
        if (request.method === 'POST' && pathname === '/v1/recovery/reset-management-password') return send(response, 200, await service.resetRecoveryManagementPassword(value))
        if (request.method === 'POST' && pathname === '/v1/recovery/disable-management-password') return send(response, 200, await service.disableRecoveryManagementPassword(value))
        if (request.method === 'POST' && pathname === '/v1/recovery/generate-key') return send(response, 201, await service.generateAuthenticationResetKey())
        if (request.method === 'POST' && pathname === '/v1/recovery/clear-retry') return send(response, 200, await service.clearAuthenticationRetry(value))
        return send(response, 404, { error: 'not found', code: 'NOT_FOUND' })
      }
      const value = await body(request)
      if (request.method === 'POST' && pathname === '/v1/classify') return send(response, 200, await service.classify(value))
      if (request.method === 'POST' && pathname === '/v1/initialize') return send(response, 201, await service.initialize(value))
      if (request.method === 'POST' && pathname === '/v1/authenticate') return send(response, 200, await service.authenticate(value))
      if (request.method === 'POST' && pathname === '/v1/dsh/initialize') return send(response, 201, await service.initializeDsh(value))
      if (request.method === 'POST' && pathname === '/v1/dsh/reset-authentication') return send(response, 201, await service.resetDshAuthentication(value))
      if (request.method === 'POST' && pathname === '/v1/dsh/login') return send(response, 200, await service.loginDsh(value))
      if (request.method === 'POST' && pathname === '/v1/dsh/totp/complete') return send(response, 200, await service.completeDshTotp(value))
      if (request.method === 'POST' && pathname === '/v1/authentication-retry/status') return send(response, 200, await service.authenticationRetryStatus(value))
      if (request.method === 'POST' && pathname === '/v1/sessions/validate') return send(response, 200, await service.validateSession(value))
      if (request.method === 'POST' && pathname === '/v1/sessions/logout') return send(response, 200, await service.logout(value))
      if (request.method === 'POST' && pathname === '/v1/dsh/browser-logout') return send(response, 200, await service.logoutDshBrowser(value))
      if (request.method === 'POST' && pathname === '/v1/management/handoffs') return send(response, 201, await service.createManagementHandoff(value))
      if (request.method === 'POST' && pathname === '/v1/management/handoffs/consume') return send(response, 200, await service.consumeManagementHandoff(value))
      if (request.method === 'POST' && pathname === '/v1/management/pending/complete') return send(response, 200, await service.completeManagementLogin(value))
      if (request.method === 'POST' && pathname === '/v1/capabilities') return send(response, 201, await service.issueCapability(value))
      if (request.method === 'POST' && pathname === '/v1/dsh/capabilities') return send(response, 201, await service.issuePluginCapability(value))
      if (request.method === 'POST' && pathname === '/v1/capabilities/consume') return send(response, 200, await service.consumeCapability(value))
      if (request.method === 'POST' && pathname === '/v1/management/settings') return send(response, 200, await service.authenticationSettings(value))
      if (request.method === 'POST' && pathname === '/v1/management/totp/enrollments') return send(response, 201, await service.beginTotpEnrollment(value))
      if (request.method === 'POST' && pathname === '/v1/management/totp/enrollments/confirm') return send(response, 200, await service.confirmTotpEnrollment(value))
      if (request.method === 'POST' && pathname === '/v1/management/totp/enrollments/cancel') return send(response, 200, await service.cancelTotpEnrollment(value))
      if (request.method === 'POST' && pathname === '/v1/management/totp/disable-confirmations') return send(response, 201, await service.beginTotpDisableConfirmation(value))
      if (request.method === 'POST' && pathname === '/v1/management/totp/disable-confirmations/confirm') return send(response, 200, await service.confirmTotpDisable(value))
      if (request.method === 'POST' && pathname === '/v1/management/totp/disable-confirmations/cancel') return send(response, 200, await service.cancelTotpDisableConfirmation(value))
      if (request.method === 'POST' && pathname === '/v1/management/sessions/revoke') return send(response, 200, await service.revokeBrowserSessions(value))
      if (request.method === 'POST' && pathname === '/v1/management/transitions') return send(response, 201, await service.createManagementTransition(value))
      if (request.method === 'POST' && pathname === '/v1/management/transitions/probe') return send(response, 200, await service.probeManagementTransition(value))
      if (request.method === 'POST' && pathname === '/v1/management/transitions/commit') return send(response, 200, await service.commitManagementTransition(value))
      if (request.method === 'POST' && pathname === '/v1/management/continuations/consume') return send(response, 200, await service.consumeManagementContinuation(value))
      if (request.method === 'POST' && pathname === '/v1/management/auth-settings') return send(response, 200, await service.updateAuthenticationSettings(value))
      send(response, 404, { error: 'not found', code: 'NOT_FOUND' })
    })().catch(async error => {
      const status = error instanceof AccessError ? error.statusCode : 500
      const failedPathname = new URL(request.url ?? '/', 'http://access.internal').pathname
      const recoveryOperation = surface === 'recovery' && request.method === 'POST'
        ? RECOVERY_OPERATIONS.get(failedPathname) : undefined
      if (recoveryOperation !== undefined) {
        await service.report('access.recovery-operation.failed', {
          operation: recoveryOperation,
          code: error instanceof AccessError ? error.code : 'INTERNAL_ERROR',
        })
      }
      if (!(error instanceof AccessError)) await service.report('access.request.failed', {
        error, method: request.method ?? null, pathname: request.url ?? null,
      })
      send(response, status, accessErrorBody(error), Number.isInteger(error?.details?.retryAfterSeconds)
        ? { 'retry-after': String(error.details.retryAfterSeconds) } : {})
    })
  })
}
