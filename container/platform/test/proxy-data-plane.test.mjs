import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import { createServer as createNetServer, connect } from 'node:net'
import test from 'node:test'
import { defaultProxyConfiguration, validateProxyConfiguration } from '../../control-plane/services/proxy/lib/contracts.mjs'
import { createScopedProxyServer } from '../../control-plane/services/proxy/lib/data-plane.mjs'
import { selectProxyRoute } from '../../control-plane/services/proxy/lib/policy.mjs'

const connections = new WeakMap()

async function listen(server, host = '127.0.0.1') {
  const sockets = new Set()
  connections.set(server, sockets)
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  server.listen(0, host)
  await once(server, 'listening')
  return server.address().port
}

async function close(server) {
  if (!server.listening) return
  for (const socket of connections.get(server) ?? []) socket.destroy()
  server.closeAllConnections?.()
  await new Promise(resolve => server.close(resolve))
}

function snapshot({ proxyPort = null, protocol = 'http', scopes = {}, noProxy = [], bypass = [] } = {}) {
  const defaults = defaultProxyConfiguration()
  const validated = validateProxyConfiguration({
    ...defaults,
    enabled: proxyPort !== null,
    proxy: {
      ...defaults.proxy,
      protocol,
      host: proxyPort === null ? '' : '127.0.0.1',
      port: proxyPort,
      username: proxyPort === null ? '' : 'proxy-user',
      password: proxyPort === null ? undefined : 'proxy-password',
    },
    scopes: { ...defaults.scopes, updates: proxyPort !== null, ...scopes },
    noProxy: { user: noProxy },
    bypass: { additional: bypass },
  })
  return Object.freeze({ revision: 'test-revision', recovery: 'none', ...validated })
}

function proxyRequest({ proxyPort, target, method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: '127.0.0.1', port: proxyPort, method, path: target, headers,
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
        trailers: response.trailers,
      }))
    })
    request.once('error', reject)
    if (body !== null) request.write(body)
    request.end()
  })
}

function rawExchange(port, request, { waitFor = '\r\n\r\n', keepOpen = false } = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    let bytes = Buffer.alloc(0)
    socket.once('connect', () => socket.write(request))
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`raw proxy exchange timed out waiting for ${waitFor}`))
    }, 3_000)
    socket.on('data', chunk => {
      bytes = Buffer.concat([bytes, chunk])
      if (bytes.includes(waitFor)) {
        clearTimeout(timer)
        if (!keepOpen) socket.end()
        resolve({ socket, bytes })
      }
    })
    socket.once('error', reject)
    socket.once('close', () => clearTimeout(timer))
  })
}

test('routes direct HTTP absolute-form requests and preserves streamed bodies and trailers', async () => {
  const payload = Buffer.alloc(2 * 1024 * 1024, 0x5a)
  const target = createServer((request, response) => {
    assert.equal(request.url, '/download?q=1')
    assert.equal(request.headers['proxy-authorization'], undefined)
    response.writeHead(200, { 'content-type': 'application/octet-stream', trailer: 'x-result' })
    response.write(payload)
    response.addTrailers({ 'x-result': 'complete' })
    response.end()
  })
  const targetPort = await listen(target)
  const state = snapshot()
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  try {
    const result = await proxyRequest({ proxyPort, target: `http://127.0.0.1:${targetPort}/download?q=1` })
    assert.equal(result.statusCode, 200)
    assert.equal(result.body.byteLength, payload.byteLength)
    assert.equal(createHash('sha256').update(result.body).digest('hex'), createHash('sha256').update(payload).digest('hex'))
    assert.equal(result.trailers['x-result'], 'complete')
  } finally {
    await close(proxy)
    await close(target)
  }
})

test('rejects origin-form and unsupported absolute-form requests without contacting an upstream', async () => {
  const state = snapshot()
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  try {
    const origin = await proxyRequest({ proxyPort, target: '/local/path' })
    assert.equal(origin.statusCode, 400)
    assert.equal(origin.headers['x-dsh-proxy-error'], 'INVALID_PROXY_REQUEST')
    const https = await proxyRequest({ proxyPort, target: 'https://example.invalid/' })
    assert.equal(https.statusCode, 501)
    assert.equal(https.headers['x-dsh-proxy-error'], 'UNSUPPORTED_TARGET_SCHEME')
  } finally {
    await close(proxy)
  }
})

