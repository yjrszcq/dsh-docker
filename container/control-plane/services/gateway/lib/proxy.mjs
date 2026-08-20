import { createServer, request as httpRequest } from 'node:http'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { connect as netConnect } from 'node:net'
import { join, resolve } from 'node:path'
import { inspectExternalRequest } from './trust.mjs'
import { injectRandomUuidPolyfill } from './polyfill.mjs'
import { BASIC_AUTH_CHALLENGE, createPasswordAccess } from './auth.mjs'
import { availabilityPage, DshAvailability, probeDsh, stateMessage } from './availability.mjs'

export const INTERNAL_HOST = '127.0.0.1'
export const INTERNAL_PORT = 3079
export const INTERNAL_AUTHORITY = `${INTERNAL_HOST}:${String(INTERNAL_PORT)}`
export const HEALTH_PATH = '/_dsh_gateway/health'
export const READINESS_PATH = '/_dsh_gateway/readiness'
export const MANAGEMENT_PREFIX = '/_dsh_platform/api/v1/'
export const MANAGEMENT_UI_PREFIX = '/_dsh_platform/ui/'
const EXTERNAL_MANAGEMENT_ROUTES = new Map([
  ['GET', new Set(['status', 'events', 'logs', 'logs/stream', 'rollback-plan', 'bundled-plugins', 'settings-document'])],
  ['POST', new Set(['check', 'update', 'holds/retry', 'rollback', 'return-stable', 'restart-dsh', 'bundled-plugins/action', 'bundled-plugins/toggle', 'bundled-plugins/recovery-action', 'bundled-plugins/discard'])],
  ['PUT', new Set(['channel', 'automatic-check', 'settings-document'])],
])

const MAX_HTML_BYTES = 5 * 1024 * 1024
const SYSTEM_PLUGIN_BUNDLE = /^\/plugins\/@dsh-docker\/([a-z0-9][a-z0-9._-]{0,127})\/client\.js$/
const upgradedSocketsByServer = new WeakMap()
const probeTimersByServer = new WeakMap()
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

export function upstreamRequestHeaders(headers) {
  const excluded = excludedHeaderNames(headers)
  const rewritten = copyEndToEndHeaders(headers)
  rewritten.host = INTERNAL_AUTHORITY
  rewritten['accept-encoding'] = 'identity'
  if (!excluded.has('origin') && typeof headers.origin === 'string') {
    rewritten.origin = `http://${INTERNAL_AUTHORITY}`
  }
  delete rewritten.authorization
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

function sendJson(response, status, value) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`)
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': String(body.byteLength),
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(body)
}

function isPageNavigation(request) {
  const pathname = new URL(request.url ?? '/', 'http://gateway.internal').pathname
  return request.method === 'GET'
    && !pathname.startsWith('/api/')
    && typeof request.headers.accept === 'string'
    && request.headers.accept.toLowerCase().includes('text/html')
}

function sendAvailabilityPage(request, response, state) {
  const body = Buffer.from(availabilityPage(state, request.headers))
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-length': String(body.byteLength),
    'content-security-policy': "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
    'content-type': 'text/html; charset=utf-8',
    'referrer-policy': 'no-referrer',
  })
  response.end(body)
}

async function serveSystemPluginBundle(request, response, root, pathname, searchParams) {
  if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) return false
  const match = SYSTEM_PLUGIN_BUNDLE.exec(pathname)
  if (match === null) return false
  const packageRoot = join(resolve(root), match[1])
  try {
    const metadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    if (metadata.name !== `@dsh-docker/${match[1]}`) return false
    const client = metadata.exports?.['./client']
    const relative = typeof client === 'string' ? client : client?.default
    if (typeof relative !== 'string' || relative.startsWith('/') || relative.includes('\\') || relative.split('/').includes('..')) return false
    const body = await readFile(join(packageRoot, relative))
    const requestedRev = searchParams.get('rev')
    const actualRev = createHash('sha1').update(body).digest('hex').slice(0, 12)
    if (requestedRev !== null && requestedRev !== actualRev) return false
    response.writeHead(200, {
      'cache-control': 'no-cache',
      'content-length': String(body.byteLength),
      'content-type': 'text/javascript; charset=utf-8',
      etag: `"${actualRev}"`,
    })
    response.end(request.method === 'HEAD' ? undefined : body)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function rejectUpgrade(socket, status, reason, headers = {}) {
  if (!socket.destroyed) {
    const lines = [`HTTP/1.1 ${String(status)} ${reason}`, 'Connection: close', 'Content-Length: 0']
    for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${value}`)
    socket.end(`${lines.join('\r\n')}\r\n\r\n`)
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
  delete headers['last-modified']
  headers['cache-control'] = 'no-cache'
  headers['content-length'] = String(body.byteLength)
  response.writeHead(upstream.statusCode ?? 502, upstream.statusMessage, headers)
  response.end(body)
}

