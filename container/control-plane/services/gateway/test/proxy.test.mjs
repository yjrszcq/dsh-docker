import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseTrustedHosts } from '../lib/config.mjs'
import { DshAvailability } from '../lib/availability.mjs'
import {
  closeGatewayServer,
  CLIENT_EVENT_PATH,
  createGatewayServer as createGatewayServerBase,
  HEALTH_PATH,
  INTERNAL_AUTHORITY,
  upstreamRequestHeaders,
} from '../lib/proxy.mjs'
const AUTHENTICATED_BROWSER = Object.freeze({
  status: async () => ({ state: 'initialized' }),
  validateDsh: async () => ({ authenticated: true }),
  validateManagement: async () => ({ authenticated: true }),
  enterManagement: async () => { throw new Error('unexpected Management login') },
  handle: async () => false,
})

function browserForMode(mode) {
  return Object.freeze({
    ...AUTHENTICATED_BROWSER,
    status: async () => ({
      state: 'initialized',
      account: {
        managementAccess: {
          mode,
          version: 1,
          isolatedEntry: mode === 'isolated'
            ? { kind: 'public', managementPublicOrigin: 'http://127.0.0.1:3081' }
            : null,
        },
      },
    }),
    authorizeManagement: async () => ({ authorized: true, capability: { token: 'test-capability' } }),
  })
}

function createGatewayServer(options) {
  return createGatewayServerBase({
    ...options,
    browserAuthentication: options.browserAuthentication ?? AUTHENTICATED_BROWSER,
  })
}

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

async function withServers(callback, { polyfill = true, report } = {}) {
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
    if (incoming.url === '/delayed') {
      setTimeout(() => response.end('delayed'), 50)
      return
    }
    if (incoming.url === '/cookies') {
      response.writeHead(200, {
        'set-cookie': [
          'dsh_gateway_session=forged; Path=/',
          'dsh_management_compat_session=forged; Path=/',
          'dsh_application_cookie=preserved; Path=/',
        ],
      })
      response.end('cookies')
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
    report,
  })
  const gatewayPort = await listen(gateway)
  try {
    await callback({ upstream, upstreamPort, gateway, gatewayPort, requests: () => upstreamRequests })
  } finally {
    await closeGatewayServer(gateway)
    await close(upstream)
  }
}

test('client cancellation of a streamed response is not an upstream failure', async () => {
  const reports = []
  await withServers(async ({ gatewayPort }) => {
    await new Promise((resolve, reject) => {
      const outgoing = httpRequest({
        hostname: '127.0.0.1', port: gatewayPort, path: '/stream', headers: { host: 'dsh.example' },
      }, response => {
        response.once('data', () => {
          response.destroy()
          resolve()
        })
      })
      outgoing.once('error', reject)
      outgoing.end()
    })
    await new Promise(resolve => setTimeout(resolve, 100))
  }, { report: (message, fields) => { reports.push({ message, fields }) } })
  assert.equal(reports.some(entry => entry.message === 'gateway.upstream-response.failed'), false)
})

test('client cancellation before response headers is not an upstream outage', async () => {
  const reports = []
  await withServers(async ({ gatewayPort }) => {
    await new Promise((resolve, reject) => {
      const outgoing = httpRequest({
        hostname: '127.0.0.1', port: gatewayPort, path: '/delayed', headers: { host: 'dsh.example' },
      })
      outgoing.once('error', error => {
        if (error.code === 'ECONNRESET') resolve()
        else reject(error)
      })
      outgoing.end()
      setTimeout(() => outgoing.destroy(), 10)
    })
    await new Promise(resolve => setTimeout(resolve, 100))
  }, { report: (message, fields) => { reports.push({ message, fields }) } })
  assert.equal(reports.some(entry => entry.message === 'gateway.upstream.failed'), false)
})

