const LOOPBACK = '127.0.0.1'

export const OUTBOUND_PROXY_PORTS = Object.freeze({
  updates: 17891,
  platform: 17892,
  dshCore: 17893,
  dshPlugins: 17894,
  agentNetwork: 17895,
  managementTerminal: 17896,
  modelApi: 17897,
  sharedDsh: 17898,
})

export const OUTBOUND_PROXY_SCOPES = Object.freeze(Object.keys(OUTBOUND_PROXY_PORTS))
export const PLATFORM_NO_PROXY = Object.freeze(['localhost', '127.0.0.1', '::1'])
export const OUTBOUND_PROXY_ENVIRONMENT_KEYS = Object.freeze([
  'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy',
  'ALL_PROXY', 'all_proxy',
])

export function outboundProxyUrl(scope) {
  const port = OUTBOUND_PROXY_PORTS[scope]
  if (port === undefined) throw new Error(`outbound proxy scope ${String(scope)} is invalid`)
  return `http://${LOOPBACK}:${String(port)}`
}

export function outboundProxyScopeEnabled(configuration, scope, providerId) {
  if (configuration?.enabled !== true) return false
  if (scope === 'sharedDsh') return configuration.scopes?.dshCore === true || configuration.scopes?.dshPlugins === true
  if (scope === 'modelApi') {
    if (providerId === undefined) return false
    const policy = configuration.modelApi?.providers?.[providerId] ?? configuration.modelApi?.default
    return policy?.proxyEnabled === true
  }
  return configuration.scopes?.[scope] === true
}

export function outboundProxyEnvironment(scope, {
  noProxy = PLATFORM_NO_PROXY,
  allProxy = false,
  enabled = true,
} = {}) {
  if (!Array.isArray(noProxy) || noProxy.some(value => typeof value !== 'string' || value.length === 0)) {
    throw new Error('outbound proxy NO_PROXY entries are invalid')
  }
  if (typeof allProxy !== 'boolean') throw new Error('outbound proxy ALL_PROXY setting is invalid')
  const proxy = outboundProxyUrl(scope)
  const bypass = [...new Set(noProxy)].join(',')
  if (typeof enabled !== 'boolean') throw new Error('outbound proxy enabled setting is invalid')
  return Object.freeze({
    ...Object.fromEntries(OUTBOUND_PROXY_ENVIRONMENT_KEYS.map(key => [key, undefined])),
    NO_PROXY: bypass,
    no_proxy: bypass,
    ...(enabled ? {
      HTTP_PROXY: proxy,
      HTTPS_PROXY: proxy,
      http_proxy: proxy,
      https_proxy: proxy,
      ...(allProxy ? { ALL_PROXY: proxy, all_proxy: proxy } : {}),
    } : {}),
  })
}

export function parseOutboundProxyEnvironment(value, scope) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('outbound proxy environment response is invalid')
  }
  const expectedUrl = outboundProxyUrl(scope)
  const allowed = new Set([
    'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy',
    'NO_PROXY', 'no_proxy', 'ALL_PROXY', 'all_proxy',
  ])
  if (Object.keys(value).some(key => !allowed.has(key))) {
    throw new Error('outbound proxy environment response contains unsupported fields')
  }
  const proxyKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']
  const proxied = proxyKeys.some(key => value[key] !== undefined)
  for (const key of proxyKeys) {
    if (proxied ? value[key] !== expectedUrl : value[key] !== undefined) {
      throw new Error(`outbound proxy environment ${key} is invalid`)
    }
  }
  if (typeof value.NO_PROXY !== 'string' || value.no_proxy !== value.NO_PROXY) {
    throw new Error('outbound proxy environment NO_PROXY is invalid')
  }
  const hasAllProxy = value.ALL_PROXY !== undefined || value.all_proxy !== undefined
  if (hasAllProxy && (value.ALL_PROXY !== expectedUrl || value.all_proxy !== expectedUrl)) {
    throw new Error('outbound proxy environment ALL_PROXY is invalid')
  }
  return Object.freeze(Object.fromEntries(Object.entries(value)))
}

export function clearOutboundProxyEnvironment(value = {}) {
  return Object.freeze({
    ...Object.fromEntries(OUTBOUND_PROXY_ENVIRONMENT_KEYS.map(key => [key, undefined])),
    ...value,
  })
}
