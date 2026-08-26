import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  defaultProxyConfiguration,
  PROXY_PORTS,
  sanitizedProxyConfiguration,
  validateProxyConfiguration,
} from '../../control-plane/services/outbound-proxy/lib/contracts.mjs'
import { ProxyConfigurationError, proxyErrorBody } from '../../control-plane/services/outbound-proxy/lib/errors.mjs'
import {
  matchesProxyRules,
  noProxyEnvironment,
  normalizeProxyRules,
} from '../../control-plane/services/outbound-proxy/lib/rules.mjs'
import { ProxyConfigurationStore } from '../../control-plane/services/outbound-proxy/lib/store.mjs'
import { PROXY_SCOPE_CATALOG } from '../../control-plane/services/outbound-proxy/lib/scope-catalog.mjs'
import { createOutboundProxyControl } from '../../control-plane/services/outbound-proxy/lib/control.mjs'
import { OutboundProxyControlClient } from '../../control-plane/services/management/outbound-proxy-client.mjs'

function configured(overrides = {}) {
  const defaults = defaultProxyConfiguration()
  return {
    ...defaults,
    enabled: true,
    proxy: {
      ...defaults.proxy,
      host: 'Proxy.Example.COM.',
      port: 1080,
      username: 'user:@/',
      password: 'secret:@/',
      ...overrides.proxy,
    },
    scopes: { ...defaults.scopes, updates: true, ...overrides.scopes },
    environment: { ...defaults.environment, ...overrides.environment },
    modelApi: { ...defaults.modelApi, providers: {}, ...overrides.modelApi },
    noProxy: { user: ['GOOGLE.com.', '.Example.COM', 'google.com'], ...overrides.noProxy },
    bypass: { additional: ['192.168.1.0/24', '[::1]:8443'], ...overrides.bypass },
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server.address().port
}

function exchange(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const outgoing = request({
      host: '127.0.0.1', port, method, path,
      headers: bytes === undefined ? {} : { 'content-type': 'application/json', 'content-length': bytes.byteLength },
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }))
    })
    outgoing.once('error', reject)
    outgoing.end(bytes)
  })
}

test('normalizes strict proxy configuration without exposing a password', () => {
  const { configuration, credentials } = validateProxyConfiguration(configured())
  assert.equal(configuration.proxy.host, 'proxy.example.com')
  assert.equal(configuration.proxy.passwordConfigured, true)
  assert.equal('password' in configuration.proxy, false)
  assert.deepEqual(configuration.noProxy.user, ['.example.com', 'google.com'])
  assert.deepEqual(configuration.bypass.additional, ['[::1]:8443', '192.168.1.0/24'])
  assert.equal(credentials.password, 'secret:@/')
  assert.equal(Object.isFrozen(configuration.proxy), true)
  assert.equal(Object.isFrozen(configuration.scopes), true)
  assert.deepEqual(PROXY_PORTS, {
    updates: 17891, platform: 17892, dshCore: 17893, dshPlugins: 17894,
    agentNetwork: 17895, managementTerminal: 17896, modelApi: 17897, sharedDsh: 17898,
  })
  const view = sanitizedProxyConfiguration(configuration, 'revision')
  assert.equal(JSON.stringify(view).includes('secret'), false)
})

test('rejects unknown schemas, fields, wildcards, URLs, incomplete endpoints, and CIDR in NO_PROXY', () => {
  for (const value of [
    { ...configured(), schema: 2 },
    { ...configured(), unexpected: true },
    configured({ proxy: { host: '', port: 1080 } }),
    configured({ noProxy: { user: ['*.example.com'] } }),
    configured({ noProxy: { user: ['https://example.com'] } }),
    configured({ noProxy: { user: ['192.168.0.0/16'] } }),
  ]) assert.throws(() => validateProxyConfiguration(value), ProxyConfigurationError)
})

test('enforces SOCKS5 credential byte limits without rejecting valid UTF-8 credentials', () => {
  const boundary = validateProxyConfiguration(configured({ proxy: {
    username: 'u'.repeat(255), password: 'p'.repeat(255), protocol: 'socks5',
  } }))
  assert.equal(Buffer.byteLength(boundary.credentials.username), 255)
  assert.equal(Buffer.byteLength(boundary.credentials.password), 255)
  assert.equal(validateProxyConfiguration(configured({ proxy: {
    username: '代理', password: '密钥', protocol: 'socks5',
  } })).credentials.username, '代理')
  assert.throws(() => validateProxyConfiguration(configured({ proxy: { username: 'u'.repeat(256) } })), ProxyConfigurationError)
  assert.throws(() => validateProxyConfiguration(configured({ proxy: { password: 'p'.repeat(256) } })), ProxyConfigurationError)
})

