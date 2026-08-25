import { randomBytes } from 'node:crypto'
import { ProxyConfigurationError } from './errors.mjs'
import { validProviderId } from './contracts.mjs'

const HANDLE_BYTES = 32
const HANDLE_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const PROVIDER_HANDLE_TTL_MS = 15 * 60 * 1000

function invalidHandle() {
  return new ProxyConfigurationError('provider policy handle is invalid', {
    code: 'PROVIDER_HANDLE_INVALID', statusCode: 407, stage: 'authorize', retryable: true,
  })
}

export class ProviderHandleStore {
  constructor({ ttlMs = PROVIDER_HANDLE_TTL_MS, now = () => Date.now(), random = randomBytes } = {}) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new TypeError('provider handle TTL is invalid')
    this.ttlMs = ttlMs
    this.now = now
    this.random = random
    this.handles = new Map()
  }

  issue({ providerId, policyRevision }, snapshot) {
    if (!validProviderId(providerId)) throw new ProxyConfigurationError('model API provider ID is invalid')
    if (typeof policyRevision !== 'string' || policyRevision !== snapshot.revision) {
      throw new ProxyConfigurationError('provider policy revision changed', {
        code: 'REVISION_CONFLICT', statusCode: 409, stage: 'authorize', retryable: true,
      })
    }
    this.prune()
    const handle = this.random(HANDLE_BYTES).toString('base64url')
    if (!HANDLE_PATTERN.test(handle) || this.handles.has(handle)) throw new Error('provider handle generation failed')
    const expiresAtMs = this.now() + this.ttlMs
    this.handles.set(handle, Object.freeze({ providerId, policyRevision, expiresAtMs }))
    return Object.freeze({ handle, policyRevision, expiresAt: new Date(expiresAtMs).toISOString() })
  }

  resolve(authorization, snapshot) {
    const match = typeof authorization === 'string' ? /^DSH-Provider ([A-Za-z0-9_-]{43})$/.exec(authorization) : null
    if (match === null) throw invalidHandle()
    const entry = this.handles.get(match[1])
    if (entry === undefined || entry.expiresAtMs <= this.now() || entry.policyRevision !== snapshot.revision) {
      if (entry !== undefined) this.handles.delete(match[1])
      throw invalidHandle()
    }
    return entry.providerId
  }

  prune() {
    const now = this.now()
    for (const [handle, entry] of this.handles) {
      if (entry.expiresAtMs <= now) this.handles.delete(handle)
    }
  }

  clear() {
    this.handles.clear()
  }
}

export const providerHandleInternals = Object.freeze({ HANDLE_BYTES, HANDLE_PATTERN })