test('forwards HTTP through an external proxy with in-memory Basic authentication', async () => {
  let observed
  const upstreamProxy = createServer((request, response) => {
    observed = { url: request.url, authorization: request.headers['proxy-authorization'], host: request.headers.host }
    response.writeHead(201, { 'x-upstream-proxy': 'yes' })
    response.end('proxied')
  })
  const upstreamPort = await listen(upstreamProxy)
  const state = snapshot({ proxyPort: upstreamPort })
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  try {
    const result = await proxyRequest({ proxyPort, target: 'http://example.invalid/resource?q=1' })
    assert.equal(result.statusCode, 201)
    assert.equal(result.body.toString(), 'proxied')
    assert.deepEqual(observed, {
      url: 'http://example.invalid/resource?q=1',
      authorization: `Basic ${Buffer.from('proxy-user:proxy-password').toString('base64')}`,
      host: 'example.invalid',
    })
  } finally {
    await close(proxy)
    await close(upstreamProxy)
  }
})

test('maps external HTTP proxy authentication failures to a redacted local 502', async () => {
  const upstreamProxy = createServer((request, response) => {
    response.writeHead(407, { 'proxy-authenticate': 'Basic realm="secret-upstream"' })
    response.end('credential details')
  })
  const upstreamPort = await listen(upstreamProxy)
  const state = snapshot({ proxyPort: upstreamPort })
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  try {
    const result = await proxyRequest({ proxyPort, target: 'http://example.invalid/' })
    assert.equal(result.statusCode, 502)
    assert.equal(result.headers['x-dsh-proxy-error'], 'UPSTREAM_PROXY_AUTH_FAILED')
    assert.equal(result.headers['proxy-authenticate'], undefined)
    assert.equal(result.body.toString().includes('credential details'), false)
  } finally {
    await close(proxy)
    await close(upstreamProxy)
  }
})

test('establishes direct CONNECT tunnels and preserves bytes sent with the request head', async () => {
  const echo = createNetServer(socket => socket.pipe(socket))
  const echoPort = await listen(echo)
  const state = snapshot()
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  let socket
  try {
    const exchange = await rawExchange(proxyPort, [
      `CONNECT 127.0.0.1:${echoPort} HTTP/1.1`,
      `Host: 127.0.0.1:${echoPort}`,
      '',
      'sticky-head',
    ].join('\r\n'), { waitFor: 'sticky-head', keepOpen: true })
    socket = exchange.socket
    assert.match(exchange.bytes.toString('latin1'), /^HTTP\/1\.1 200 Connection Established/)
    assert.equal(exchange.bytes.toString('latin1').endsWith('sticky-head'), true)
    socket.end()
  } finally {
    socket?.destroy()
    await close(proxy)
    await close(echo)
  }
})

test('establishes authenticated CONNECT through an external HTTP proxy and preserves handshake remainder', async () => {
  let observed = ''
  const upstreamProxy = createNetServer(socket => {
    let request = Buffer.alloc(0)
    socket.on('data', chunk => {
      request = Buffer.concat([request, chunk])
      if (!request.includes('\r\n\r\n')) return
      observed = request.toString('latin1')
      socket.removeAllListeners('data')
      socket.write('HTTP/1.1 200 Connection')
      setTimeout(() => socket.write(' Established\r\nProxy-Agent: fixture\r\n\r\nprefetched'), 5)
      socket.on('data', value => socket.write(value))
    })
  })
  const upstreamPort = await listen(upstreamProxy)
  const state = snapshot({ proxyPort: upstreamPort })
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  let socket
  try {
    const exchange = await rawExchange(proxyPort, [
      'CONNECT example.invalid:443 HTTP/1.1',
      'Host: example.invalid:443',
      '',
      '',
    ].join('\r\n'), { waitFor: 'prefetched', keepOpen: true })
    socket = exchange.socket
    assert.match(observed, /^CONNECT example\.invalid:443 HTTP\/1\.1\r\n/m)
    assert.match(observed, new RegExp(`Proxy-Authorization: Basic ${Buffer.from('proxy-user:proxy-password').toString('base64')}`, 'i'))
    assert.equal(exchange.bytes.toString('latin1').endsWith('prefetched'), true)
    socket.write('echo')
    const [chunk] = await once(socket, 'data')
    assert.equal(chunk.toString(), 'echo')
  } finally {
    socket?.destroy()
    await close(proxy)
    await close(upstreamProxy)
  }
})

