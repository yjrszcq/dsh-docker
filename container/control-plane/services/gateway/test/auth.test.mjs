import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import test from 'node:test'
import { BASIC_AUTH_CHALLENGE, LoginRateLimiter } from '../lib/auth.mjs'
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

function authorization(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

async function withGateway(password, callback, username = '') {
  let upstreamRequests = 0
  let upstreamHeaders
  const upstream = createServer((incoming, response) => {
    upstreamRequests += 1
    upstreamHeaders = incoming.headers
    response.end('upstream')
  })
  const upstreamPort = await listen(upstream)
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'dsh.example' }),
    password,
    username,
    upstreamPort,
  })
  const gatewayPort = await listen(gateway)
  try {
    await callback({ gatewayPort, requests: () => upstreamRequests, headers: () => upstreamHeaders })
  } finally {
    await closeGatewayServer(gateway)
    await close(upstream)
  }
}

test('empty password leaves gateway access transparent even with a username', async () => {
  await withGateway('', async ({ gatewayPort, requests }) => {
    const response = await request(gatewayPort, { headers: { host: 'dsh.example' } })
    assert.equal(response.status, 200)
    assert.equal(response.body, 'upstream')
    assert.equal(requests(), 1)
  }, 'unused')
})

test('password access challenges every unauthenticated request with HTTP Basic', async () => {
  await withGateway('correct horse', async ({ gatewayPort, requests }) => {
    for (const path of ['/sessions', '/api/sessions']) {
      const response = await request(gatewayPort, { path, headers: { host: 'dsh.example' } })
      assert.equal(response.status, 401)
      assert.equal(response.headers['www-authenticate'], BASIC_AUTH_CHALLENGE)
      assert.equal(response.headers['cache-control'], 'no-store')
    }
    assert.equal(requests(), 0)
  })
})

test('HTTP Basic ignores the username, accepts the password, and hides credentials upstream', async () => {
  await withGateway('密:码', async ({ gatewayPort, requests, headers }) => {
    const rejected = await request(gatewayPort, {
      headers: { authorization: authorization('ignored', 'wrong'), host: 'dsh.example' },
    })
    assert.equal(rejected.status, 401)

    const accepted = await request(gatewayPort, {
      headers: { authorization: authorization('anything', '密:码'), host: 'dsh.example' },
    })
    assert.equal(accepted.status, 200)
    assert.equal(accepted.body, 'upstream')
    assert.equal(requests(), 1)
    assert.equal(headers().authorization, undefined)
  })
})

test('configured username and password must both match', async () => {
  await withGateway('secret', async ({ gatewayPort, requests }) => {
    for (const [username, password] of [['wrong', 'secret'], ['account', 'wrong']]) {
      const rejected = await request(gatewayPort, {
        headers: { authorization: authorization(username, password), host: 'dsh.example' },
      })
      assert.equal(rejected.status, 401)
    }
    const accepted = await request(gatewayPort, {
      headers: { authorization: authorization('account', 'secret'), host: 'dsh.example' },
    })
    assert.equal(accepted.status, 200)
    assert.equal(requests(), 1)
  }, 'account')
})

test('malformed HTTP Basic credentials are rejected', async () => {
  await withGateway('secret', async ({ gatewayPort, requests }) => {
    for (const value of ['Bearer secret', 'Basic !!!', `Basic ${Buffer.from('missing-colon').toString('base64')}`]) {
      const response = await request(gatewayPort, {
        headers: { authorization: value, host: 'dsh.example' },
      })
      assert.equal(response.status, 401)
    }
    assert.equal(requests(), 0)
  })
})

test('health remains available but untrusted requests are rejected first', async () => {
  await withGateway('secret', async ({ gatewayPort, requests }) => {
    const health = await request(gatewayPort, { path: HEALTH_PATH, headers: { host: '127.0.0.1' } })
    assert.equal(health.status, 200)
    const untrusted = await request(gatewayPort, { headers: { host: 'evil.example' } })
    assert.equal(untrusted.status, 403)
    assert.equal(requests(), 0)
  })
})

test('password-protected WebSocket upgrades return an HTTP Basic challenge', async () => {
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
      assert.match(response, new RegExp(`WWW-Authenticate: ${BASIC_AUTH_CHALLENGE}`))
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
