#!/usr/bin/env node

import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { chmod, mkdir, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { PlatformPaths } from '../../../platform/lib/paths.mjs'
import { PROXY_PORTS } from './lib/contracts.mjs'
import { ProxyConfigurationStore } from './lib/store.mjs'

const paths = new PlatformPaths(
  process.env.DSH_PLATFORM_DATA ?? '/data/platform',
  process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform',
)
const store = new ProxyConfigurationStore(paths.proxyStateRoot)
const snapshot = await store.load()
const listeners = []

function unavailable(socket) {
  socket.end([
    'HTTP/1.1 503 Service Unavailable',
    'Content-Type: text/plain; charset=utf-8',
    'X-DSH-Proxy-Error: PROXY_DATA_PLANE_STARTING',
    'Content-Length: 37',
    'Connection: close',
    '',
    'proxy data plane is not available yet',
  ].join('\r\n'))
}

for (const port of Object.values(PROXY_PORTS)) {
  const server = createNetServer(unavailable)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  listeners.push(server)
}

const control = createHttpServer((request, response) => {
  if (request.method === 'GET' && request.url === '/v1/status') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(`${JSON.stringify({
      componentReady: true,
      revision: snapshot.revision,
      recovery: snapshot.recovery,
      routeHealth: Object.fromEntries(Object.keys(PROXY_PORTS).map(scope => [scope, 'unknown'])),
    })}\n`)
    return
  }
  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
  response.end('{"error":"not found"}\n')
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
await Promise.all(listeners.map(server => new Promise(resolve => server.close(resolve))))
await new Promise(resolve => control.close(resolve))
await unlink(paths.proxyControlSocket).catch(error => {
  if (error?.code !== 'ENOENT') throw error
})
