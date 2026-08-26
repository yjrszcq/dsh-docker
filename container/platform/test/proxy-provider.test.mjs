import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import { createServer as createNetServer, connect } from 'node:net'
import test from 'node:test'
import { defaultProxyConfiguration, validateProxyConfiguration } from '../../control-plane/services/outbound-proxy/lib/contracts.mjs'
import { createOutboundProxyControl } from '../../control-plane/services/outbound-proxy/lib/control.mjs'
import { createScopedProxyServer } from '../../control-plane/services/outbound-proxy/lib/data-plane.mjs'
import { ProviderHandleStore, providerHandleInternals } from '../../control-plane/services/outbound-proxy/lib/provider-handles.mjs'
import { selectProxyRoute } from '../../control-plane/services/outbound-proxy/lib/policy.mjs'

const sockets = new WeakMap()

async function listen(server) {
  const active = new Set()
  sockets.set(server, active)
  server.on('connection', socket => {
    active.add(socket)
    socket.once('close', () => active.delete(socket))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

async function close(server) {
  for (const socket of sockets.get(server) ?? []) socket.destroy()
  if (!server.listening) return
  server.closeAllConnections?.()
  await new Promise(resolve => server.close(resolve))
}

function snapshot({ revision = 'revision-one', proxyPort = null, policy = 'direct' } = {}) {
  const defaults = defaultProxyConfiguration()
  const value = validateProxyConfiguration({
    ...defaults,
    enabled: proxyPort !== null,
    proxy: {
      ...defaults.proxy,
      host: proxyPort === null ? '' : '127.0.0.1',
      port: proxyPort,
      username: proxyPort === null ? '' : 'external-user',
      password: proxyPort === null ? undefined : 'external-password',
    },
    modelApi: { default: defaults.modelApi.default, providers: { deepseek: policy } },
  })
  return Object.freeze({ revision, recovery: 'none', ...value })
}

test('model Provider follow and proxy controls select all four routes independently', async () => {
  const defaults = defaultProxyConfiguration()
  const make = (policy, scopes = {}) => Object.freeze({
    revision: 'revision-one',
    recovery: 'none',
    ...validateProxyConfiguration({
      ...defaults,
      enabled: true,
      proxy: { ...defaults.proxy, host: '127.0.0.1', port: 7890 },
      scopes: { ...defaults.scopes, ...scopes },
      modelApi: { default: defaults.modelApi.default, providers: { custom: policy } },
    }),
  })
  const route = state => selectProxyRoute({
    snapshot: state, scope: 'modelApi', providerId: 'custom', host: 'api.example.test', port: 443,
  })

  assert.equal((await route(make({ followDsh: true, proxyEnabled: false }, { dshCore: true }))).reason, 'provider-direct')
  assert.equal((await route(make({ followDsh: false, proxyEnabled: false }, { dshCore: true }))).reason, 'provider-direct')
  assert.equal((await route(make({ followDsh: true, proxyEnabled: true }, { dshCore: false, dshPlugins: false }))).reason, 'provider-direct')
  assert.equal((await route(make({ followDsh: true, proxyEnabled: true }, { dshPlugins: true }))).reason, 'provider-follow-dsh')
  assert.equal((await route(make({ followDsh: false, proxyEnabled: true }))).reason, 'provider-proxy')
})

test('unconfigured model Providers inherit the complete default policy', async () => {
  const defaults = defaultProxyConfiguration()
  const snapshot = Object.freeze({
    revision: 'revision-one', recovery: 'none',
    ...validateProxyConfiguration({
      ...defaults,
      enabled: true,
      proxy: { ...defaults.proxy, host: '127.0.0.1', port: 7890 },
      scopes: { ...defaults.scopes, dshCore: true },
      modelApi: { default: { followDsh: true, proxyEnabled: true }, providers: {} },
    }),
  })
  const result = await selectProxyRoute({
    snapshot, scope: 'modelApi', providerId: 'new-provider', host: 'api.example.test', port: 443,
  })
  assert.equal(result.reason, 'provider-follow-dsh')
})

function request({ port, path = '/', method = 'GET', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port, path, method, headers }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.once('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }))
    })
    outgoing.once('error', reject)
    if (body !== undefined) outgoing.end(body)
    else outgoing.end()
  })
}

