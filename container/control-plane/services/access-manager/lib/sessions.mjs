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
  }

  issue(kind, account, { origin, sourceDshOrigin = null, sourceDshSessionId = null } = {}) {
    const policy = this.policy[kind]
    if (policy === undefined) throw new TypeError('browser session kind is invalid')
    if (typeof origin !== 'string' || origin.length === 0 || origin.length > 2_048) {
      throw new TypeError('browser session origin is invalid')
    }
    this.prune()
    const token = `${kind === 'dsh' ? 'dshs' : 'dshms'}_${identifier(this.random)}`
    const csrfToken = `dshc_${identifier(this.random)}`
    const sessionId = identifier(this.random, 16)
    const createdAt = this.now()
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
      csrfDigest: digest(csrfToken),
      createdAt,
      lastSeenAt: createdAt,
      expiresAt: createdAt + policy.absoluteMs,
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
    return this.sessions.delete(digest(token).toString('hex'))
  }

  revokeKind(kind) {
    for (const [key, session] of this.sessions) {
      if (session.kind === kind) this.sessions.delete(key)
    }
  }

  list(account, currentSessionId) {
    this.prune()
    return [...this.sessions.values()]
      .filter(session => session.accountId === account.accountId
        && session.mainCredentialVersion === account.mainCredential.version
        && session.managementAccessVersion === account.managementAccess.version
        && (session.kind !== 'management'
          || session.managementAdditionalCredentialVersion === (account.managementAdditionalCredential.enabled
            ? account.managementAdditionalCredential.version : null)))
      .map(session => Object.freeze({
        sessionId: session.sessionId,
        kind: session.kind,
        origin: session.origin,
        current: session.sessionId === currentSessionId,
        createdAt: new Date(session.createdAt).toISOString(),
        lastSeenAt: new Date(session.lastSeenAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
      }))
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
  }

  revokeKindExcept(kind, sessionId) {
    let revoked = 0
    for (const [key, session] of this.sessions) {
      if (session.kind !== kind || session.sessionId === sessionId) continue
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
