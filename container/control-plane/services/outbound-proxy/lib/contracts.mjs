import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'
import { ProxyConfigurationError } from './errors.mjs'
import { normalizeProxyRules, PLATFORM_NO_PROXY } from './rules.mjs'
import { OUTBOUND_PROXY_PORTS } from '../../../../platform/lib/outbound-proxy.mjs'

export const PROXY_SCHEMA = 1
export const PROXY_SCOPES = Object.freeze([
  'updates', 'platform', 'dshCore', 'dshPlugins', 'agentNetwork', 'managementTerminal',
])
export const PROXY_PORTS = OUTBOUND_PROXY_PORTS

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProxyConfigurationError(`${label} must be an object`)
  }
  return value
}

function allowedKeys(value, allowed, label) {
  const extras = Object.keys(value).filter(key => !allowed.includes(key))
  if (extras.length > 0) throw new ProxyConfigurationError(`${label} contains unsupported fields: ${extras.sort().join(', ')}`)
}

function requiredKeys(value, required, label) {
  const missing = required.filter(key => !(key in value))
  if (missing.length > 0) throw new ProxyConfigurationError(`${label} is missing fields: ${missing.join(', ')}`)
}

function normalizeProxyHost(value) {
  if (typeof value !== 'string' || value !== value.trim() || /[\u0000-\u0020\u007f\/@?#]/.test(value)) {
    throw new ProxyConfigurationError('proxy host is invalid')
  }
  if (value === '') return ''
  if (isIP(value) !== 0) return value.toLowerCase()
  const ascii = domainToASCII(value.toLowerCase().replace(/\.$/, ''))
  if (ascii === '' || ascii.length > 253 || ascii.split('.').some(part => part === '' || part.length > 63)) {
    throw new ProxyConfigurationError('proxy host is invalid')
  }
  return ascii
}

function normalizeScopes(value) {
  object(value, 'proxy scopes')
  requiredKeys(value, PROXY_SCOPES, 'proxy scopes')
  allowedKeys(value, PROXY_SCOPES, 'proxy scopes')
  return Object.fromEntries(PROXY_SCOPES.map(scope => {
    if (typeof value[scope] !== 'boolean') throw new ProxyConfigurationError(`proxy scope ${scope} must be boolean`)
    return [scope, value[scope]]
  }))
}

function normalizeProviderPolicy(value, label) {
  if (!['direct', 'proxy'].includes(value)) throw new ProxyConfigurationError(`${label} must be direct or proxy`)
  return value
}

export function validProviderId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value)
}

export function assertSupportedProviderPolicies(value, supportedProviderIds = new Set()) {
  if (value?.modelApi?.default !== 'direct') {
    throw new ProxyConfigurationError('model API default proxy policy is not supported', {
      code: 'PROVIDER_POLICY_UNSUPPORTED', stage: 'validate',
    })
  }
  for (const id of Object.keys(value?.modelApi?.providers ?? {})) {
    if (!supportedProviderIds.has(id)) {
      throw new ProxyConfigurationError(`model API provider ${id} cannot use an independent proxy route`, {
        code: 'PROVIDER_POLICY_UNSUPPORTED', stage: 'validate',
      })
    }
  }
}

function normalizeModelApi(value) {
  object(value, 'model API proxy policy')
  requiredKeys(value, ['default', 'providers'], 'model API proxy policy')
  allowedKeys(value, ['default', 'providers'], 'model API proxy policy')
  object(value.providers, 'model API provider policies')
  const providers = {}
  for (const [id, policy] of Object.entries(value.providers)) {
    if (!validProviderId(id)) throw new ProxyConfigurationError('model API provider ID is invalid')
    providers[id] = normalizeProviderPolicy(policy, `model API provider ${id}`)
  }
  return { default: normalizeProviderPolicy(value.default, 'model API default'), providers }
}

export function defaultProxyConfiguration() {
  return Object.freeze({
    schema: PROXY_SCHEMA,
    enabled: false,
    proxy: Object.freeze({
      protocol: 'http', host: '', port: null, username: '', passwordConfigured: false, remoteDns: true,
    }),
    scopes: Object.freeze(Object.fromEntries(PROXY_SCOPES.map(scope => [scope, false]))),
    environment: Object.freeze({ allProxy: null }),
    modelApi: Object.freeze({ default: 'direct', providers: Object.freeze({}) }),
    noProxy: Object.freeze({ system: PLATFORM_NO_PROXY, user: Object.freeze([]) }),
    bypass: Object.freeze({ additional: Object.freeze([]) }),
  })
}