test('trusted HTTP requests reach upstream with loopback headers', async () => {
  await withServers(async ({ gatewayPort }) => {
    const response = await request(gatewayPort, '/echo?x=1', {
      host: 'dsh.example',
      origin: 'https://dsh.example',
      forwarded: 'for=198.51.100.4;proto=https',
      'x-forwarded-for': '198.51.100.4',
      'x-forwarded-host': 'public.example',
      'x-forwarded-proto': 'https',
      'x-real-ip': '198.51.100.4',
    })
    assert.equal(response.status, 200)
    const payload = JSON.parse(response.body)
    assert.equal(payload.url, '/echo?x=1')
    assert.equal(payload.headers.host, INTERNAL_AUTHORITY)
    assert.equal(payload.headers.origin, `http://${INTERNAL_AUTHORITY}`)
    assert.equal(payload.headers['accept-encoding'], 'identity')
    assert.equal(payload.headers.forwarded, undefined)
    assert.equal(payload.headers['x-forwarded-for'], undefined)
    assert.equal(payload.headers['x-forwarded-host'], undefined)
    assert.equal(payload.headers['x-forwarded-proto'], undefined)
    assert.equal(payload.headers['x-real-ip'], undefined)
  })
})

test('upstream headers remove connection tokens and gateway authorization', () => {
  const headers = upstreamRequestHeaders({
    authorization: 'Basic c2VjcmV0',
    connection: 'keep-alive, x-remove',
    cookie: 'dsh_plugin_session=preserved',
    host: 'dsh.example',
    'x-remove': 'hop-by-hop',
    Forwarded: 'for=198.51.100.4',
    'X-Forwarded-Custom': 'external',
    'X-Real-IP': '198.51.100.4',
  })
  assert.equal(headers.connection, undefined)
  assert.equal(headers['x-remove'], undefined)
  assert.equal(headers.authorization, undefined)
  assert.equal(headers.cookie, 'dsh_plugin_session=preserved')
  assert.equal(headers.Forwarded, undefined)
  assert.equal(headers['X-Forwarded-Custom'], undefined)
  assert.equal(headers['X-Real-IP'], undefined)
  const management = upstreamRequestHeaders({
    forwarded: 'for=198.51.100.4',
    'x-forwarded-for': '198.51.100.4',
    'x-real-ip': '198.51.100.4',
  }, { dsh: false })
  assert.equal(management.forwarded, 'for=198.51.100.4')
  assert.equal(management['x-forwarded-for'], '198.51.100.4')
  assert.equal(management['x-real-ip'], '198.51.100.4')
})

test('upstream responses cannot replace Gateway authentication cookies', async () => {
  await withServers(async ({ gatewayPort }) => {
    const response = await request(gatewayPort, '/cookies', { host: 'dsh.example' })
    assert.equal(response.status, 200)
    assert.deepEqual(response.headers['set-cookie'], ['dsh_application_cookie=preserved; Path=/'])
  })
})

test('untrusted requests are rejected without reaching upstream', async () => {
  await withServers(async ({ gatewayPort, requests }) => {
    const response = await request(gatewayPort, '/', { host: 'evil.example' })
    assert.equal(response.status, 403)
    assert.equal(requests(), 0)
  })
})

test('trust rejections report a bounded reason without request secrets', async () => {
  const reports = []
  const upstream = createServer((_incoming, response) => response.end('unexpected'))
  const upstreamPort = await listen(upstream)
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'dsh.example' }),
    upstreamPort,
    report: (message, fields) => { reports.push({ message, fields }) },
  })
  const gatewayPort = await listen(gateway)
  try {
    const response = await request(gatewayPort, '/private?token=must-not-appear', { host: 'evil.example' })
    assert.equal(response.status, 403)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(reports[0].message, 'gateway.request.rejected')
    assert.equal(reports[0].fields.reason, 'untrusted-host')
    assert.equal(reports[0].fields.pathname, '/private')
    assert.doesNotMatch(JSON.stringify(reports), /must-not-appear|token/)
  } finally {
    await closeGatewayServer(gateway)
    await close(upstream)
  }
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
  const availability = new DshAvailability({ now: () => now })
  availability.observe(true)
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({}),
    upstreamPort,
    probeIntervalMs: 1_000_000,
    now: () => now,
    availability,
    report: (message, fields) => { reports.push({ message, fields }) },
  })
  const gatewayPort = await listen(gateway)
  try {
    await request(gatewayPort, '/private?token=must-not-appear', { host: '127.0.0.1' })
    await request(gatewayPort, '/second?secret=must-not-appear', { host: '127.0.0.1' })
    for (let attempt = 0; attempt < 20 && !reports.some(entry => entry.message === 'gateway.upstream.failed'); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
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

test('holds third-party plugin bundles until a managed DSH restart completes', async () => {
  const reservation = createServer()
  await listen(reservation)
  const upstreamPort = reservation.address().port
  await close(reservation)
  let lifecycle = 'restarting'
  let ready = false
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({}),
    upstreamPort,
    platformStatus: async () => ({ dshLifecycle: { state: lifecycle } }),
    probe: async () => ready,
    pluginBundleHoldTimeoutMs: 2_000,
    pluginBundlePollIntervalMs: 10,
  })
  const gatewayPort = await listen(gateway)
  const pending = [
    '/plugins/@example/plugin/client.js?rev=0123456789ab',
    '/plugins/@dsh-docker/platform-management/client.js?rev=stale-image-revision',
  ].map(path => request(gatewayPort, path, { host: '127.0.0.1' }))
  let upstream
  try {
    await new Promise(resolve => setTimeout(resolve, 30))
    upstream = createServer((_incoming, response) => {
      response.writeHead(200, { 'content-type': 'text/javascript' })
      response.end('window.pluginLoaded = true\n')
    })
    await new Promise((resolve, reject) => {
      upstream.once('error', reject)
      upstream.listen(upstreamPort, '127.0.0.1', resolve)
    })
    lifecycle = 'running'
    ready = true
    const responses = await Promise.all(pending)
    assert.deepEqual(responses.map(response => response.status), [200, 200])
    assert.deepEqual(responses.map(response => response.body), [
      'window.pluginLoaded = true\n',
      'window.pluginLoaded = true\n',
    ])
  } finally {
    await closeGatewayServer(gateway)
    if (upstream?.listening) await close(upstream)
  }
})

