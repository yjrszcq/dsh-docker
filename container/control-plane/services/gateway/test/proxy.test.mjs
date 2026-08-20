import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
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
import { PlatformAccess } from '../lib/platform-access.mjs'

const PLATFORM_ACCESS_ALLOWED = Object.freeze({ isAuthenticated: () => true })

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

function request(port, path, headers = {}, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port, path, headers, method }, (response) => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    outgoing.once('error', reject)
    outgoing.end(body)
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

test('classifies, redacts, rate-limits, and closes an upstream outage', async () => {
  const reservation = createServer()
  const upstreamPort = await listen(reservation)
  await close(reservation)
  const reports = []
  let now = 1_000
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({}),
    upstreamPort,
    probeIntervalMs: 1_000_000,
    now: () => now,
    report: (message, fields) => { reports.push({ message, fields }) },
  })
  const gatewayPort = await listen(gateway)
  try {
    await request(gatewayPort, '/private?token=must-not-appear', { host: '127.0.0.1' })
    await request(gatewayPort, '/second?secret=must-not-appear', { host: '127.0.0.1' })
    await new Promise(resolve => setImmediate(resolve))
    const failures = reports.filter(entry => entry.message === 'gateway.upstream.failed')
    assert.equal(failures.length, 1)
    assert.equal(failures[0].fields.upstream, 'dsh')
    assert.equal(failures[0].fields.pathname, '/private')
    assert.equal(failures[0].fields.error.code, 'ECONNREFUSED')
    assert.doesNotMatch(JSON.stringify(reports), /must-not-appear|token|secret/)

    const upstream = createServer((_incoming, response) => response.end('ready'))
    await new Promise((resolve, reject) => {
      upstream.once('error', reject)
      upstream.listen(upstreamPort, '127.0.0.1', resolve)
    })
    try {
      now += 5_000
      assert.equal((await request(gatewayPort, '/', { host: '127.0.0.1' })).status, 200)
      await new Promise(resolve => setImmediate(resolve))
      const recovered = reports.find(entry => entry.message === 'gateway.upstream.recovered')
      assert.equal(recovered.fields.upstream, 'dsh')
      assert.equal(recovered.fields.suppressedCount, 1)
      assert.equal(recovered.fields.outageMs, 5_000)
    } finally {
      await close(upstream)
    }
  } finally {
    await closeGatewayServer(gateway)
  }
})

test('serves trusted System Plugin bundles across DSH restart and uninstall races', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-gateway-system-plugin-'))
  const packageRoot = join(root, 'settings-document-editor')
  const bundle = Buffer.from('window.systemPluginLoaded = true\n')
  const rev = createHash('sha1').update(bundle).digest('hex').slice(0, 12)
  await mkdir(join(packageRoot, 'lib'), { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@dsh-docker/settings-document-editor',
    exports: { './client': './lib/client.bundle.js' },
  }))
  await writeFile(join(packageRoot, 'lib/client.bundle.js'), bundle)
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({}),
    upstreamPort: 1,
    systemPluginRoot: root,
  })
  const port = await listen(gateway)
  try {
    const response = await request(port, `/plugins/@dsh-docker/settings-document-editor/client.js?rev=${rev}`, { host: '127.0.0.1' })
    assert.equal(response.status, 200)
    assert.equal(response.body, bundle.toString('utf8'))
    assert.match(response.headers['content-type'], /text\/javascript/)
    const stale = await request(port, '/plugins/@dsh-docker/settings-document-editor/client.js?rev=000000000000', { host: '127.0.0.1' })
    assert.notEqual(stale.status, 200)
  } finally {
    await closeGatewayServer(gateway)
  }
})

