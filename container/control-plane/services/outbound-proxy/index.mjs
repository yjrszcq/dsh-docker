#!/usr/bin/env node

import { chmod, mkdir, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { PlatformPaths } from '../../../platform/lib/paths.mjs'
import { PROXY_PORTS } from './lib/contracts.mjs'
import { createOutboundProxyControl } from './lib/control.mjs'
import { createScopedProxyServer, ProxyAgentPool } from './lib/data-plane.mjs'
import { ProxyDnsCache } from './lib/dns-cache.mjs'
import { probeProxyEntry } from './lib/readiness.mjs'
import { ProxyRouteHealth } from './lib/route-health.mjs'
import { ProxyConfigurationStore } from './lib/store.mjs'
import { ProviderHandleStore } from './lib/provider-handles.mjs'

const paths = new PlatformPaths(
  process.env.DSH_PLATFORM_DATA ?? '/data/platform',
  process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform',
)
const store = new ProxyConfigurationStore(paths.proxyStateRoot)
let snapshot = await store.load()
const listeners = []
const dnsCache = new ProxyDnsCache()
const agentPool = new ProxyAgentPool()
const routeHealth = new ProxyRouteHealth()
const providerHandles = new ProviderHandleStore()

for (const [scope, port] of Object.entries(PROXY_PORTS)) {
  const server = createScopedProxyServer({
    scope, getSnapshot: () => snapshot, dnsCache, agentPool, routeHealth, providerHandles,
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  listeners.push(server)
}
await Promise.all(Object.values(PROXY_PORTS).map(port => probeProxyEntry(port)))

const control = createOutboundProxyControl({ getSnapshot: () => snapshot, routeHealth, providerHandles })
await mkdir(dirname(paths.proxyControlSocket), { recursive: true })
await unlink(paths.proxyControlSocket).catch(error => {
  if (error?.code !== 'ENOENT') throw error
})
await new Promise((resolve, reject) => {
  control.once('error', reject)
  control.listen(paths.proxyControlSocket, resolve)
})
await chmod(paths.proxyControlSocket, 0o600)

process.send?.({
  type: 'ready',
  componentReady: true,
  revision: snapshot.revision,
  ports: Object.values(PROXY_PORTS),
})

let resolveSignal
const signal = new Promise(resolve => { resolveSignal = resolve })
process.once('SIGINT', () => resolveSignal())
process.once('SIGTERM', () => resolveSignal())
await signal
agentPool.close()
await Promise.all(listeners.map(server => new Promise(resolve => server.close(resolve))))
await new Promise(resolve => control.close(resolve))
await unlink(paths.proxyControlSocket).catch(error => {
  if (error?.code !== 'ENOENT') throw error
})
