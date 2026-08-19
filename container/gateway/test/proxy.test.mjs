import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseTrustedHosts } from '../lib/config.mjs'
import {
  closeGatewayServer,
  createGatewayServer,
  HEALTH_PATH,
  INTERNAL_AUTHORITY,
  upstreamRequestHeaders,
} from '../lib/proxy.mjs'

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return server.address().port
}

async function close(server) {
  server.closeAllConnections?.()
  await new Promise(resolve => server.close(resolve))
}

function request(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port, path, headers }, (response) => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    outgoing.once('error', reject)
    outgoing.end()
  })
}

async function withServers(callback, { polyfill = true } = {}) {
  let upstreamRequests = 0
  const upstream = createServer((incoming, response) => {
    upstreamRequests += 1
    if (incoming.url === '/html') {
      const body = '<html><head><title>DSH</title></head><body></body></html>'
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(Buffer.byteLength(body)),
        etag: 'stale-after-injection',
        'last-modified': 'Mon, 17 Aug 2026 00:00:00 GMT',
      })
      response.end(body)
      return
    }
    if (incoming.url === '/stream') {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: first\n\n')
      setTimeout(() => response.end('data: second\n\n'), 50)
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ headers: incoming.headers, url: incoming.url }))
  })
  const upstreamPort = await listen(upstream)
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'dsh.example' }),
    polyfill,
    upstreamPort,
  })
  const gatewayPort = await listen(gateway)
  try {
    await callback({ upstream, upstreamPort, gateway, gatewayPort, requests: () => upstreamRequests })
  } finally {
    await closeGatewayServer(gateway)
    await close(upstream)
  }
}

test('trusted HTTP requests reach upstream with loopback headers', async () => {
  await withServers(async ({ gatewayPort }) => {
    const response = await request(gatewayPort, '/echo?x=1', {
      host: 'dsh.example',
      origin: 'https://dsh.example',
    })
    assert.equal(response.status, 200)
    const payload = JSON.parse(response.body)
    assert.equal(payload.url, '/echo?x=1')
    assert.equal(payload.headers.host, INTERNAL_AUTHORITY)
    assert.equal(payload.headers.origin, `http://${INTERNAL_AUTHORITY}`)
    assert.equal(payload.headers['accept-encoding'], 'identity')
  })
})

test('upstream headers remove connection tokens and gateway authorization', () => {
  const headers = upstreamRequestHeaders({
    authorization: 'Basic c2VjcmV0',
    connection: 'keep-alive, x-remove',
    cookie: 'dsh_plugin_session=preserved',
    host: 'dsh.example',
    'x-remove': 'hop-by-hop',
  })
  assert.equal(headers.connection, undefined)
  assert.equal(headers['x-remove'], undefined)
  assert.equal(headers.authorization, undefined)
  assert.equal(headers.cookie, 'dsh_plugin_session=preserved')
})

test('untrusted requests are rejected without reaching upstream', async () => {
  await withServers(async ({ gatewayPort, requests }) => {
    const response = await request(gatewayPort, '/', { host: 'evil.example' })
    assert.equal(response.status, 403)
    assert.equal(requests(), 0)
  })
})

test('health endpoint reports gateway readiness without touching upstream', async () => {
  await withServers(async ({ gatewayPort, requests }) => {
    const response = await request(gatewayPort, HEALTH_PATH, { host: '127.0.0.1' })
    assert.equal(response.status, 200)
    assert.equal(response.body, 'ok\n')
    assert.equal(requests(), 0)
  })
})

test('management requests use the protected local socket instead of DSH upstream', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-gateway-management-'))
  const socketPath = join(root, 'management.sock')
  const management = createServer((incoming, response) => {
    response.writeHead(202, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ method: incoming.method, path: incoming.url }))
  })
  await new Promise((resolve, reject) => {
    management.once('error', reject)
    management.listen(socketPath, resolve)
  })
  let upstreamRequests = 0
  const upstream = createServer((_incoming, response) => { upstreamRequests += 1; response.end('dsh') })
  const upstreamPort = await listen(upstream)
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'dsh.example' }),
    managementSocketPath: socketPath,
    upstreamPort,
  })
  const gatewayPort = await listen(gateway)
  try {
    const result = await request(gatewayPort, '/_dsh_platform/api/v1/update', { host: 'dsh.example' })
    assert.equal(result.status, 202)
    assert.deepEqual(JSON.parse(result.body), { method: 'GET', path: '/_dsh_platform/api/v1/update' })
    assert.equal(upstreamRequests, 0)
  } finally {
    await Promise.all([closeGatewayServer(gateway), close(upstream), close(management)])
  }
})

