import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import test from 'node:test'
import { DshAvailability, availabilityPage, language } from '../lib/availability.mjs'
import { closeGatewayServer, createGatewayServer, READINESS_PATH, WAIT_PATH, safeReturnPath } from '../lib/proxy.mjs'
import { parseTrustedHosts } from '../lib/config.mjs'

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server.address().port
}

function request(port, path = '/', { method = 'GET', accept = 'text/html', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({
      hostname: '127.0.0.1', port, path, method,
      headers: { host: 'dsh.example', accept, ...headers },
    }, response => {
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

async function unavailableGateway({ platform = {}, availability = new DshAvailability(), probe = async () => false } = {}) {
  const placeholder = createServer()
  const unavailablePort = await listen(placeholder)
  await new Promise(resolve => placeholder.close(resolve))
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'dsh.example' }),
    upstreamPort: unavailablePort,
    platformStatus: async () => platform,
    availability,
    probe,
    probeIntervalMs: 60_000,
  })
  return { gateway, port: await listen(gateway) }
}

test('official-style holding page is self-contained and replaces the spinner with platform status', () => {
  const page = availabilityPage('switching', { 'accept-language': 'zh-CN' })
  assert.match(page, /HARNESS/)
  assert.match(page, /正在切换 DeepSeek Harness 运行版本/)
  assert.match(page, /href="\/_dsh_platform\/console\/"/)
  assert.match(page, /打开 DSH 管理中心进行检查和恢复/)
  assert.match(page, new RegExp(READINESS_PATH))
  assert.match(page, /prefers-color-scheme:light/)
  assert.match(page, /name="viewport"/)
  assert.match(page, /max-width:520px/)
  assert.doesNotMatch(page, /spinner|Loading plugins/)
  assert.doesNotMatch(page, /letter-spacing:-/)
})

test('holding pages prefer the last DSH locale cookie over browser language', () => {
  assert.equal(language({ cookie: 'theme=dark; dsh_locale=en', 'accept-language': 'zh-CN' }), 'en')
  assert.equal(language({ cookie: 'dsh_locale=zh', 'accept-language': 'en-US' }), 'zh')
  assert.equal(language({ cookie: 'dsh_locale=fr', 'accept-language': 'en-US' }), 'en')
  assert.equal(language({ 'accept-language': 'fr-FR, zh-CN;q=0.8, en;q=0.5' }), 'zh')
  assert.match(availabilityPage('recovering', { cookie: 'dsh_locale=zh', 'accept-language': 'en-US' }), /意外停止/)
  assert.match(availabilityPage('recovering', { cookie: 'dsh_locale=en', 'accept-language': 'zh-CN' }), /Open DSH Management Console for diagnostics and recovery/)
})

test('every classified outage page links to the standalone Platform Management console', () => {
  for (const state of ['starting', 'stopping', 'stopped', 'restarting', 'switching', 'runtime-recovering', 'recovering', 'failed', 'unavailable']) {
    const page = availabilityPage(state, { 'accept-language': 'en-US' })
    assert.match(page, /href="\/_dsh_platform\/console\/"/)
  }
})

test('intentional DSH restarts have explicit holding and failure states', () => {
  const availability = new DshAvailability()
  assert.equal(availability.classify({ operation: 'restarting' }), 'restarting')
  assert.equal(availability.classify({ operation: 'restart-failed' }), 'failed')
  assert.match(availabilityPage('restarting', { 'accept-language': 'zh-CN' }), /正在重新启动/)
  assert.equal(availability.classify({ dshLifecycle: { state: 'stopping' } }), 'stopping')
  assert.equal(availability.classify({ dshLifecycle: { state: 'stopped' } }), 'stopped')
  assert.equal(availability.classify({ dshLifecycle: { state: 'recovering', attempt: 2 } }), 'recovering')
  assert.match(availabilityPage('recovering', { 'accept-language': 'zh-CN' }, {
    lifecycle: { attempt: 2, maxAttempts: 3 },
  }), /第 2 \/ 3 次/)
})

test('holding-page return paths stay same-origin and reject ambiguous inputs', () => {
  assert.equal(safeReturnPath('/sessions/current?view=chat#latest'), '/sessions/current?view=chat#latest')
  for (const value of [null, '', '//example.com/path', '/\\example.com', 'https://example.com/', '/bad\npath']) {
    assert.equal(safeReturnPath(value), '/')
  }
  const page = availabilityPage('restarting', {}, { returnPath: '/</script><script>alert(1)</script>' })
  assert.doesNotMatch(page, /const returnPath="\/<\/script>/)
  assert.match(page, /\\u003c\/script>/)
})

test('cold start serves a holding page while API and WebSocket-shaped HTTP requests receive 503', async () => {
  const { gateway, port } = await unavailableGateway()
  try {
    const page = await request(port)
    assert.equal(page.status, 200)
    assert.match(page.body, /DeepSeek Harness is starting/)
    assert.equal(page.headers['cache-control'], 'no-store')
    assert.equal((await request(port, '/api/sessions', { accept: 'application/json' })).status, 503)
    assert.equal((await request(port, '/', { method: 'POST', accept: 'text/html' })).status, 503)
  } finally {
    await closeGatewayServer(gateway)
  }
})

test('an unresponsive management service does not block the cold-start holding page', async () => {
  const placeholder = createServer()
  const unavailablePort = await listen(placeholder)
  await new Promise(resolve => placeholder.close(resolve))
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'dsh.example' }),
    upstreamPort: unavailablePort,
    platformStatus: () => new Promise(() => {}),
    probe: async () => false,
    probeIntervalMs: 60_000,
  })
  const port = await listen(gateway)
  try {
    const startedAt = Date.now()
    const page = await request(port)
    assert.equal(page.status, 200)
    assert.match(page.body, /DeepSeek Harness is starting/)
    assert.ok(Date.now() - startedAt < 1_000)
  } finally {
    await closeGatewayServer(gateway)
  }
})

