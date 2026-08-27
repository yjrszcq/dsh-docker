import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { Agent, createServer, request as httpRequest } from 'node:http'
import { createServer as createNetServer, connect } from 'node:net'
import test from 'node:test'
import { defaultProxyConfiguration, validateProxyConfiguration } from '../../control-plane/services/outbound-proxy/lib/contracts.mjs'
import { createScopedProxyServer } from '../../control-plane/services/outbound-proxy/lib/data-plane.mjs'
import { probeProxyEntry } from '../../control-plane/services/outbound-proxy/lib/readiness.mjs'
import { ProxyRouteHealth } from '../../control-plane/services/outbound-proxy/lib/route-health.mjs'
import { ProxyDnsCache } from '../../control-plane/services/outbound-proxy/lib/dns-cache.mjs'
import { selectProxyRoute } from '../../control-plane/services/outbound-proxy/lib/policy.mjs'
import { connectTcp, connectThroughSocks5 } from '../../control-plane/services/outbound-proxy/lib/transport.mjs'

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

async function unusedPort() {
  const server = createNetServer()
  const port = await listen(server)
  await close(server)
  return port
}

const shortTimeouts = Object.freeze({
  connectMs: 30,
  handshakeMs: 30,
  responseHeaderMs: 30,
  streamIdleMs: 30,
  tunnelIdleMs: 30,
})

function snapshot({
  proxyPort = null,
  protocol = 'http',
  remoteDns = true,
  username = 'proxy-user',
  password = 'proxy-password',
  scopes = {},
  noProxy = [],
  bypass = [],
} = {}) {
  const defaults = defaultProxyConfiguration()
  const validated = validateProxyConfiguration({
    ...defaults,
    enabled: proxyPort !== null,
    proxy: {
      ...defaults.proxy,
      protocol,
      host: proxyPort === null ? '' : '127.0.0.1',
      port: proxyPort,
      username: proxyPort === null ? '' : username,
      password: proxyPort === null ? undefined : password,
      remoteDns,
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
    request.setTimeout(5_000, () => request.destroy(new Error('proxy fixture request timed out')))
    request.once('error', reject)
    if (body !== null) request.write(body)
    request.end()
  })
}

function proxyAgentRequest({ proxyPort, target, agent }) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port: proxyPort, path: target, agent }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ body: Buffer.concat(chunks), socket: request.socket }))
    })
    request.once('error', reject)
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

class FixtureReader {
  constructor(socket) {
    this.socket = socket
    this.buffer = Buffer.alloc(0)
    this.waiters = []
    this.onData = chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.flush()
    }
    socket.on('data', this.onData)
  }

  flush() {
    while (this.waiters.length > 0 && this.buffer.byteLength >= this.waiters[0].size) {
      const waiter = this.waiters.shift()
      const value = this.buffer.subarray(0, waiter.size)
      this.buffer = this.buffer.subarray(waiter.size)
      waiter.resolve(value)
    }
  }

  exact(size) {
    if (this.buffer.byteLength >= size) {
      const value = this.buffer.subarray(0, size)
      this.buffer = this.buffer.subarray(size)
      return Promise.resolve(value)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SOCKS fixture read timed out')), 3_000)
      this.waiters.push({ size, resolve: value => { clearTimeout(timer); resolve(value) } })
    })
  }

  release() {
    this.socket.pause()
    this.socket.off('data', this.onData)
    return this.buffer
  }
}

test('readiness probes one local proxy entry without contacting an upstream', async t => {
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => snapshot() })
  const port = await listen(proxy)
  t.after(() => close(proxy))
  await probeProxyEntry(port)
})

test('survives a peer reset while an established socket changes owners', async t => {
  const target = createNetServer(socket => setImmediate(() => socket.resetAndDestroy()))
  const port = await listen(target)
  t.after(() => close(target))

  const socket = await connectTcp({ host: '127.0.0.1', port })
  await new Promise(resolve => socket.once('close', resolve))
  assert.equal(socket.destroyed, true)
})

test('survives a reset CONNECT tunnel and keeps direct routing available', async t => {
  const resetTarget = createNetServer(socket => socket.resume())
  const resetPort = await listen(resetTarget)
  t.after(() => close(resetTarget))

  const healthyTarget = createServer((_request, response) => response.end('ready'))
  const healthyPort = await listen(healthyTarget)
  t.after(() => close(healthyTarget))

  const proxy = createScopedProxyServer({ scope: 'agentNetwork', getSnapshot: () => snapshot() })
  const proxyPort = await listen(proxy)
  t.after(() => close(proxy))

  const tunnel = await rawExchange(proxyPort, [
    `CONNECT 127.0.0.1:${resetPort} HTTP/1.1`,
    `Host: 127.0.0.1:${resetPort}`,
    '',
    '',
  ].join('\r\n'), { keepOpen: true })
  const tunnelClosed = once(tunnel.socket, 'close')
  tunnel.socket.resetAndDestroy()
  await tunnelClosed

  const response = await proxyRequest({
    proxyPort,
    target: `http://127.0.0.1:${healthyPort}/health`,
  })
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.toString('utf8'), 'ready')
})