test('HTML responses receive a guarded polyfill and updated metadata', async () => {
  await withServers(async ({ gatewayPort }) => {
    const response = await request(gatewayPort, '/html', { host: 'dsh.example' })
    assert.equal(response.status, 200)
    assert.match(response.body, /<head><script>/)
    assert.match(response.body, /getRandomValues/)
    assert.equal(response.headers['cache-control'], 'no-cache')
    assert.equal(response.headers.etag, undefined)
    assert.equal(response.headers['last-modified'], undefined)
    assert.equal(Number(response.headers['content-length']), Buffer.byteLength(response.body))
  })
})

test('polyfill can be disabled without changing HTML', async () => {
  await withServers(async ({ gatewayPort }) => {
    const response = await request(gatewayPort, '/html', { host: 'dsh.example' })
    assert.equal(response.body, '<html><head><title>DSH</title></head><body></body></html>')
    assert.equal(response.headers.etag, 'stale-after-injection')
  }, { polyfill: false })
})

test('event streams are forwarded before the upstream response ends', async () => {
  await withServers(async ({ gatewayPort }) => {
    const result = await new Promise((resolve, reject) => {
      const outgoing = httpRequest({
        hostname: '127.0.0.1',
        port: gatewayPort,
        path: '/stream',
        headers: { host: 'dsh.example' },
      }, (response) => {
        let ended = false
        let body = ''
        response.once('data', (chunk) => {
          body += chunk.toString('utf8')
          resolve({ response, first: body, ended: () => ended })
        })
        response.on('data', chunk => { body += chunk.toString('utf8') })
        response.once('end', () => { ended = true })
      })
      outgoing.once('error', reject)
      outgoing.end()
    })
    assert.equal(result.response.headers['content-type'], 'text/event-stream')
    assert.match(result.first, /data: first/)
    assert.equal(result.ended(), false)
    await new Promise(resolve => result.response.once('end', resolve))
  })
})

test('WebSocket upgrades preserve the stream and receive loopback headers', async () => {
  const upstream = createServer()
  let seenHeaders
  let upgradedSocket
  upstream.on('upgrade', (incoming, socket) => {
    seenHeaders = incoming.headers
    upgradedSocket = socket
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    socket.on('data', data => socket.write(data))
  })
  const upstreamPort = await listen(upstream)
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'dsh.example' }),
    upstreamPort,
  })
  const gatewayPort = await listen(gateway)
  const client = netConnect(gatewayPort, '127.0.0.1')
  try {
    await new Promise((resolve, reject) => {
      client.once('connect', resolve)
      client.once('error', reject)
    })
    client.write([
      'GET /api/events.host HTTP/1.1',
      'Host: dsh.example',
      'Origin: https://dsh.example',
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Key: dGVzdA==',
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n'))
    let received = ''
    await new Promise((resolve, reject) => {
      const onData = (chunk) => {
        received += chunk.toString('utf8')
        if (received.includes('\r\n\r\n')) {
          client.off('data', onData)
          resolve()
        }
      }
      client.on('data', onData)
      client.once('error', reject)
    })
    assert.match(received, /^HTTP\/1\.1 101/)
    assert.equal(seenHeaders.host, INTERNAL_AUTHORITY)
    assert.equal(seenHeaders.origin, `http://${INTERNAL_AUTHORITY}`)

    client.write('ping')
    const echo = await new Promise((resolve, reject) => {
      client.once('data', data => resolve(data.toString('utf8')))
      client.once('error', reject)
    })
    assert.equal(echo, 'ping')
  } finally {
    client.destroy()
    upgradedSocket?.destroy()
    upstream.closeAllConnections?.()
    await Promise.all([
      closeGatewayServer(gateway),
      new Promise(resolve => upstream.close(resolve)),
    ])
  }
})