test('preserves CONNECT half-close so a target can respond after request EOF', async () => {
  const target = createNetServer({ allowHalfOpen: true }, socket => {
    const chunks = []
    socket.on('data', chunk => chunks.push(chunk))
    socket.on('end', () => socket.end(`response:${Buffer.concat(chunks).toString()}`))
  })
  const targetPort = await listen(target)
  const state = snapshot()
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  const socket = connect({ host: '127.0.0.1', port: proxyPort, allowHalfOpen: true })
  try {
    await once(socket, 'connect')
    socket.write(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`)
    let received = Buffer.alloc(0)
    while (!received.includes('\r\n\r\n')) {
      const [chunk] = await once(socket, 'data')
      received = Buffer.concat([received, chunk])
    }
    socket.end('half-close-body')
    while (!received.includes('response:half-close-body')) {
      const [chunk] = await once(socket, 'data')
      received = Buffer.concat([received, chunk])
    }
    assert.equal(received.toString('latin1').endsWith('response:half-close-body'), true)
  } finally {
    socket.destroy()
    await close(proxy)
    await close(target)
  }
})

test('rejects a single oversized request header with 431', async () => {
  const state = snapshot()
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  let socket
  try {
    const exchange = await rawExchange(proxyPort, [
      'GET http://example.invalid/ HTTP/1.1',
      'Host: example.invalid',
      `X-Oversized: ${'x'.repeat(65 * 1024)}`,
      '',
      '',
    ].join('\r\n'))
    socket = exchange.socket
    assert.match(exchange.bytes.toString('latin1'), /^HTTP\/1\.1 431 /)
    assert.match(exchange.bytes.toString('latin1'), /X-DSH-Proxy-Error: REQUEST_HEADERS_TOO_LARGE/i)
  } finally {
    socket?.destroy()
    await close(proxy)
  }
})

test('forwards absolute-form WebSocket upgrade as an opaque bidirectional stream', async () => {
  const target = createServer()
  target.on('upgrade', (request, socket, head) => {
    assert.equal(request.url, '/socket')
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    if (head.byteLength > 0) socket.write(head)
    socket.on('data', chunk => socket.write(chunk))
  })
  const targetPort = await listen(target)
  const state = snapshot()
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  let socket
  try {
    const exchange = await rawExchange(proxyPort, [
      `GET ws://127.0.0.1:${targetPort}/socket HTTP/1.1`,
      `Host: 127.0.0.1:${targetPort}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      '',
      'sticky-ws',
    ].join('\r\n'), { waitFor: 'sticky-ws', keepOpen: true })
    socket = exchange.socket
    assert.match(exchange.bytes.toString('latin1'), /^HTTP\/1\.1 101 Switching Protocols/)
    assert.equal(exchange.bytes.toString('latin1').endsWith('sticky-ws'), true)
  } finally {
    socket?.destroy()
    await close(proxy)
    await close(target)
  }
})

test('applies forced direct, NO_PROXY, bypass, shared DSH and scoped proxy priority', async () => {
  const state = snapshot({
    proxyPort: 3128,
    scopes: { dshCore: true, dshPlugins: false },
    noProxy: ['.example.com'],
    bypass: ['10.0.0.0/8'],
  })
  const resolver = async host => host === 'cidr.example' ? [{ address: '10.4.3.2', family: 4 }] : [{ address: '203.0.113.1', family: 4 }]
  assert.equal((await selectProxyRoute({ snapshot: state, scope: 'updates', host: '127.0.0.1', port: 80, resolver })).reason, 'platform-forced-direct')
  assert.equal((await selectProxyRoute({ snapshot: state, scope: 'updates', host: 'sub.example.com', port: 80, resolver })).reason, 'no-proxy')
  assert.equal((await selectProxyRoute({ snapshot: state, scope: 'updates', host: 'cidr.example', port: 80, resolver })).reason, 'bypass')
  assert.equal((await selectProxyRoute({ snapshot: state, scope: 'sharedDsh', host: 'remote.invalid', port: 80, resolver })).mode, 'http')
  assert.equal((await selectProxyRoute({ snapshot: state, scope: 'platform', host: 'remote.invalid', port: 80, resolver })).reason, 'scope-direct')
  assert.equal((await selectProxyRoute({ snapshot: state, scope: 'updates', host: '::1', port: 443, resolver })).reason, 'platform-forced-direct')
})
