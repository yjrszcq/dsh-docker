import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { TrustLedger } from '../stage0/lib/ledger.mjs'
import { document, experimentalTarget, keyPair, keyring, signature, target } from './helpers.mjs'

async function fixture() {
  const recovery = keyPair()
  return {
    recovery,
    ledger: new TrustLedger(await mkdtemp(join(tmpdir(), 'dsh-trust-ledger-')), recovery.publicKey),
  }
}

test('persists only increasing keyring generations and identical repeats', async () => {
  const { ledger, recovery } = await fixture()
  const current = keyPair()
  const next = keyPair()
  const first = document(keyring(1, current, next))
  await ledger.acceptKeyring(first, signature(first, recovery))
  await ledger.acceptKeyring(first, signature(first, recovery))
  const conflicting = document({ ...keyring(1, current, next), issuedAt: '2026-08-19T02:00:00.000Z' })
  await assert.rejects(ledger.acceptKeyring(conflicting, signature(conflicting, recovery)))
  const older = document(keyring(1, current, next))
  const third = keyPair()
  const rotated = document(keyring(2, next, third, [current.keyId]))
  await ledger.acceptKeyring(rotated, signature(rotated, recovery))
  await assert.rejects(ledger.acceptKeyring(older, signature(older, recovery)), { code: 'TRUST_ROLLBACK' })
})

test('accepts targets only from current release key and prevents sequence rollback', async () => {
  const { ledger, recovery } = await fixture()
  const current = keyPair()
  const next = keyPair()
  const ring = document(keyring(1, current, next))
  await ledger.acceptKeyring(ring, signature(ring, recovery))

  const first = document(target(1, 1))
  await assert.rejects(ledger.acceptTarget(first, signature(first, next)), { code: 'TRUST_UNKNOWN_KEY' })
  await ledger.acceptTarget(first, signature(first, current))
  await ledger.acceptTarget(first, signature(first, current))

  const conflicting = document({ ...target(1, 1), target: { changed: true } })
  await assert.rejects(ledger.acceptTarget(conflicting, signature(conflicting, current)))
  const second = document(target(1, 2))
  await ledger.acceptTarget(second, signature(second, current))
  await assert.rejects(ledger.acceptTarget(first, signature(first, current)), { code: 'TRUST_ROLLBACK' })
})

test('requires an accepted keyring before accepting a target', async () => {
  const { ledger } = await fixture()
  const release = keyPair()
  const bytes = document(target(1, 1))
  await assert.rejects(ledger.acceptTarget(bytes, signature(bytes, release)), /keyring/)
})

test('keeps Experimental sequence independent and requires a newer DSH signed by current Release Key', async () => {
  const { ledger, recovery } = await fixture()
  const current = keyPair()
  const next = keyPair()
  const ring = document(keyring(1, current, next))
  await ledger.acceptKeyring(ring, signature(ring, recovery))
  const stable = document(target(1, 4))
  await ledger.acceptTarget(stable, signature(stable, current))

  const first = document(experimentalTarget(1, 1))
  await assert.rejects(ledger.acceptExperimental(first, signature(first, next)), { code: 'TRUST_UNKNOWN_KEY' })
  await ledger.acceptExperimental(first, signature(first, current))
  await ledger.acceptExperimental(first, signature(first, current))
  assert.equal((await ledger.currentExperimental()).value.experimentalSequence, 1)

  const sameVersion = document(experimentalTarget(1, 2, '0.1.0-rc.7'))
  await assert.rejects(ledger.acceptExperimental(sameVersion, signature(sameVersion, current)), /newer/)
  const second = document(experimentalTarget(1, 2, '0.1.0-rc.9'))
  await ledger.acceptExperimental(second, signature(second, current))
  await assert.rejects(ledger.acceptExperimental(first, signature(first, current)), { code: 'TRUST_ROLLBACK' })
})

test('retains historical keyrings so an accepted target remains verifiable after rotation', async () => {
  const { ledger, recovery } = await fixture()
  const first = keyPair()
  const second = keyPair()
  const third = keyPair()
  const initialRing = document(keyring(1, first, second))
  await ledger.acceptKeyring(initialRing, signature(initialRing, recovery))
  const initialTarget = document(target(1, 7))
  await ledger.acceptTarget(initialTarget, signature(initialTarget, first))

  const rotatedRing = document(keyring(2, second, third, [first.keyId]))
  await ledger.acceptKeyring(rotatedRing, signature(rotatedRing, recovery))
  assert.equal((await ledger.currentTarget()).value.targetSequence, 7)

  const rotatedTarget = document(target(2, 8))
  await ledger.acceptTarget(rotatedTarget, signature(rotatedTarget, second))
  assert.equal((await ledger.currentTarget()).value.keyId, second.keyId)
})

test('serializes concurrent target acceptance in call order', async () => {
  const { ledger, recovery } = await fixture()
  const current = keyPair()
  const next = keyPair()
  const ring = document(keyring(1, current, next))
  await ledger.acceptKeyring(ring, signature(ring, recovery))
  const first = document(target(1, 1))
  const second = document(target(1, 2))
  await Promise.all([
    ledger.acceptTarget(first, signature(first, current)),
    ledger.acceptTarget(second, signature(second, current)),
  ])
  assert.equal((await ledger.currentTarget()).value.targetSequence, 2)
})

test('does not overwrite a conflicting historical generation after interrupted promotion', async () => {
  const { ledger, recovery } = await fixture()
  const first = keyPair()
  const second = keyPair()
  const third = keyPair()
  const initial = document(keyring(1, first, second))
  await ledger.acceptKeyring(initial, signature(initial, recovery))
  const rotated = document(keyring(2, second, third, [first.keyId]))
  await ledger.acceptKeyring(rotated, signature(rotated, recovery))
  const rotatedRecord = await readFile(ledger.keyringPath('current.record.json'))
  const initialRecord = await readFile(ledger.keyringPath('generations/1.record.json'))
  await writeFile(ledger.keyringPath('current.record.json'), initialRecord)

  const replacement = keyPair()
  const conflicting = document(keyring(2, second, replacement, [first.keyId, third.keyId]))
  await assert.rejects(
    ledger.acceptKeyring(conflicting, signature(conflicting, recovery)),
    /history conflicts/,
  )
  assert.deepEqual(await readFile(ledger.keyringPath('generations/2.record.json')), rotatedRecord)
})
