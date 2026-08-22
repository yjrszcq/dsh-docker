import { setTimeout as delay } from 'node:timers/promises'
import { parseStable } from '../../../../platform/lib/contracts.mjs'
import { compareDshVersions } from '../../../../platform/lib/supported-target.mjs'

export class MetadataUnavailableError extends Error {
  constructor() {
    super('signed update metadata has not been published')
    this.name = 'MetadataUnavailableError'
    this.code = 'METADATA_UNAVAILABLE'
  }
}

async function responseBytes(response, label, maxBytes = 10 * 1024 * 1024) {
  if (!response.ok) throw new HttpResponseError(label, response.status)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new Error(`${label} exceeds the download limit`)
  return bytes
}

class HttpResponseError extends Error {
  constructor(label, status) {
    super(`${label} returned HTTP ${String(status)}`)
    this.name = 'HttpResponseError'
    this.status = status
  }
}

function retryableRequest(error) {
  return !(error instanceof HttpResponseError)
    || error.status === 408
    || error.status === 429
    || error.status >= 500
}

function exhaustedRequest(label, error, attempts) {
  const timeout = error?.name === 'TimeoutError'
  const detail = error instanceof Error && error.message !== '' ? `: ${error.message}` : ''
  const wrapped = new Error(
    timeout
      ? `${label} timed out after ${String(attempts)} attempts`
      : `${label} failed after ${String(attempts)} attempts${detail}`,
    { cause: error },
  )
  wrapped.name = timeout ? 'TimeoutError' : 'Error'
  if (error?.code !== undefined) wrapped.code = error.code
  wrapped.requestExhausted = true
  return wrapped
}

function timeoutForAttempt(initial, retry, attempt) {
  return attempt === 1 ? initial : retry
}

export class MetadataClient {
  constructor({
    baseUrl,
    trust,
    fetchImpl = fetch,
    attempts = 2,
    retryMs = 250,
    requestTimeoutMs = 5_000,
    retryRequestTimeoutMs = requestTimeoutMs,
  }) {
    this.baseUrl = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
    if (this.baseUrl.protocol !== 'https:' && this.baseUrl.hostname !== '127.0.0.1' && this.baseUrl.hostname !== 'localhost') {
      throw new Error('update metadata URL must use HTTPS')
    }
    this.trust = trust
    this.fetchImpl = fetchImpl
    this.attempts = attempts
    this.retryMs = retryMs
    this.requestTimeoutMs = requestTimeoutMs
    this.retryRequestTimeoutMs = retryRequestTimeoutMs
  }

  async file(name) {
    let lastError
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(new URL(name, this.baseUrl), {
          signal: AbortSignal.timeout(timeoutForAttempt(this.requestTimeoutMs, this.retryRequestTimeoutMs, attempt)),
        })
        if (response.status === 404) throw new MetadataUnavailableError()
        return await responseBytes(response, name)
      } catch (error) {
        if (error instanceof MetadataUnavailableError) throw error
        if (!retryableRequest(error)) throw error
        lastError = error
        if (attempt < this.attempts) await delay(this.retryMs)
      }
    }
    throw exhaustedRequest(name, lastError, this.attempts)
  }

  async verifiedPair(payloadName, signatureName, accept) {
    let lastError
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        const [payload, signatureBytes] = await Promise.all([
          this.file(payloadName), this.file(signatureName),
        ])
        await accept(payload, JSON.parse(signatureBytes.toString('utf8')))
        return payload
      } catch (error) {
        if (error instanceof MetadataUnavailableError
          || error instanceof HttpResponseError
          || error?.requestExhausted === true) throw error
        lastError = error
        if (attempt < this.attempts) await delay(this.retryMs)
      }
    }
    throw lastError
  }

  async check() {
    await this.verifiedPair('keyring.json', 'keyring.sig.json', (bytes, signature) => (
      this.trust.acceptKeyring(bytes, signature)
    ))
    const stable = await this.verifiedPair('stable.json', 'stable.sig.json', (bytes, signature) => (
      this.trust.acceptTarget(bytes, signature)
    ))
    return Object.freeze({ bytes: stable, value: parseStable(stable) })
  }
}

export class NpmRegistryClient {
  constructor({
    fetchImpl = fetch,
    registry = 'https://registry.npmjs.org/',
    packageName = '@deepseek-ai/dsh',
    attempts = 2,
    retryMs = 250,
    requestTimeoutMs = 5_000,
    retryRequestTimeoutMs = requestTimeoutMs,
  }) {
    this.fetchImpl = fetchImpl
    this.registry = registry
    this.packageName = packageName
    this.attempts = attempts
    this.retryMs = retryMs
    this.requestTimeoutMs = requestTimeoutMs
    this.retryRequestTimeoutMs = retryRequestTimeoutMs
  }

  async discover(policy = {}) {
    const registry = policy.registry ?? this.registry
    const packageName = policy.packageName ?? this.packageName
    const packagePath = encodeURIComponent(packageName)
    let bytes
    let lastError
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(new URL(packagePath, registry), {
          headers: { accept: 'application/vnd.npm.install-v1+json' },
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutForAttempt(this.requestTimeoutMs, this.retryRequestTimeoutMs, attempt)),
        })
        bytes = await responseBytes(response, 'npm packument', 20 * 1024 * 1024)
        break
      } catch (error) {
        if (!retryableRequest(error)) throw error
        lastError = error
        if (attempt < this.attempts) await delay(this.retryMs)
      }
    }
    if (bytes === undefined) throw exhaustedRequest('npm packument', lastError, this.attempts)
    let packument
    try { packument = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('npm packument is not valid JSON') }
    const latest = packument?.['dist-tags']?.latest
    const version = typeof latest === 'string' ? packument?.versions?.[latest]?.version : undefined
    if (version !== latest) throw new Error('npm packument has no coherent latest DSH version')
    return Object.freeze({ version })
  }

  async latest(stable) {
    const found = await this.discover(stable.officialDshPolicy)
    const version = found.version
    return compareDshVersions(version, stable.desired.dsh.version) > 0 ? Object.freeze({ version }) : null
  }
}
