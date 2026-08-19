import { isoTimestamp, parseJsonDocument, positiveSafeInteger, TrustError } from '../../lib/validation.mjs'
import { verifyDetached } from './signature.mjs'

export function parseReleaseTarget(bytes) {
  const object = parseJsonDocument(bytes, 'release target')
  if (object.schema !== 1) throw new TrustError('release target schema must be 1')
  if (object.updateApi !== 1) throw new TrustError('release target updateApi must be 1')
  const keyringGeneration = positiveSafeInteger(
    object.keyringGeneration,
    'release target keyringGeneration',
  )
  const targetSequence = positiveSafeInteger(object.targetSequence, 'release target targetSequence')
  isoTimestamp(object.issuedAt, 'release target issuedAt')
  return Object.freeze({ document: object, keyringGeneration, targetSequence })
}

export function verifyReleaseTarget(bytes, signature, keyring) {
  const parsed = parseReleaseTarget(bytes)
  if (parsed.keyringGeneration !== keyring.generation) {
    throw new TrustError('release target requires a different keyring generation')
  }
  const keyId = verifyDetached(bytes, signature, keyring.current.publicKey, 'release target')
  return Object.freeze({ ...parsed, keyId })
}

export function validateTargetTransition(previousBytes, previous, nextBytes, next) {
  if (next.targetSequence < previous.targetSequence) {
    throw new TrustError('release target sequence cannot decrease', 'TRUST_ROLLBACK')
  }
  if (next.targetSequence === previous.targetSequence && !previousBytes.equals(nextBytes)) {
    throw new TrustError('release target sequence cannot identify different content')
  }
  return next
}