test('publishes plugin bundles only after the complete response is stable', async () => {
  let requests = 0
  const upstream = createServer((_incoming, response) => {
    requests += 1
    response.writeHead(200, { 'content-type': 'text/javascript' })
    if (requests === 1) {
      response.write('window.partial = true\n')
      response.destroy()
      return
    }
    response.end('window.complete = true\n')
  })
  const upstreamPort = await listen(upstream)
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({}),
    upstreamPort,
    platformStatus: async () => ({ current: { recordId: 'deployment-a' }, dshLifecycle: { state: 'running' } }),
    probe: async () => true,
    pluginBundleHoldTimeoutMs: 1_000,
    pluginBundlePollIntervalMs: 10,
  })
  const gatewayPort = await listen(gateway)
  try {
    const response = await request(gatewayPort, '/plugins/example/client.js?rev=complete', { host: '127.0.0.1' })
    assert.equal(response.status, 200)
    assert.equal(response.body, 'window.complete = true\n')
    assert.equal(requests, 2)
  } finally {
    await closeGatewayServer(gateway)
    await close(upstream)
  }
})

test('reuses a complete plugin bundle only within the same Deployment', async () => {
  let body = 'window.deployment = "a"\n'
  let status = 200
  const upstream = createServer((_incoming, response) => {
    response.writeHead(status, { 'content-type': status === 200 ? 'text/javascript' : 'text/plain' })
    response.end(status === 200 ? body : 'temporarily unavailable\n')
  })
  const upstreamPort = await listen(upstream)
  let recordId = 'deployment-a'
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({}),
    upstreamPort,
    platformStatus: async () => ({ current: { recordId }, dshLifecycle: { state: 'running' } }),
    probe: async () => true,
  })
  const gatewayPort = await listen(gateway)
  const path = '/plugins/example/client.js?rev=stable'
  try {
    assert.equal((await request(gatewayPort, path, { host: '127.0.0.1' })).body, body)
    status = 503
    assert.equal((await request(gatewayPort, path, { host: '127.0.0.1' })).body, body)

    recordId = 'deployment-b'
    body = 'window.deployment = "b"\n'
    status = 200
    assert.equal((await request(gatewayPort, path, { host: '127.0.0.1' })).body, body)
  } finally {
    await closeGatewayServer(gateway)
    await close(upstream)
  }
})

