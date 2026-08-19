import { createPublicKey, verify } from 'node:crypto'
import { compareDshVersions } from '../../lib/supported-target.mjs'
import { exactKeys, plainObject, TrustError } from '../../lib/validation.mjs'

function registrySignature(value, label) {
  const object = plainObject(value, label)
  exactKeys(object, ['keyid', 'sig'], label)
  if (typeof object.keyid !== 'string' || typeof object.sig !== 'string') {
    throw new TrustError(`${label} is invalid`)
  }
  return Object.freeze({ keyid: object.keyid, sig: object.sig })
}

export function parseRegistryCandidate(value) {
  const object = plainObject(value, 'npm candidate')
  exactKeys(object, ['dist', 'name', 'schema', 'version'], 'npm candidate')
  if (object.schema !== 1) throw new TrustError('npm candidate schema must be 1')
  if (object.name !== '@deepseek-ai/dsh') throw new TrustError('npm candidate package name is invalid')
  const dist = plainObject(object.dist, 'npm candidate dist')
  exactKeys(dist, ['integrity', 'signatures', 'tarball'], 'npm candidate dist')
  if (typeof object.version !== 'string') throw new TrustError('npm candidate version is invalid')
  if (typeof dist.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(dist.integrity)) {
    throw new TrustError('npm candidate integrity must use SHA-512')
  }
  if (!Array.isArray(dist.signatures) || dist.signatures.length === 0) {
    throw new TrustError('npm candidate must contain registry signatures')
  }
  return Object.freeze({
    schema: 1,
    name: object.name,
    version: object.version,
    dist: Object.freeze({
      integrity: dist.integrity,
      tarball: dist.tarball,
      signatures: Object.freeze(dist.signatures.map((entry, index) => (
        registrySignature(entry, `npm candidate signatures[${String(index)}]`)
      ))),
    }),
  })
}

export function verifyRegistryCandidate(value, stable, now = new Date()) {
  const candidate = parseRegistryCandidate(value)
  const policy = stable.experimentalPolicy
  if (policy === null) throw new TrustError('Latest Supported does not authorize Experimental updates')
  if (candidate.name !== policy.packageName) throw new TrustError('npm candidate is outside the Experimental policy')
  if (compareDshVersions(candidate.version, stable.desired.dsh.version) <= 0) {
    throw new TrustError('Experimental DSH must be newer than Latest Supported')
  }
  const expectedTarball = new URL(`${candidate.name}/-/dsh-${candidate.version}.tgz`, policy.registry).href
  if (candidate.dist.tarball !== expectedTarball) throw new TrustError('npm candidate tarball URL is not canonical')
  const message = `${candidate.name}@${candidate.version}:${candidate.dist.integrity}`
  for (const candidateSignature of candidate.dist.signatures) {
    const key = policy.keys.find(entry => entry.keyId === candidateSignature.keyid)
    if (key === undefined || (key.expires !== null && new Date(key.expires) <= now)) continue
    let publicKey
    try {
      publicKey = createPublicKey({ key: Buffer.from(key.publicKey, 'base64'), format: 'der', type: 'spki' })
    } catch {
      throw new TrustError('Experimental policy contains an invalid registry public key')
    }
    if (publicKey.asymmetricKeyType !== 'ec' || publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new TrustError('Experimental registry key must use P-256')
    }
    if (verify('sha256', Buffer.from(message), publicKey, Buffer.from(candidateSignature.sig, 'base64'))) {
      return Object.freeze({ ...candidate, signerKeyId: key.keyId })
    }
  }
  throw new TrustError('npm candidate has no valid delegated registry signature', 'TRUST_UNKNOWN_KEY')
}