test('matches exact, suffix, port, IPv6, CIDR, wildcard, and domain boundaries', () => {
  const noProxy = normalizeProxyRules(['example.com', '.example.net', 'service.local:8443', '*'], { allowWildcard: true })
  assert.equal(matchesProxyRules(noProxy, 'anything.invalid', 443), true)
  const precise = normalizeProxyRules(['example.com', '.example.net', 'service.local:8443'])
  assert.equal(matchesProxyRules(precise, 'example.com', 443), true)
  assert.equal(matchesProxyRules(precise, 'sub.example.com', 443), false)
  assert.equal(matchesProxyRules(precise, 'example.net', 443), true)
  assert.equal(matchesProxyRules(precise, 'sub.example.net.', 443), true)
  assert.equal(matchesProxyRules(precise, 'badexample.net', 443), false)
  assert.equal(matchesProxyRules(precise, 'service.local', 8443), true)
  assert.equal(matchesProxyRules(precise, 'service.local', 443), false)
  const bypass = normalizeProxyRules(['192.168.0.0/16', 'fd00::/8', '[::1]:8443'], { allowCidr: true })
  assert.equal(matchesProxyRules(bypass, '192.168.1.4', 80), true)
  assert.equal(matchesProxyRules(bypass, '192.169.1.4', 80), false)
  assert.equal(matchesProxyRules(bypass, 'fd00::1', 80), true)
  assert.equal(matchesProxyRules(bypass, '::1', 8443), true)
  assert.equal(noProxyEnvironment(['.example.com']), '::1,127.0.0.1,localhost,.example.com')
})

test('atomically stores revisions, preserves and clears write-only credentials, and rejects stale writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-proxy-state-'))
  const store = new ProxyConfigurationStore(root, { now: () => new Date('2026-08-25T00:00:00.000Z') })
  const initial = await store.load()
  assert.match(initial.revision, /^[A-Za-z0-9_-]{43}$/)
  const saved = await store.commit({ baseRevision: initial.revision, value: configured() })
  assert.equal(saved.credentials.password, 'secret:@/')
  assert.equal((await stat(root)).mode & 0o777, 0o700)
  assert.equal((await stat(join(root, 'revisions', saved.revision, 'credentials.json'))).mode & 0o777, 0o600)
  assert.equal((await readFile(join(root, 'revisions', saved.revision, 'config.json'), 'utf8')).includes('secret'), false)

  const preserving = configured({ proxy: { password: null } })
  const preserved = await store.commit({ baseRevision: saved.revision, value: preserving })
  assert.equal(preserved.credentials.password, 'secret:@/')
  const clearing = configured({ proxy: { password: null, clearPassword: true } })
  const cleared = await store.commit({ baseRevision: preserved.revision, value: clearing })
  assert.equal(cleared.credentials.password, null)
  assert.equal(cleared.configuration.proxy.passwordConfigured, false)
  await assert.rejects(store.commit({ baseRevision: saved.revision, value: configured() }), error => (
    error.code === 'REVISION_CONFLICT' && error.statusCode === 409
  ))
})

test('control API returns only sanitized configuration and hot-activates one current revision', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-proxy-control-'))
  const store = new ProxyConfigurationStore(root)
  let snapshot = Object.freeze({ ...await store.load(), recovery: 'none' })
  let handlesCleared = 0
  const server = createOutboundProxyControl({
    getSnapshot: () => snapshot,
    routeHealth: { status: current => ({ updates: current.configuration.scopes.updates ? 'unknown' : 'direct' }) },
    providerHandles: { clear: () => { handlesCleared += 1 } },
    commitConfiguration: async update => {
      snapshot = Object.freeze({ ...await store.commit(update), recovery: 'none' })
      return snapshot
    },
  })
  const port = await listen(server)
  t.after(() => new Promise(resolve => server.close(resolve)))

  const initial = await exchange(port, 'GET', '/v1/configuration')
  assert.equal(initial.status, 200)
  assert.equal(initial.body.componentReady, true)
  assert.equal(initial.body.enabled, false)
  assert.equal('credentials' in initial.body, false)

  const activated = await exchange(port, 'PUT', '/v1/configuration', {
    baseRevision: initial.body.revision,
    value: configured(),
  })
  assert.equal(activated.status, 200)
  assert.equal(activated.body.enabled, true)
  assert.equal(activated.body.proxy.passwordConfigured, true)
  assert.equal(JSON.stringify(activated.body).includes('secret:@/'), false)
  assert.equal(snapshot.credentials.password, 'secret:@/')
  assert.equal(handlesCleared, 1)

  const stale = await exchange(port, 'PUT', '/v1/configuration', {
    baseRevision: initial.body.revision,
    value: configured(),
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.error.code, 'REVISION_CONFLICT')
  assert.equal(snapshot.revision, activated.body.revision)
})