test('returns a holding module instead of an import failure after a recent restart', async () => {
  const upstream = createServer((_incoming, response) => {
    response.writeHead(503, { 'content-type': 'text/plain' })
    response.end('temporarily unavailable\n')
  })
  const upstreamPort = await listen(upstream)
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({}),
    upstreamPort,
    platformStatus: async () => ({
      current: { recordId: 'deployment-a' },
      dshLifecycle: { state: 'running', taskId: 'restart-1', updatedAt: new Date().toISOString() },
    }),
    probe: async () => true,
    pluginBundleHoldTimeoutMs: 40,
    pluginBundlePollIntervalMs: 5,
  })
  const gatewayPort = await listen(gateway)
  try {
    const response = await request(gatewayPort, '/plugins/example/client.js?rev=missing', {
      host: '127.0.0.1',
      referer: 'http://127.0.0.1/sessions/current?tab=plugins',
    })
    assert.equal(response.status, 200)
    assert.match(response.headers['content-type'], /text\/javascript/)
    assert.match(response.body, /\/_dsh_gateway\/wait\?return=/)
    assert.match(response.body, /new Promise/)
  } finally {
    await closeGatewayServer(gateway)
    await close(upstream)
  }
})

test('grants two cold-start plugin recovery attempts without a lifecycle task', async () => {
  const upstream = createServer((_incoming, response) => {
    response.writeHead(503, { 'content-type': 'text/plain' })
    response.end('temporarily unavailable\n')
  })
  const upstreamPort = await listen(upstream)
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({}),
    upstreamPort,
    platformStatus: async () => ({
      current: { recordId: 'fresh-deployment' },
      dshLifecycle: { state: 'running', taskId: null, updatedAt: new Date().toISOString() },
    }),
    probe: async () => true,
    pluginBundleHoldTimeoutMs: 40,
    pluginBundlePollIntervalMs: 5,
  })
  const gatewayPort = await listen(gateway)
  const path = '/plugins/@deepseek-ai/dsh-client-ui-workflow-run/client.js?rev=fresh'
  try {
    const first = await request(gatewayPort, path, { host: '127.0.0.1', referer: 'http://127.0.0.1/' })
    assert.equal(first.status, 200)
    assert.match(first.body, /\/_dsh_gateway\/wait\?return=/)
    const second = await request(gatewayPort, path, { host: '127.0.0.1', referer: 'http://127.0.0.1/' })
    assert.equal(second.status, 200)
    assert.match(second.body, /\/_dsh_gateway\/wait\?return=/)
    const third = await request(gatewayPort, path, { host: '127.0.0.1', referer: 'http://127.0.0.1/' })
    assert.equal(third.status, 503)
  } finally {
    await closeGatewayServer(gateway)
    await close(upstream)
  }
})

test('records bounded browser plugin recovery events without request credentials', async () => {
  const reports = []
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({}),
    upstreamPort: 1,
    report: (message, fields) => { reports.push({ message, fields }) },
  })
  const port = await listen(gateway)
  try {
    const response = await request(port, CLIENT_EVENT_PATH, {
      host: '127.0.0.1',
      authorization: 'Basic must-not-appear',
      'content-type': 'application/json',
    }, 'POST', JSON.stringify({
      event: 'browser.plugin-load.failed',
      level: 'warning',
      pluginId: '@deepseek-ai/dsh-typert-registry',
      revision: 'f41d56e0b747',
      pathname: '/sessions/current',
      lifecycleState: 'restarting',
      lifecycleTaskId: 'task-1',
      recoveryAttempt: 1,
      reason: 'HTTP 503',
    }))
    assert.equal(response.status, 204)
    assert.deepEqual(reports, [{
      message: 'browser.plugin-load.failed',
      fields: {
        level: 'warning',
        pluginId: '@deepseek-ai/dsh-typert-registry',
        revision: 'f41d56e0b747',
        pathname: '/sessions/current',
        lifecycleState: 'restarting',
        lifecycleTaskId: 'task-1',
        recoveryAttempt: 1,
        reason: 'HTTP 503',
      },
    }])
    assert.doesNotMatch(JSON.stringify(reports), /must-not-appear/)
  } finally {
    await closeGatewayServer(gateway)
  }
})

