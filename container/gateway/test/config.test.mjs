import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  loadConfig,
  parseBoolean,
  parseTrustedAuthority,
  parseTrustedHosts,
  validateWorkspace,
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

test('parseTrustedHosts supports empty, lists, deduplication, legacy, and wildcard', () => {
  assert.deepEqual(parseTrustedHosts({}), { wildcard: false, authorities: [] })
  assert.equal(parseTrustedHosts({ DSH_TRUSTED_HOST: 'old.example' }).authorities[0].hostname, 'old.example')
  const list = parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'a.example, b.example:8443,a.example' })
  assert.equal(list.wildcard, false)
  assert.equal(list.authorities.length, 2)
  assert.deepEqual(parseTrustedHosts({ DSH_TRUSTED_HOSTS: '*' }), {
    wildcard: true,
    authorities: [],
  })
})

test('parseTrustedHosts rejects ambiguous configuration', () => {
  assert.throws(() => parseTrustedHosts({
    DSH_TRUSTED_HOSTS: 'new.example',
    DSH_TRUSTED_HOST: 'old.example',
  }), UsageError)
  assert.throws(() => parseTrustedHosts({ DSH_TRUSTED_HOSTS: 'a.example,,b.example' }), UsageError)
  assert.throws(() => parseTrustedHosts({ DSH_TRUSTED_HOSTS: '*,a.example' }), UsageError)
})

test('validateWorkspace accepts directories and rejects invalid targets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-gateway-test-'))
  const file = join(directory, 'file')
  await writeFile(file, 'x')
  try {
    assert.equal(await validateWorkspace(directory), directory)
    const config = await loadConfig({
      DSH_DEFAULT_WORKSPACE: directory,
      DSH_PROXY_USERNAME: 'unused',
      DSH_PROXY_PASSWORD: '',
    })
    assert.equal(config.password, '')
    assert.equal(config.username, 'unused')
    await assert.rejects(() => loadConfig({
      DSH_DEFAULT_WORKSPACE: directory,
      DSH_PROXY_USERNAME: 'invalid:name',
      DSH_PROXY_PASSWORD: 'secret',
    }), UsageError)
    await assert.rejects(() => validateWorkspace('relative'), UsageError)
    await assert.rejects(() => validateWorkspace(file), UsageError)
    await assert.rejects(() => validateWorkspace(join(directory, 'missing')), UsageError)
  } finally {
    await rm(directory, { recursive: true })
  }
})
