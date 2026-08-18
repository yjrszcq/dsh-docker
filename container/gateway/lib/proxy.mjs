import { createServer, request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import { inspectExternalRequest } from './trust.mjs'
import { injectRandomUuidPolyfill } from './polyfill.mjs'
import { createPasswordAccess, SESSION_COOKIE } from './auth.mjs'

export const INTERNAL_HOST = '127.0.0.1'
export const INTERNAL_PORT = 3079
export const INTERNAL_AUTHORITY = `${INTERNAL_HOST}:${String(INTERNAL_PORT)}`
export const HEALTH_PATH = '/_dsh_gateway/health'

const MAX_HTML_BYTES = 5 * 1024 * 1024
const upgradedSocketsByServer = new WeakMap()
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function excludedHeaderNames(headers) {
  const excluded = new Set(HOP_BY_HOP_HEADERS)
  if (typeof headers.connection === 'string') {
    for (const name of headers.connection.split(',')) excluded.add(name.trim().toLowerCase())
  }
  return excluded
}

function copyEndToEndHeaders(headers) {
  const excluded = excludedHeaderNames(headers)
  const copied = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!excluded.has(name.toLowerCase()) && value !== undefined) copied[name] = value
  }
  return copied
}

function withoutGatewaySessionCookie(value) {
  if (typeof value !== 'string') return undefined
  const remaining = value.split(';').filter((part) => {
    const separator = part.indexOf('=')
    return separator < 0 || part.slice(0, separator).trim() !== SESSION_COOKIE
  })
  return remaining.map(part => part.trim()).filter(Boolean).join('; ') || undefined
}

export function upstreamRequestHeaders(headers) {
  const excluded = excludedHeaderNames(headers)
  const rewritten = copyEndToEndHeaders(headers)
  rewritten.host = INTERNAL_AUTHORITY
  rewritten['accept-encoding'] = 'identity'
  if (!excluded.has('origin') && typeof headers.origin === 'string') {
    rewritten.origin = `http://${INTERNAL_AUTHORITY}`
  }
  const cookie = excluded.has('cookie') ? undefined : withoutGatewaySessionCookie(headers.cookie)
  if (cookie === undefined) delete rewritten.cookie
  else rewritten.cookie = cookie
  return rewritten
}

function rejectHttp(response, status, message) {
  if (response.headersSent) {
    response.destroy()
    return
  }
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(`${message}\n`)
}

