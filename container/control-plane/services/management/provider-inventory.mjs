import { isIP } from 'node:net'
import { readFile } from 'node:fs/promises'
import { durableReplace } from '../../../platform/lib/atomic.mjs'
import { canonicalJson } from '../../../platform/lib/canonical-json.mjs'
import { validProviderId } from '../outbound-proxy/lib/contracts.mjs'

const CACHE_SCHEMA = 1
const DEFAULT_ENDPOINT = 'http://127.0.0.1:3079'
const RPC_TIMEOUT_MS = 5_000

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function rpcValue(value, method) {
  if (!object(value) || value.type !== 'server-response' || !object(value.result)) {
    throw new Error(`DSH ${method} response is invalid`)
  }
  if (value.result.ok !== true || !object(value.result.value)) {
    throw new Error(`DSH ${method} request failed`)
  }
  return value.result.value
}

async function rpc(fetchImpl, endpoint, method, signal) {
  const rpcId = `dsh-proxy-${method}`
  const response = await fetchImpl(`${endpoint}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload: {} }),
    signal,
  })
  if (!response.ok) throw new Error(`DSH ${method} returned HTTP ${String(response.status)}`)
  return rpcValue(await response.json(), method)
}

function nestedValue(value, path) {
  let current = value
  for (const part of path) {
    if (!object(current) || !(part in current)) return undefined
    current = current[part]
  }
  return current
}

function baseUrlFor(provider, namespaces) {
  const namespace = namespaces.get(provider.settingsNs)
  if (namespace === undefined) return undefined
  const path = Array.isArray(provider.settingsPath) ? provider.settingsPath : []
  const configured = nestedValue(namespace.value, path)
  const defaults = nestedValue(namespace.base, path)
  for (const candidate of [configured, defaults]) {
    if (object(candidate) && typeof candidate.baseURL === 'string' && candidate.baseURL.trim() !== '') {
      return candidate.baseURL.trim()
    }
  }
  return undefined
}

function configuredProvider(provider, namespaces) {
  const namespace = namespaces.get(provider.settingsNs)
  if (namespace === undefined) return false
  const path = Array.isArray(provider.settingsPath) ? provider.settingsPath : []
  return path.length === 0 || nestedValue(namespace.value, path) !== undefined
}

function loopbackUrl(value) {
  if (value === undefined) return false
  let parsed
  try { parsed = new URL(value) } catch { return false }
  const host = parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
    ? parsed.hostname.slice(1, -1)
    : parsed.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (isIP(host) === 4) return host.startsWith('127.')
  if (isIP(host) === 6) return host === '::1' || host === '0:0:0:0:0:0:0:1'
  return false
}

function sanitizeProvider(provider, namespaces) {
  if (!object(provider) || !validProviderId(provider.provider)) return undefined
  if (!configuredProvider(provider, namespaces)) return undefined
  const local = loopbackUrl(baseUrlFor(provider, namespaces))
  const routingCapability = local
    ? 'forced-direct'
    : provider.routingCapability === 'shared-dsh' || provider.supportsIndependentRouting === false
      ? 'shared-dsh'
      : 'provider'
  return Object.freeze({
    id: provider.provider,
    displayName: typeof provider.displayName === 'string' && provider.displayName.trim() !== ''
      ? provider.displayName.trim()
      : provider.provider,
    type: provider.provider,
    active: provider.active === true,
    declared: provider.declared !== false,
    configured: true,
    routingCapability,
    reason: routingCapability === 'forced-direct'
      ? 'local-provider'
      : routingCapability === 'shared-dsh' ? 'client-uses-shared-dsh-route' : null,
  })
}

function decorate(provider, snapshot) {
  if (provider.routingCapability !== 'forced-direct') {
    const requestedPolicy = snapshot.configuration.modelApi.providers[provider.id]
      ?? snapshot.configuration.modelApi.default
    return Object.freeze({
      ...provider,
      requestedPolicy,
      effectivePolicy: requestedPolicy.proxyEnabled
        ? provider.routingCapability === 'shared-dsh' ? 'shared-dsh' : 'proxy'
        : 'direct',
    })
  }
  return Object.freeze({
    ...provider,
    requestedPolicy: null,
    effectivePolicy: 'direct',
  })
}

function validateCache(value) {
  if (!object(value) || value.schema !== CACHE_SCHEMA || !Array.isArray(value.providers) || typeof value.updatedAt !== 'string') {
    throw new Error('cached Provider inventory is invalid')
  }
  const providers = value.providers.map(provider => {
    if (!object(provider) || !validProviderId(provider.id) || typeof provider.displayName !== 'string'
      || typeof provider.type !== 'string' || typeof provider.active !== 'boolean' || typeof provider.declared !== 'boolean'
      || provider.configured !== true
      || !['provider', 'shared-dsh', 'forced-direct'].includes(provider.routingCapability)
      || !(provider.reason === null || typeof provider.reason === 'string')) {
      throw new Error('cached Provider inventory entry is invalid')
    }
    return Object.freeze({ ...provider })
  })
  return Object.freeze({ schema: CACHE_SCHEMA, updatedAt: value.updatedAt, providers: Object.freeze(providers) })
}

export class ProviderInventory {
  constructor({
    cachePath,
    endpoint = DEFAULT_ENDPOINT,
    fetchImpl = fetch,
    timeoutMs = RPC_TIMEOUT_MS,
    now = () => new Date(),
  }) {
    if (typeof cachePath !== 'string' || cachePath === '') throw new TypeError('Provider inventory cache path is required')
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('Provider inventory timeout is invalid')
    this.cachePath = cachePath
    this.endpoint = endpoint.replace(/\/$/, '')
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
    this.now = now
  }

  async refresh() {
    const signal = AbortSignal.timeout(this.timeoutMs)
    const [providerValue, settingsValue] = await Promise.all([
      rpc(this.fetchImpl, this.endpoint, 'llm.providers', signal),
      rpc(this.fetchImpl, this.endpoint, 'settings.describe', signal),
    ])
    if (!Array.isArray(providerValue.providers) || !Array.isArray(settingsValue.namespaces)) {
      throw new Error('DSH Provider inventory response is invalid')
    }
    const namespaces = new Map(settingsValue.namespaces
      .filter(namespace => object(namespace) && typeof namespace.ns === 'string')
      .map(namespace => [namespace.ns, namespace]))
    const providers = providerValue.providers
      .map(provider => sanitizeProvider(provider, namespaces))
      .filter(provider => provider !== undefined)
      .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id))
    const cache = Object.freeze({
      schema: CACHE_SCHEMA,
      updatedAt: this.now().toISOString(),
      providers: Object.freeze(providers),
    })
    await durableReplace(this.cachePath, canonicalJson(cache))
    return cache
  }

  async cached() {
    return validateCache(JSON.parse(await readFile(this.cachePath, 'utf8')))
  }

  async list(snapshot, { refresh = true } = {}) {
    let cache
    let source = 'live'
    let error = null
    if (refresh) {
      try { cache = await this.refresh() } catch (failure) {
        source = 'cache'
        error = failure instanceof Error ? failure.message : String(failure)
      }
    }
    if (cache === undefined) {
      try { cache = await this.cached() } catch (failure) {
        return Object.freeze({
          schema: CACHE_SCHEMA,
          source: 'unavailable',
          updatedAt: null,
          error: error ?? (failure instanceof Error ? failure.message : String(failure)),
          providers: Object.freeze([]),
        })
      }
    }
    return Object.freeze({
      schema: CACHE_SCHEMA,
      source,
      updatedAt: cache.updatedAt,
      error,
      providers: Object.freeze(cache.providers.map(provider => decorate(provider, snapshot))),
    })
  }
}

export const providerInventoryInternals = Object.freeze({ baseUrlFor, configuredProvider, loopbackUrl, validateCache })