export function validateProxyConfiguration(value, { existingPassword = null } = {}) {
  object(value, 'proxy configuration')
  requiredKeys(value, ['schema', 'enabled', 'proxy', 'scopes', 'environment', 'modelApi', 'noProxy', 'bypass'], 'proxy configuration')
  allowedKeys(value, ['schema', 'enabled', 'proxy', 'scopes', 'environment', 'modelApi', 'noProxy', 'bypass'], 'proxy configuration')
  if (value.schema !== PROXY_SCHEMA) throw new ProxyConfigurationError('proxy configuration schema must be 1')
  if (typeof value.enabled !== 'boolean') throw new ProxyConfigurationError('proxy enabled must be boolean')

  const proxy = object(value.proxy, 'proxy endpoint')
  requiredKeys(proxy, ['protocol', 'host', 'port', 'username', 'remoteDns'], 'proxy endpoint')
  allowedKeys(proxy, ['protocol', 'host', 'port', 'username', 'password', 'clearPassword', 'passwordConfigured', 'remoteDns'], 'proxy endpoint')
  if (!['http', 'socks5'].includes(proxy.protocol)) throw new ProxyConfigurationError('proxy protocol must be http or socks5')
  const host = normalizeProxyHost(proxy.host)
  const port = proxy.port === null ? null : Number(proxy.port)
  if (port !== null && (!Number.isSafeInteger(port) || port < 1 || port > 65535)) throw new ProxyConfigurationError('proxy port is invalid')
  if (value.enabled && (host === '' || port === null)) throw new ProxyConfigurationError('enabled proxy requires a host and port')
  if ((host === '') !== (port === null)) throw new ProxyConfigurationError('proxy host and port must be configured together')
  if (typeof proxy.username !== 'string' || Buffer.byteLength(proxy.username, 'utf8') > 255 || /[\u0000-\u001f\u007f]/.test(proxy.username)) {
    throw new ProxyConfigurationError('proxy username is invalid')
  }
  if (typeof proxy.remoteDns !== 'boolean') throw new ProxyConfigurationError('proxy remoteDns must be boolean')
  if (proxy.clearPassword === true && proxy.password !== undefined && proxy.password !== null) {
    throw new ProxyConfigurationError('proxy password cannot be set and cleared together')
  }
  let password = existingPassword
  if (proxy.clearPassword === true) password = null
  else if (proxy.password !== undefined && proxy.password !== null) {
    if (typeof proxy.password !== 'string' || proxy.password === '' || Buffer.byteLength(proxy.password, 'utf8') > 255 || /[\u0000-\u001f\u007f]/.test(proxy.password)) {
      throw new ProxyConfigurationError('proxy password is invalid')
    }
    password = proxy.password
  }

  const environment = object(value.environment, 'proxy environment')
  requiredKeys(environment, ['allProxy'], 'proxy environment')
  allowedKeys(environment, ['allProxy'], 'proxy environment')
  if (environment.allProxy !== null && environment.allProxy !== 'scope-proxy') {
    throw new ProxyConfigurationError('proxy environment allProxy must be null or scope-proxy')
  }
  const noProxy = object(value.noProxy, 'NO_PROXY')
  requiredKeys(noProxy, ['user'], 'NO_PROXY')
  allowedKeys(noProxy, ['user', 'system'], 'NO_PROXY')
  const bypass = object(value.bypass, 'proxy bypass')
  requiredKeys(bypass, ['additional'], 'proxy bypass')
  allowedKeys(bypass, ['additional'], 'proxy bypass')

  const normalized = {
    schema: PROXY_SCHEMA,
    enabled: value.enabled,
    proxy: {
      protocol: proxy.protocol,
      host,
      port,
      username: proxy.username,
      passwordConfigured: password !== null,
      remoteDns: proxy.remoteDns,
    },
    scopes: normalizeScopes(value.scopes),
    environment: { allProxy: environment.allProxy },
    modelApi: normalizeModelApi(value.modelApi),
    noProxy: {
      system: PLATFORM_NO_PROXY,
      user: normalizeProxyRules(noProxy.user, { allowWildcard: true, label: 'NO_PROXY' }).map(rule => rule.value),
    },
    bypass: {
      additional: normalizeProxyRules(bypass.additional, { allowCidr: true, label: 'proxy bypass' }).map(rule => rule.value),
    },
  }
  return Object.freeze({
    configuration: deepFreeze(normalized),
    credentials: deepFreeze({ username: proxy.username, password }),
  })
}

export function sanitizedProxyConfiguration(configuration, revision, state = {}) {
  return Object.freeze({
    ...configuration,
    revision,
    componentReady: state.componentReady === true,
    routeHealth: state.routeHealth ?? Object.fromEntries([...PROXY_SCOPES, 'modelApi', 'sharedDsh'].map(scope => [scope, 'unknown'])),
    lastTest: state.lastTest ?? null,
  })
}
