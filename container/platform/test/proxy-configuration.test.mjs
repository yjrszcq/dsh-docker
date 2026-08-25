import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  defaultProxyConfiguration,
  PROXY_PORTS,
  sanitizedProxyConfiguration,
  validateProxyConfiguration,
} from '../../control-plane/services/proxy/lib/contracts.mjs'
import { ProxyConfigurationError, proxyErrorBody } from '../../control-plane/services/proxy/lib/errors.mjs'
import {
  matchesProxyRules,
  noProxyEnvironment,
  normalizeProxyRules,
} from '../../control-plane/services/proxy/lib/rules.mjs'
import { ProxyConfigurationStore } from '../../control-plane/services/proxy/lib/store.mjs'
import { PROXY_SCOPE_CATALOG } from '../../control-plane/services/proxy/lib/scope-catalog.mjs'

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
  const script = new URL('../../control-plane/services/proxy/supervisor.mjs', import.meta.url).pathname
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

test('restarts Proxy Manager after an unclean exit leaves its control socket behind', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-proxy-process-restart-'))
  const runRoot = join(root, 'run')
  const dataRoot = join(root, 'data')
  await mkdir(runRoot)
  const script = new URL('../../control-plane/services/proxy/index.mjs', import.meta.url).pathname
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
