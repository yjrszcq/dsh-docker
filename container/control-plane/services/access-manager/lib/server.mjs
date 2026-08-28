import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { AuthenticationLimiter } from './rate-limiter.mjs'
import { AccessError, accessErrorBody } from './errors.mjs'
import { normalizeUsername, verifyCredential } from './credentials.mjs'
import { BrowserSessionStore } from './sessions.mjs'
import { ManagementExchangeStore } from './exchanges.mjs'
import { CapabilityStore } from './capabilities.mjs'

const MAX_BODY_BYTES = 64 * 1024

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
    verify = verifyCredential,
    sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    report = async () => {},
  }) {
    this.store = store
    this.classificationToken = classificationToken
    this.limiter = limiter
    this.sessions = sessions
    this.exchanges = exchanges
    this.capabilities = capabilities
    this.verify = verify
    this.sleep = sleep
    this.report = report
    this.transition = Promise.resolve()
  }

  serialized(operation) {
    const pending = this.transition.then(operation, operation)
    this.transition = pending.catch(() => {})
    return pending
  }

  async status() {
    const current = await this.store.state()
    return {
      componentReady: true,
      state: current.state,
      instanceId: current.initialization?.instanceId ?? null,
      account: publicAccount(current.account),
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

  async managementResult(account, { origin, sourceDshOrigin = null }) {
    if (account.managementAdditionalCredential.enabled) {
      return { pending: this.exchanges.createPending(account, { targetOrigin: origin, sourceDshOrigin }) }
    }
    const session = this.sessions.issue('management', account, { origin, sourceDshOrigin })
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
    return this.managementResult(current.account, { origin: value.origin, sourceDshOrigin: handoff.sourceDshOrigin })
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
      origin: value.origin, sourceDshOrigin: pending.value.sourceDshOrigin,
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
}

export function createAccessHttpServer({ service, surface = 'access' }) {
  return createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url ?? '/', 'http://access.internal').pathname
      if (request.method === 'GET' && pathname === '/v1/status') return send(response, 200, await service.status())
      if (surface === 'recovery') return send(response, 404, { error: 'not found', code: 'NOT_FOUND' })
      const value = await body(request)
      if (request.method === 'POST' && pathname === '/v1/classify') return send(response, 200, await service.classify(value))
      if (request.method === 'POST' && pathname === '/v1/initialize') return send(response, 201, await service.initialize(value))
      if (request.method === 'POST' && pathname === '/v1/authenticate') return send(response, 200, await service.authenticate(value))
      if (request.method === 'POST' && pathname === '/v1/dsh/initialize') return send(response, 201, await service.initializeDsh(value))
      if (request.method === 'POST' && pathname === '/v1/dsh/login') return send(response, 200, await service.loginDsh(value))
      if (request.method === 'POST' && pathname === '/v1/sessions/validate') return send(response, 200, await service.validateSession(value))
      if (request.method === 'POST' && pathname === '/v1/sessions/logout') return send(response, 200, await service.logout(value))
      if (request.method === 'POST' && pathname === '/v1/management/login') return send(response, 200, await service.loginManagement(value))
      if (request.method === 'POST' && pathname === '/v1/management/handoffs') return send(response, 201, await service.createManagementHandoff(value))
      if (request.method === 'POST' && pathname === '/v1/management/handoffs/consume') return send(response, 200, await service.consumeManagementHandoff(value))
      if (request.method === 'POST' && pathname === '/v1/management/pending/complete') return send(response, 200, await service.completeManagementLogin(value))
      if (request.method === 'POST' && pathname === '/v1/capabilities') return send(response, 201, await service.issueCapability(value))
      if (request.method === 'POST' && pathname === '/v1/capabilities/consume') return send(response, 200, await service.consumeCapability(value))
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
