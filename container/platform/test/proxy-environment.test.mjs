import assert from 'node:assert/strict'
import { request } from 'node:http'
import test from 'node:test'
import { createOutboundProxyControl } from '../../control-plane/services/outbound-proxy/lib/control.mjs'
import {
  OUTBOUND_PROXY_PORTS,
  outboundProxyEnvironment,
  outboundProxyScopeEnabled,
  outboundProxyUrl,
  parseOutboundProxyEnvironment,
} from '../lib/outbound-proxy.mjs'

function get(port, path) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, path }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.once('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }))
    })
    outgoing.once('error', reject)
    outgoing.end()
  })
}

test('managed proxy environments use only fixed loopback entries', () => {
  assert.equal(outboundProxyUrl('agentNetwork'), 'http://127.0.0.1:17895')
  assert.deepEqual(Object.keys(OUTBOUND_PROXY_PORTS), [
    'updates', 'platform', 'dshCore', 'dshPlugins', 'agentNetwork',
    'managementTerminal', 'modelApi', 'sharedDsh',
  ])
  const environment = outboundProxyEnvironment('managementTerminal', {
    noProxy: ['localhost', '127.0.0.1', 'localhost', '.example.com'],
    allProxy: true,
  })
  assert.deepEqual(environment, {
    HTTP_PROXY: 'http://127.0.0.1:17896',
    HTTPS_PROXY: 'http://127.0.0.1:17896',
    http_proxy: 'http://127.0.0.1:17896',
    https_proxy: 'http://127.0.0.1:17896',
    NO_PROXY: 'localhost,127.0.0.1,.example.com',
    no_proxy: 'localhost,127.0.0.1,.example.com',
    ALL_PROXY: 'http://127.0.0.1:17896',
    all_proxy: 'http://127.0.0.1:17896',
  })
  assert.deepEqual(parseOutboundProxyEnvironment(environment, 'managementTerminal'), environment)
  assert.throws(() => parseOutboundProxyEnvironment({ ...environment, PASSWORD: 'secret' }, 'managementTerminal'), /unsupported fields/)
  assert.throws(() => outboundProxyEnvironment('unknown'), /scope unknown is invalid/)
})

test('scope policy selects direct transport whenever the configured route is disabled', () => {
  const direct = {
    enabled: false,
    scopes: { updates: true, platform: true, dshCore: true, dshPlugins: true, agentNetwork: true, managementTerminal: true },
    modelApi: { default: { proxyEnabled: true }, providers: {} },
  }
  for (const scope of ['updates', 'platform', 'dshCore', 'dshPlugins', 'agentNetwork', 'managementTerminal', 'sharedDsh']) {
    assert.equal(outboundProxyScopeEnabled(direct, scope), false, scope)
  }
  assert.equal(outboundProxyScopeEnabled(direct, 'modelApi', 'deepseek'), false)

  const configured = {
    ...direct,
    enabled: true,
    scopes: { updates: true, platform: false, dshCore: false, dshPlugins: false, agentNetwork: true, managementTerminal: false },
    modelApi: {
      default: { proxyEnabled: true },
      providers: {
        direct: { proxyEnabled: false },
        independent: { proxyEnabled: true },
      },
    },
  }
  assert.equal(outboundProxyScopeEnabled(configured, 'updates'), true)
  assert.equal(outboundProxyScopeEnabled(configured, 'platform'), false)
  assert.equal(outboundProxyScopeEnabled(configured, 'agentNetwork'), true)
  assert.equal(outboundProxyScopeEnabled(configured, 'managementTerminal'), false)
  assert.equal(outboundProxyScopeEnabled(configured, 'sharedDsh'), false)
  assert.equal(outboundProxyScopeEnabled(configured, 'modelApi', 'direct'), false)
  assert.equal(outboundProxyScopeEnabled(configured, 'modelApi', 'independent'), true)
  assert.equal(outboundProxyScopeEnabled(configured, 'modelApi', 'default'), true)

  configured.scopes.dshCore = true
  assert.equal(outboundProxyScopeEnabled(configured, 'sharedDsh'), true)
  assert.equal(outboundProxyScopeEnabled(configured, 'modelApi', 'default'), true)
})

test('outbound proxy control returns sanitized process environments', async () => {
  const snapshot = Object.freeze({
    revision: 'revision-one',
    recovery: 'none',
    credentials: Object.freeze({ username: 'alice', password: 'never-return-this' }),
    configuration: Object.freeze({
      noProxy: Object.freeze({ system: Object.freeze(['localhost', '127.0.0.1', '::1']), user: Object.freeze(['.example.com']) }),
      environment: Object.freeze({ allProxy: 'scope-proxy' }),
      enabled: true,
      scopes: Object.freeze({ agentNetwork: true }),
      modelApi: Object.freeze({ default: Object.freeze({ proxyEnabled: false }), providers: Object.freeze({}) }),
    }),
  })
  const server = createOutboundProxyControl({
    getSnapshot: () => snapshot,
    routeHealth: { status: () => ({ updates: 'direct' }) },
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const result = await get(server.address().port, '/v1/environment?scope=agentNetwork')
    assert.equal(result.status, 200)
    assert.equal(result.body.revision, 'revision-one')
    assert.equal(result.body.environment.HTTP_PROXY, 'http://127.0.0.1:17895')
    assert.equal(result.body.environment.NO_PROXY, 'localhost,127.0.0.1,::1,.example.com')
    assert.equal(result.body.environment.ALL_PROXY, 'http://127.0.0.1:17895')
    assert.doesNotMatch(JSON.stringify(result.body), /alice|never-return-this/)
    assert.equal((await get(server.address().port, '/v1/environment?scope=invalid')).status, 400)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('outbound proxy control omits proxy entries for every disabled process scope', async () => {
  const scopes = ['updates', 'platform', 'dshCore', 'dshPlugins', 'agentNetwork', 'managementTerminal', 'sharedDsh']
  const snapshot = Object.freeze({
    revision: 'direct-revision', recovery: 'none', credentials: Object.freeze({ username: '', password: null }),
    configuration: Object.freeze({
      enabled: true,
      scopes: Object.freeze({
        updates: false, platform: false, dshCore: false, dshPlugins: false,
        agentNetwork: false, managementTerminal: false,
      }),
      modelApi: Object.freeze({ default: Object.freeze({ proxyEnabled: false }), providers: Object.freeze({}) }),
      noProxy: Object.freeze({ system: Object.freeze(['localhost', '127.0.0.1', '::1']), user: Object.freeze([]) }),
      environment: Object.freeze({ allProxy: 'scope-proxy' }),
    }),
  })
  const server = createOutboundProxyControl({
    getSnapshot: () => snapshot,
    routeHealth: { status: () => ({}) },
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    for (const scope of scopes) {
      const result = await get(server.address().port, `/v1/environment?scope=${scope}`)
      assert.equal(result.status, 200)
      assert.equal(result.body.environment.HTTP_PROXY, undefined, scope)
      assert.equal(result.body.environment.HTTPS_PROXY, undefined, scope)
      assert.equal(result.body.environment.ALL_PROXY, undefined, scope)
    }
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
