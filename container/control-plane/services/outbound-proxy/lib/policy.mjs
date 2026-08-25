import { isIP } from 'node:net'
import { matchesProxyRules, normalizeProxyRules } from './rules.mjs'

const PLATFORM_RULES = normalizeProxyRules(['localhost', '127.0.0.1', '::1'], { label: 'platform NO_PROXY' })

export function providerPolicy(configuration, providerId) {
  return configuration.modelApi.providers[providerId] ?? configuration.modelApi.default
}

function scopeEnabled(configuration, scope, providerId) {
  if (scope === 'sharedDsh') return configuration.scopes.dshCore || configuration.scopes.dshPlugins
  if (scope === 'modelApi') return providerId !== undefined && providerPolicy(configuration, providerId) === 'proxy'
  return configuration.scopes[scope] === true
}

function route(mode, reason, snapshot, fields = {}) {
  return Object.freeze({ mode, reason, revision: snapshot.revision, ...fields })
}

export async function selectProxyRoute({ snapshot, scope, providerId, host, port, dnsCache, signal }) {
  const configuration = snapshot.configuration
  const userNoProxy = normalizeProxyRules(configuration.noProxy.user, {
    allowWildcard: true,
    label: 'NO_PROXY',
  })
  const bypass = normalizeProxyRules(configuration.bypass.additional, {
    allowCidr: true,
    label: 'proxy bypass',
  })
  const bypassHosts = bypass.filter(rule => rule.type !== 'cidr')
  const bypassCidrs = bypass.filter(rule => rule.type === 'cidr')
  if (matchesProxyRules(PLATFORM_RULES, host, port)) return route('direct', 'platform-forced-direct', snapshot)
  if (matchesProxyRules(userNoProxy, host, port)) return route('direct', 'no-proxy', snapshot)
  if (matchesProxyRules(bypassHosts, host, port)) return route('direct', 'bypass', snapshot)
  if (isIP(host) !== 0 && matchesProxyRules(bypassCidrs, host, port)) return route('direct', 'bypass', snapshot)
  if (!configuration.enabled || !scopeEnabled(configuration, scope, providerId)) {
    return route('direct', scope === 'modelApi' ? 'provider-direct' : 'scope-direct', snapshot)
  }
  const endpoint = Object.freeze({
    host: configuration.proxy.host,
    port: configuration.proxy.port,
    remoteDns: configuration.proxy.remoteDns,
    username: snapshot.credentials.username,
    password: snapshot.credentials.password,
  })
  if (configuration.proxy.protocol !== 'socks5' || configuration.proxy.remoteDns || isIP(host) !== 0) {
    return route(configuration.proxy.protocol, scope === 'modelApi' ? 'provider-proxy' : 'scope-proxy', snapshot, { endpoint })
  }
  if (dnsCache === undefined) throw new TypeError('SOCKS5 local DNS requires a ProxyDnsCache')
  const targets = await dnsCache.resolve(host, snapshot.revision, { signal })
  const directTargets = targets.filter(target => matchesProxyRules(bypassCidrs, target.address, port))
  if (directTargets.length > 0) return route('direct', 'bypass-cidr', snapshot, { targets: Object.freeze(directTargets) })
  return route('socks5', scope === 'modelApi' ? 'provider-proxy' : 'scope-proxy', snapshot, { endpoint, targets })
}
