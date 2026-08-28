import { createServer, request as httpRequest } from 'node:http'

const ROUTES = new Set([
  'GET /_dsh_platform/api/v1/status',
  'POST /_dsh_platform/api/v1/check',
  'POST /_dsh_platform/api/v1/update',
  'GET /_dsh_platform/api/v1/channel',
  'PUT /_dsh_platform/api/v1/channel',
  'POST /_dsh_platform/api/v1/holds/retry',
  'GET /_dsh_platform/api/v1/rollback-plan',
  'POST /_dsh_platform/api/v1/rollback',
  'POST /_dsh_platform/api/v1/return-stable',
  'POST /_dsh_platform/api/v1/start-dsh',
  'POST /_dsh_platform/api/v1/stop-dsh',
  'POST /_dsh_platform/api/v1/restart-dsh',
  'GET /_dsh_platform/api/v1/logs',
])

export function restrictedCliRoute(method, target) {
  let pathname
  try { pathname = new URL(target, 'http://management-cli.internal').pathname } catch { return false }
  return ROUTES.has(`${method} ${pathname}`)
}

export function createRestrictedCliServer({ managementSocketPath, token }) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('restricted CLI token is invalid')
  return createServer((request, response) => {
    if (!restrictedCliRoute(request.method ?? 'GET', request.url ?? '/')) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'CLI route is not available', code: 'CLI_ROUTE_NOT_AVAILABLE' }))
      return
    }
    const headers = { 'x-dsh-restricted-cli': token }
    for (const name of ['accept', 'content-length', 'content-type']) {
      if (request.headers[name] !== undefined) headers[name] = request.headers[name]
    }
    const upstream = httpRequest({
      socketPath: managementSocketPath,
      method: request.method,
      path: request.url,
      headers,
    }, upstreamResponse => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
      upstreamResponse.pipe(response)
    })
    upstream.once('error', error => {
      if (response.headersSent) response.destroy(error)
      else {
        response.writeHead(503, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'Management service is unavailable', code: 'MANAGEMENT_UNAVAILABLE' }))
      }
    })
    request.pipe(upstream)
  })
}