test('keeps local readiness separate from revision-scoped external route health', async () => {
  const health = new ProxyRouteHealth()
  const direct = Object.freeze({ ...snapshot(), revision: 'direct-revision' })
  assert.equal(health.status(direct).updates, 'direct')
  const enabled = Object.freeze({ ...snapshot({ proxyPort: 65534 }), revision: 'enabled-revision' })
  assert.equal(health.status(enabled).updates, 'unknown')
  health.observe(enabled, 'updates', 'degraded')
  assert.equal(health.status(enabled).updates, 'degraded')
  health.observe(enabled, 'updates', 'ready')
  assert.equal(health.status(enabled).updates, 'ready')
  const next = Object.freeze({ ...enabled, revision: 'next-revision' })
  assert.equal(health.status(next).updates, 'unknown')
})

test('classifies target DNS and TCP connection failures at the proxy entry', async () => {
  let proxyConnections = 0
  const socks = createNetServer(socket => {
    proxyConnections += 1
    socket.destroy()
  })
  const socksPort = await listen(socks)
  const dnsState = snapshot({ proxyPort: socksPort, protocol: 'socks5', remoteDns: false })
  const dnsProxy = createScopedProxyServer({
    scope: 'updates',
    getSnapshot: () => dnsState,
    resolver: async () => { throw new Error('fixture DNS failure') },
    timeouts: shortTimeouts,
  })
  const dnsProxyPort = await listen(dnsProxy)
  try {
    const result = await proxyRequest({ proxyPort: dnsProxyPort, target: 'http://missing.example/' })
    assert.equal(result.statusCode, 502)
    assert.equal(result.headers['x-dsh-proxy-error'], 'TARGET_DNS_FAILED')
    assert.equal(proxyConnections, 0)
  } finally {
    await close(dnsProxy)
    await close(socks)
  }

  const refusedPort = await unusedPort()
  const tcpProxy = createScopedProxyServer({
    scope: 'updates', getSnapshot: () => snapshot(), timeouts: shortTimeouts,
  })
  const tcpProxyPort = await listen(tcpProxy)
  try {
    const result = await proxyRequest({ proxyPort: tcpProxyPort, target: `http://127.0.0.1:${refusedPort}/` })
    assert.equal(result.statusCode, 502)
    assert.equal(result.headers['x-dsh-proxy-error'], 'UPSTREAM_CONNECT_FAILED')
  } finally {
    await close(tcpProxy)
  }
})

test('classifies HTTP proxy handshake and response-header timeouts at the proxy entry', async () => {
  const silentProxy = createNetServer(socket => socket.resume())
  const silentProxyPort = await listen(silentProxy)
  const state = snapshot({ proxyPort: silentProxyPort })
  const handshakeProxy = createScopedProxyServer({
    scope: 'updates', getSnapshot: () => state, timeouts: shortTimeouts,
  })
  const handshakeProxyPort = await listen(handshakeProxy)
  try {
    const exchange = await rawExchange(handshakeProxyPort, [
      'CONNECT target.example:443 HTTP/1.1',
      'Host: target.example:443',
      '',
      '',
    ].join('\r\n'), { waitFor: 'PROXY_CONNECT_TIMEOUT' })
    assert.match(exchange.bytes.toString('latin1'), /^HTTP\/1\.1 504 /)
  } finally {
    await close(handshakeProxy)
    await close(silentProxy)
  }

  const silentTarget = createServer(() => {})
  const silentTargetPort = await listen(silentTarget)
  const responseProxy = createScopedProxyServer({
    scope: 'updates', getSnapshot: () => snapshot(), timeouts: shortTimeouts,
  })
  const responseProxyPort = await listen(responseProxy)
  try {
    const result = await proxyRequest({ proxyPort: responseProxyPort, target: `http://127.0.0.1:${silentTargetPort}/` })
    assert.equal(result.statusCode, 504)
    assert.equal(result.headers['x-dsh-proxy-error'], 'UPSTREAM_TIMEOUT')
  } finally {
    await close(responseProxy)
    await close(silentTarget)
  }
})

