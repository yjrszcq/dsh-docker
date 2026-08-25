import { createServer } from 'node:http'
import { outboundProxyEnvironment } from '../../../../platform/lib/outbound-proxy.mjs'
import { ProxyConfigurationError, proxyErrorBody } from './errors.mjs'

const MAX_CONTROL_BODY_BYTES = 4096

async function jsonBody(request) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.byteLength
    if (total > MAX_CONTROL_BODY_BYTES) throw new ProxyConfigurationError('control request body is too large')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
    throw new ProxyConfigurationError('control request body is invalid')
  }
}

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(value)}\n`)
}

export function createOutboundProxyControl({ getSnapshot, routeHealth, providerHandles }) {
  return createServer(async (request, response) => {
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
    if (request.method === 'POST' && url.pathname === '/v1/provider-handles') {
      try {
        if (providerHandles === undefined) throw new Error('provider handles are unavailable')
        send(response, 201, providerHandles.issue(await jsonBody(request), snapshot))
      } catch (error) {
        send(response, error?.statusCode ?? 400, proxyErrorBody(error))
      }
      return
    }
    send(response, 404, { error: 'not found' })
  })
}