function rejectUpgrade(socket, status, reason) {
  if (!socket.destroyed) {
    socket.end(`HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  }
}

function proxyResponseHeaders(headers) {
  return copyEndToEndHeaders(headers)
}

function isInjectableHtml(request, response) {
  if (request.method === 'HEAD') return false
  const contentType = response.headers['content-type']
  const encoding = response.headers['content-encoding']
  return typeof contentType === 'string'
    && contentType.toLowerCase().includes('text/html')
    && encoding === undefined
}

async function writeInjectedHtml(upstream, response) {
  const chunks = []
  let bytes = 0
  for await (const chunk of upstream) {
    bytes += chunk.byteLength
    if (bytes > MAX_HTML_BYTES) throw new Error('upstream HTML exceeds gateway injection limit')
    chunks.push(chunk)
  }
  const body = Buffer.from(injectRandomUuidPolyfill(Buffer.concat(chunks).toString('utf8')))
  const headers = proxyResponseHeaders(upstream.headers)
  delete headers.etag
  headers['content-length'] = String(body.byteLength)
  response.writeHead(upstream.statusCode ?? 502, upstream.statusMessage, headers)
  response.end(body)
}

function pipeHttpResponse(upstream, response) {
  response.writeHead(
    upstream.statusCode ?? 502,
    upstream.statusMessage,
    proxyResponseHeaders(upstream.headers),
  )
  upstream.on('error', () => response.destroy())
  upstream.pipe(response)
}

function proxyHttp(request, response, options) {
  const upstream = httpRequest({
    hostname: options.upstreamHost,
    port: options.upstreamPort,
    method: request.method,
    path: request.url,
    headers: upstreamRequestHeaders(request.headers),
  })
  upstream.on('response', (upstreamResponse) => {
    if (options.polyfill && isInjectableHtml(request, upstreamResponse)) {
      void writeInjectedHtml(upstreamResponse, response).catch(() => {
        upstreamResponse.destroy()
        rejectHttp(response, 502, 'bad gateway')
      })
      return
    }
    pipeHttpResponse(upstreamResponse, response)
  })
  upstream.on('error', () => rejectHttp(response, 502, 'bad gateway'))
  request.on('aborted', () => upstream.destroy())
  response.on('close', () => upstream.destroy())
  request.pipe(upstream)
}

function serializeUpgradeRequest(request, headers) {
  const lines = [`${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/${request.httpVersion}`]
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) lines.push(`${name}: ${item}`)
    } else if (value !== undefined) {
      lines.push(`${name}: ${value}`)
    }
  }
  return `${lines.join('\r\n')}\r\n\r\n`
}

function proxyUpgrade(request, clientSocket, head, options) {
  const headers = upstreamRequestHeaders(request.headers)
  headers.connection = 'Upgrade'
  headers.upgrade = request.headers.upgrade ?? 'websocket'
  const upstreamSocket = netConnect(options.upstreamPort, options.upstreamHost)
  let connected = false

  upstreamSocket.once('connect', () => {
    connected = true
    upstreamSocket.write(serializeUpgradeRequest(request, headers))
    if (head.length > 0) upstreamSocket.write(head)
    clientSocket.pipe(upstreamSocket).pipe(clientSocket)
  })
  upstreamSocket.once('error', () => {
    if (!connected) rejectUpgrade(clientSocket, 502, 'Bad Gateway')
    else clientSocket.destroy()
  })
  clientSocket.once('error', () => upstreamSocket.destroy())
  clientSocket.once('close', () => upstreamSocket.destroy())
}

export function createGatewayServer({
  trustedHosts,
  polyfill = true,
  upstreamHost = INTERNAL_HOST,
  upstreamPort = INTERNAL_PORT,
  isReady = () => true,
  password = '',
  passwordAccess = createPasswordAccess(password),
}) {
  const options = { trustedHosts, polyfill, upstreamHost, upstreamPort, isReady, passwordAccess }
  const upgradedSockets = new Set()
  const server = createServer((request, response) => {
    void handleRequest(request, response)
  })
  async function handleRequest(request, response) {
    try {
      const trust = inspectExternalRequest(request.headers, options.trustedHosts)
      if (!trust.accepted) {
        rejectHttp(response, 403, 'forbidden')
        return
      }
      const pathname = new URL(request.url ?? '/', 'http://gateway.internal').pathname
      if (pathname === HEALTH_PATH) {
        if (options.isReady()) {
          response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('ok\n')
        } else {
          rejectHttp(response, 503, 'unavailable')
        }
        return
      }
      if (await options.passwordAccess.handleHttp(request, response, pathname)) return
      proxyHttp(request, response, options)
    } catch {
      rejectHttp(response, 400, 'bad request')
    }
  }
  server.on('upgrade', (request, socket, head) => {
    const trust = inspectExternalRequest(request.headers, options.trustedHosts)
    if (!trust.accepted) {
      rejectUpgrade(socket, 403, 'Forbidden')
      return
    }
    if (options.passwordAccess.enabled && !options.passwordAccess.isAuthenticated(request)) {
      rejectUpgrade(socket, 401, 'Unauthorized')
      return
    }
    upgradedSockets.add(socket)
    socket.once('close', () => upgradedSockets.delete(socket))
    proxyUpgrade(request, socket, head, options)
  })
  upgradedSocketsByServer.set(server, upgradedSockets)
  return server
}

export async function closeGatewayServer(server) {
  const closed = new Promise((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  })
  server.closeAllConnections()
  for (const socket of upgradedSocketsByServer.get(server) ?? []) socket.destroy()
  await closed
}
