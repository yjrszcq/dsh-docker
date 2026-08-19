import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseExperimentalPolicy } from '../lib/contracts.mjs'
import { verifyRegistryCandidate } from '../stage0/lib/experimental.mjs'
import { experimentalPolicy, registryCandidate, registryKeyPair } from './helpers.mjs'

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
  const policy = parseExperimentalPolicy(JSON.parse(await readFile(
    new URL('../../../release/experimental-policy.json', import.meta.url),
  )))
  const stable = { desired: { dsh: { version: '0.1.0-rc.6' } }, experimentalPolicy: policy }
  assert.equal(verifyRegistryCandidate(candidate, stable).version, '0.1.0-rc.7')
  assert.throws(() => verifyRegistryCandidate({
    ...candidate,
    dist: { ...candidate.dist, integrity: candidate.dist.integrity.replace('Zce', 'Ace') },
  }, stable), { code: 'TRUST_UNKNOWN_KEY' })
  assert.throws(() => verifyRegistryCandidate(candidate, {
    ...stable,
    experimentalPolicy: { ...policy, keys: [] },
  }), { code: 'TRUST_UNKNOWN_KEY' })
})

test('rejects Stable versions and noncanonical npm tarball origins', async () => {
  const policy = parseExperimentalPolicy(JSON.parse(await readFile(
    new URL('../../../release/experimental-policy.json', import.meta.url),
  )))
  assert.throws(() => verifyRegistryCandidate(candidate, {
    desired: { dsh: { version: candidate.version } }, experimentalPolicy: policy,
  }), /newer/)
  assert.throws(() => verifyRegistryCandidate({
    ...candidate,
    dist: { ...candidate.dist, tarball: 'https://mirror.example/dsh.tgz' },
  }, { desired: { dsh: { version: '0.1.0-rc.6' } }, experimentalPolicy: policy }), /canonical/)
})

test('rejects candidates after a delegated npm Registry key expires', () => {
  const registry = registryKeyPair()
  const policy = parseExperimentalPolicy(experimentalPolicy(registry, '2026-08-18T00:00:00.000Z'))
  assert.throws(() => verifyRegistryCandidate(
    registryCandidate(registry),
    { desired: { dsh: { version: '0.1.0-rc.7' } }, experimentalPolicy: policy },
    new Date('2026-08-19T00:00:00.000Z'),
  ), { code: 'TRUST_UNKNOWN_KEY' })
})
