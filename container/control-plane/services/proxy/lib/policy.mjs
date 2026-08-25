import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { matchesProxyRules, normalizeProxyRules } from './rules.mjs'

const PLATFORM_RULES = normalizeProxyRules(['localhost', '127.0.0.1', '::1'], { label: 'platform NO_PROXY' })

function scopeEnabled(configuration, scope) {
  if (scope === 'sharedDsh') return configuration.scopes.dshCore || configuration.scopes.dshPlugins
  if (scope === 'modelApi') return false
  return configuration.scopes[scope] === true
}

async function resolvedAddresses(host, resolver) {
  if (isIP(host) !== 0) return [host]
  try {
    const records = await resolver(host, { all: true, verbatim: true })
    return [...new Set(records.map(record => record.address))]
  } catch {
    return []
  }
}

async function rulesMatch(rules, host, port, resolver) {
  if (matchesProxyRules(rules.filter(rule => rule.type !== 'cidr'), host, port)) return true
  const cidr = rules.filter(rule => rule.type === 'cidr')
  if (cidr.length === 0) return false
  const addresses = await resolvedAddresses(host, resolver)
  return addresses.some(address => matchesProxyRules(cidr, address, port))
}

export async function selectProxyRoute({ snapshot, scope, host, port, resolver = lookup }) {
  const configuration = snapshot.configuration
  const userNoProxy = normalizeProxyRules(configuration.noProxy.user, {
    allowWildcard: true,
    label: 'NO_PROXY',
  })
  const bypass = normalizeProxyRules(configuration.bypass.additional, {
    allowCidr: true,
    label: 'proxy bypass',
  })
  if (await rulesMatch(PLATFORM_RULES, host, port, resolver)) {
    return Object.freeze({ mode: 'direct', reason: 'platform-forced-direct', revision: snapshot.revision })
  }
  if (await rulesMatch(userNoProxy, host, port, resolver)) {
    return Object.freeze({ mode: 'direct', reason: 'no-proxy', revision: snapshot.revision })
  }
  if (await rulesMatch(bypass, host, port, resolver)) {
    return Object.freeze({ mode: 'direct', reason: 'bypass', revision: snapshot.revision })
  }
  if (!configuration.enabled || !scopeEnabled(configuration, scope)) {
    return Object.freeze({ mode: 'direct', reason: 'scope-direct', revision: snapshot.revision })
  }
  return Object.freeze({
    mode: configuration.proxy.protocol,
    reason: 'scope-proxy',
    revision: snapshot.revision,
    endpoint: Object.freeze({
      host: configuration.proxy.host,
      port: configuration.proxy.port,
      remoteDns: configuration.proxy.remoteDns,
      username: snapshot.credentials.username,
      password: snapshot.credentials.password,
    }),
  })
}
