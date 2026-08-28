#!/usr/bin/env node

import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
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
import { ProxyTestManager } from './lib/test-manager.mjs'

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
const proxyTests = new ProxyTestManager({
  statePath: paths.proxyTestStatePath,
})
await proxyTests.initialize(async path => JSON.parse(await readFile(path, 'utf8')))

const ENTRY_BIND_ATTEMPTS = 21
const ENTRY_BIND_RETRY_MS = 50

async function listenProxyEntry(server, port) {
  for (let attempt = 1; attempt <= ENTRY_BIND_ATTEMPTS; attempt += 1) {
    try {
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          server.off('error', onError)
          server.off('listening', onListening)
        }
        const onError = error => {
          cleanup()
          reject(error)
        }
        const onListening = () => {
          cleanup()
          resolve()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, '127.0.0.1')
      })
      return
    } catch (error) {
      if (error?.code !== 'EADDRINUSE' || attempt === ENTRY_BIND_ATTEMPTS) throw error
      await new Promise(resolve => setTimeout(resolve, ENTRY_BIND_RETRY_MS))
    }
  }
}

async function publishRoutingState(current) {
  const staging = `${paths.proxyRoutingStatePath}.${String(process.pid)}.tmp`
  const value = {
    schema: 1,
    revision: current.revision,
    enabled: current.configuration.enabled,
    scopes: current.configuration.scopes,
    modelApi: current.configuration.modelApi,
    environment: current.configuration.environment,
    noProxy: current.configuration.noProxy,
    bypass: current.configuration.bypass,
  }
  await writeFile(staging, `${JSON.stringify(value)}\n`, { mode: 0o644 })
  await chmod(staging, 0o644)
  await rename(staging, paths.proxyRoutingStatePath)
}

await publishRoutingState(snapshot)

for (const [scope, port] of Object.entries(PROXY_PORTS)) {
  const server = createScopedProxyServer({
    scope, getSnapshot: () => snapshot, dnsCache, agentPool, routeHealth, providerHandles,
  })
  await listenProxyEntry(server, port)
  listeners.push(server)
}
await Promise.all(Object.values(PROXY_PORTS).map(port => probeProxyEntry(port)))

const control = createOutboundProxyControl({
  getSnapshot: () => snapshot,
  routeHealth,
  providerHandles,
  proxyTests,
  getTestState: () => proxyTests.getState(),
  commitConfiguration: async request => {
    const activated = await store.commit(request)
    snapshot = Object.freeze({ ...activated, recovery: 'none' })
    await publishRoutingState(snapshot)
    return snapshot
  },
})
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