test('bounded management and Console requests use the protected local socket instead of DSH upstream', async () => {
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
    platformAccess: PLATFORM_ACCESS_ALLOWED,
    upstreamPort,
  })
  const gatewayPort = await listen(gateway)
  try {
    const result = await request(gatewayPort, '/_dsh_platform/api/v1/status', { host: 'dsh.example' })
    assert.equal(result.status, 202)
    assert.deepEqual(JSON.parse(result.body), { method: 'GET', path: '/_dsh_platform/api/v1/status' })
    assert.equal(upstreamRequests, 0)
    for (const [method, path] of [
      ['GET', '/_dsh_platform/api/v1/rollback-plan'],
      ['GET', '/_dsh_platform/api/v1/bundled-plugins'],
      ['GET', '/_dsh_platform/api/v1/settings-document'],
      ['GET', '/_dsh_platform/api/v1/user-plugins'],
      ['GET', '/_dsh_platform/api/v1/user-plugins/task/123e4567-e89b-42d3-a456-426614174000'],
      ['GET', '/_dsh_platform/api/v1/terminal/sessions/123e4567-e89b-42d3-a456-426614174000'],
      ['DELETE', '/_dsh_platform/api/v1/terminal/sessions/123e4567-e89b-42d3-a456-426614174000'],
      ['POST', '/_dsh_platform/api/v1/holds/retry'],
      ['POST', '/_dsh_platform/api/v1/rollback'],
      ['POST', '/_dsh_platform/api/v1/return-stable'],
      ['POST', '/_dsh_platform/api/v1/restart-dsh'],
      ['POST', '/_dsh_platform/api/v1/runtime/reset'],
      ['POST', '/_dsh_platform/api/v1/bundled-plugins/action'],
      ['POST', '/_dsh_platform/api/v1/bundled-plugins/toggle'],
      ['POST', '/_dsh_platform/api/v1/bundled-plugins/recovery-action'],
      ['POST', '/_dsh_platform/api/v1/user-plugins/apply'],
      ['POST', '/_dsh_platform/api/v1/terminal/sessions'],
      ['PUT', '/_dsh_platform/api/v1/channel'],
      ['PUT', '/_dsh_platform/api/v1/automatic-check'],
      ['PUT', '/_dsh_platform/api/v1/settings-document'],
      ['GET', '/_dsh_platform/ui/'],
      ['HEAD', '/_dsh_platform/ui/style.css'],
    ]) {
      const proxied = await request(gatewayPort, path, { host: 'dsh.example' }, method)
      assert.equal(proxied.status, 202, `${method} ${path}`)
      if (method !== 'HEAD') assert.equal(JSON.parse(proxied.body).path, path)
    }
    assert.equal((await request(gatewayPort, '/_dsh_platform/api/v1/trust/reset', { host: 'dsh.example' }, 'POST')).status, 404)
    assert.equal((await request(gatewayPort, '/_dsh_platform/api/v1/user-plugins/task/not-a-uuid', { host: 'dsh.example' })).status, 404)
    assert.equal((await request(gatewayPort, '/_dsh_platform/api/v1/terminal/sessions/not-a-uuid', { host: 'dsh.example' })).status, 404)
    assert.equal((await request(gatewayPort, '/_dsh_platform/ui/app.js', { host: 'dsh.example' }, 'POST')).status, 404)
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
  const unauthorized = netConnect(gatewayPort, '127.0.0.1')
  await new Promise((resolve, reject) => {
    unauthorized.once('connect', resolve)
    unauthorized.once('error', reject)
  })
  unauthorized.write([
    'GET /_dsh_platform/api/v1/terminal/sessions/123e4567-e89b-42d3-a456-426614174000/stream HTTP/1.1',
    'Host: dsh.example',
    'Origin: https://dsh.example',
    'Connection: Upgrade',
    'Upgrade: websocket',
    '',
    '',
  ].join('\r\n'))
  const unauthorizedResponse = await new Promise(resolve => unauthorized.once('data', data => resolve(data.toString())))
  assert.match(unauthorizedResponse, /^HTTP\/1\.1 401 Unauthorized/)
  unauthorized.destroy()
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

test('only exact terminal WebSocket upgrades reach the Management Unix socket', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-gateway-terminal-'))
  const socketPath = join(root, 'management.sock')
  const management = createServer()
  let seenHeaders
  let upgradedSocket
  management.on('upgrade', (incoming, socket) => {
    seenHeaders = incoming.headers
    upgradedSocket = socket
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    socket.on('data', data => socket.write(data))
  })
  await new Promise((resolve, reject) => {
    management.once('error', reject)
    management.listen(socketPath, resolve)
  })
  const upstream = createServer((_incoming, response) => response.end('dsh'))
  const upstreamPort = await listen(upstream)
  const platformAccess = new PlatformAccess({ password: 'platform-secret' })
  const platformSession = platformAccess.signIn('platform-secret')
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'dsh.example' }),
    managementSocketPath: socketPath,
    platformAccess,
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
      'GET /_dsh_platform/api/v1/terminal/sessions/123e4567-e89b-42d3-a456-426614174000/stream HTTP/1.1',
      'Host: dsh.example',
      'Origin: https://dsh.example',
      `Cookie: dsh_platform_session=${platformSession}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Key: dGVzdA==',
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n'))
    let received = ''
    await new Promise((resolve, reject) => {
      const onData = chunk => {
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
    client.write('terminal-ping')
    assert.equal(await new Promise(resolve => client.once('data', data => resolve(data.toString()))), 'terminal-ping')

    const rejected = netConnect(gatewayPort, '127.0.0.1')
    await new Promise((resolve, reject) => {
      rejected.once('connect', resolve)
      rejected.once('error', reject)
    })
    rejected.write('GET /_dsh_platform/api/v1/events HTTP/1.1\r\nHost: dsh.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    const rejectedResponse = await new Promise(resolve => rejected.once('data', data => resolve(data.toString())))
    assert.match(rejectedResponse, /^HTTP\/1\.1 400 Bad Request/)
    rejected.destroy()
  } finally {
    client.destroy()
    upgradedSocket?.destroy()
    await Promise.all([closeGatewayServer(gateway), close(upstream), close(management)])
  }
})
