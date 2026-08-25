import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'
import { ProxyTransportError } from './transport.mjs'

const POSITIVE_TTL_MS = 60_000
const NEGATIVE_TTL_MS = 10_000

function normalizeHost(value) {
  if (isIP(value) !== 0) return value.toLowerCase()
  const ascii = domainToASCII(String(value).toLowerCase().replace(/\.+$/, ''))
  if (ascii === '') throw new ProxyTransportError('target DNS name is invalid', { code: 'TARGET_DNS_FAILED' })
  return ascii
}

function normalizeRecords(value) {
  if (!Array.isArray(value)) value = [value]
  const records = new Map()
  for (const record of value) {
    const address = typeof record === 'string' ? record : record?.address
    const family = typeof record === 'object' ? Number(record?.family) : isIP(address)
    if (typeof address !== 'string' || ![4, 6].includes(family) || isIP(address) !== family) continue
    const ttl = typeof record?.ttl === 'number' && Number.isFinite(record.ttl)
      ? Math.max(0, Math.min(60, record.ttl))
      : 60
    records.set(`${family}:${address}`, Object.freeze({ address, family, ttl }))
  }
  return Object.freeze([...records.values()])
}

export class ProxyDnsCache {
  constructor({ resolver = lookup, now = Date.now, positiveTtlMs = POSITIVE_TTL_MS, negativeTtlMs = NEGATIVE_TTL_MS } = {}) {
    this.resolver = resolver
    this.now = now
    this.positiveTtlMs = positiveTtlMs
    this.negativeTtlMs = negativeTtlMs
    this.entries = new Map()
  }

  async resolve(host, revision, { signal } = {}) {
    const normalized = normalizeHost(host)
    const type = isIP(normalized)
    if (type !== 0) return Object.freeze([{ address: normalized, family: type, ttl: 60 }])
    const key = `${revision}\u0000${normalized}`
    const cached = this.entries.get(key)
    if (cached !== undefined && cached.expiresAt > this.now()) {
      if (cached.error !== null) throw cached.error
      return cached.records
    }
    if (signal?.aborted) throw new ProxyTransportError('target DNS resolution was cancelled', { code: 'REQUEST_CANCELLED', statusCode: 499 })
    let records
    try {
      if (signal === undefined) records = await this.resolver(normalized, { all: true, verbatim: true })
      else records = await new Promise((resolve, reject) => {
        const cancelled = () => reject(new ProxyTransportError('target DNS resolution was cancelled', {
          code: 'REQUEST_CANCELLED', statusCode: 499,
        }))
        signal.addEventListener('abort', cancelled, { once: true })
        this.resolver(normalized, { all: true, verbatim: true }).then(resolve, reject).finally(() => {
          signal.removeEventListener('abort', cancelled)
        })
      })
      records = normalizeRecords(records)
      if (records.length === 0) throw new Error('resolver returned no usable addresses')
    } catch (cause) {
      if (cause instanceof ProxyTransportError) throw cause
      const error = new ProxyTransportError('target DNS resolution failed', { code: 'TARGET_DNS_FAILED', cause })
      this.entries.set(key, Object.freeze({ records: null, error, expiresAt: this.now() + this.negativeTtlMs }))
      throw error
    }
    const recordTtlMs = Math.min(...records.map(record => record.ttl * 1000), this.positiveTtlMs)
    this.entries.set(key, Object.freeze({ records, error: null, expiresAt: this.now() + recordTtlMs }))
    if (this.entries.size > 512) {
      const now = this.now()
      for (const [entryKey, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(entryKey)
      while (this.entries.size > 512) this.entries.delete(this.entries.keys().next().value)
    }
    return records
  }
}
