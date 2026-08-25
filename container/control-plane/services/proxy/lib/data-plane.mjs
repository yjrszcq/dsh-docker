import { createServer, request as httpRequest } from 'node:http'
import { connectTcp, basicProxyAuthorization, connectThroughHttpProxy, PROXY_TIMEOUTS, ProxyTransportError } from './transport.mjs'
import { selectProxyRoute } from './policy.mjs'

const MAX_HEADER_LINE_BYTES = 64 * 1024
const MAX_CONNECT_AUTHORITY_BYTES = 1024
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
])

function proxyError(response, statusCode, code, message) {
  if (response.headersSent) return response.destroy()
  const body = `${message}\n`
  response.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'x-dsh-proxy-error': code,
    connection: 'close',
  })
  response.end(body)
}

function socketError(socket, statusCode, code, message) {
  if (socket.destroyed) return
  const body = `${message}\n`
  socket.end([
    `HTTP/1.1 ${statusCode} ${statusCode === 504 ? 'Gateway Timeout' : statusCode === 431 ? 'Request Header Fields Too Large' : statusCode === 400 ? 'Bad Request' : 'Bad Gateway'}`,
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    `X-DSH-Proxy-Error: ${code}`,
    'Connection: close',
    '',
    body,
  ].join('\r\n'))
}

function errorFields(error) {
  if (error instanceof ProxyTransportError) {
    return { statusCode: error.statusCode, code: error.code, message: error.message }
  }
  return { statusCode: 502, code: 'UPSTREAM_CONNECT_FAILED', message: 'upstream connection failed' }
}

