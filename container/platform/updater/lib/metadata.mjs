import { setTimeout as delay } from 'node:timers/promises'
import { parseStable } from '../../lib/contracts.mjs'

async function responseBytes(response, label, maxBytes = 10 * 1024 * 1024) {
  if (!response.ok) throw new Error(`${label} returned HTTP ${String(response.status)}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new Error(`${label} exceeds the download limit`)
  return bytes
}

export class MetadataClient {
  constructor({ baseUrl, trust, fetchImpl = fetch, attempts = 3, retryMs = 1_000 }) {
    this.baseUrl = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
    if (this.baseUrl.protocol !== 'https:' && this.baseUrl.hostname !== '127.0.0.1' && this.baseUrl.hostname !== 'localhost') {
      throw new Error('update metadata URL must use HTTPS')
    }
    this.trust = trust
    this.fetchImpl = fetchImpl
    this.attempts = attempts
    this.retryMs = retryMs
  }

  async file(name) {
    return responseBytes(await this.fetchImpl(new URL(name, this.baseUrl)), name)
  }

  async check() {
    let lastError
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        const [keyring, keyringSignatureBytes] = await Promise.all([
          this.file('keyring.json'), this.file('keyring.sig.json'),
        ])
        await this.trust.acceptKeyring(keyring, JSON.parse(keyringSignatureBytes.toString('utf8')))
        const [stable, stableSignatureBytes] = await Promise.all([
          this.file('stable.json'), this.file('stable.sig.json'),
        ])
        await this.trust.acceptTarget(stable, JSON.parse(stableSignatureBytes.toString('utf8')))
        return Object.freeze({ bytes: stable, value: parseStable(stable) })
      } catch (error) {
        lastError = error
        if (attempt < this.attempts) await delay(this.retryMs)
      }
    }
    throw lastError
  }
}
