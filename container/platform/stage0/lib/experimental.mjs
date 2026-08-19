import { parseExperimental } from '../../lib/contracts.mjs'
import { compareDshVersions } from '../../lib/supported-target.mjs'
import { TrustError } from '../../lib/validation.mjs'
import { verifyDetached } from './signature.mjs'

export function verifyExperimentalTarget(bytes, signature, keyring, stable) {
  const parsed = parseExperimental(bytes)
  if (parsed.keyringGeneration !== keyring.generation) {
    throw new TrustError('experimental target requires a different keyring generation')
  }
  if (compareDshVersions(parsed.desired.dsh.version, stable.desired.dsh.version) <= 0) {
    throw new TrustError('experimental DSH must be newer than Latest Supported')
  }
  const keyId = verifyDetached(bytes, signature, keyring.current.publicKey, 'experimental target')
  return Object.freeze({ ...parsed, keyId })
}

export function validateExperimentalTransition(previousBytes, previous, nextBytes, next) {
  if (next.experimentalSequence < previous.experimentalSequence) {
    throw new TrustError('experimental sequence cannot decrease', 'TRUST_ROLLBACK')
  }
  if (next.experimentalSequence === previous.experimentalSequence && !previousBytes.equals(nextBytes)) {
    throw new TrustError('experimental sequence cannot identify different content')
  }
  return next
}