test('platform switching, recovery, and startup failure select distinct page messages', async () => {
  for (const [platform, expected] of [
    [{ operation: 'switching' }, /Switching the DeepSeek Harness runtime/],
    [{ operation: 'recovering' }, /Restoring the DeepSeek Harness runtime/],
    [{ recoveryMode: 'candidate failed' }, /DeepSeek Harness could not start/],
  ]) {
    const { gateway, port } = await unavailableGateway({ platform })
    try {
      const page = await request(port)
      assert.equal(page.status, 200)
      assert.match(page.body, expected)
      assert.equal((await request(port, '/api/status', { accept: 'application/json' })).status, 503)
    } finally {
      await closeGatewayServer(gateway)
    }
  }
})

test('dedicated holding route preserves a safe return path and redirects when ready', async () => {
  let ready = false
  const platform = { dshLifecycle: { state: 'stopping' } }
  const context = await unavailableGateway({
    platform,
    probe: async () => ready,
  })
  try {
    const target = '/sessions/current?view=chat#latest'
    const waiting = await request(context.port, `${WAIT_PATH}?return=${encodeURIComponent(target)}`)
    assert.equal(waiting.status, 200)
    assert.match(waiting.body, /DeepSeek Harness is stopping/)
    assert.match(waiting.body, /location\.replace\(returnPath\)/)
    assert.match(waiting.body, /\/sessions\/current\?view=chat#latest/)

    const invalid = await request(context.port, `${WAIT_PATH}?return=${encodeURIComponent('//example.com/')}`)
    assert.equal(invalid.status, 200)
    assert.match(invalid.body, /const returnPath="\/"/)

    ready = true
    const premature = await request(context.port, `${WAIT_PATH}?return=${encodeURIComponent(target)}`)
    assert.equal(premature.status, 200)
    assert.match(premature.body, /DeepSeek Harness is stopping/)
    const prematureReadiness = await request(context.port, READINESS_PATH)
    assert.equal(prematureReadiness.status, 503)
    assert.equal(JSON.parse(prematureReadiness.body).state, 'stopping')

    platform.dshLifecycle.state = 'running'
    const redirected = await request(context.port, `${WAIT_PATH}?return=${encodeURIComponent(target)}`)
    assert.equal(redirected.status, 302)
    assert.equal(redirected.headers.location, target)
    assert.deepEqual(JSON.parse((await request(context.port, READINESS_PATH)).body), { ready: true, state: 'ready' })
    assert.equal((await request(context.port, WAIT_PATH, { method: 'POST' })).status, 405)
  } finally {
    await closeGatewayServer(context.gateway)
  }
})

test('WebSocket receives 503 during a classified DSH outage', async () => {
  const { gateway, port } = await unavailableGateway({ platform: { operation: 'switching' } })
  const socket = netConnect(port, '127.0.0.1')
  try {
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    socket.write('GET /events HTTP/1.1\r\nHost: dsh.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    const response = await new Promise((resolve, reject) => {
      socket.once('data', data => resolve(data.toString('utf8')))
      socket.once('error', reject)
    })
    assert.match(response, /^HTTP\/1\.1 503 Service Unavailable/)
  } finally {
    socket.destroy()
    await closeGatewayServer(gateway)
  }
})

test('one unexpected local failure remains 502 until repeated probes confirm unavailability', async () => {
  let now = 0
  const availability = new DshAvailability({ now: () => now, failures: 3, failureWindowMs: 1_500 })
  availability.observe(true)
  const context = await unavailableGateway({ availability })
  try {
    assert.equal((await request(context.port)).status, 502)
    availability.observe(false)
    now = 1_600
    availability.observe(false)
    const recovered = await request(context.port)
    assert.equal(recovered.status, 200)
    assert.match(recovered.body, /temporarily unavailable/)
  } finally {
    await closeGatewayServer(context.gateway)
  }
})

test('readiness immediately reports ready and clears confirmed failure state', async () => {
  let ready = false
  let now = 0
  const availability = new DshAvailability({ now: () => now, failures: 1, failureWindowMs: 0 })
  availability.observe(true)
  availability.observe(false)
  const context = await unavailableGateway({ availability, probe: async () => ready })
  try {
    const unavailable = await request(context.port, READINESS_PATH, { accept: 'application/json' })
    assert.equal(unavailable.status, 503)
    assert.equal(JSON.parse(unavailable.body).state, 'unavailable')
    ready = true
    const healthy = await request(context.port, READINESS_PATH, { accept: 'application/json' })
    assert.equal(healthy.status, 200)
    assert.deepEqual(JSON.parse(healthy.body), { ready: true, state: 'ready' })
    assert.equal(availability.classify({}), 'unknown')
  } finally {
    await closeGatewayServer(context.gateway)
  }
})
