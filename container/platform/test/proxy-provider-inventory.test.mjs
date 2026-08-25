import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { defaultProxyConfiguration, validateProxyConfiguration } from '../../control-plane/services/outbound-proxy/lib/contracts.mjs'
import { ProviderInventory } from '../../control-plane/services/management/provider-inventory.mjs'

function response(value) {
  return new Response(JSON.stringify({
    type: 'server-response',
    rpcId: 'fixture',
    result: { ok: true, value },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function proxySnapshot() {
  const defaults = defaultProxyConfiguration()
  return Object.freeze({
    revision: 'revision-one',
    recovery: 'none',
    ...validateProxyConfiguration({
      ...defaults,
      modelApi: { default: 'direct', providers: { adapted: 'proxy', shared: 'proxy', local: 'proxy' } },
    }),
  })
}

test('builds a sanitized Provider capability inventory from controlled DSH RPCs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-provider-inventory-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const calls = []
  const inventory = new ProviderInventory({
    cachePath: join(root, 'providers.json'),
    adaptedProviders: ['adapted'],
    now: () => new Date('2026-08-25T00:00:00.000Z'),
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body)
      calls.push({ url, method: body.method })
      if (body.method === 'llm.providers') return response({ providers: [
        { provider: 'dormant', displayName: 'Dormant', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'dormant'], active: false },
        { provider: 'shared', displayName: 'Shared', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'shared'], active: true },
        { provider: 'custom', displayName: 'Custom route', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'custom'], active: true, declared: true },
        { provider: 'adapted', displayName: 'Adapted', settingsNs: 'adapted', settingsPath: [], active: true },
        { provider: 'local', displayName: 'Local', settingsNs: 'local', settingsPath: [], active: true },
        { provider: '../invalid', displayName: 'Invalid', settingsNs: 'invalid', settingsPath: [], active: true },
      ] })
      return response({ namespaces: [
        { ns: 'llm-pi-ai', value: { providers: { shared: { baseURL: 'https://api.example.test' }, custom: { baseURL: 'https://custom.example.test' } } }, base: {} },
        { ns: 'adapted', value: {}, base: {} },
        { ns: 'local', value: { baseURL: 'http://127.0.0.1:11434/v1' }, base: {} },
      ] })
    },
  })
  const result = await inventory.list(proxySnapshot())
  assert.equal(result.source, 'live')
  assert.equal(result.error, null)
  assert.equal(result.updatedAt, '2026-08-25T00:00:00.000Z')
  assert.deepEqual(result.providers.map(provider => ({
    id: provider.id,
    capability: provider.routingCapability,
    requested: provider.requestedPolicy,
    effective: provider.effectivePolicy,
    reason: provider.reason,
  })), [
    { id: 'adapted', capability: 'provider', requested: 'proxy', effective: 'proxy', reason: null },
    { id: 'custom', capability: 'shared-dsh', requested: null, effective: 'shared-dsh', reason: 'client-uses-shared-dsh-route' },
    { id: 'local', capability: 'forced-direct', requested: null, effective: 'direct', reason: 'local-provider' },
    { id: 'shared', capability: 'shared-dsh', requested: null, effective: 'shared-dsh', reason: 'client-uses-shared-dsh-route' },
  ])
  assert.deepEqual(calls.map(call => call.method).sort(), ['llm.providers', 'settings.describe'])
  assert.equal(result.providers.some(provider => provider.id === 'dormant'), false)
  const cache = JSON.parse(await readFile(join(root, 'providers.json'), 'utf8'))
  assert.doesNotMatch(JSON.stringify(cache), /api\.example|127\.0\.0\.1|baseURL|secret/i)
})

test('keeps the last sanitized Provider inventory when DSH is unavailable', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-provider-cache-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let online = true
  const inventory = new ProviderInventory({
    cachePath: join(root, 'providers.json'),
    fetchImpl: async (_url, init) => {
      if (!online) throw new Error('DSH is stopped')
      const method = JSON.parse(init.body).method
      return method === 'llm.providers'
        ? response({ providers: [{ provider: 'deepseek', displayName: 'DeepSeek', settingsNs: 'deepseek', settingsPath: [], active: true }] })
        : response({ namespaces: [{ ns: 'deepseek', value: {}, base: {} }] })
    },
  })
  assert.equal((await inventory.list(proxySnapshot())).source, 'live')
  online = false
  const cached = await inventory.list(proxySnapshot())
  assert.equal(cached.source, 'cache')
  assert.equal(cached.providers[0].id, 'deepseek')
  assert.equal(cached.error, 'DSH is stopped')

  const empty = new ProviderInventory({
    cachePath: join(root, 'missing.json'),
    fetchImpl: async () => { throw new Error('DSH is stopped') },
  })
  const unavailable = await empty.list(proxySnapshot())
  assert.equal(unavailable.source, 'unavailable')
  assert.deepEqual(unavailable.providers, [])
  assert.equal(unavailable.error, 'DSH is stopped')
})