test('bounded management and Console requests use the protected local socket instead of DSH upstream', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-gateway-management-'))
  const socketPath = join(root, 'management.sock')
  const maintenanceSocketPath = join(root, 'maintenance.sock')
  const management = createServer((incoming, response) => {
    response.writeHead(202, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      method: incoming.method,
      path: incoming.url,
      forwarded: incoming.headers.forwarded,
      forwardedFor: incoming.headers['x-forwarded-for'],
      realIp: incoming.headers['x-real-ip'],
    }))
  })
  await new Promise((resolve, reject) => {
    management.once('error', reject)
    management.listen(socketPath, resolve)
  })
  const maintenance = createServer((incoming, response) => {
    response.writeHead(203, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ method: incoming.method, path: incoming.url, privileged: true }))
  })
  await new Promise((resolve, reject) => {
    maintenance.once('error', reject)
    maintenance.listen(maintenanceSocketPath, resolve)
  })
  let upstreamRequests = 0
  const upstream = createServer((_incoming, response) => { upstreamRequests += 1; response.end('dsh') })
  const upstreamPort = await listen(upstream)
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'dsh.example' }),
    managementSocketPath: socketPath,
    maintenanceSocketPath,
    browserAuthentication: AUTHENTICATED_BROWSER,
    upstreamPort,
  })
  const gatewayPort = await listen(gateway)
  try {
    const result = await request(gatewayPort, '/_dsh_platform/api/v1/status', {
      host: 'dsh.example',
      forwarded: 'for=198.51.100.4;proto=https',
      'x-forwarded-for': '198.51.100.4',
      'x-real-ip': '198.51.100.4',
    })
    assert.equal(result.status, 202)
    assert.deepEqual(JSON.parse(result.body), {
      method: 'GET',
      path: '/_dsh_platform/api/v1/status',
      forwarded: 'for=198.51.100.4;proto=https',
      forwardedFor: '198.51.100.4',
      realIp: '198.51.100.4',
    })
    assert.equal(upstreamRequests, 0)
    for (const [method, path] of [
      ['GET', '/_dsh_platform/api/v1/rollback-plan'],
      ['GET', '/_dsh_platform/api/v1/bundled-plugins'],
      ['GET', '/_dsh_platform/api/v1/bundled-plugins/task/123e4567-e89b-42d3-a456-426614174000'],
      ['GET', '/_dsh_platform/api/v1/system-skills'],
      ['GET', '/_dsh_platform/api/v1/user-skills'],
      ['GET', '/_dsh_platform/api/v1/settings-document'],
      ['GET', '/_dsh_platform/api/v1/user-plugins'],
      ['GET', '/_dsh_platform/api/v1/proxy'],
      ['GET', '/_dsh_platform/api/v1/proxy/provider-inventory'],
      ['GET', '/_dsh_platform/api/v1/proxy/test/tasks/123e4567-e89b-42d3-a456-426614174000'],
      ['DELETE', '/_dsh_platform/api/v1/proxy/test/tasks/123e4567-e89b-42d3-a456-426614174000'],
      ['GET', '/_dsh_platform/api/v1/files/config'],
      ['GET', '/_dsh_platform/api/v1/files/list'],
      ['GET', '/_dsh_platform/api/v1/files/stat'],
      ['GET', '/_dsh_platform/api/v1/files/content'],
      ['GET', '/_dsh_platform/api/v1/files/download'],
      ['GET', '/_dsh_platform/api/v1/files/tasks'],
      ['GET', '/_dsh_platform/api/v1/files/tasks/123e4567-e89b-42d3-a456-426614174000'],
      ['DELETE', '/_dsh_platform/api/v1/files/tasks/123e4567-e89b-42d3-a456-426614174000'],
      ['GET', '/_dsh_platform/api/v1/user-plugins/task/123e4567-e89b-42d3-a456-426614174000'],
      ['GET', '/_dsh_platform/api/v1/terminal/sessions/123e4567-e89b-42d3-a456-426614174000'],
      ['DELETE', '/_dsh_platform/api/v1/terminal/sessions/123e4567-e89b-42d3-a456-426614174000'],
      ['POST', '/_dsh_platform/api/v1/holds/retry'],
      ['POST', '/_dsh_platform/api/v1/rollback'],
      ['POST', '/_dsh_platform/api/v1/return-stable'],
      ['POST', '/_dsh_platform/api/v1/start-dsh'],
      ['POST', '/_dsh_platform/api/v1/stop-dsh'],
      ['POST', '/_dsh_platform/api/v1/restart-dsh'],
      ['POST', '/_dsh_platform/api/v1/runtime/reset'],
      ['POST', '/_dsh_platform/api/v1/bundled-plugins/action'],
      ['POST', '/_dsh_platform/api/v1/bundled-plugins/toggle'],
      ['POST', '/_dsh_platform/api/v1/bundled-plugins/recovery-action'],
      ['POST', '/_dsh_platform/api/v1/system-skills/action'],
      ['POST', '/_dsh_platform/api/v1/user-skills/action'],
      ['POST', '/_dsh_platform/api/v1/user-plugins/apply'],
      ['POST', '/_dsh_platform/api/v1/terminal/sessions'],
      ['POST', '/_dsh_platform/api/v1/files/upload'],
      ['POST', '/_dsh_platform/api/v1/files/tasks'],
      ['POST', '/_dsh_platform/api/v1/proxy/test'],
      ['PUT', '/_dsh_platform/api/v1/channel'],
      ['PUT', '/_dsh_platform/api/v1/automatic-check'],
      ['PUT', '/_dsh_platform/api/v1/proxy'],
      ['PUT', '/_dsh_platform/api/v1/settings-document'],
      ['PUT', '/_dsh_platform/api/v1/files/content'],
      ['GET', '/_dsh_platform/console/'],
      ['HEAD', '/_dsh_platform/console/style.css'],
    ]) {
      const proxied = await request(gatewayPort, path, { host: 'dsh.example' }, method)
      const maintenanceRoute = path.startsWith('/_dsh_platform/api/v1/files/')
        || path.startsWith('/_dsh_platform/api/v1/terminal/sessions')
      assert.equal(proxied.status, maintenanceRoute ? 203 : 202, `${method} ${path}`)
      if (method !== 'HEAD') assert.equal(JSON.parse(proxied.body).path, path)
    }
    assert.equal((await request(gatewayPort, '/_dsh_platform/api/v1/trust/reset', { host: 'dsh.example' }, 'POST')).status, 404)
    assert.equal((await request(gatewayPort, '/_dsh_platform/api/v1/user-plugins/task/not-a-uuid', { host: 'dsh.example' })).status, 404)
    assert.equal((await request(gatewayPort, '/_dsh_platform/api/v1/bundled-plugins/task/not-a-uuid', { host: 'dsh.example' })).status, 404)
    assert.equal((await request(gatewayPort, '/_dsh_platform/api/v1/terminal/sessions/not-a-uuid', { host: 'dsh.example' })).status, 404)
    assert.equal((await request(gatewayPort, '/_dsh_platform/api/v1/files/tasks/not-a-uuid', { host: 'dsh.example' })).status, 404)
    assert.equal((await request(gatewayPort, '/_dsh_platform/api/v1/proxy/test/tasks/not-a-uuid', { host: 'dsh.example' })).status, 404)
    assert.equal((await request(gatewayPort, '/_dsh_platform/console/app.js', { host: 'dsh.example' }, 'POST')).status, 404)
    assert.equal(upstreamRequests, 0)
  } finally {
    await Promise.all([closeGatewayServer(gateway), close(upstream), close(management), close(maintenance)])
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
      'Forwarded: for=198.51.100.4;proto=https',
      'X-Forwarded-For: 198.51.100.4',
      'X-Real-IP: 198.51.100.4',
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
    assert.equal(seenHeaders.forwarded, undefined)
    assert.equal(seenHeaders['x-forwarded-for'], undefined)
    assert.equal(seenHeaders['x-real-ip'], undefined)

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

test('only exact terminal WebSocket upgrades reach the Maintenance Unix socket', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-gateway-terminal-'))
  const socketPath = join(root, 'maintenance.sock')
  const maintenance = createServer()
  let seenHeaders
  let upgradedSocket
  maintenance.on('upgrade', (incoming, socket) => {
    seenHeaders = incoming.headers
    upgradedSocket = socket
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
    socket.on('data', data => socket.write(data))
  })
  await new Promise((resolve, reject) => {
    maintenance.once('error', reject)
    maintenance.listen(socketPath, resolve)
  })
  const upstream = createServer((_incoming, response) => response.end('dsh'))
  const upstreamPort = await listen(upstream)
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'dsh.example' }),
    maintenanceSocketPath: socketPath,
    browserAuthentication: AUTHENTICATED_BROWSER,
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
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Key: dGVzdA==',
      'Sec-WebSocket-Version: 13',
      'Forwarded: for=198.51.100.4;proto=https',
      'X-Forwarded-For: 198.51.100.4',
      'X-Real-IP: 198.51.100.4',
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
    assert.equal(seenHeaders.forwarded, 'for=198.51.100.4;proto=https')
    assert.equal(seenHeaders['x-forwarded-for'], '198.51.100.4')
    assert.equal(seenHeaders['x-real-ip'], '198.51.100.4')
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
    await Promise.all([closeGatewayServer(gateway), close(upstream), close(maintenance)])
  }
})