function checkHeaderLimits(request) {
  if (request.rawHeaders.length / 2 > 256) return false
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (Buffer.byteLength(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`, 'latin1') > MAX_HEADER_LINE_BYTES) return false
  }
  return true
}

function connectionTokens(headers) {
  return new Set(String(headers.connection ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean))
}

function forwardHeaders(headers, { upgrade = false, authorization = null, host }) {
  const tokens = connectionTokens(headers)
  const result = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (HOP_BY_HOP.has(lower) || tokens.has(lower)) continue
    if (value !== undefined) result[lower] = value
  }
  result.host = host
  if (upgrade) {
    result.connection = 'Upgrade'
    result.upgrade = headers.upgrade
  }
  if (authorization !== null) result['proxy-authorization'] = authorization
  return result
}

function responseHeaders(headers) {
  const tokens = connectionTokens(headers)
  const result = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (HOP_BY_HOP.has(lower) || tokens.has(lower)) continue
    if (value !== undefined) result[lower] = value
  }
  return result
}

function parseAbsoluteTarget(raw) {
  let target
  try { target = new URL(raw) } catch { return null }
  if (target.username !== '' || target.password !== '' || target.hostname === '' || target.hash !== '') return null
  if (!['http:', 'ws:'].includes(target.protocol)) return Object.freeze({ unsupported: true, url: target })
  const port = target.port === '' ? 80 : Number(target.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  const host = target.hostname.startsWith('[') && target.hostname.endsWith(']')
    ? target.hostname.slice(1, -1)
    : target.hostname
  return Object.freeze({ url: target, host, port, authority: target.host })
}

function parseAuthority(raw) {
  if (Buffer.byteLength(raw) > MAX_CONNECT_AUTHORITY_BYTES || raw.includes('/') || raw.includes('@')) return null
  try {
    const value = new URL(`tcp://${raw}`)
    if (value.hostname === '' || value.port === '') return null
    const port = Number(value.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null
    const host = value.hostname.startsWith('[') && value.hostname.endsWith(']')
      ? value.hostname.slice(1, -1)
      : value.hostname
    return Object.freeze({ host, port })
  } catch { return null }
}

function requestPath(target) {
  return `${target.url.pathname || '/'}${target.url.search}`
}

function idle(socket, timeoutMs) {
  socket.setTimeout(timeoutMs, () => socket.destroy(new ProxyTransportError('upstream stream timed out', {
    code: 'UPSTREAM_TIMEOUT', statusCode: 504,
  })))
}

function bridge(left, right, { leftHead = Buffer.alloc(0), rightHead = Buffer.alloc(0), timeoutMs }) {
  idle(left, timeoutMs)
  idle(right, timeoutMs)
  if (leftHead.byteLength > 0) right.write(leftHead)
  if (rightHead.byteLength > 0) left.write(rightHead)
  left.pipe(right)
  right.pipe(left)
  const close = error => {
    if (!left.destroyed) left.destroy(error)
    if (!right.destroyed) right.destroy(error)
  }
  left.once('error', close)
  right.once('error', close)
}

async function routeSocket(route, target) {
  if (route.mode === 'direct') return Object.freeze({
    socket: await connectTcp({ host: target.host, port: target.port }),
    remainder: Buffer.alloc(0),
  })
  if (route.mode === 'http') return connectThroughHttpProxy({
    endpoint: route.endpoint,
    targetHost: target.host,
    targetPort: target.port,
  })
  throw new ProxyTransportError('configured proxy protocol is not available', {
    code: 'PROXY_PROTOCOL_UNAVAILABLE',
  })
}

async function httpConnection(route, target) {
  if (route.mode === 'direct') return connectTcp({ host: target.host, port: target.port })
  if (route.mode === 'http') return connectTcp({ host: route.endpoint.host, port: route.endpoint.port })
  throw new ProxyTransportError('configured proxy protocol is not available', {
    code: 'PROXY_PROTOCOL_UNAVAILABLE',
  })
}

async function handleHttp(request, response, context) {
  if (!checkHeaderLimits(request)) return proxyError(response, 431, 'REQUEST_HEADERS_TOO_LARGE', 'request headers are too large')
  const target = parseAbsoluteTarget(request.url ?? '')
  if (target === null || target.unsupported === true || target.url.protocol !== 'http:') {
    const invalid = target === null
    return proxyError(response, invalid ? 400 : 501, invalid ? 'INVALID_PROXY_REQUEST' : 'UNSUPPORTED_TARGET_SCHEME', invalid ? 'absolute-form HTTP target required' : 'target scheme is not supported')
  }
  let upstream
  try {
    request.pause()
    const snapshot = context.getSnapshot()
    const route = await selectProxyRoute({ snapshot, scope: context.scope, host: target.host, port: target.port, resolver: context.resolver })
    const proxied = route.mode === 'http'
    const socket = await httpConnection(route, target)
    const headers = forwardHeaders(request.headers, {
      host: target.authority,
      authorization: proxied ? basicProxyAuthorization(route.endpoint.username, route.endpoint.password) : null,
    })
    upstream = httpRequest({
      host: proxied ? route.endpoint.host : target.host,
      port: proxied ? route.endpoint.port : target.port,
      method: request.method,
      path: proxied ? target.url.href : requestPath(target),
      headers,
      agent: false,
      createConnection: () => socket,
    })
    upstream.setTimeout(PROXY_TIMEOUTS.responseHeaderMs, () => upstream.destroy(new ProxyTransportError('upstream response timed out', {
      code: 'UPSTREAM_TIMEOUT', statusCode: 504,
    })))
    request.once('aborted', () => upstream.destroy())
    upstream.once('response', incoming => {
      if (proxied && incoming.statusCode === 407) {
        incoming.resume()
        return proxyError(response, 502, 'UPSTREAM_PROXY_AUTH_FAILED', 'upstream proxy authentication failed')
      }
      incoming.socket.setTimeout(PROXY_TIMEOUTS.streamIdleMs, () => incoming.destroy(new ProxyTransportError('upstream response timed out', {
        code: 'UPSTREAM_TIMEOUT', statusCode: 504,
      })))
      response.writeHead(incoming.statusCode ?? 502, incoming.statusMessage, responseHeaders(incoming.headers))
      incoming.pipe(response, { end: false })
      incoming.once('end', () => {
        if (Object.keys(incoming.trailers).length > 0) response.addTrailers(incoming.trailers)
        response.end()
      })
      incoming.once('error', error => response.destroy(error))
    })
    upstream.once('error', error => {
      const fields = errorFields(error)
      proxyError(response, fields.statusCode, fields.code, fields.message)
    })
    request.pipe(upstream)
    request.resume()
  } catch (error) {
    upstream?.destroy()
    const fields = errorFields(error)
    proxyError(response, fields.statusCode, fields.code, fields.message)
  }
}

function rawRequest(request, target, { absolute, authorization }) {
  const headers = forwardHeaders(request.headers, {
    upgrade: true,
    host: target.authority,
    authorization,
  })
  const start = `${request.method ?? 'GET'} ${absolute ? target.url.href : requestPath(target)} HTTP/${request.httpVersion}`
  return Buffer.from(`${[start, ...Object.entries(headers).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`), '', ''].join('\r\n')}`, 'latin1')
}

async function handleUpgrade(request, socket, head, context) {
  if (!checkHeaderLimits(request)) return socketError(socket, 431, 'REQUEST_HEADERS_TOO_LARGE', 'request headers are too large')
  const target = parseAbsoluteTarget(request.url ?? '')
  if (target === null || target.unsupported === true || target.url.protocol !== 'ws:' || String(request.headers.upgrade ?? '').toLowerCase() !== 'websocket') {
    const invalid = target === null
    return socketError(socket, invalid ? 400 : 501, invalid ? 'INVALID_PROXY_REQUEST' : 'UNSUPPORTED_TARGET_SCHEME', invalid ? 'absolute-form WS target required' : 'target scheme is not supported')
  }
  try {
    const route = await selectProxyRoute({ snapshot: context.getSnapshot(), scope: context.scope, host: target.host, port: target.port, resolver: context.resolver })
    if (!['direct', 'http'].includes(route.mode)) throw new ProxyTransportError('configured proxy protocol is not available', { code: 'PROXY_PROTOCOL_UNAVAILABLE' })
    const upstream = await connectTcp({
      host: route.mode === 'http' ? route.endpoint.host : target.host,
      port: route.mode === 'http' ? route.endpoint.port : target.port,
    })
    const authorization = route.mode === 'http' ? basicProxyAuthorization(route.endpoint.username, route.endpoint.password) : null
    const preface = rawRequest(request, target, { absolute: route.mode === 'http', authorization })
    bridge(socket, upstream, { leftHead: Buffer.concat([preface, head]), timeoutMs: PROXY_TIMEOUTS.streamIdleMs })
  } catch (error) {
    const fields = errorFields(error)
    socketError(socket, fields.statusCode, fields.code, fields.message)
  }
}

async function handleConnect(request, socket, head, context) {
  if (!checkHeaderLimits(request)) return socketError(socket, 431, 'REQUEST_HEADERS_TOO_LARGE', 'request headers are too large')
  const target = parseAuthority(request.url ?? '')
  if (target === null) return socketError(socket, 400, 'INVALID_CONNECT_AUTHORITY', 'CONNECT authority is invalid')
  try {
    const route = await selectProxyRoute({ snapshot: context.getSnapshot(), scope: context.scope, host: target.host, port: target.port, resolver: context.resolver })
    const connected = await routeSocket(route, target)
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    bridge(socket, connected.socket, {
      leftHead: head,
      rightHead: connected.remainder,
      timeoutMs: PROXY_TIMEOUTS.tunnelIdleMs,
    })
  } catch (error) {
    const fields = errorFields(error)
    socketError(socket, fields.statusCode, fields.code, fields.message)
  }
}

export function createScopedProxyServer({ scope, getSnapshot, resolver }) {
  const context = Object.freeze({ scope, getSnapshot, resolver })
  const server = createServer({ maxHeaderSize: 256 * 1024, allowHalfOpen: true }, (request, response) => {
    void handleHttp(request, response, context)
  })
  server.maxHeadersCount = 256
  server.on('connect', (request, socket, head) => { void handleConnect(request, socket, head, context) })
  server.on('upgrade', (request, socket, head) => { void handleUpgrade(request, socket, head, context) })
  server.on('clientError', (error, socket) => {
    const overflow = error?.code === 'HPE_HEADER_OVERFLOW'
    socketError(socket, overflow ? 431 : 400, overflow ? 'REQUEST_HEADERS_TOO_LARGE' : 'INVALID_PROXY_REQUEST', overflow ? 'request headers are too large' : 'proxy request is invalid')
  })
  return server
}
