import { createHash, randomBytes } from 'node:crypto'

function digest(value) { return createHash('sha256').update(value).digest('hex') }
function token(random) { return `dshcap_${random(32).toString('base64url')}` }

export function capabilityTarget(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > 8_192 || !path.startsWith('/')) {
    throw new TypeError('capability target is invalid')
  }
  const value = new URL(path, 'http://capability.internal')
  if (value.origin !== 'http://capability.internal' || value.hash !== '') throw new TypeError('capability target is invalid')
  return `${value.pathname}${value.search}`
}

export class CapabilityStore {
  constructor({ now = Date.now, random = randomBytes, ttlMs = 5_000 } = {}) {
    this.now = now
    this.random = random
    this.ttlMs = ttlMs
    this.capabilities = new Map()
  }

  prune() {
    const now = this.now()
    for (const [key, value] of this.capabilities) if (value.expiresAt <= now) this.capabilities.delete(key)
  }

  issue(session, account, { audience, method, target }) {
    if (!['management', 'maintenance'].includes(audience)) throw new TypeError('capability audience is invalid')
    if (!/^(?:GET|HEAD|POST|PUT|DELETE)$/.test(method ?? '')) throw new TypeError('capability method is invalid')
    this.prune()
    const value = token(this.random)
    this.capabilities.set(digest(value), {
      audience,
      method,
      target: capabilityTarget(target),
      sessionId: session.sessionId,
      accountId: account.accountId,
      mainCredentialVersion: account.mainCredential.version,
      managementAdditionalCredentialVersion: account.managementAdditionalCredential.enabled
        ? account.managementAdditionalCredential.version : null,
      managementAccessVersion: account.managementAccess.version,
      expiresAt: this.now() + this.ttlMs,
    })
    return Object.freeze({ token: value, expiresAt: new Date(this.now() + this.ttlMs).toISOString() })
  }

  consume(value, account, { audience, method, target }) {
    this.prune()
    if (typeof value !== 'string' || value.length > 512) return undefined
    const key = digest(value)
    const capability = this.capabilities.get(key)
    this.capabilities.delete(key)
    const additionalVersion = account.managementAdditionalCredential.enabled
      ? account.managementAdditionalCredential.version : null
    if (capability === undefined || capability.accountId !== account.accountId
      || capability.mainCredentialVersion !== account.mainCredential.version
      || capability.managementAdditionalCredentialVersion !== additionalVersion
      || capability.managementAccessVersion !== account.managementAccess.version
      || capability.audience !== audience || capability.method !== method
      || capability.target !== capabilityTarget(target)) return undefined
    return Object.freeze({ sessionId: capability.sessionId, audience: capability.audience })
  }
}