function rawExchange(port, value, waitFor = '\r\n\r\n') {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    let bytes = Buffer.alloc(0)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('provider CONNECT fixture timed out'))
    }, 3_000)
    socket.once('connect', () => socket.write(value))
    socket.on('data', chunk => {
      bytes = Buffer.concat([bytes, chunk])
      if (!bytes.includes(waitFor)) return
      clearTimeout(timer)
      resolve({ socket, bytes })
    })
    socket.once('error', reject)
    socket.once('close', () => clearTimeout(timer))
  })
}

test('issues opaque provider handles and rejects expiry or policy revision changes', () => {
  let now = 1_000
  let generated = 0
  const handles = new ProviderHandleStore({
    ttlMs: 100,
    now: () => now,
    random: size => Buffer.alloc(size, ++generated),
  })
  const state = snapshot()
  const issued = handles.issue({ providerId: 'deepseek', policyRevision: state.revision }, state)
  assert.match(issued.handle, providerHandleInternals.HANDLE_PATTERN)
  assert.equal(Buffer.from(issued.handle, 'base64url').byteLength, providerHandleInternals.HANDLE_BYTES)
  assert.equal(handles.resolve(`DSH-Provider ${issued.handle}`, state), 'deepseek')
  assert.throws(() => handles.resolve(`Basic ${issued.handle}`, state), error => error.code === 'PROVIDER_HANDLE_INVALID')
  assert.throws(() => handles.resolve(`DSH-Provider ${issued.handle}`, snapshot({ revision: 'revision-two' })), error => error.code === 'PROVIDER_HANDLE_INVALID')

  const expiring = handles.issue({ providerId: 'deepseek', policyRevision: state.revision }, state)
  now += 101
  assert.throws(() => handles.resolve(`DSH-Provider ${expiring.handle}`, state), error => error.code === 'PROVIDER_HANDLE_INVALID')
  assert.throws(() => handles.issue({ providerId: '../secret', policyRevision: state.revision }, state), /provider ID/)
  assert.throws(() => handles.issue({ providerId: 'deepseek', policyRevision: 'stale' }, state), error => error.code === 'REVISION_CONFLICT' && error.statusCode === 409)
})

test('control socket issues a provider handle only for the current revision', async () => {
  const state = snapshot()
  const handles = new ProviderHandleStore()
  const control = createOutboundProxyControl({
    getSnapshot: () => state,
    routeHealth: { status: () => ({}) },
    providerHandles: handles,
  })
  const port = await listen(control)
  try {
    const current = await request({
      port,
      path: '/v1/provider-handles',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'deepseek', policyRevision: state.revision }),
    })
    assert.equal(current.status, 201)
    const issued = JSON.parse(current.body)
    assert.equal(handles.resolve(`DSH-Provider ${issued.handle}`, state), 'deepseek')
    const stale = await request({
      port,
      path: '/v1/provider-handles',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'deepseek', policyRevision: 'stale' }),
    })
    assert.equal(stale.status, 409)
    assert.equal(JSON.parse(stale.body).error.code, 'REVISION_CONFLICT')
    const oversized = await request({
      port,
      path: '/v1/provider-handles',
      method: 'POST',
      body: JSON.stringify({ providerId: 'deepseek', policyRevision: state.revision, padding: 'x'.repeat(4096) }),
    })
    assert.equal(oversized.status, 400)
  } finally {
    await close(control)
  }
})

