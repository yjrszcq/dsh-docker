import { readFileSync } from 'node:fs'
import { Agent, fetch as undiciFetch, ProxyAgent } from 'undici'
import { OUTBOUND_PROXY_PORTS, outboundProxyScopeEnabled } from '../../../platform/lib/outbound-proxy.mjs'

const LOOPBACK = '127.0.0.1'
const DEFAULT_ROUTING_STATE = '/run/dsh-platform/outbound-proxy-routing.json'

export const PROXY_SCOPE_PORTS = Object.freeze({
  updates: OUTBOUND_PROXY_PORTS.updates,
  platform: OUTBOUND_PROXY_PORTS.platform,
  dshCore: OUTBOUND_PROXY_PORTS.dshCore,
  dshPlugins: OUTBOUND_PROXY_PORTS.dshPlugins,
  agent: OUTBOUND_PROXY_PORTS.agentNetwork,
  terminal: OUTBOUND_PROXY_PORTS.managementTerminal,
  provider: OUTBOUND_PROXY_PORTS.modelApi,
  sharedDsh: OUTBOUND_PROXY_PORTS.sharedDsh,
})

const CONFIGURATION_SCOPE = Object.freeze({
  updates: 'updates', platform: 'platform', dshCore: 'dshCore', dshPlugins: 'dshPlugins',
  agent: 'agentNetwork', terminal: 'managementTerminal',
})

function proxyEnabled(path, scope) {
  try {
    const state = JSON.parse(readFileSync(path, 'utf8'))
    if (state?.schema !== 1 || typeof state.enabled !== 'boolean') return true
    const configurationScope = CONFIGURATION_SCOPE[scope]
    return configurationScope === undefined ? true : outboundProxyScopeEnabled(state, configurationScope)
  } catch {
    return true
  }
}

export function createScopedFetch(scope, {
  fetchImpl = undiciFetch,
  routingStatePath = DEFAULT_ROUTING_STATE,
  createDirectDispatcher = () => new Agent(),
  createProxyDispatcher = options => new ProxyAgent(options),
} = {}) {
  const port = PROXY_SCOPE_PORTS[scope]
  if (port === undefined) throw new TypeError(`unknown outbound proxy scope ${JSON.stringify(scope)}`)
  const directDispatcher = createDirectDispatcher()
  const proxyDispatcher = createProxyDispatcher({ uri: `http://${LOOPBACK}:${String(port)}` })
  const scopedFetch = (input, init = {}) => fetchImpl(input, {
    ...init,
    dispatcher: proxyEnabled(routingStatePath, scope) ? proxyDispatcher : directDispatcher,
  })
  scopedFetch.close = async () => {
    await Promise.all([directDispatcher.close(), proxyDispatcher.close()])
  }
  return scopedFetch
}

export const scopedFetchInternals = Object.freeze({ proxyEnabled })
