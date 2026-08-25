import { fetch as undiciFetch, ProxyAgent } from 'undici'
import { OUTBOUND_PROXY_PORTS } from '../../../platform/lib/outbound-proxy.mjs'

const LOOPBACK = '127.0.0.1'

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

export function createScopedFetch(scope, { fetchImpl = undiciFetch } = {}) {
  const port = PROXY_SCOPE_PORTS[scope]
  if (port === undefined) throw new TypeError(`unknown outbound proxy scope ${JSON.stringify(scope)}`)
  const dispatcher = new ProxyAgent({ uri: `http://${LOOPBACK}:${String(port)}` })
  const scopedFetch = (input, init = {}) => fetchImpl(input, { ...init, dispatcher })
  scopedFetch.close = () => dispatcher.close()
  return scopedFetch
}
