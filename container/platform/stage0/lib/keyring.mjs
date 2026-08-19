import { exactKeys, isoTimestamp, parseJsonDocument, plainObject, positiveSafeInteger, TrustError } from '../../lib/validation.mjs'
import { releaseKeyId, verifyDetached } from './signature.mjs'

export const KEYRING_SCHEMA = 1

function parseReleaseKey(value, label) {
  const object = plainObject(value, label)
  exactKeys(object, ['algorithm', 'keyId', 'publicKey'], label)
  if (object.algorithm !== 'Ed25519') throw new TrustError(`${label}.algorithm must be Ed25519`)
  if (typeof object.publicKey !== 'string') throw new TrustError(`${label}.publicKey must be base64`)
  const keyId = releaseKeyId(object.publicKey)
  if (object.keyId !== keyId) throw new TrustError(`${label}.keyId does not match its public key`)
  return Object.freeze({ algorithm: object.algorithm, keyId, publicKey: object.publicKey })
}

export function parseKeyring(bytes) {
  const object = parseJsonDocument(bytes, 'keyring')
  exactKeys(object, ['current', 'generation', 'issuedAt', 'next', 'revokedKeyIds', 'schema'], 'keyring')
  if (object.schema !== KEYRING_SCHEMA) throw new TrustError('keyring.schema must be 1')
  const generation = positiveSafeInteger(object.generation, 'keyring.generation')
  const issuedAt = isoTimestamp(object.issuedAt, 'keyring.issuedAt')
  const current = parseReleaseKey(object.current, 'keyring.current')
  const next = parseReleaseKey(object.next, 'keyring.next')
  if (current.keyId === next.keyId) throw new TrustError('keyring current and next keys must differ')
  if (!Array.isArray(object.revokedKeyIds)) throw new TrustError('keyring.revokedKeyIds must be an array')
  const revokedKeyIds = object.revokedKeyIds.map((keyId, index) => {
    if (typeof keyId !== 'string' || !/^[a-f0-9]{64}$/.test(keyId)) {
      throw new TrustError(`keyring.revokedKeyIds[${String(index)}] must be a SHA-256 hex digest`)
    }
    return keyId
  })
  if (new Set(revokedKeyIds).size !== revokedKeyIds.length) {
    throw new TrustError('keyring.revokedKeyIds must not contain duplicates')
  }
  if ([...revokedKeyIds].sort().some((keyId, index) => keyId !== revokedKeyIds[index])) {
    throw new TrustError('keyring.revokedKeyIds must be sorted')
  }
  if (revokedKeyIds.includes(current.keyId) || revokedKeyIds.includes(next.keyId)) {
    throw new TrustError('keyring active keys must not be revoked')
  }
  return Object.freeze({
    schema: object.schema,
    generation,
    issuedAt,
    current,
    next,
    revokedKeyIds: Object.freeze(revokedKeyIds),
  })
}

export function verifyRecoveryKeyring(bytes, signature, recoveryPublicKey) {
  verifyDetached(bytes, signature, recoveryPublicKey, 'keyring')
  return parseKeyring(bytes)
}

export function validateKeyringTransition(previous, next) {
  if (next.generation <= previous.generation) {
    throw new TrustError('keyring generation must increase', 'TRUST_ROLLBACK')
  }
  const nextRevoked = new Set(next.revokedKeyIds)
  for (const keyId of previous.revokedKeyIds) {
    if (!nextRevoked.has(keyId)) throw new TrustError('keyring cannot remove a revoked key')
  }
  for (const keyId of [previous.current.keyId, previous.next.keyId]) {
    const remainsActive = keyId === next.current.keyId || keyId === next.next.keyId
    if (!remainsActive && !nextRevoked.has(keyId)) {
      throw new TrustError('keyring must revoke every removed release key')
    }
  }
  for (const keyId of [next.current.keyId, next.next.keyId]) {
    if (previous.revokedKeyIds.includes(keyId)) {
      throw new TrustError('keyring cannot reactivate a revoked key')
    }
  }
  return next
}
