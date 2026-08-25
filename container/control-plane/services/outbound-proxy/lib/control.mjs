import { createServer } from 'node:http'
import { outboundProxyEnvironment } from '../../../../platform/lib/outbound-proxy.mjs'

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(value)}\n`)
}

export function createOutboundProxyControl({ getSnapshot, routeHealth }) {
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://outbound-proxy.internal')
    const snapshot = getSnapshot()
    if (request.method === 'GET' && url.pathname === '/v1/status') {
      send(response, 200, {
        componentReady: true,
        revision: snapshot.revision,
        recovery: snapshot.recovery,
        routeHealth: routeHealth.status(snapshot),
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/v1/environment') {
      try {
        const scope = url.searchParams.get('scope')
        const environment = outboundProxyEnvironment(scope, {
          noProxy: [...snapshot.configuration.noProxy.system, ...snapshot.configuration.noProxy.user],
          allProxy: snapshot.configuration.environment.allProxy === 'scope-proxy',
        })
        send(response, 200, { scope, revision: snapshot.revision, environment })
      } catch (error) {
        send(response, 400, { error: error instanceof Error ? error.message : 'invalid scope' })
      }
      return
    }
    send(response, 404, { error: 'not found' })
  })
}