test('management surface refuses DSH routes while retaining its console surface', async () => {
  const upstream = createServer((_request, response) => response.end('dsh'))
  const upstreamPort = await listen(upstream)
  const gateway = createGatewayServer({
    trustedHosts: parseTrustedHosts({}),
    upstreamPort,
    surface: 'management',
    browserAuthentication: browserForMode('isolated'),
  })
  const port = await listen(gateway)
  try {
    const dsh = await request(port, '/dsh-page', { accept: 'text/html', host: '127.0.0.1' })
    assert.equal(dsh.status, 404)
    const consoleResponse = await request(port, '/', { accept: 'text/html', host: '127.0.0.1' })
    assert.notEqual(consoleResponse.status, 404)
  } finally {
    await closeGatewayServer(gateway)
    await close(upstream)
  }
})

test('compatibility and isolated Management surfaces are mutually exclusive', async () => {
  const upstream = createServer((_request, response) => response.end('dsh'))
  const upstreamPort = await listen(upstream)
  const isolatedBrowser = {
    ...browserForMode('isolated'),
    handle: async (_request, response, pathname) => {
      if (pathname !== '/_dsh_platform/auth/management/start') return false
      response.writeHead(204)
      response.end()
      return true
    },
  }
  const compat = createGatewayServer({
    trustedHosts: parseTrustedHosts({}), upstreamPort, surface: 'compat',
    browserAuthentication: isolatedBrowser,
  })
  const management = createGatewayServer({
    trustedHosts: parseTrustedHosts({}), upstreamPort, surface: 'management',
    browserAuthentication: browserForMode('compat'),
  })
  const compatPort = await listen(compat)
  const managementPort = await listen(management)
  try {
    assert.equal((await request(compatPort, '/_dsh_platform/console/', { host: '127.0.0.1' })).status, 404)
    assert.equal((await request(compatPort, '/_dsh_platform/api/v1/status', { host: '127.0.0.1' })).status, 404)
    assert.notEqual((await request(compatPort, '/_dsh_platform/auth/management/start', { host: '127.0.0.1' })).status, 404)
    assert.notEqual((await request(compatPort, '/_dsh_platform/plugin-api/v1/status', { host: '127.0.0.1' })).status, 404)
    assert.equal((await request(managementPort, '/', { host: '127.0.0.1' })).status, 404)
    assert.equal((await request(managementPort, '/api/v1/status', { host: '127.0.0.1' })).status, 404)
  } finally {
    await Promise.all([closeGatewayServer(compat), closeGatewayServer(management)])
    await close(upstream)
  }
})

