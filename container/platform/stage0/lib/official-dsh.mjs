import { createPublicKey, verify } from 'node:crypto'
import { compareDshVersions } from '../../lib/supported-target.mjs'
import { exactKeys, plainObject, TrustError } from '../../lib/validation.mjs'
import {
  OFFICIAL_DSH_PACKAGE,
  OFFICIAL_NPM_REGISTRY,
  officialDshTarballUrl,
} from '../../lib/official-dsh-contracts.mjs'

function registrySignature(value, label) {
  const object = plainObject(value, label)
  exactKeys(object, ['keyid', 'sig'], label)
  if (typeof object.keyid !== 'string' || typeof object.sig !== 'string') {
    throw new TrustError(`${label} is invalid`)
  }
  return Object.freeze({ keyid: object.keyid, sig: object.sig })
}

export function parseOfficialDshCandidate(value) {
  const object = plainObject(value, 'official DSH candidate')
  exactKeys(object, ['dist', 'name', 'schema', 'version'], 'official DSH candidate')
  if (object.schema !== 1) throw new TrustError('official DSH candidate schema must be 1')
  if (object.name !== OFFICIAL_DSH_PACKAGE) throw new TrustError('official DSH candidate package name is invalid')
  compareDshVersions(object.version, object.version)
  const dist = plainObject(object.dist, 'official DSH candidate dist')
  exactKeys(dist, ['integrity', 'signatures', 'tarball'], 'official DSH candidate dist')
  if (typeof dist.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(dist.integrity)) {
    throw new TrustError('official DSH candidate integrity must use SHA-512')
  }
  if (!Array.isArray(dist.signatures) || dist.signatures.length === 0) {
    throw new TrustError('official DSH candidate must contain registry signatures')
  }
  return Object.freeze({
    schema: 1,
    name: object.name,
    version: object.version,
    dist: Object.freeze({
      integrity: dist.integrity,
      tarball: dist.tarball,
      signatures: Object.freeze(dist.signatures.map((entry, index) => (
        registrySignature(entry, `official DSH signatures[${String(index)}]`)
      ))),
    }),
  })
}

export function candidateFromPackument(value, requestedVersion) {
  compareDshVersions(requestedVersion, requestedVersion)
  const packument = plainObject(value, 'official DSH packument')
  const versions = plainObject(packument.versions, 'official DSH packument versions')
  const selected = plainObject(versions[requestedVersion], `official DSH ${requestedVersion}`)
  return parseOfficialDshCandidate({
    schema: 1,
    name: selected.name,
    version: selected.version,
    dist: {
      integrity: selected.dist?.integrity,
      tarball: selected.dist?.tarball,
      signatures: selected.dist?.signatures,
    },
  })
}

export function verifyOfficialDshCandidate(value, requestedVersion, policy, now = new Date()) {
  const candidate = parseOfficialDshCandidate(value)
  if (policy.registry !== OFFICIAL_NPM_REGISTRY) throw new TrustError('official DSH policy registry is invalid')
  if (candidate.version !== requestedVersion) throw new TrustError('official DSH metadata returned a different version')
  if (candidate.name !== policy.packageName) throw new TrustError('official DSH candidate is outside the trusted policy')
  const expectedTarball = officialDshTarballUrl(candidate.version).href
  if (candidate.dist.tarball !== expectedTarball) throw new TrustError('official DSH tarball URL is not canonical')
  const message = `${candidate.name}@${candidate.version}:${candidate.dist.integrity}`
  for (const candidateSignature of candidate.dist.signatures) {
    const key = policy.keys.find(entry => entry.keyId === candidateSignature.keyid)
    if (key === undefined || (key.expires !== null && new Date(key.expires) <= now)) continue
    let publicKey
    try {
      publicKey = createPublicKey({ key: Buffer.from(key.publicKey, 'base64'), format: 'der', type: 'spki' })
    } catch {
      throw new TrustError('official DSH policy contains an invalid registry public key')
    }
    if (publicKey.asymmetricKeyType !== 'ec' || publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new TrustError('official DSH registry key must use P-256')
    }
    if (verify('sha256', Buffer.from(message), publicKey, Buffer.from(candidateSignature.sig, 'base64'))) {
      return Object.freeze({ ...candidate, signerKeyId: key.keyId })
    }
  }
  throw new TrustError('official DSH candidate has no valid delegated registry signature', 'TRUST_UNKNOWN_KEY')
}
