import { createPublicKey, verify } from 'node:crypto'
import { compareDshVersions } from '../../lib/supported-target.mjs'
import { exactKeys, plainObject, TrustError } from '../../lib/validation.mjs'

export const OFFICIAL_DSH_PACKAGE = '@deepseek-ai/dsh'
export const OFFICIAL_NPM_REGISTRY = 'https://registry.npmjs.org/'
export const OFFICIAL_DSH_METADATA_LIMIT = 20 * 1024 * 1024
export const OFFICIAL_DSH_TARBALL_LIMIT = 512 * 1024 * 1024

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
  if (candidate.version !== requestedVersion) throw new TrustError('official DSH metadata returned a different version')
  if (candidate.name !== policy.packageName) throw new TrustError('official DSH candidate is outside the trusted policy')
  const expectedTarball = new URL(`${candidate.name}/-/dsh-${candidate.version}.tgz`, policy.registry).href
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

async function boundedResponseBytes(response, label, maxBytes) {
  if (!response.ok) throw new TrustError(`${label} returned HTTP ${String(response.status)}`)
  const declaredLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new TrustError(`${label} exceeds the download limit`)
  if (response.body === null || response.body === undefined) return Buffer.alloc(0)
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk)
    size += bytes.byteLength
    if (size > maxBytes) throw new TrustError(`${label} exceeds the download limit`)
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, size)
}

async function exactFetch(fetchImpl, url, label, options = {}) {
  const response = await fetchImpl(url, { ...options, redirect: 'error' })
  if (response.redirected || (response.url !== undefined && response.url !== '' && response.url !== url.href)) {
    throw new TrustError(`${label} changed origin or redirected`)
  }
  return response
}

export async function fetchOfficialDshCandidate({ requestedVersion, policy, fetchImpl, now, signal }) {
  if (policy.registry !== OFFICIAL_NPM_REGISTRY || policy.packageName !== OFFICIAL_DSH_PACKAGE) {
    throw new TrustError('official DSH policy does not identify the fixed npm source')
  }
  const metadataUrl = new URL(encodeURIComponent(OFFICIAL_DSH_PACKAGE), OFFICIAL_NPM_REGISTRY)
  const response = await exactFetch(fetchImpl, metadataUrl, 'official DSH metadata', {
    headers: { accept: 'application/vnd.npm.install-v1+json', 'accept-encoding': 'identity' },
    signal,
  })
  const bytes = await boundedResponseBytes(response, 'official DSH metadata', OFFICIAL_DSH_METADATA_LIMIT)
  let packument
  try { packument = JSON.parse(bytes.toString('utf8')) } catch { throw new TrustError('official DSH metadata is not valid JSON') }
  return verifyOfficialDshCandidate(candidateFromPackument(packument, requestedVersion), requestedVersion, policy, now)
}

export async function fetchOfficialDshTarball({ candidate, fetchImpl, signal }) {
  const url = new URL(candidate.dist.tarball)
  if (url.origin !== new URL(OFFICIAL_NPM_REGISTRY).origin) throw new TrustError('official DSH tarball origin is invalid')
  const response = await exactFetch(fetchImpl, url, 'official DSH tarball', {
    headers: { accept: 'application/octet-stream', 'accept-encoding': 'identity' },
    signal,
  })
  if (response.headers?.get?.('content-encoding')) throw new TrustError('official DSH tarball must not use content encoding')
  if (!response.ok) throw new TrustError(`official DSH tarball returned HTTP ${String(response.status)}`)
  const declaredLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > OFFICIAL_DSH_TARBALL_LIMIT) {
    throw new TrustError('official DSH tarball exceeds the download limit')
  }
  if (response.body === null || response.body === undefined) throw new TrustError('official DSH tarball has no response body')
  return response.body
}