test('isolated listener exposes only the instance-bound transition probe before isolation is enabled', async () => {
  const upstream = createServer((_request, response) => response.end('dsh'))
  const upstreamPort = await listen(upstream)
  const handled = []
  const browserAuthentication = {
    ...browserForMode('compat'),
    handle: async (_request, response, pathname) => {
      handled.push(pathname)
      if (pathname !== '/transition/probe') return false
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"proof":"bound"}')
      return true
    },
  }
  const management = createGatewayServer({
    trustedHosts: parseTrustedHosts({}), upstreamPort, surface: 'management', browserAuthentication,
  })
  const port = await listen(management)
  try {
    const probe = await request(port, '/transition/probe?transitionId=one&nonce=two', {
      host: 'candidate-management.example', origin: 'https://dsh.example', accept: 'application/json',
    })
    assert.equal(probe.status, 200)
    assert.deepEqual(handled, ['/transition/probe'])
    assert.equal((await request(port, '/', { host: '127.0.0.1', accept: 'text/html' })).status, 404)
    assert.equal((await request(port, '/api/v1/status', { host: '127.0.0.1' })).status, 404)
  } finally {
    await Promise.all([closeGatewayServer(management), close(upstream)])
  }
})

test('isolated listener admits only the dedicated cross-site continuation navigation', async () => {
  const upstream = createServer((_request, response) => response.end('dsh'))
  const upstreamPort = await listen(upstream)
  const handled = []
  const browserAuthentication = {
    ...browserForMode('isolated'),
    handle: async (_request, response, pathname) => {
      handled.push(pathname)
      if (pathname !== '/transition/continue') return false
      response.writeHead(204)
      response.end()
      return true
    },
  }
  const management = createGatewayServer({
    trustedHosts: parseTrustedHosts({}), upstreamPort, surface: 'management', browserAuthentication,
  })
  const port = await listen(management)
  try {
    const navigationHeaders = {
      host: '127.0.0.1',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
    }
    assert.equal((await request(port, '/transition/continue?token=one', navigationHeaders)).status, 204)
    assert.deepEqual(handled, ['/transition/continue'])
    assert.equal((await request(port, '/', navigationHeaders)).status, 403)
  } finally {
    await Promise.all([closeGatewayServer(management), close(upstream)])
  }
})

