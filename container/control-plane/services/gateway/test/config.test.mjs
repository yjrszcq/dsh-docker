import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadConfig,
  parseBoolean,
  parseTrustedAuthority,
  parseTrustedHosts,
} from '../lib/config.mjs'
import { UsageError } from '../lib/errors.mjs'

test('parseBoolean accepts only explicit Compose booleans', () => {
  assert.equal(parseBoolean('FLAG', undefined, true), true)
  assert.equal(parseBoolean('FLAG', 'false', true), false)
  assert.throws(() => parseBoolean('FLAG', '1', true), UsageError)
})

test('parseTrustedAuthority accepts canonical host authorities', () => {
  assert.deepEqual(parseTrustedAuthority('Example.COM'), {
    hostname: 'example.com',
    authority: 'example.com',
    anyPort: true,
    matchAuthority: 'example.com',
  })
  assert.deepEqual(parseTrustedAuthority('example.com:8443'), {
    hostname: 'example.com',
    authority: 'example.com:8443',
    anyPort: false,
    matchAuthority: 'example.com:8443',
  })
  assert.deepEqual(parseTrustedAuthority('[fd00::1]:3080'), {
    hostname: '[fd00::1]',
    authority: '[fd00::1]:3080',
    anyPort: false,
    matchAuthority: '[fd00::1]:3080',
  })
})

test('parseTrustedAuthority rejects URL-like and noncanonical entries', () => {
  for (const value of [
    'https://example.com',
    'example.com/path',
    'user@example.com',
    'example.com:',
    '*.example.com',
    ' example.com',
  ]) {
    assert.throws(() => parseTrustedAuthority(value), UsageError, value)
  }
})

test('parseTrustedHosts supports empty, lists, deduplication, and wildcard', () => {
  assert.deepEqual(parseTrustedHosts({}), { wildcard: false, authorities: [] })
  const list = parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'a.example, b.example:8443,a.example' })
  assert.equal(list.wildcard, false)
  assert.equal(list.authorities.length, 2)
  assert.deepEqual(parseTrustedHosts({ DSH_TRUSTED_HOSTS: '*' }), {
    wildcard: true,
    authorities: [],
  })
})

test('parseTrustedHosts rejects malformed lists', () => {
  assert.throws(() => parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'a.example,,b.example' }), UsageError)
  assert.throws(() => parseTrustedHosts({ DSH_TRUSTED_HOSTS: '*,a.example' }), UsageError)
})

test('loadConfig owns only Gateway settings', async () => {
  const config = await loadConfig({
    DSH_DEFAULT_WORKSPACE: 'not-a-gateway-setting',
    DSH_TELEMETRY_DISABLED: 'not-a-gateway-setting',
    DSH_PROXY_USERNAME: 'unused',
    DSH_PROXY_PASSWORD: '',
  })
  assert.equal(Object.hasOwn(config, 'password'), false)
  assert.equal(Object.hasOwn(config, 'username'), false)
  assert.equal(Object.hasOwn(config, 'platformPassword'), false)
  assert.equal(Object.hasOwn(config, 'workspace'), false)
  assert.equal(Object.hasOwn(config, 'telemetryDisabled'), false)
  assert.equal(config.managementPort, 3081)
  assert.doesNotReject(() => loadConfig({
    DSH_PROXY_USERNAME: 'invalid:name',
    DSH_PROXY_PASSWORD: 'secret',
    DSH_PLATFORM_PASSWORD: 'legacy-secret',
  }))
})
