import assert from 'node:assert/strict'
import { request } from 'node:http'
import test from 'node:test'
import { createOutboundProxyControl } from '../../control-plane/services/outbound-proxy/lib/control.mjs'
import {
  OUTBOUND_PROXY_PORTS,
  outboundProxyEnvironment,
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

test('outbound proxy control returns sanitized process environments', async () => {
  const snapshot = Object.freeze({
    revision: 'revision-one',
    recovery: 'none',
    credentials: Object.freeze({ username: 'alice', password: 'never-return-this' }),
    configuration: Object.freeze({
      noProxy: Object.freeze({ system: Object.freeze(['localhost', '127.0.0.1', '::1']), user: Object.freeze(['.example.com']) }),
      environment: Object.freeze({ allProxy: 'scope-proxy' }),
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
