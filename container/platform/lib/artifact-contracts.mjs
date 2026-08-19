import { exactKeys, isoTimestamp, parseJsonDocument, plainObject, positiveSafeInteger, TrustError } from './validation.mjs'

export const MANIFEST_MEDIA_TYPE = 'application/vnd.dsh-platform.manifest.v1+json'
export const SIGNATURE_MEDIA_TYPE = 'application/vnd.dsh-platform.signature.v1+json'

function nonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TrustError(`${label} must be a non-negative safe integer`)
  }
  return value
}

export function parseArtifactDescriptor(value, label = 'artifact') {
  const object = plainObject(value, label)
  exactKeys(object, ['id', 'mediaType', 'sha256', 'size', 'url'], label)
  if (typeof object.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(object.id)) {
    throw new TrustError(`${label}.id is invalid`)
  }
  if (typeof object.mediaType !== 'string' || !/^[\x21-\x7e]{1,127}$/.test(object.mediaType)) {
    throw new TrustError(`${label}.mediaType is invalid`)
  }
  if (typeof object.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(object.sha256)) {
    throw new TrustError(`${label}.sha256 must be a SHA-256 hex digest`)
  }
  const size = nonNegativeSafeInteger(object.size, `${label}.size`)
  let url
  try {
    url = new URL(object.url)
  } catch {
    throw new TrustError(`${label}.url must be an HTTPS URL`)
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new TrustError(`${label}.url must be an HTTPS URL without credentials`)
  }
  return Object.freeze({
    id: object.id,
    mediaType: object.mediaType,
    sha256: object.sha256,
    size,
    url: url.href,
  })
}

export function parseArtifactList(value, label) {
  if (!Array.isArray(value)) throw new TrustError(`${label} must be an array`)
  const artifacts = value.map((entry, index) => parseArtifactDescriptor(entry, `${label}[${String(index)}]`))
  if (new Set(artifacts.map(artifact => artifact.id)).size !== artifacts.length) {
    throw new TrustError(`${label} must not contain duplicate IDs`)
  }
  return Object.freeze(artifacts)
}

export function parseReleaseManifest(bytes) {
  const object = parseJsonDocument(bytes, 'release manifest')
  const common = ['artifacts', 'issuedAt', 'keyringGeneration', 'manifestType', 'schema', 'targetSequence', 'version']
  const specific = object.manifestType === 'bootstrap'
    ? ['bootstrapApi', 'entrypoint']
    : object.manifestType === 'environment'
      ? ['bootstrapApi', 'components', 'patches', 'systemPlugins']
      : []
  exactKeys(object, [...common, ...specific], 'release manifest')
  if (object.schema !== 1) throw new TrustError('release manifest schema must be 1')
  if (typeof object.manifestType !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(object.manifestType)) {
    throw new TrustError('release manifest manifestType is invalid')
  }
  if (typeof object.version !== 'string' || object.version === '') {
    throw new TrustError('release manifest version is invalid')
  }
  return Object.freeze({
    document: object,
    keyringGeneration: positiveSafeInteger(object.keyringGeneration, 'release manifest keyringGeneration'),
    targetSequence: positiveSafeInteger(object.targetSequence, 'release manifest targetSequence'),
    issuedAt: isoTimestamp(object.issuedAt, 'release manifest issuedAt'),
    artifacts: parseArtifactList(object.artifacts, 'release manifest artifacts'),
  })
}