test('closes idle HTTP response streams and CONNECT tunnels', async () => {
  const partialTarget = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.write('partial')
  })
  const partialTargetPort = await listen(partialTarget)
  const streamProxy = createScopedProxyServer({
    scope: 'updates', getSnapshot: () => snapshot(), timeouts: shortTimeouts,
  })
  const streamProxyPort = await listen(streamProxy)
  let streamSocket
  try {
    const exchange = await rawExchange(streamProxyPort, [
      `GET http://127.0.0.1:${partialTargetPort}/ HTTP/1.1`,
      `Host: 127.0.0.1:${partialTargetPort}`,
      '',
      '',
    ].join('\r\n'), { waitFor: 'partial', keepOpen: true })
    streamSocket = exchange.socket
    assert.match(exchange.bytes.toString('latin1'), /^HTTP\/1\.1 200 /)
    await Promise.race([
      once(streamSocket, 'close'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('idle HTTP response stream remained open')), 500)),
    ])
  } finally {
    streamSocket?.destroy()
    await close(streamProxy)
    await close(partialTarget)
  }

  const tunnelTarget = createNetServer(socket => socket.resume())
  const tunnelTargetPort = await listen(tunnelTarget)
  const tunnelProxy = createScopedProxyServer({
    scope: 'updates', getSnapshot: () => snapshot(), timeouts: shortTimeouts,
  })
  const tunnelProxyPort = await listen(tunnelProxy)
  let tunnelSocket
  try {
    const exchange = await rawExchange(tunnelProxyPort, [
      `CONNECT 127.0.0.1:${tunnelTargetPort} HTTP/1.1`,
      `Host: 127.0.0.1:${tunnelTargetPort}`,
      '',
      '',
    ].join('\r\n'), { keepOpen: true })
    tunnelSocket = exchange.socket
    assert.match(exchange.bytes.toString('latin1'), /^HTTP\/1\.1 200 Connection Established/)
    await Promise.race([
      once(tunnelSocket, 'close'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('idle CONNECT tunnel remained open')), 500)),
    ])
  } finally {
    tunnelSocket?.destroy()
    await close(tunnelProxy)
    await close(tunnelTarget)
  }
})

function socksFixture({ username = null, password = null, rejectAuth = false, rejectConnect = false, connectTarget = true, sticky = '' } = {}) {
  const observations = []
  const server = createNetServer({ allowHalfOpen: true }, socket => {
    void (async () => {
      const reader = new FixtureReader(socket)
      const greeting = await reader.exact(2)
      assert.equal(greeting[0], 0x05)
      const methods = await reader.exact(greeting[1])
      const method = username === null ? 0x00 : 0x02
      assert.equal(methods.includes(method), true)
      socket.write(Buffer.from([0x05, method]))
      if (method === 0x02) {
        const versionAndLength = await reader.exact(2)
        const receivedUser = (await reader.exact(versionAndLength[1])).toString('utf8')
        const passwordLength = (await reader.exact(1))[0]
        const receivedPassword = (await reader.exact(passwordLength)).toString('utf8')
        observations.push({ authentication: { username: receivedUser, password: receivedPassword } })
        socket.write(Buffer.from([0x01, rejectAuth ? 0x01 : 0x00]))
        if (rejectAuth) return socket.end()
        assert.equal(receivedUser, username)
        assert.equal(receivedPassword, password)
      }
      const request = await reader.exact(4)
      assert.deepEqual([...request.subarray(0, 3)], [0x05, 0x01, 0x00])
      let host
      if (request[3] === 0x01) host = [...await reader.exact(4)].join('.')
      else if (request[3] === 0x03) host = (await reader.exact((await reader.exact(1))[0])).toString('ascii')
      else if (request[3] === 0x04) host = (await reader.exact(16)).toString('hex')
      else throw new Error(`unexpected SOCKS fixture ATYP ${request[3]}`)
      const port = (await reader.exact(2)).readUInt16BE()
      observations.push({ target: { atyp: request[3], host, port } })
      const remainder = reader.release()
      const success = Buffer.from([0x05, rejectConnect ? 0x05 : 0x00, 0x00, 0x01, 127, 0, 0, 1, 0x12, 0x34])
      socket.write(success.subarray(0, 3))
      setTimeout(() => {
        socket.write(Buffer.concat([success.subarray(3), Buffer.from(sticky)]))
        if (rejectConnect) return socket.end()
        if (connectTarget) {
          const target = connect({ host, port, allowHalfOpen: true })
          target.once('connect', () => {
            if (remainder.byteLength > 0) target.write(remainder)
            socket.pipe(target)
            target.pipe(socket)
          })
          target.once('error', error => socket.destroy(error))
          socket.once('close', () => target.destroy())
        } else {
          if (remainder.byteLength > 0) socket.write(remainder)
          socket.on('data', chunk => socket.write(chunk))
          socket.resume()
        }
      }, 5)
    })().catch(error => socket.destroy(error))
  })
  return { server, observations }
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

test('preserves request trailers while removing client hop-by-hop framing', async () => {
  const target = createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      assert.equal(Buffer.concat(chunks).toString(), 'body')
      assert.deepEqual(request.trailers, { 'x-checksum': 'verified' })
      response.end('request-trailers-preserved')
    })
  })
  const targetPort = await listen(target)
  const state = snapshot()
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  let socket
  try {
    const exchange = await rawExchange(proxyPort, [
      `POST http://127.0.0.1:${targetPort}/upload HTTP/1.1`,
      `Host: 127.0.0.1:${targetPort}`,
      'Transfer-Encoding: chunked',
      'Trailer: X-Checksum',
      '',
      '4',
      'body',
      '0',
      'X-Checksum: verified',
      '',
      '',
    ].join('\r\n'), { waitFor: 'request-trailers-preserved' })
    socket = exchange.socket
    assert.equal(exchange.bytes.includes('request-trailers-preserved'), true)
  } finally {
    socket?.destroy()
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

test('rejects invalid CONNECT authorities without contacting an upstream', async () => {
  const state = snapshot()
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  try {
    for (const authority of ['missing-port', 'target.example:0', 'target.example:65536', 'user@target.example:443', 'target.example:443/path']) {
      const exchange = await rawExchange(proxyPort, `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`, {
        waitFor: 'INVALID_CONNECT_AUTHORITY',
      })
      assert.match(exchange.bytes.toString('latin1'), /^HTTP\/1\.1 400 /)
    }
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
  const routeHealth = new ProxyRouteHealth()
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state, routeHealth })
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
    assert.equal(routeHealth.status(state).updates, 'ready')
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
  const routeHealth = new ProxyRouteHealth()
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state, routeHealth })
  const proxyPort = await listen(proxy)
  try {
    const result = await proxyRequest({ proxyPort, target: 'http://example.invalid/' })
    assert.equal(result.statusCode, 502)
    assert.equal(result.headers['x-dsh-proxy-error'], 'UPSTREAM_PROXY_AUTH_FAILED')
    assert.equal(result.headers['proxy-authenticate'], undefined)
    assert.equal(result.body.toString().includes('credential details'), false)
    assert.equal(routeHealth.status(state).updates, 'degraded')
  } finally {
    await close(proxy)
    await close(upstreamProxy)
  }
})

