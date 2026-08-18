import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import test from 'node:test'
import { LoginRateLimiter, LOGIN_PATH, LOGOUT_PATH, SESSION_COOKIE } from '../lib/auth.mjs'
import { parseTrustedHosts } from '../lib/config.mjs'
import { closeGatewayServer, createGatewayServer, HEALTH_PATH } from '../lib/proxy.mjs'

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

function request(port, { path = '/', method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port, path, method, headers }, (response) => {
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

async function withGateway(password, callback) {
  let upstreamRequests = 0
  const upstream = createServer((_incoming, response) => {
    upstreamRequests += 1
    response.end('upstream')
  })
  const upstreamPort = await listen(upstream)
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'dsh.example' }),
    password,
    upstreamPort,
  })
  const gatewayPort = await listen(gateway)
  try {
    await callback({ gatewayPort, requests: () => upstreamRequests })
  } finally {
    await closeGatewayServer(gateway)
    await close(upstream)
  }
}

test('empty password leaves gateway access transparent', async () => {
  await withGateway('', async ({ gatewayPort, requests }) => {
    const response = await request(gatewayPort, { headers: { host: 'dsh.example' } })
    assert.equal(response.status, 200)
    assert.equal(response.body, 'upstream')
    assert.equal(requests(), 1)
  })
})

test('password access distinguishes navigation and API requests', async () => {
  await withGateway('correct horse', async ({ gatewayPort, requests }) => {
    const page = await request(gatewayPort, {
      path: '/sessions',
      headers: { accept: 'text/html', host: 'dsh.example' },
    })
    assert.equal(page.status, 303)
    assert.equal(page.headers.location, `${LOGIN_PATH}?return=%2Fsessions`)

    const api = await request(gatewayPort, {
      path: '/api/sessions',
      headers: { accept: 'application/json', host: 'dsh.example' },
    })
    assert.equal(api.status, 401)
    assert.equal(requests(), 0)
  })
})

test('login issues an in-memory strict cookie and authorizes requests', async () => {
  await withGateway('correct horse', async ({ gatewayPort, requests }) => {
    const rejected = await request(gatewayPort, {
      path: LOGIN_PATH,
      method: 'POST',
      headers: { host: 'dsh.example' },
      body: 'password=wrong&return=%2Fsettings',
    })
    assert.equal(rejected.status, 401)
    assert.equal(rejected.headers['set-cookie'], undefined)

    const accepted = await request(gatewayPort, {
      path: LOGIN_PATH,
      method: 'POST',
      headers: { host: 'dsh.example', 'x-forwarded-proto': 'https' },
      body: 'password=correct+horse&return=%2Fsettings',
    })
    assert.equal(accepted.status, 303)
    assert.equal(accepted.headers.location, '/settings')
    const cookie = accepted.headers['set-cookie'][0]
    assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43};`))
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /SameSite=Strict/)
    assert.match(cookie, /Secure/)
    assert.doesNotMatch(cookie, /correct/)

    const authorized = await request(gatewayPort, {
      path: '/api/settings',
      headers: { cookie: cookie.split(';', 1)[0], host: 'dsh.example' },
    })
    assert.equal(authorized.status, 200)
    assert.equal(authorized.body, 'upstream')
    assert.equal(requests(), 1)

    const logout = await request(gatewayPort, {
      path: LOGOUT_PATH,
      method: 'POST',
      headers: { cookie: cookie.split(';', 1)[0], host: 'dsh.example' },
    })
    assert.equal(logout.status, 303)
    assert.match(logout.headers['set-cookie'][0], /Max-Age=0/)
  })
})

test('health remains available but untrusted login requests are rejected first', async () => {
  await withGateway('secret', async ({ gatewayPort, requests }) => {
    const health = await request(gatewayPort, { path: HEALTH_PATH, headers: { host: '127.0.0.1' } })
    assert.equal(health.status, 200)
    const login = await request(gatewayPort, { path: LOGIN_PATH, headers: { host: 'evil.example' } })
    assert.equal(login.status, 403)
    assert.equal(requests(), 0)
  })
})

test('password-protected WebSocket upgrades fail before reaching upstream', async () => {
  await withGateway('secret', async ({ gatewayPort, requests }) => {
    const client = netConnect(gatewayPort, '127.0.0.1')
    try {
      await new Promise((resolve, reject) => {
        client.once('connect', resolve)
        client.once('error', reject)
      })
      client.write('GET /events HTTP/1.1\r\nHost: dsh.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
      const response = await new Promise((resolve, reject) => {
        client.once('data', data => resolve(data.toString('utf8')))
        client.once('error', reject)
      })
      assert.match(response, /^HTTP\/1\.1 401 Unauthorized/)
      assert.equal(requests(), 0)
    } finally {
      client.destroy()
    }
  })
})

test('login rate limiter resets windows and successful clients', () => {
  let now = 0
  const limiter = new LoginRateLimiter({ attempts: 2, windowMs: 100, now: () => now })
  assert.equal(limiter.allow('client'), true)
  assert.equal(limiter.allow('client'), true)
  assert.equal(limiter.allow('client'), false)
  now = 100
  assert.equal(limiter.allow('client'), true)
  limiter.reset('client')
  assert.equal(limiter.allow('client'), true)
})

test('login rate limiter bounds global attempts and tracked clients', () => {
  const globallyLimited = new LoginRateLimiter({ attempts: 10, globalAttempts: 2 })
  assert.equal(globallyLimited.allow('one'), true)
  assert.equal(globallyLimited.allow('two'), true)
  assert.equal(globallyLimited.allow('three'), false)

  const clientLimited = new LoginRateLimiter({ attempts: 10, globalAttempts: 10, maxClients: 1 })
  assert.equal(clientLimited.allow('one'), true)
  assert.equal(clientLimited.allow('two'), false)
})