test('control API accepts dynamic model Provider routing before persistence', async t => {
  const current = Object.freeze({
    revision: 'revision-one', recovery: 'none',
    ...validateProxyConfiguration(defaultProxyConfiguration()),
  })
  let committed = false
  const server = createOutboundProxyControl({
    getSnapshot: () => current,
    routeHealth: { status: () => ({}) },
    commitConfiguration: async request => {
      committed = true
      return Object.freeze({ revision: 'revision-two', recovery: 'none', ...validateProxyConfiguration(request.value) })
    },
  })
  const port = await listen(server)
  t.after(() => new Promise(resolve => server.close(resolve)))
  const value = configured({ modelApi: { providers: { unsupported: { proxyEnabled: true } } } })
  const result = await exchange(port, 'PUT', '/v1/configuration', { baseRevision: current.revision, value })
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.modelApi.providers.unsupported, { proxyEnabled: true })
  assert.equal(committed, true)
})

test('rejects unreleased legacy Provider policy shapes', () => {
  assert.throws(() => validateProxyConfiguration(configured({
    modelApi: { default: 'direct', providers: {} },
  })), /must be an object/)
  assert.throws(() => validateProxyConfiguration(configured({
    modelApi: { default: { proxyEnabled: false }, providers: { legacy: { followDsh: true, proxyEnabled: true } } },
  })), /unsupported fields: followDsh/)
})

test('Management outbound proxy client preserves structured control errors', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-proxy-client-'))
  const socket = join(root, 'control.sock')
  const server = createServer((_request, response) => {
    response.writeHead(409, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: {
      code: 'REVISION_CONFLICT', message: 'proxy configuration changed', stage: 'activate', retryable: true,
    } }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socket, resolve)
  })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const client = new OutboundProxyControlClient(socket)
  await assert.rejects(client.updateConfiguration({}), error => (
    error.statusCode === 409 && error.code === 'REVISION_CONFLICT'
      && error.stage === 'activate' && error.retryable === true
  ))
})

test('recovers the newest intact immutable revision when current state is corrupt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-proxy-recovery-'))
  let tick = 0
  const store = new ProxyConfigurationStore(root, { now: () => new Date(Date.UTC(2026, 7, 25, 0, 0, tick++)) })
  const initial = await store.load()
  const first = await store.commit({ baseRevision: initial.revision, value: configured() })
  const second = await store.commit({ baseRevision: first.revision, value: configured({ proxy: { port: 1081 } }) })
  await writeFile(join(root, 'revisions', second.revision, 'config.json'), '{}\n')
  const recovered = await store.load()
  assert.equal(recovered.revision, first.revision)
  assert.equal(JSON.parse(await readFile(join(root, 'current.json'), 'utf8')).revision, first.revision)
})

test('returns stable redacted error structures', () => {
  const body = proxyErrorBody(new ProxyConfigurationError('proxy configuration changed', {
    code: 'REVISION_CONFLICT', statusCode: 409, stage: 'activate',
  }))
  assert.deepEqual(body, {
    error: { code: 'REVISION_CONFLICT', message: 'proxy configuration changed', stage: 'activate', retryable: false },
  })
})

test('recovers a corrupt pointer and safely disables proxy when every revision is corrupt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-proxy-reset-'))
  const store = new ProxyConfigurationStore(root)
  const initial = await store.load()
  await writeFile(join(root, 'revisions', initial.revision, 'credentials.json'), '{broken')
  await writeFile(join(root, 'current.json'), '{broken')
  const recovered = await store.load()
  assert.equal(recovered.recovery, 'reset-disabled')
  assert.equal(recovered.configuration.enabled, false)
  assert.equal(recovered.configuration.proxy.passwordConfigured, false)
  assert.equal((await readFile(join(root, 'revisions', initial.revision, 'credentials.json'), 'utf8')), '{broken')
  const names = await import('node:fs/promises').then(({ readdir }) => readdir(root))
  assert.equal(names.some(name => name.startsWith('current.corrupt.')), true)
})

test('publishes one complete bilingual proxy scope catalog', () => {
  assert.equal(PROXY_SCOPE_CATALOG.schema, 1)
  assert.equal(PROXY_SCOPE_CATALOG.entries.length, 24)
  assert.equal(new Set(PROXY_SCOPE_CATALOG.entries.map(entry => entry.id)).size, 24)
  assert.deepEqual(new Set(PROXY_SCOPE_CATALOG.entries.map(entry => entry.group)), new Set(Object.keys(PROXY_SCOPE_CATALOG.groups)))
  for (const entry of PROXY_SCOPE_CATALOG.entries) {
    assert.equal(typeof entry.source.zh, 'string')
    assert.equal(typeof entry.source.en, 'string')
    assert.equal(typeof entry.detail.zh, 'string')
    assert.equal(typeof entry.detail.en, 'string')
  }
})