test('does not replay a failed non-idempotent request', async () => {
  let requests = 0
  const upstreamProxy = createServer((request) => {
    requests += 1
    request.socket.destroy()
  })
  const upstreamPort = await listen(upstreamProxy)
  const state = snapshot({ proxyPort: upstreamPort })
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  try {
    const result = await proxyRequest({
      proxyPort,
      target: 'http://example.invalid/mutate',
      method: 'POST',
      body: Buffer.from('must-not-replay'),
    })
    assert.equal(result.statusCode, 502)
    assert.equal(requests, 1)
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

test('rejects an oversized external HTTP proxy handshake line', async () => {
  const upstreamProxy = createNetServer(socket => {
    socket.once('data', () => socket.write(`HTTP/1.1 200 Connection Established\r\nX-Oversized: ${'x'.repeat(64 * 1024)}\r\n\r\n`))
  })
  const upstreamPort = await listen(upstreamProxy)
  const state = snapshot({ proxyPort: upstreamPort })
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  let socket
  try {
    const exchange = await rawExchange(proxyPort, 'CONNECT target.example:443 HTTP/1.1\r\nHost: target.example:443\r\n\r\n', {
      waitFor: 'UPSTREAM_HEADERS_TOO_LARGE',
    })
    socket = exchange.socket
    assert.match(exchange.bytes.toString('latin1'), /^HTTP\/1\.1 502 /)
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

test('forwards WebSocket absolute-form and in-memory authentication through an external HTTP proxy', async () => {
  let observed
  const upstream = createServer()
  upstream.on('upgrade', (request, socket, head) => {
    observed = {
      url: request.url,
      authorization: request.headers['proxy-authorization'],
      upgrade: request.headers.upgrade,
    }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    if (head.byteLength > 0) socket.write(head)
    socket.on('data', chunk => socket.write(chunk))
  })
  const upstreamPort = await listen(upstream)
  const state = snapshot({ proxyPort: upstreamPort })
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  let socket
  try {
    const exchange = await rawExchange(proxyPort, [
      'GET ws://socket.example/events HTTP/1.1',
      'Host: socket.example',
      'Connection: Upgrade',
      'Upgrade: websocket',
      '',
      'external-ws-sticky',
    ].join('\r\n'), { waitFor: 'external-ws-sticky', keepOpen: true })
    socket = exchange.socket
    assert.deepEqual(observed, {
      url: 'ws://socket.example/events',
      authorization: `Basic ${Buffer.from('proxy-user:proxy-password').toString('base64')}`,
      upgrade: 'websocket',
    })
    assert.equal(exchange.bytes.toString('latin1').endsWith('external-ws-sticky'), true)
  } finally {
    socket?.destroy()
    await close(proxy)
    await close(upstream)
  }
})

test('routes HTTP through authenticated SOCKS5 with local DNS and fragmented replies', async () => {
  const payload = Buffer.alloc(2 * 1024 * 1024, 0x6b)
  const target = createServer((request, response) => {
    assert.equal(request.url, '/resource')
    response.end(payload)
  })
  const targetPort = await listen(target)
  const username = '代理:@/'
  const password = '密钥:@/'
  const fixture = socksFixture({ username, password })
  const socksPort = await listen(fixture.server)
  const state = snapshot({ proxyPort: socksPort, protocol: 'socks5', remoteDns: false, username, password })
  const resolver = async (host, options = {}) => {
    assert.equal(host, 'target.test')
    if (options.all) return [{ address: '127.0.0.1', family: 4 }]
    return { address: '127.0.0.1', family: 4 }
  }
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state, resolver })
  const proxyPort = await listen(proxy)
  try {
    const result = await proxyRequest({ proxyPort, target: `http://target.test:${targetPort}/resource` })
    assert.equal(result.statusCode, 200)
    assert.equal(result.body.byteLength, payload.byteLength)
    assert.equal(createHash('sha256').update(result.body).digest('hex'), createHash('sha256').update(payload).digest('hex'))
    assert.deepEqual(fixture.observations, [
      { authentication: { username, password } },
      { target: { atyp: 0x01, host: '127.0.0.1', port: targetPort } },
    ])
  } finally {
    await close(proxy)
    await close(fixture.server)
    await close(target)
  }
})

test('routes WebSocket upgrade through unauthenticated SOCKS5 without exposing proxy details', async () => {
  const target = createServer()
  target.on('upgrade', (request, socket, head) => {
    assert.equal(request.url, '/events')
    assert.equal(request.headers['proxy-authorization'], undefined)
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    if (head.byteLength > 0) socket.write(head)
    socket.on('data', chunk => socket.write(chunk))
  })
  const targetPort = await listen(target)
  const fixture = socksFixture()
  const socksPort = await listen(fixture.server)
  const state = snapshot({ proxyPort: socksPort, protocol: 'socks5', username: '', password: null })
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  let socket
  try {
    const exchange = await rawExchange(proxyPort, [
      `GET ws://127.0.0.1:${targetPort}/events HTTP/1.1`,
      `Host: 127.0.0.1:${targetPort}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      '',
      'socks-ws-sticky',
    ].join('\r\n'), { waitFor: 'socks-ws-sticky', keepOpen: true })
    socket = exchange.socket
    assert.match(exchange.bytes.toString('latin1'), /^HTTP\/1\.1 101 Switching Protocols/)
    assert.equal(exchange.bytes.toString('latin1').endsWith('socks-ws-sticky'), true)
    assert.equal(fixture.observations.some(entry => 'authentication' in entry), false)
  } finally {
    socket?.destroy()
    await close(proxy)
    await close(fixture.server)
    await close(target)
  }
})

test('routes CONNECT through SOCKS5 remote DNS and preserves post-handshake bytes', async () => {
  const fixture = socksFixture({
    username: 'proxy-user', password: 'proxy-password', connectTarget: false, sticky: 'socks-prefetched',
  })
  const socksPort = await listen(fixture.server)
  const state = snapshot({ proxyPort: socksPort, protocol: 'socks5', remoteDns: true })
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  let socket
  try {
    const exchange = await rawExchange(proxyPort, 'CONNECT remote.example:443 HTTP/1.1\r\nHost: remote.example:443\r\n\r\n', {
      waitFor: 'socks-prefetched', keepOpen: true,
    })
    socket = exchange.socket
    assert.equal(exchange.bytes.toString('latin1').endsWith('socks-prefetched'), true)
    assert.deepEqual(fixture.observations.at(-1), { target: { atyp: 0x03, host: 'remote.example', port: 443 } })
    socket.write('socks-echo')
    const [chunk] = await once(socket, 'data')
    assert.equal(chunk.toString(), 'socks-echo')
  } finally {
    socket?.destroy()
    await close(proxy)
    await close(fixture.server)
  }
})

test('encodes IPv6 SOCKS5 targets and does not fall back direct on authentication failure', async () => {
  const ipv6 = socksFixture({ username: 'proxy-user', password: 'proxy-password', connectTarget: false })
  const ipv6Port = await listen(ipv6.server)
  const ipv6State = snapshot({ proxyPort: ipv6Port, protocol: 'socks5' })
  const ipv6Proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => ipv6State })
  const ipv6ProxyPort = await listen(ipv6Proxy)
  let tunnel
  try {
    tunnel = (await rawExchange(ipv6ProxyPort, 'CONNECT [2001:db8::1]:443 HTTP/1.1\r\nHost: [2001:db8::1]:443\r\n\r\n', { keepOpen: true })).socket
    assert.deepEqual(ipv6.observations.at(-1), {
      target: { atyp: 0x04, host: '20010db8000000000000000000000001', port: 443 },
    })
  } finally {
    tunnel?.destroy()
    await close(ipv6Proxy)
    await close(ipv6.server)
  }

  const rejected = socksFixture({ username: 'proxy-user', password: 'proxy-password', rejectAuth: true })
  const rejectedPort = await listen(rejected.server)
  const rejectedState = snapshot({ proxyPort: rejectedPort, protocol: 'socks5' })
  const rejectedProxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => rejectedState })
  const rejectedProxyPort = await listen(rejectedProxy)
  try {
    const result = await proxyRequest({ proxyPort: rejectedProxyPort, target: 'http://must-not-connect.invalid/' })
    assert.equal(result.statusCode, 502)
    assert.equal(result.headers['x-dsh-proxy-error'], 'UPSTREAM_PROXY_AUTH_FAILED')
  } finally {
    await close(rejectedProxy)
    await close(rejected.server)
  }
})

test('rejects an oversized SOCKS5 domain before sending a CONNECT request', async () => {
  let bytesAfterGreeting = 0
  let closed
  const fixture = createNetServer(socket => {
    let greeted = false
    socket.on('data', chunk => {
      if (!greeted) {
        greeted = true
        socket.write(Buffer.from([0x05, 0x00]))
        return
      }
      bytesAfterGreeting += chunk.byteLength
    })
    socket.once('close', () => closed?.())
  })
  const fixturePort = await listen(fixture)
  try {
    const fixtureClosed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('invalid SOCKS target did not close its transport')), 1_000)
      closed = () => { clearTimeout(timer); resolve() }
    })
    await assert.rejects(connectThroughSocks5({
      endpoint: { host: '127.0.0.1', port: fixturePort, username: '', password: null, remoteDns: true },
      targetHost: `${'a'.repeat(252)}.test`,
      targetPort: 443,
    }), error => error.code === 'SOCKS5_TARGET_INVALID')
    await fixtureClosed
    assert.equal(bytesAfterGreeting, 0)
  } finally {
    await close(fixture)
  }
})

test('reports a SOCKS5 CONNECT rejection without retrying the target directly', async () => {
  const rejected = socksFixture({ username: 'proxy-user', password: 'proxy-password', rejectConnect: true })
  const rejectedPort = await listen(rejected.server)
  const state = snapshot({ proxyPort: rejectedPort, protocol: 'socks5' })
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  try {
    const result = await proxyRequest({ proxyPort, target: 'http://must-not-connect.invalid/' })
    assert.equal(result.statusCode, 502)
    assert.equal(result.headers['x-dsh-proxy-error'], 'UPSTREAM_PROXY_REJECTED')
  } finally {
    await close(proxy)
    await close(rejected.server)
  }
})

test('cancels a pending SOCKS5 handshake when the proxy client disconnects', async () => {
  let accepted
  let closed
  const hanging = createNetServer(socket => {
    accepted?.()
    socket.once('close', () => closed?.())
    socket.resume()
  })
  const hangingPort = await listen(hanging)
  const state = snapshot({ proxyPort: hangingPort, protocol: 'socks5' })
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  const client = connect({ host: '127.0.0.1', port: proxyPort })
  try {
    const proxyAccepted = new Promise(resolve => { accepted = resolve })
    const upstreamClosed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cancelled SOCKS5 handshake left an upstream socket open')), 1_000)
      closed = () => { clearTimeout(timer); resolve() }
    })
    await once(client, 'connect')
    client.write('GET http://cancelled.invalid/ HTTP/1.1\r\nHost: cancelled.invalid\r\n\r\n')
    await proxyAccepted
    client.destroy()
    await upstreamClosed
  } finally {
    client.destroy()
    await close(proxy)
    await close(hanging)
  }
})

test('times out a silent SOCKS5 handshake and closes its transport', async () => {
  let closed
  const hanging = createNetServer(socket => {
    socket.once('close', () => closed?.())
    socket.resume()
  })
  const port = await listen(hanging)
  try {
    const upstreamClosed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed-out SOCKS5 handshake left an upstream socket open')), 1_000)
      closed = () => { clearTimeout(timer); resolve() }
    })
    await assert.rejects(connectThroughSocks5({
      endpoint: { host: '127.0.0.1', port, username: '', password: null, remoteDns: true },
      targetHost: 'timeout.invalid', targetPort: 443, timeoutMs: 30,
    }), error => error.code === 'PROXY_CONNECT_TIMEOUT' && error.statusCode === 504)
    await upstreamClosed
  } finally {
    await close(hanging)
  }
})

test('preserves half-close semantics through a SOCKS5 CONNECT tunnel', async () => {
  const target = createNetServer({ allowHalfOpen: true }, socket => {
    const chunks = []
    socket.on('data', chunk => chunks.push(chunk))
    socket.on('end', () => socket.end(`socks-response:${Buffer.concat(chunks).toString()}`))
  })
  const targetPort = await listen(target)
  const fixture = socksFixture({ username: 'proxy-user', password: 'proxy-password' })
  const socksPort = await listen(fixture.server)
  const state = snapshot({ proxyPort: socksPort, protocol: 'socks5' })
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  const socket = connect({ host: '127.0.0.1', port: proxyPort, allowHalfOpen: true })
  try {
    await once(socket, 'connect')
    socket.write(`CONNECT 127.0.0.1:${targetPort} HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\n\r\n`)
    let received = Buffer.alloc(0)
    while (!received.includes('\r\n\r\n')) received = Buffer.concat([received, (await once(socket, 'data'))[0]])
    socket.end('half-close-socks')
    while (!received.includes('socks-response:half-close-socks')) {
      received = Buffer.concat([received, (await once(socket, 'data'))[0]])
    }
    assert.equal(received.toString('latin1').endsWith('socks-response:half-close-socks'), true)
  } finally {
    socket.destroy()
    await close(proxy)
    await close(fixture.server)
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
  let resolutions = 0
  const dnsCache = new ProxyDnsCache({ resolver: async () => {
    resolutions += 1
    return [{ address: '10.4.3.2', family: 4 }]
  } })
  assert.equal((await selectProxyRoute({ snapshot: state, scope: 'updates', host: '127.0.0.1', port: 80, dnsCache })).reason, 'platform-forced-direct')
  assert.equal((await selectProxyRoute({ snapshot: state, scope: 'updates', host: 'sub.example.com', port: 80, dnsCache })).reason, 'no-proxy')
  assert.equal((await selectProxyRoute({ snapshot: state, scope: 'updates', host: 'cidr.example', port: 80, dnsCache })).reason, 'scope-proxy')
  assert.equal((await selectProxyRoute({ snapshot: state, scope: 'sharedDsh', host: 'remote.invalid', port: 80, dnsCache })).mode, 'http')
  assert.equal((await selectProxyRoute({ snapshot: state, scope: 'platform', host: 'remote.invalid', port: 80, dnsCache })).reason, 'scope-direct')
  assert.equal((await selectProxyRoute({ snapshot: state, scope: 'updates', host: '::1', port: 443, dnsCache })).reason, 'platform-forced-direct')
  assert.equal(resolutions, 0, 'HTTP proxy and direct hostname rules must not leak DNS locally')
})

test('resolves SOCKS5 local-DNS candidates once per revision and isolates CIDR bypass targets', async () => {
  let now = 0
  let calls = 0
  const resolver = async () => {
    calls += 1
    return [
      { address: '10.4.3.2', family: 4, ttl: 30 },
      { address: '203.0.113.9', family: 4, ttl: 30 },
      { address: '10.4.3.2', family: 4, ttl: 30 },
    ]
  }
  const dnsCache = new ProxyDnsCache({ resolver, now: () => now })
  const local = snapshot({ proxyPort: 1080, protocol: 'socks5', remoteDns: false, bypass: ['10.0.0.0/8'] })
  const first = await selectProxyRoute({ snapshot: local, scope: 'updates', host: 'mixed.example', port: 443, dnsCache })
  assert.equal(first.reason, 'bypass-cidr')
  assert.deepEqual(first.targets.map(target => target.address), ['10.4.3.2'])
  await selectProxyRoute({ snapshot: local, scope: 'updates', host: 'mixed.example', port: 443, dnsCache })
  assert.equal(calls, 1)
  now = 30_001
  await selectProxyRoute({ snapshot: local, scope: 'updates', host: 'mixed.example', port: 443, dnsCache })
  assert.equal(calls, 2)

  const nextRevision = Object.freeze({ ...local, revision: 'next-revision' })
  await selectProxyRoute({ snapshot: nextRevision, scope: 'updates', host: 'mixed.example', port: 443, dnsCache })
  assert.equal(calls, 3)

  const remote = snapshot({ proxyPort: 1080, protocol: 'socks5', remoteDns: true, bypass: ['10.0.0.0/8'] })
  const remoteRoute = await selectProxyRoute({ snapshot: remote, scope: 'updates', host: 'mixed.example', port: 443, dnsCache })
  assert.equal(remoteRoute.mode, 'socks5')
  assert.equal('targets' in remoteRoute, false)
  assert.equal(calls, 3, 'remote DNS must not resolve a domain to apply CIDR locally')
})

test('negative DNS results expire after ten seconds without leaking across revisions', async () => {
  let now = 0
  let calls = 0
  const dnsCache = new ProxyDnsCache({
    resolver: async () => { calls += 1; throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' }) },
    now: () => now,
  })
  await assert.rejects(dnsCache.resolve('missing.example', 'revision-a'), error => error.code === 'TARGET_DNS_FAILED')
  await assert.rejects(dnsCache.resolve('missing.example', 'revision-a'), error => error.code === 'TARGET_DNS_FAILED')
  assert.equal(calls, 1)
  now = 10_001
  await assert.rejects(dnsCache.resolve('missing.example', 'revision-a'), error => error.code === 'TARGET_DNS_FAILED')
  assert.equal(calls, 2)
  await assert.rejects(dnsCache.resolve('missing.example', 'revision-b'), error => error.code === 'TARGET_DNS_FAILED')
  assert.equal(calls, 3)
})

test('does not fall back to an unbypassed address or proxy after a CIDR-selected direct target fails', async () => {
  const target = createServer((_request, response) => response.end('must-not-be-reached'))
  const targetPort = await listen(target)
  const fixture = socksFixture({ username: 'proxy-user', password: 'proxy-password' })
  const socksPort = await listen(fixture.server)
  const state = snapshot({ proxyPort: socksPort, protocol: 'socks5', remoteDns: false, bypass: ['127.0.0.2/32'] })
  const resolver = async () => [
    { address: '127.0.0.2', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ]
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state, resolver })
  const proxyPort = await listen(proxy)
  try {
    const result = await proxyRequest({ proxyPort, target: `http://mixed.test:${targetPort}/` })
    assert.equal(result.statusCode, 502)
    assert.equal(result.body.includes('must-not-be-reached'), false)
    assert.equal(fixture.observations.length, 0)
  } finally {
    await close(proxy)
    await close(fixture.server)
    await close(target)
  }
})

test('reevaluates policy revision for each request on one client keep-alive connection', async () => {
  const firstUpstream = createServer((_request, response) => response.end('first-revision'))
  const secondUpstream = createServer((_request, response) => response.end('second-revision'))
  const firstPort = await listen(firstUpstream)
  const secondPort = await listen(secondUpstream)
  let state = Object.freeze({ ...snapshot({ proxyPort: firstPort }), revision: 'revision-one' })
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  const agent = new Agent({ keepAlive: true, maxSockets: 1 })
  try {
    const first = await proxyAgentRequest({ proxyPort, target: 'http://revision.test/value', agent })
    state = Object.freeze({ ...snapshot({ proxyPort: secondPort }), revision: 'revision-two' })
    const second = await proxyAgentRequest({ proxyPort, target: 'http://revision.test/value', agent })
    assert.equal(first.body.toString(), 'first-revision')
    assert.equal(second.body.toString(), 'second-revision')
    assert.equal(first.socket, second.socket, 'the local client connection should be reused')
  } finally {
    agent.destroy()
    await close(proxy)
    await close(firstUpstream)
    await close(secondUpstream)
  }
})

test('reuses outbound HTTP connections only within one policy revision', async () => {
  let connectionsOpened = 0
  const target = createServer((_request, response) => response.end('ok'))
  target.on('connection', () => { connectionsOpened += 1 })
  const targetPort = await listen(target)
  let state = Object.freeze({ ...snapshot(), revision: 'revision-one' })
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  try {
    await proxyRequest({ proxyPort, target: `http://127.0.0.1:${targetPort}/one` })
    await proxyRequest({ proxyPort, target: `http://127.0.0.1:${targetPort}/two` })
    assert.equal(connectionsOpened, 1)
    state = Object.freeze({ ...snapshot(), revision: 'revision-two' })
    await proxyRequest({ proxyPort, target: `http://127.0.0.1:${targetPort}/three` })
    assert.equal(connectionsOpened, 2)
  } finally {
    await close(proxy)
    await close(target)
  }
})

test('lets an active old-revision request finish while retiring its connection', async () => {
  let releaseSlow
  let slowStarted
  const started = new Promise(resolve => { slowStarted = resolve })
  const target = createServer((request, response) => {
    if (request.url === '/slow') {
      slowStarted()
      return void new Promise(resolve => { releaseSlow = () => { response.end('old-complete'); resolve() } })
    }
    response.end('new-complete')
  })
  const targetPort = await listen(target)
  let state = Object.freeze({ ...snapshot(), revision: 'revision-one' })
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  try {
    const oldRequest = proxyRequest({ proxyPort, target: `http://127.0.0.1:${targetPort}/slow` })
    await started
    state = Object.freeze({ ...snapshot(), revision: 'revision-two' })
    const current = await proxyRequest({ proxyPort, target: `http://127.0.0.1:${targetPort}/current` })
    assert.equal(current.body.toString(), 'new-complete')
    releaseSlow()
    assert.equal((await oldRequest).body.toString(), 'old-complete')
  } finally {
    releaseSlow?.()
    await close(proxy)
    await close(target)
  }
})

test('keeps an established CONNECT tunnel on its original revision while new tunnels use the new revision', async () => {
  const counts = [0, 0]
  const upstream = index => createNetServer(socket => {
    let bytes = Buffer.alloc(0)
    socket.on('data', chunk => {
      bytes = Buffer.concat([bytes, chunk])
      if (!bytes.includes('\r\n\r\n')) return
      counts[index] += 1
      socket.removeAllListeners('data')
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      socket.on('data', value => socket.write(value))
    })
  })
  const firstUpstream = upstream(0)
  const secondUpstream = upstream(1)
  const firstPort = await listen(firstUpstream)
  const secondPort = await listen(secondUpstream)
  let state = Object.freeze({ ...snapshot({ proxyPort: firstPort }), revision: 'revision-one' })
  const proxy = createScopedProxyServer({ scope: 'updates', getSnapshot: () => state })
  const proxyPort = await listen(proxy)
  let first
  let second
  try {
    first = (await rawExchange(proxyPort, 'CONNECT fixed.example:443 HTTP/1.1\r\nHost: fixed.example:443\r\n\r\n', { keepOpen: true })).socket
    state = Object.freeze({ ...snapshot({ proxyPort: secondPort }), revision: 'revision-two' })
    first.write('old-tunnel')
    assert.equal((await once(first, 'data'))[0].toString(), 'old-tunnel')
    second = (await rawExchange(proxyPort, 'CONNECT fixed.example:443 HTTP/1.1\r\nHost: fixed.example:443\r\n\r\n', { keepOpen: true })).socket
    assert.deepEqual(counts, [1, 1])
  } finally {
    first?.destroy()
    second?.destroy()
    await close(proxy)
    await close(firstUpstream)
    await close(secondUpstream)
  }
})
