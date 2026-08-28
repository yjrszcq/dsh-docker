import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { AuthenticationLimiter } from './rate-limiter.mjs'
import { AccessError, accessErrorBody } from './errors.mjs'
import { normalizeUsername, verifyCredential } from './credentials.mjs'

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
    verify = verifyCredential,
    sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    report = async () => {},
  }) {
    this.store = store
    this.classificationToken = classificationToken
    this.limiter = limiter
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
