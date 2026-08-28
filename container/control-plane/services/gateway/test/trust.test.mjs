import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTrustedHosts } from '../lib/config.mjs'
import { inspectExternalRequest, isLoopbackHostname } from '../lib/trust.mjs'

test('isLoopbackHostname follows DSH loopback semantics', () => {
  for (const hostname of ['localhost', '127.0.0.1', '127.255.255.255', '[::1]']) {
    assert.equal(isLoopbackHostname(hostname), true, hostname)
  }
  for (const hostname of ['example.com', '128.0.0.1', '127.0.0.999', '[::2]']) {
    assert.equal(isLoopbackHostname(hostname), false, hostname)
  }
})

test('empty trusted Hosts accepts loopback only', () => {
  const trusted = parseTrustedHosts({})
  assert.equal(inspectExternalRequest({ host: '127.0.0.1:3080' }, trusted).accepted, true)
  assert.equal(inspectExternalRequest({ host: 'localhost:3080' }, trusted).accepted, true)
  assert.deepEqual(inspectExternalRequest({ host: '192.168.1.10:3080' }, trusted), {
    accepted: false,
    reason: 'untrusted-host',
  })
})

test('trusted Hosts match optional ports and wildcard', () => {
  const trusted = parseTrustedHosts({
    DSH_TRUSTED_HOSTS: 'lan.example,exact.example:8443,default.example:80',
  })
  assert.equal(inspectExternalRequest({ host: 'lan.example:9999' }, trusted).accepted, true)
  assert.equal(inspectExternalRequest({ host: 'exact.example:8443' }, trusted).accepted, true)
  assert.equal(inspectExternalRequest({ host: 'exact.example:3080' }, trusted).accepted, false)
  assert.equal(inspectExternalRequest({ host: 'default.example' }, trusted).accepted, true)
  assert.equal(inspectExternalRequest({ host: 'default.example:80' }, trusted).accepted, true)
  const wildcard = parseTrustedHosts({ DSH_TRUSTED_HOSTS: '*' })
  assert.equal(inspectExternalRequest({ host: 'anything.example' }, wildcard).accepted, true)
})

test('request inspection rejects cross-site and mismatched origins', () => {
  const trusted = parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'dsh.example' })
  assert.deepEqual(inspectExternalRequest({
    host: 'dsh.example',
    'sec-fetch-site': 'cross-site',
  }, trusted), { accepted: false, reason: 'cross-site' })
  assert.deepEqual(inspectExternalRequest({
    host: 'dsh.example',
    origin: 'https://evil.example',
  }, trusted), { accepted: false, reason: 'origin-mismatch' })
  assert.equal(inspectExternalRequest({
    host: 'dsh.example',
    origin: 'https://dsh.example',
    'sec-fetch-site': 'same-origin',
  }, trusted).accepted, true)
})

test('explicit cross-origin inspection still requires a trusted Host', () => {
  const trusted = parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'management.example' })
  assert.equal(inspectExternalRequest({
    host: 'management.example',
    origin: 'https://dsh.example',
    'sec-fetch-site': 'cross-site',
  }, trusted, { allowCrossOrigin: true }).accepted, true)
  assert.equal(inspectExternalRequest({
    host: 'untrusted.example',
    origin: 'https://dsh.example',
    'sec-fetch-site': 'cross-site',
  }, trusted, { allowCrossOrigin: true }).accepted, false)
})

test('request inspection rejects missing and malformed browser authorities', () => {
  const trusted = parseTrustedHosts({ DSH_TRUSTED_HOSTS: '*' })
  assert.deepEqual(inspectExternalRequest({}, trusted), { accepted: false, reason: 'missing-host' })
  assert.deepEqual(inspectExternalRequest({ host: 'bad host' }, trusted), {
    accepted: false,
    reason: 'invalid-host',
  })
  for (const host of ['ok.example/path', 'user@ok.example', 'ok.example?', 'ok.example#x', 'ok.example:']) {
    assert.deepEqual(inspectExternalRequest({ host }, trusted), {
      accepted: false,
      reason: 'invalid-host',
    }, host)
  }
  assert.deepEqual(inspectExternalRequest({ host: 'ok.example', origin: 'null' }, trusted), {
    accepted: false,
    reason: 'invalid-origin',
  })
})