test('isolated listener admits cross-site top-level authentication entry routes only', async () => {
  const upstream = createServer((_request, response) => response.end('dsh'))
  const upstreamPort = await listen(upstream)
  const handled = []
  const browserAuthentication = {
    ...browserForMode('isolated'),
    handle: async (_request, response, pathname) => {
      handled.push(pathname)
      response.writeHead(204)
      response.end()
      return true
    },
  }
  const management = createGatewayServer({
    trustedHosts: parseTrustedHosts({}), upstreamPort, surface: 'management', browserAuthentication,
  })
  const port = await listen(management)
  const headers = {
    host: '127.0.0.1',
    'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
  }
  try {
    assert.equal((await request(port, '/auth/management', headers)).status, 204)
    assert.equal((await request(port, '/auth/management/handoff?token=one', headers)).status, 204)
    assert.equal((await request(port, '/auth/management/pending', headers)).status, 403)
    assert.deepEqual(handled, ['/auth/management', '/auth/management/handoff'])
  } finally {
    await Promise.all([closeGatewayServer(management), close(upstream)])
  }
})

test('compatibility listener admits only the exact cross-site DSH authentication page', async () => {
  const upstream = createServer((_request, response) => response.end('dsh'))
  const upstreamPort = await listen(upstream)
  const handled = []
  const browserAuthentication = {
    ...browserForMode('isolated'),
    handle: async (_request, response, pathname) => {
      handled.push(pathname)
      response.writeHead(204)
      response.end()
      return true
    },
  }
  const compat = createGatewayServer({
    trustedHosts: parseTrustedHosts({}), upstreamPort, surface: 'compat', browserAuthentication,
  })
  const port = await listen(compat)
  const headers = {
    host: '127.0.0.1',
    'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
  }
  try {
    assert.equal((await request(port, '/_dsh_platform/auth/', headers)).status, 204)
    assert.equal((await request(port, '/_dsh_platform/auth/reset', headers)).status, 403)
    assert.deepEqual(handled, ['/_dsh_platform/auth/'])
  } finally {
    await Promise.all([closeGatewayServer(compat), close(upstream)])
  }
})

test('isolated Management trusts its verified public Origin instead of DSH trusted Hosts', async () => {
  const upstream = createServer((_request, response) => response.end('dsh'))
  const upstreamPort = await listen(upstream)
  const browserAuthentication = {
    ...browserForMode('isolated'),
    status: async () => ({
      state: 'initialized',
      account: { managementAccess: {
        mode: 'isolated', version: 2,
        isolatedEntry: { kind: 'public', managementPublicOrigin: 'https://management.example' },
      } },
    }),
  }
  const management = createGatewayServer({
    trustedHosts: parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'dsh.example' }),
    upstreamPort, surface: 'management', browserAuthentication,
  })
  const port = await listen(management)
  try {
    const accepted = await request(port, '/', {
      host: 'management.example', origin: 'https://management.example', accept: 'text/html',
      'x-forwarded-proto': 'https',
    })
    assert.notEqual(accepted.status, 403)
    assert.equal((await request(port, '/', {
      host: 'dsh.example', origin: 'https://dsh.example', accept: 'text/html',
      'x-forwarded-proto': 'https',
    })).status, 403)
  } finally {
    await Promise.all([closeGatewayServer(management), close(upstream)])
  }
})
