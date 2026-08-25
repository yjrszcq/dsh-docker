import { fetch as undiciFetch, ProxyAgent } from 'undici'

const LOOPBACK = '127.0.0.1'

export const PROXY_SCOPE_PORTS = Object.freeze({
  updates: 17891,
  platform: 17892,
  dshCore: 17893,
  dshPlugins: 17894,
  agent: 17895,
  terminal: 17896,
  provider: 17897,
  sharedDsh: 17898,
})

export function createScopedFetch(scope, { fetchImpl = undiciFetch } = {}) {
  const port = PROXY_SCOPE_PORTS[scope]
  if (port === undefined) throw new TypeError(`unknown outbound proxy scope ${JSON.stringify(scope)}`)
  const dispatcher = new ProxyAgent({ uri: `http://${LOOPBACK}:${String(port)}` })
  const scopedFetch = (input, init = {}) => fetchImpl(input, { ...init, dispatcher })
  scopedFetch.close = () => dispatcher.close()
  return scopedFetch
}
