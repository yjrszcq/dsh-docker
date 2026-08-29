import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

function digest(value) {
  return createHash('sha256').update(value).digest()
}

function identifier(random = randomBytes, bytes = 32) {
  return random(bytes).toString('base64url')
}

function sameDigest(value, expected) {
  const actual = digest(value ?? '')
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
}

function sessionClient(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({ ip: null, userAgent: null })
  const bounded = (field, maximum) => typeof field === 'string' && field.length > 0 && field.length <= maximum
    ? field : null
  return Object.freeze({
    ip: bounded(value.ip, 128),
    userAgent: bounded(value.userAgent, 512),
  })
}

export class BrowserSessionStore {
  constructor({
    now = Date.now,
    random = randomBytes,
    dshAbsoluteMs = 12 * 60 * 60_000,
    dshIdleMs = 2 * 60 * 60_000,
    managementAbsoluteMs = 8 * 60 * 60_000,
    managementIdleMs = 30 * 60_000,
  } = {}) {
    this.now = now
    this.random = random
    this.policy = Object.freeze({
      dsh: Object.freeze({ absoluteMs: dshAbsoluteMs, idleMs: dshIdleMs }),
      management: Object.freeze({ absoluteMs: managementAbsoluteMs, idleMs: managementIdleMs }),
    })
    this.sessions = new Map()
  }