function pipeHttpResponse(upstream, response, onError = () => {}) {
  response.writeHead(
    upstream.statusCode ?? 502,
    upstream.statusMessage,
    proxyResponseHeaders(upstream.headers),
  )
  upstream.on('error', error => {
    onError(error)
    response.destroy()
  })
  upstream.pipe(response)
}

function requestContext(request) {
  let pathname = 'invalid-url'
  try { pathname = new URL(request.url ?? '/', 'http://gateway.internal').pathname } catch {}
  return { method: request.method ?? null, pathname }
}

async function boundedPlatformStatus(platformStatus, options, timeoutMs = 250) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(() => platformStatus()).then(value => {
        options.reportRecovered('platform-status', 'gateway.platform-status.recovered', { upstream: 'management' })
        return value
      }, error => {
        options.reportFailure('platform-status', 'gateway.platform-status.failed', { error, upstream: 'management' })
        return {}
      }),
      new Promise(resolve => {
        timer = setTimeout(() => {
          options.reportFailure('platform-status', 'gateway.platform-status.timed-out', { timeoutMs, upstream: 'management' })
          resolve({})
        }, timeoutMs)
        timer.unref()
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function unavailableState(options) {
  const platform = await boundedPlatformStatus(options.platformStatus, options)
  return options.availability.classify(platform)
}

async function rejectDshFailure(request, response, options) {
  options.availability.observe(false)
  const state = await unavailableState(options)
  if (state === 'unknown') {
    rejectHttp(response, 502, 'bad gateway')
  } else if (isPageNavigation(request)) {
    sendAvailabilityPage(request, response, state)
  } else {
    rejectHttp(response, 503, stateMessage(state, request.headers))
  }
}

function proxyHttp(request, response, options) {
  const upstreamType = options.socketPath === undefined ? 'dsh' : 'management'
  const context = requestContext(request)
  const upstream = httpRequest({
    ...(options.socketPath === undefined
      ? { hostname: options.upstreamHost, port: options.upstreamPort }
      : { socketPath: options.socketPath }),
    method: request.method,
    path: request.url,
    headers: upstreamRequestHeaders(request.headers),
  })
  upstream.on('response', (upstreamResponse) => {
    options.reportRecovered(`${upstreamType}-http`, 'gateway.upstream.recovered', { upstream: upstreamType })
    if (options.trackDsh === true) options.availability.observe(true)
    if (options.polyfill && isInjectableHtml(request, upstreamResponse)) {
      void writeInjectedHtml(upstreamResponse, response).catch(error => {
        options.reportFailure('dsh-injection', 'gateway.response-injection.failed', {
          ...context,
          error,
          upstream: 'dsh',
        })
        upstreamResponse.destroy()
        rejectHttp(response, 502, 'bad gateway')
      })
      return
    }
    pipeHttpResponse(upstreamResponse, response, error => options.reportFailure(`${upstreamType}-response`, 'gateway.upstream-response.failed', {
      ...context,
      error,
      level: 'warning',
      upstream: upstreamType,
    }))
  })
  upstream.on('error', error => {
    options.reportFailure(`${upstreamType}-http`, 'gateway.upstream.failed', {
      ...context,
      error,
      upstream: upstreamType,
    })
    if (options.trackDsh === true) void rejectDshFailure(request, response, options)
    else rejectHttp(response, 502, 'bad gateway')
  })
  request.on('aborted', () => upstream.destroy())
  response.on('close', () => upstream.destroy())
  request.pipe(upstream)
}

function isExternalManagementRoute(method, pathname) {
  if (!pathname.startsWith(MANAGEMENT_PREFIX)) return false
  return EXTERNAL_MANAGEMENT_ROUTES.get(method ?? 'GET')?.has(pathname.slice(MANAGEMENT_PREFIX.length)) ?? false
}

function isExternalConsoleRoute(method, pathname) {
  return ['GET', 'HEAD'].includes(method ?? 'GET')
    && (pathname === MANAGEMENT_UI_PREFIX.slice(0, -1) || pathname.startsWith(MANAGEMENT_UI_PREFIX))
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
  const context = requestContext(request)
  const headers = upstreamRequestHeaders(request.headers)
  headers.connection = 'Upgrade'
  headers.upgrade = request.headers.upgrade ?? 'websocket'
  const upstreamSocket = netConnect(options.upstreamPort, options.upstreamHost)
  let connected = false

  upstreamSocket.once('connect', () => {
    connected = true
    options.reportRecovered('dsh-websocket', 'gateway.websocket.recovered', { upstream: 'dsh' })
    options.availability.observe(true)
    upstreamSocket.write(serializeUpgradeRequest(request, headers))
    if (head.length > 0) upstreamSocket.write(head)
    clientSocket.pipe(upstreamSocket).pipe(clientSocket)
  })
  upstreamSocket.once('error', error => {
    options.reportFailure('dsh-websocket', connected ? 'gateway.websocket.disconnected' : 'gateway.websocket.failed', {
      ...context,
      error,
      level: connected ? 'warning' : 'error',
      upstream: 'dsh',
    })
    if (!connected) {
      options.availability.observe(false)
      void unavailableState(options).then(state => {
        if (state === 'unknown') rejectUpgrade(clientSocket, 502, 'Bad Gateway')
        else rejectUpgrade(clientSocket, 503, 'Service Unavailable')
      })
    }
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
  managementSocketPath = '/run/dsh-platform/management.sock',
  systemPluginRoot = '/run/dsh-platform/deployment/system-plugins/packages',
  platformStatus = async () => ({}),
  availability = new DshAvailability(),
  probe = () => probeDsh({ host: upstreamHost, port: upstreamPort }),
  probeIntervalMs = 750,
  isReady = () => true,
  password = '',
  username = '',
  passwordAccess = createPasswordAccess(password, { username }),
  report = async () => {},
  now = () => Date.now(),
  failureLogIntervalMs = 30_000,
}) {
  const failures = new Map()
  const record = (message, fields) => Promise.resolve().then(() => report(message, fields)).catch(() => {})
  const reportFailure = (key, message, fields) => {
    const timestamp = now()
    const previous = failures.get(key)
    if (previous !== undefined && timestamp - previous.lastReportedAt < failureLogIntervalMs) {
      previous.suppressedCount += 1
      return
    }
    const suppressedCount = previous?.suppressedCount ?? 0
    failures.set(key, { firstFailureAt: previous?.firstFailureAt ?? timestamp, lastReportedAt: timestamp, suppressedCount: 0 })
    void record(message, { ...fields, ...(suppressedCount === 0 ? {} : { suppressedCount }) })
  }
  const reportRecovered = (key, message, fields) => {
    const failure = failures.get(key)
    if (failure === undefined) return
    failures.delete(key)
    void record(message, {
      ...fields,
      outageMs: Math.max(0, now() - failure.firstFailureAt),
      suppressedCount: failure.suppressedCount,
    })
  }
  const options = {
    trustedHosts, polyfill, upstreamHost, upstreamPort, managementSocketPath, systemPluginRoot, platformStatus,
    availability, probe, isReady, passwordAccess, reportFailure, reportRecovered,
  }
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
      const url = new URL(request.url ?? '/', 'http://gateway.internal')
      const pathname = url.pathname
      if (pathname === HEALTH_PATH) {
        if (options.isReady()) {
          response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('ok\n')
        } else {
          rejectHttp(response, 503, 'unavailable')
        }
        return
      }
      if (options.passwordAccess.handleHttp(request, response)) return
      if (await serveSystemPluginBundle(request, response, options.systemPluginRoot, pathname, url.searchParams)) return
      if (pathname === READINESS_PATH) {
        const ready = await options.probe()
        options.availability.observe(ready)
        if (ready) sendJson(response, 200, { ready: true, state: 'ready' })
        else {
          const state = await unavailableState(options)
          sendJson(response, state === 'unknown' ? 502 : 503, { ready: false, state })
        }
        return
      }
      if (pathname === MANAGEMENT_UI_PREFIX.slice(0, -1) || pathname.startsWith(MANAGEMENT_UI_PREFIX)) {
        if (!isExternalConsoleRoute(request.method, pathname)) {
          rejectHttp(response, 404, 'not found')
          return
        }
        proxyHttp(request, response, { ...options, socketPath: options.managementSocketPath, polyfill: false })
        return
      }
      if (pathname.startsWith(MANAGEMENT_PREFIX)) {
        if (!isExternalManagementRoute(request.method, pathname)) {
          rejectHttp(response, 404, 'not found')
          return
        }
        proxyHttp(request, response, { ...options, socketPath: options.managementSocketPath, polyfill: false })
        return
      }
      proxyHttp(request, response, { ...options, trackDsh: true })
    } catch (error) {
      reportFailure('gateway-request', 'gateway.request.failed', { ...requestContext(request), error })
      rejectHttp(response, 400, 'bad request')
    }
  }
  server.on('upgrade', (request, socket, head) => {
    try {
      const trust = inspectExternalRequest(request.headers, options.trustedHosts)
      if (!trust.accepted) {
        rejectUpgrade(socket, 403, 'Forbidden')
        return
      }
      if (options.passwordAccess.enabled && !options.passwordAccess.isAuthenticated(request)) {
        rejectUpgrade(socket, 401, 'Unauthorized', { 'WWW-Authenticate': BASIC_AUTH_CHALLENGE })
        return
      }
      const pathname = new URL(request.url ?? '/', 'http://gateway.internal').pathname
      if (pathname.startsWith(MANAGEMENT_PREFIX)) {
        rejectUpgrade(socket, 400, 'Bad Request')
        return
      }
      upgradedSockets.add(socket)
      socket.once('close', () => upgradedSockets.delete(socket))
      proxyUpgrade(request, socket, head, options)
    } catch (error) {
      reportFailure('gateway-upgrade', 'gateway.upgrade-request.failed', { ...requestContext(request), error })
      rejectUpgrade(socket, 400, 'Bad Request')
    }
  })
  upgradedSocketsByServer.set(server, upgradedSockets)
  let probing = false
  const probeTimer = setInterval(() => {
    if (probing) return
    probing = true
    void options.probe().then(ready => {
      const wasReady = options.availability.everReady
      options.availability.observe(ready)
      if (ready) reportRecovered('dsh-probe', 'gateway.dsh.recovered', { upstream: 'dsh' })
      else if (wasReady && options.availability.consecutiveFailures >= options.availability.failures) {
        reportFailure('dsh-probe', 'gateway.dsh.unavailable', { level: 'warning', upstream: 'dsh' })
      }
    }, error => {
      options.availability.observe(false)
      reportFailure('dsh-probe', 'gateway.dsh.probe.failed', { error, level: 'warning', upstream: 'dsh' })
    })
      .finally(() => { probing = false })
  }, probeIntervalMs)
  probeTimer.unref()
  server.once('close', () => clearInterval(probeTimer))
  probeTimersByServer.set(server, probeTimer)
  return server
}

export async function closeGatewayServer(server) {
  clearInterval(probeTimersByServer.get(server))
  const closed = new Promise((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  })
  server.closeAllConnections()
  for (const socket of upgradedSocketsByServer.get(server) ?? []) socket.destroy()
  await closed
}
