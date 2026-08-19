import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseOfficialDshPolicy } from '../lib/contracts.mjs'
import { verifyOfficialDshCandidate } from '../stage0/lib/official-dsh.mjs'
import { officialDshPolicy, registryCandidate, registryKeyPair } from './helpers.mjs'

const candidate = {
  schema: 1,
  name: '@deepseek-ai/dsh',
  version: '0.1.0-rc.7',
  dist: {
    integrity: 'sha512-ZceDCJ8FAywih+USW/OMk9jEhunlvJBGEz4kqrhau23hPzbciOazZrywH0nBRsaalSeAJ1JGBmjtw4OSjToStw==',
    tarball: 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.1.0-rc.7.tgz',
    signatures: [{
      keyid: 'SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U',
      sig: 'MEUCIQD2wLkZaghGyVZ5rWsOZdS2ue69pTRoGlnAEXvOk/zyOwIgRG6dOCTpAaSYCoYR7PXG6bB/O5ET57rGkBWJSVpvBkQ=',
    }],
  },
}

test('verifies the official npm Registry signature delegated by Stable metadata', async () => {
  const policy = parseOfficialDshPolicy(JSON.parse(await readFile(
    new URL('../../../release/official-dsh-policy.json', import.meta.url),
  )))
  assert.equal(verifyOfficialDshCandidate(candidate, candidate.version, policy).version, candidate.version)
  assert.throws(() => verifyOfficialDshCandidate({
    ...candidate,
    dist: { ...candidate.dist, integrity: candidate.dist.integrity.replace('Zce', 'Ace') },
  }, candidate.version, policy), { code: 'TRUST_UNKNOWN_KEY' })
  assert.throws(() => verifyOfficialDshCandidate(
    candidate, candidate.version, { ...policy, keys: [] },
  ), { code: 'TRUST_UNKNOWN_KEY' })
})

test('accepts an exact requested version and rejects noncanonical npm tarball origins', async () => {
  const policy = parseOfficialDshPolicy(JSON.parse(await readFile(
    new URL('../../../release/official-dsh-policy.json', import.meta.url),
  )))
  assert.equal(verifyOfficialDshCandidate(candidate, candidate.version, policy).version, candidate.version)
  assert.throws(() => verifyOfficialDshCandidate(candidate, '0.1.0-rc.8', policy), /different version/)
  assert.throws(() => verifyOfficialDshCandidate({
    ...candidate,
    dist: { ...candidate.dist, tarball: 'https://mirror.example/dsh.tgz' },
  }, candidate.version, policy), /canonical/)
})

test('rejects candidates after a delegated npm Registry key expires', () => {
  const registry = registryKeyPair()
  const policy = parseOfficialDshPolicy(officialDshPolicy(registry, '2026-08-18T00:00:00.000Z'))
  assert.throws(() => verifyOfficialDshCandidate(
    registryCandidate(registry),
    '0.1.0-rc.8',
    policy,
    new Date('2026-08-19T00:00:00.000Z'),
  ), { code: 'TRUST_UNKNOWN_KEY' })
})