  prune() {
    const now = this.now()
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now || session.lastSeenAt + session.idleMs <= now) this.sessions.delete(key)
    }
    for (const [key, session] of this.sessions) {
      if (session.kind === 'management' && this.activeDshSession(session.sourceDshSessionId, session.accountId) === undefined) {
        this.sessions.delete(key)
      }
    }
  }

  activeDshSession(sessionId, accountId) {
    if (typeof sessionId !== 'string') return undefined
    for (const session of this.sessions.values()) {
      if (session.kind === 'dsh' && session.sessionId === sessionId && session.accountId === accountId) return session
    }
    return undefined
  }

  issue(kind, account, { origin, sourceDshOrigin = null, sourceDshSessionId = null, client = null } = {}) {
    const policy = this.policy[kind]
    if (policy === undefined) throw new TypeError('browser session kind is invalid')
    if (typeof origin !== 'string' || origin.length === 0 || origin.length > 2_048) {
      throw new TypeError('browser session origin is invalid')
    }
    this.prune()
    const sourceDshSession = kind === 'management'
      ? this.activeDshSession(sourceDshSessionId, account.accountId)
      : undefined
    if (kind === 'management' && (sourceDshSession === undefined || sourceDshSession.origin !== sourceDshOrigin)) {
      throw new TypeError('Management session requires an active DSH session')
    }
    const token = `${kind === 'dsh' ? 'dshs' : 'dshms'}_${identifier(this.random)}`
    const csrfToken = `dshc_${identifier(this.random)}`
    const sessionId = identifier(this.random, 16)
    const createdAt = this.now()
    const sourceClient = sourceDshSession === undefined ? sessionClient(client) : sourceDshSession.client
    this.sessions.set(digest(token).toString('hex'), {
      sessionId,
      kind,
      accountId: account.accountId,
      mainCredentialVersion: account.mainCredential.version,
      managementAdditionalCredentialVersion: account.managementAdditionalCredential.enabled
        ? account.managementAdditionalCredential.version : null,
      managementAccessVersion: account.managementAccess.version,
      origin,
      sourceDshOrigin,
      sourceDshSessionId,
      client: sourceClient,
      csrfDigest: digest(csrfToken),
      createdAt,
      lastSeenAt: createdAt,
      expiresAt: Math.min(createdAt + policy.absoluteMs, sourceDshSession?.expiresAt ?? Number.POSITIVE_INFINITY),
      idleMs: policy.idleMs,
    })
    return Object.freeze({
      token,
      csrfToken,
      sessionId,
      expiresAt: new Date(createdAt + policy.absoluteMs).toISOString(),
    })
  }

  validate(token, kind, account, { origin, csrfToken, requireCsrf = false, touch = true } = {}) {
    this.prune()
    if (typeof token !== 'string' || token.length > 512 || this.policy[kind] === undefined) return undefined
    const key = digest(token).toString('hex')
    const session = this.sessions.get(key)
    if (session === undefined || session.kind !== kind || session.accountId !== account.accountId
      || session.mainCredentialVersion !== account.mainCredential.version
      || session.managementAccessVersion !== account.managementAccess.version
      || session.origin !== origin
      || (kind === 'management'
        && session.managementAdditionalCredentialVersion !== (account.managementAdditionalCredential.enabled
          ? account.managementAdditionalCredential.version : null))
      || (requireCsrf && !sameDigest(csrfToken, session.csrfDigest))) {
      return undefined
    }
    if (kind === 'management') {
      const source = this.activeDshSession(session.sourceDshSessionId, account.accountId)
      if (source === undefined || source.origin !== session.sourceDshOrigin
        || source.mainCredentialVersion !== account.mainCredential.version
        || source.managementAccessVersion !== account.managementAccess.version) {
        this.sessions.delete(key)
        return undefined
      }
    }
    if (touch) session.lastSeenAt = this.now()
    return Object.freeze({
      sessionId: session.sessionId,
      kind: session.kind,
      accountId: session.accountId,
      origin: session.origin,
      sourceDshOrigin: session.sourceDshOrigin,
      sourceDshSessionId: session.sourceDshSessionId,
      createdAt: new Date(session.createdAt).toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString(),
    })
  }

  revoke(token) {
    if (typeof token !== 'string' || token.length > 512) return false
    const key = digest(token).toString('hex')
    const session = this.sessions.get(key)
    if (!this.sessions.delete(key)) return false
    if (session.kind === 'dsh') this.revokeManagementFromDsh(session.sessionId)
    return true
  }

  revokeKind(kind) {
    const dshSessionIds = []
    for (const [key, session] of this.sessions) {
      if (session.kind !== kind) continue
      this.sessions.delete(key)
      if (kind === 'dsh') dshSessionIds.push(session.sessionId)
    }
    for (const sessionId of dshSessionIds) this.revokeManagementFromDsh(sessionId)
  }

  list(account, currentSessionId) {
    this.prune()
    const currentDshSessionId = this.sourceDshSessionId(currentSessionId) ?? currentSessionId
    const managementSources = new Set([...this.sessions.values()]
      .filter(session => session.kind === 'management')
      .map(session => session.sourceDshSessionId))
    return [...this.sessions.values()]
      .filter(session => session.accountId === account.accountId
        && session.kind === 'dsh'
        && session.mainCredentialVersion === account.mainCredential.version
        && session.managementAccessVersion === account.managementAccess.version)
      .map(session => Object.freeze({
        sessionId: session.sessionId,
        origin: session.origin,
        current: session.sessionId === currentDshSessionId,
        managementActive: managementSources.has(session.sessionId),
        ip: session.client.ip,
        userAgent: session.client.userAgent,
        createdAt: new Date(session.createdAt).toISOString(),
        lastSeenAt: new Date(session.lastSeenAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
      }))
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
  }

  revokeDshSession(sessionId, accountId) {
    if (typeof sessionId !== 'string' || typeof accountId !== 'string') return false
    for (const [key, session] of this.sessions) {
      if (session.kind !== 'dsh' || session.sessionId !== sessionId || session.accountId !== accountId) continue
      this.sessions.delete(key)
      this.revokeManagementFromDsh(session.sessionId)
      return true
    }
    return false
  }

  revokeManagementFromDsh(sessionId) {
    let revoked = 0
    for (const [key, session] of this.sessions) {
      if (session.kind !== 'management' || session.sourceDshSessionId !== sessionId) continue
      this.sessions.delete(key)
      revoked += 1
    }
    return revoked
  }

  sourceDshSessionId(sessionId) {
    for (const session of this.sessions.values()) {
      if (session.kind === 'management' && session.sessionId === sessionId) return session.sourceDshSessionId
    }
    return null
  }

  refreshDshSession(sessionId, account) {
    const session = this.activeDshSession(sessionId, account.accountId)
    if (session === undefined) return false
    session.mainCredentialVersion = account.mainCredential.version
    session.managementAccessVersion = account.managementAccess.version
    return true
  }

  details(sessionId) {
    this.prune()
    for (const session of this.sessions.values()) {
      if (session.sessionId !== sessionId) continue
      return Object.freeze({
        sessionId: session.sessionId,
        kind: session.kind,
        origin: session.origin,
        sourceDshOrigin: session.sourceDshOrigin,
        sourceDshSessionId: session.sourceDshSessionId,
      })
    }
    return undefined
  }

  revokeAll() { this.sessions.clear() }
}