test('keeps the Bootstrap proxy supervisor alive until an explicit stop', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-proxy-supervisor-'))
  const runRoot = join(root, 'run')
  const socket = join(runRoot, 'proxy-launch.sock')
  await mkdir(runRoot)
  let running = false
  const calls = []
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      calls.push(`${request.method} ${request.url}`)
      if (request.method === 'POST' && request.url === '/v1/start') running = true
      if (request.method === 'POST' && request.url === '/v1/stop') running = false
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ running, componentReady: running }))
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socket, resolve)
  })
  const script = new URL('../../control-plane/services/outbound-proxy/supervisor.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      DSH_PLATFORM_DATA: join(root, 'data'),
      DSH_PLATFORM_RUN: runRoot,
      DSH_PROXY_LAUNCH_TOKEN: 'x'.repeat(43),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('proxy supervisor did not start')), 3_000)
      const check = setInterval(() => {
        if (calls.includes('POST /v1/start')) {
          clearInterval(check)
          clearTimeout(deadline)
          resolve()
        }
      }, 20)
    })
    await new Promise(resolve => setTimeout(resolve, 750))
    assert.equal(child.exitCode, null)
    child.kill('SIGTERM')
    const [code] = await once(child, 'exit')
    assert.equal(code, 0)
    assert.equal(calls.includes('POST /v1/stop'), true)
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('stops the Bootstrap proxy supervisor cleanly after its launch socket disappears', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-proxy-supervisor-missing-socket-'))
  const runRoot = join(root, 'run')
  const socket = join(runRoot, 'proxy-launch.sock')
  await mkdir(runRoot)
  let started = false
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      if (request.method === 'POST' && request.url === '/v1/start') started = true
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ running: true, componentReady: true }))
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socket, resolve)
  })
  const script = new URL('../../control-plane/services/outbound-proxy/supervisor.mjs', import.meta.url).pathname
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      DSH_PLATFORM_DATA: join(root, 'data'),
      DSH_PLATFORM_RUN: runRoot,
      DSH_PROXY_LAUNCH_TOKEN: 'x'.repeat(43),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const stderr = []
  child.stderr.on('data', chunk => stderr.push(chunk))
  try {
    const deadline = Date.now() + 3_000
    while (!started && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(started, true)
    await new Promise(resolve => setTimeout(resolve, 50))
    await new Promise(resolve => server.close(resolve))
    await rm(socket, { force: true })
    child.kill('SIGTERM')
    const [code] = await once(child, 'exit')
    assert.equal(code, 0)
    assert.equal(Buffer.concat(stderr).toString('utf8'), '')
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    if (server.listening) await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('restarts Proxy Manager after an unclean exit leaves its control socket behind', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-proxy-process-restart-'))
  const runRoot = join(root, 'run')
  const dataRoot = join(root, 'data')
  await mkdir(runRoot)
  const script = new URL('../../control-plane/services/outbound-proxy/index.mjs', import.meta.url).pathname
  const launch = () => spawn(process.execPath, [script], {
    env: { ...process.env, DSH_PLATFORM_DATA: dataRoot, DSH_PLATFORM_RUN: runRoot },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  const ready = child => Promise.race([
    once(child, 'message').then(([message]) => {
      assert.equal(message.componentReady, true)
    }),
    once(child, 'exit').then(([code, signal]) => {
      throw new Error(`Proxy Manager exited before readiness (${String(code)}, ${String(signal)})`)
    }),
  ])
  const first = launch()
  let second
  try {
    await ready(first)
    const routing = JSON.parse(await readFile(join(runRoot, 'outbound-proxy-routing.json'), 'utf8'))
    assert.equal(routing.schema, 1)
    assert.equal(routing.enabled, false)
    assert.equal(routing.scopes.agentNetwork, false)
    assert.deepEqual(routing.environment, { allProxy: null })
    assert.deepEqual(routing.noProxy.system, ['localhost', '127.0.0.1', '::1'])
    assert.equal(JSON.stringify(routing).includes('password'), false)
    first.kill('SIGKILL')
    await once(first, 'exit')
    second = launch()
    await ready(second)
    assert.equal(second.exitCode, null)
  } finally {
    if (first.exitCode === null) first.kill('SIGKILL')
    if (second?.exitCode === null) {
      second.kill('SIGTERM')
      await once(second, 'exit')
    }
    await rm(root, { recursive: true, force: true })
  }
})
