import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

function digest(value) { return createHash('sha256').update(value).digest() }
function token(prefix, random, bytes = 32) { return `${prefix}_${random(bytes).toString('base64url')}` }
function sameDigest(value, expected) {
  if (typeof value !== 'string' || expected === null) return false
  const actual = digest(value)
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
}

export class ManagementTransitionStore {
  constructor({ now = Date.now, random = randomBytes, ttlMs = 30_000 } = {}) {
    this.now = now
    this.random = random
    this.ttlMs = ttlMs
    this.transitions = new Map()
    this.continuations = new Map()
  }

  prune() {
    const now = this.now()
    for (const [id, value] of this.transitions) if (value.expiresAt <= now) this.transitions.delete(id)
    for (const [key, value] of this.continuations) if (value.expiresAt <= now) this.continuations.delete(key)
  }

  create({ account, instanceId, sessionId, sourceOrigin, sourceDshOrigin, mode, isolatedEntry, candidateOrigin }) {
    this.prune()
    const transitionId = token('dshmt', this.random, 16)
    const nonce = candidateOrigin === null ? null : token('dshmn', this.random)
    const expiresAt = this.now() + this.ttlMs
    this.transitions.set(transitionId, {
      accountId: account.accountId,
      accountRevision: account.revision,
      managementAccessVersion: account.managementAccess.version,
      instanceId,
      sessionId,
      sourceOrigin,
      sourceDshOrigin,
      mode,
      isolatedEntry,
      candidateOrigin,
      nonceDigest: nonce === null ? null : digest(nonce),
      proofDigest: null,
      expiresAt,
    })
    return Object.freeze({
      transitionId,
      nonce,
      candidateOrigin,
      expiresAt: new Date(expiresAt).toISOString(),
    })
  }

  probe({ transitionId, nonce, candidateOrigin, sourceOrigin, instanceId }) {
    this.prune()
    const transition = this.transitions.get(transitionId)
    if (transition === undefined || transition.candidateOrigin !== candidateOrigin
      || transition.sourceOrigin !== sourceOrigin || transition.instanceId !== instanceId
      || !sameDigest(nonce, transition.nonceDigest)) return undefined
    transition.nonceDigest = null
    const proof = token('dshmpf', this.random)
    transition.proofDigest = digest(proof)
    return Object.freeze({ proof, expiresAt: new Date(transition.expiresAt).toISOString() })
  }

  inspect({ transitionId, proof, account, sessionId }) {
    this.prune()
    const transition = this.transitions.get(transitionId)
    if (transition === undefined || transition.accountId !== account.accountId
      || transition.accountRevision !== account.revision
      || transition.managementAccessVersion !== account.managementAccess.version
      || transition.sessionId !== sessionId
      || (transition.candidateOrigin !== null && !sameDigest(proof, transition.proofDigest))) return undefined
    return transition
  }

  consume(value) {
    const transition = this.inspect(value)
    if (transition === undefined) return undefined
    const { transitionId } = value
    this.transitions.delete(transitionId)
    return transition
  }

  createContinuation({ account, targetOrigin, sourceDshOrigin }) {
    if (targetOrigin === null) return null
    this.prune()
    const continuation = token('dshmc', this.random)
    const expiresAt = this.now() + this.ttlMs
    this.continuations.set(digest(continuation).toString('hex'), {
      accountId: account.accountId,
      accountRevision: account.revision,
      managementAccessVersion: account.managementAccess.version,
      targetOrigin,
      sourceDshOrigin,
      expiresAt,
    })
    return Object.freeze({ token: continuation, expiresAt: new Date(expiresAt).toISOString() })
  }

  consumeContinuation({ token: value, account, targetOrigin }) {
    this.prune()
    if (typeof value !== 'string' || value.length > 512) return undefined
    const key = digest(value).toString('hex')
    const continuation = this.continuations.get(key)
    this.continuations.delete(key)
    if (continuation === undefined || continuation.accountId !== account.accountId
      || continuation.accountRevision !== account.revision
      || continuation.managementAccessVersion !== account.managementAccess.version
      || continuation.targetOrigin !== targetOrigin) return undefined
    return continuation
  }

  clear() {
    this.transitions.clear()
    this.continuations.clear()
  }
}
