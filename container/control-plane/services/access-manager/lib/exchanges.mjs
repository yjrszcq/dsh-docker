import { createHash, randomBytes } from 'node:crypto'

function digest(value) { return createHash('sha256').update(value).digest('hex') }
function token(prefix, random) { return `${prefix}_${random(32).toString('base64url')}` }

export class ManagementExchangeStore {
  constructor({ now = Date.now, random = randomBytes, handoffTtlMs = 30_000, pendingTtlMs = 5 * 60_000, pendingAttempts = 16 } = {}) {
    this.now = now
    this.random = random
    this.handoffTtlMs = handoffTtlMs
    this.pendingTtlMs = pendingTtlMs
    this.pendingAttempts = pendingAttempts
    this.handoffs = new Map()
    this.pending = new Map()
  }

  prune() {
    const now = this.now()
    for (const [key, value] of this.handoffs) if (value.expiresAt <= now) this.handoffs.delete(key)
    for (const [key, value] of this.pending) if (value.expiresAt <= now) this.pending.delete(key)
  }

  createHandoff(session, account, targetOrigin) {
    this.prune()
    const value = token('dshh', this.random)
    this.handoffs.set(digest(value), {
      accountId: account.accountId,
      dshSessionId: session.sessionId,
      mainCredentialVersion: account.mainCredential.version,
      managementAccessVersion: account.managementAccess.version,
      sourceDshOrigin: session.origin,
      targetOrigin,
      expiresAt: this.now() + this.handoffTtlMs,
    })
    return Object.freeze({ token: value, expiresAt: new Date(this.now() + this.handoffTtlMs).toISOString() })
  }

  consumeHandoff(value, account, targetOrigin) {
    this.prune()
    if (typeof value !== 'string' || value.length > 512) return undefined
    const key = digest(value)
    const handoff = this.handoffs.get(key)
    this.handoffs.delete(key)
    if (handoff === undefined || handoff.accountId !== account.accountId
      || handoff.mainCredentialVersion !== account.mainCredential.version
      || handoff.managementAccessVersion !== account.managementAccess.version
      || handoff.targetOrigin !== targetOrigin) return undefined
    return handoff
  }

  createPending(account, { targetOrigin, sourceDshOrigin = null, sourceDshSessionId = null }) {
    this.prune()
    const value = token('dshmp', this.random)
    this.pending.set(digest(value), {
      accountId: account.accountId,
      mainCredentialVersion: account.mainCredential.version,
      managementAdditionalCredentialVersion: account.managementAdditionalCredential.version,
      managementAccessVersion: account.managementAccess.version,
      targetOrigin,
      sourceDshOrigin,
      sourceDshSessionId,
      attempts: 0,
      expiresAt: this.now() + this.pendingTtlMs,
    })
    return Object.freeze({ token: value, expiresAt: new Date(this.now() + this.pendingTtlMs).toISOString() })
  }

  peekPendingSource(value, account, targetOrigin) {
    this.prune()
    if (typeof value !== 'string' || value.length > 512) return undefined
    const pending = this.pending.get(digest(value))
    if (pending === undefined || pending.accountId !== account.accountId
      || pending.mainCredentialVersion !== account.mainCredential.version
      || pending.managementAdditionalCredentialVersion !== account.managementAdditionalCredential.version
      || pending.managementAccessVersion !== account.managementAccess.version
      || pending.targetOrigin !== targetOrigin) return undefined
    return pending.sourceDshSessionId
  }

  inspectPending(value, account, targetOrigin) {
    this.prune()
    if (typeof value !== 'string' || value.length > 512) return undefined
    const key = digest(value)
    const pending = this.pending.get(key)
    if (pending === undefined || pending.accountId !== account.accountId
      || pending.mainCredentialVersion !== account.mainCredential.version
      || pending.managementAdditionalCredentialVersion !== account.managementAdditionalCredential.version
      || pending.managementAccessVersion !== account.managementAccess.version
      || pending.targetOrigin !== targetOrigin) return undefined
    pending.attempts += 1
    if (pending.attempts > this.pendingAttempts) {
      this.pending.delete(key)
      return undefined
    }
    return { key, value: pending }
  }

  consumePending(key) { return this.pending.delete(key) }
}
