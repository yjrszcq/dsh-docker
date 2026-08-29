import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseTrustedHosts } from '../lib/config.mjs'
import { closeGatewayServer, createGatewayServer, HEALTH_PATH } from '../lib/proxy.mjs'

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server.address().port
}

async function close(server) {
  server.closeAllConnections?.()
  await new Promise(resolve => server.close(resolve))
}

function request(port, { path = '/', method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port, path, method, headers }, response => {
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

const initialized = Object.freeze({ status: async () => ({ state: 'initialized' }), handle: async () => false })

test('Gateway fails closed without an authenticated browser session while health remains available', async () => {
  let upstreamRequests = 0
  const upstream = createServer((_incoming, response) => { upstreamRequests += 1; response.end('upstream') })
  const upstreamPort = await listen(upstream)
  const gateway = createGatewayServer({ trustedHosts: parseTrustedHosts({}), upstreamPort })
  const port = await listen(gateway)
  try {
    assert.equal((await request(port, { path: HEALTH_PATH, headers: { host: '127.0.0.1' } })).status, 200)
    const navigation = await request(port, { headers: { accept: 'text/html', host: '127.0.0.1' } })
    assert.equal(navigation.status, 303)
    assert.match(navigation.headers.location, /^\/_dsh_platform\/auth\//)
    assert.equal((await request(port, { path: '/api/sessions', headers: { host: '127.0.0.1' } })).status, 401)
    assert.equal(upstreamRequests, 0)
  } finally {
    await Promise.all([closeGatewayServer(gateway), close(upstream)])
  }
})

test('Gateway reports an unavailable authentication backend as a service failure', async () => {
  const unavailable = new Error('access socket unavailable')
  unavailable.browserAuthenticationBackend = true
  const browserAuthentication = {
    status: async () => { throw unavailable },
    handle: async () => false,
  }
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({}), browserAuthentication, upstreamPort: 1,
  })
  const port = await listen(gateway)
  try {
    assert.equal((await request(port, {
      path: HEALTH_PATH, headers: { host: '127.0.0.1' },
    })).status, 200)
    const unavailable = await request(port, { headers: { host: '127.0.0.1', accept: 'text/html' } })
    assert.equal(unavailable.status, 503)
    assert.match(unavailable.body, /authentication service unavailable/)
  } finally { await closeGatewayServer(gateway) }
})

test('DSH and Management sessions authorize only their own route surfaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-gateway-session-domains-'))
  const socketPath = join(root, 'management.sock')
  const management = createServer((incoming, response) => response.end(`management:${incoming.url}`))
  await new Promise((resolve, reject) => {
    management.once('error', reject)
    management.listen(socketPath, resolve)
  })
  const upstream = createServer((_incoming, response) => response.end('dsh'))
  const upstreamPort = await listen(upstream)
  const browserAuthentication = {
    ...initialized,
    validateDsh: async request => ({ authenticated: request.headers.cookie === 'dsh=yes' }),
    authorizePlugin: async request => request.headers.cookie === 'dsh=yes'
      ? { authorized: true, capability: { token: 'plugin-capability' } }
      : { authorized: false },
    validateManagement: async request => ({ authenticated: request.headers.cookie === 'management=yes' }),
    enterManagement: async (_request, response) => { response.writeHead(303, { location: '/_dsh_platform/auth/management' }); response.end() },
  }
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({}), browserAuthentication,
    managementSocketPath: socketPath, upstreamPort,
  })
  const port = await listen(gateway)
  try {
    assert.equal((await request(port, { headers: { host: '127.0.0.1', cookie: 'dsh=yes' } })).body, 'dsh')
    assert.equal((await request(port, {
      path: '/_dsh_platform/plugin-api/v1/status', headers: { host: '127.0.0.1', cookie: 'dsh=yes' },
    })).body, 'management:/_dsh_platform/api/v1/status')
    assert.equal((await request(port, {
      path: '/_dsh_platform/api/v1/status', headers: { host: '127.0.0.1', cookie: 'dsh=yes' },
    })).status, 401)
    assert.equal((await request(port, {
      path: '/_dsh_platform/api/v1/status', headers: { host: '127.0.0.1', cookie: 'management=yes' },
    })).body, 'management:/_dsh_platform/api/v1/status')
    assert.equal((await request(port, {
      path: '/', headers: { host: '127.0.0.1', cookie: 'management=yes' },
    })).status, 401)
  } finally {
    await Promise.all([closeGatewayServer(gateway), close(management), close(upstream)])
  }
})

test('terminal WebSocket requires Management rather than DSH authentication', async () => {
  const browserAuthentication = {
    ...initialized,
    validateDsh: async () => ({ authenticated: true }),
    validateManagement: async () => ({ authenticated: false }),
    enterManagement: async () => {},
  }
  const gateway = createGatewayServer({ trustedHosts: parseTrustedHosts({}), browserAuthentication, upstreamPort: 1 })
  const port = await listen(gateway)
  const client = netConnect(port, '127.0.0.1')
  try {
    await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('error', reject) })
    client.write([
      'GET /_dsh_platform/api/v1/terminal/sessions/123e4567-e89b-42d3-a456-426614174000/stream HTTP/1.1',
      'Host: 127.0.0.1', 'Connection: Upgrade', 'Upgrade: websocket', '', '',
    ].join('\r\n'))
    const response = await new Promise((resolve, reject) => {
      client.once('data', data => resolve(data.toString('utf8')))
      client.once('error', reject)
    })
    assert.match(response, /^HTTP\/1\.1 401 Unauthorized/)
  } finally {
    client.destroy()
    await closeGatewayServer(gateway)
  }
})
