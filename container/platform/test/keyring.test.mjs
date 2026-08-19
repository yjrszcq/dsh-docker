import assert from 'node:assert/strict'
import test from 'node:test'
import { parseKeyring, validateKeyringTransition, verifyRecoveryKeyring } from '../stage0/lib/keyring.mjs'
import { document, keyPair, keyring, signature } from './helpers.mjs'

test('accepts a Recovery-signed keyring with derived current and next IDs', () => {
  const recovery = keyPair()
  const value = keyring(1, keyPair(), keyPair())
  const bytes = document(value)
  assert.deepEqual(verifyRecoveryKeyring(bytes, signature(bytes, recovery), recovery.publicKey), value)
})

test('rejects a keyring signed by a non-Recovery key or modified after signing', () => {
  const recovery = keyPair()
  const other = keyPair()
  const bytes = document(keyring(1, keyPair(), keyPair()))
  assert.throws(() => verifyRecoveryKeyring(bytes, signature(bytes, other), recovery.publicKey), {
    code: 'TRUST_UNKNOWN_KEY',
  })
  const signed = signature(bytes, recovery)
  assert.throws(() => verifyRecoveryKeyring(Buffer.concat([bytes, Buffer.from(' ')]), signed, recovery.publicKey), {
    code: 'TRUST_BAD_SIGNATURE',
  })
})

test('rejects mismatched IDs, duplicate active keys, revoked active keys, and unknown algorithms', () => {
  const current = keyPair()
  const next = keyPair()
  const cases = [
    { ...keyring(1, current, next), current: { ...keyring(1, current, next).current, keyId: next.keyId } },
    { ...keyring(1, current, next), next: { ...keyring(1, current, next).current } },
    { ...keyring(1, current, next), revokedKeyIds: [current.keyId] },
    { ...keyring(1, current, next), current: { ...keyring(1, current, next).current, algorithm: 'RSA' } },
  ]
  for (const value of cases) assert.throws(() => parseKeyring(document(value)))
})

test('requires transitions to preserve revocations and revoke removed keys', () => {
  const first = keyPair()
  const second = keyPair()
  const third = keyPair()
  const fourth = keyPair()
  const initial = parseKeyring(document(keyring(1, first, second)))
  const rotated = parseKeyring(document(keyring(2, second, third, [first.keyId])))
  assert.equal(validateKeyringTransition(initial, rotated), rotated)
  assert.throws(() => validateKeyringTransition(initial, parseKeyring(document(keyring(2, second, third)))))
  const next = parseKeyring(document(keyring(3, third, fourth, [first.keyId, second.keyId])))
  assert.equal(validateKeyringTransition(rotated, next), next)
  assert.throws(() => validateKeyringTransition(next, parseKeyring(document(keyring(4, first, fourth, [second.keyId, third.keyId])))))
})