test('model Provider entry requires a valid handle and strips it from a direct request', async () => {
  let authorization
  const target = createServer((incoming, response) => {
    authorization = incoming.headers['proxy-authorization']
    response.end('provider-direct')
  })
  const targetPort = await listen(target)
  const state = snapshot()
  const handles = new ProviderHandleStore()
  const proxy = createScopedProxyServer({ scope: 'modelApi', getSnapshot: () => state, providerHandles: handles })
  const proxyPort = await listen(proxy)
  try {
    const missing = await request({ port: proxyPort, path: `http://127.0.0.1:${targetPort}/` })
    assert.equal(missing.status, 407)
    assert.equal(missing.headers['x-dsh-proxy-error'], 'PROVIDER_HANDLE_INVALID')
    assert.equal(missing.headers['proxy-authenticate'], 'DSH-Provider')

    const issued = handles.issue({ providerId: 'deepseek', policyRevision: state.revision }, state)
    const accepted = await request({
      port: proxyPort,
      path: `http://127.0.0.1:${targetPort}/`,
      headers: { 'proxy-authorization': `DSH-Provider ${issued.handle}` },
    })
    assert.equal(accepted.status, 200)
    assert.equal(accepted.body.toString(), 'provider-direct')
    assert.equal(authorization, undefined)
  } finally {
    await close(proxy)
    await close(target)
  }
})

test('model Provider proxy replaces the internal handle with external Basic authentication', async () => {
  let observed
  const upstream = createServer((incoming, response) => {
    observed = { path: incoming.url, authorization: incoming.headers['proxy-authorization'] }
    response.end('provider-proxied')
  })
  const upstreamPort = await listen(upstream)
  const state = snapshot({ proxyPort: upstreamPort, policy: 'proxy' })
  const handles = new ProviderHandleStore()
  const issued = handles.issue({ providerId: 'deepseek', policyRevision: state.revision }, state)
  const proxy = createScopedProxyServer({ scope: 'modelApi', getSnapshot: () => state, providerHandles: handles })
  const proxyPort = await listen(proxy)
  try {
    const result = await request({
      port: proxyPort,
      path: 'http://provider.example/v1/models',
      headers: { 'proxy-authorization': `DSH-Provider ${issued.handle}` },
    })
    assert.equal(result.status, 200)
    assert.equal(result.body.toString(), 'provider-proxied')
    assert.equal(observed.path, 'http://provider.example/v1/models')
    assert.equal(observed.authorization, `Basic ${Buffer.from('external-user:external-password').toString('base64')}`)
    assert.doesNotMatch(observed.authorization, new RegExp(issued.handle))
  } finally {
    await close(proxy)
    await close(upstream)
  }
})

test('model Provider CONNECT requires a handle and never forwards it to the external proxy', async () => {
  let observed = ''
  const upstream = createNetServer(socket => {
    let requestBytes = Buffer.alloc(0)
    socket.on('data', chunk => {
      requestBytes = Buffer.concat([requestBytes, chunk])
      if (!requestBytes.includes('\r\n\r\n')) return
      observed = requestBytes.toString('latin1')
      socket.removeAllListeners('data')
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      socket.on('data', value => socket.write(value))
    })
  })
  const upstreamPort = await listen(upstream)
  const state = snapshot({ proxyPort: upstreamPort, policy: 'proxy' })
  const handles = new ProviderHandleStore()
  const issued = handles.issue({ providerId: 'deepseek', policyRevision: state.revision }, state)
  const proxy = createScopedProxyServer({ scope: 'modelApi', getSnapshot: () => state, providerHandles: handles })
  const proxyPort = await listen(proxy)
  let socket
  try {
    const rejected = await rawExchange(proxyPort, 'CONNECT provider.example:443 HTTP/1.1\r\nHost: provider.example:443\r\n\r\n')
    rejected.socket.destroy()
    assert.match(rejected.bytes.toString('latin1'), /^HTTP\/1\.1 407/)

    const accepted = await rawExchange(proxyPort, [
      'CONNECT provider.example:443 HTTP/1.1',
      'Host: provider.example:443',
      `Proxy-Authorization: DSH-Provider ${issued.handle}`,
      '',
      '',
    ].join('\r\n'))
    socket = accepted.socket
    assert.match(accepted.bytes.toString('latin1'), /^HTTP\/1\.1 200/)
    assert.match(observed, new RegExp(`Proxy-Authorization: Basic ${Buffer.from('external-user:external-password').toString('base64')}`, 'i'))
    assert.doesNotMatch(observed, new RegExp(issued.handle))
  } finally {
    socket?.destroy()
    await close(proxy)
    await close(upstream)
  }
})
