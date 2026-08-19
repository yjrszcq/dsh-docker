import { createHash } from 'node:crypto'
import { canonicalJson } from './canonical-json.mjs'
import { exactKeys, parseJsonDocument, plainObject, TrustError } from './validation.mjs'

export const PLATFORM_LAYOUT = 1
export const BOOTSTRAP_API = 1
export const UPDATE_API = 1

const REFERENCE_KINDS = new Set([
  'bootstrap',
  'environment',
  'pristine',
  'runtime',
  'system-plugins',
])
const AUTHORITIES = new Set(['stable', 'experimental', 'development'])
const SHA256 = /^[a-f0-9]{64}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const IMAGE_BUILD_ID = /^sha256:[a-f0-9]{64}$/

function identifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new TrustError(`${label} is invalid`)
  return value
}

function sha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new TrustError(`${label} must be a SHA-256 hex digest`)
  return value
}

function imageBuildId(value, label = 'imageBuildId') {
  if (typeof value !== 'string' || !IMAGE_BUILD_ID.test(value)) throw new TrustError(`${label} is invalid`)
  return value
}

function version(value, label) {
  if (typeof value !== 'string' || value === '' || value.length > 128 || /[\0/\\]/.test(value)) {
    throw new TrustError(`${label} is invalid`)
  }
  return value
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TrustError(`${label} must be a non-negative safe integer`)
  return value
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TrustError(`${label} must be a positive safe integer`)
  return value
}

function authority(value, sequence, label = 'authority') {
  if (!AUTHORITIES.has(value)) throw new TrustError(`${label} is invalid`)
  if (value === 'development' && sequence !== 0) throw new TrustError('development authority requires targetSequence 0')
  if (value !== 'development' && sequence === 0) throw new TrustError(`${value} authority requires a positive targetSequence`)
  return value
}

function parseBytesOrObject(value, label) {
  return Buffer.isBuffer(value) ? parseJsonDocument(value, label) : plainObject(value, label)
}

function contentHash(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export function deriveRecordId(prefix, recordWithoutId) {
  identifier(prefix, 'record prefix')
  return `${prefix}-${contentHash(recordWithoutId)}`
}

export function deriveImageBuildId(inventoryWithoutId) {
  return `sha256:${contentHash(inventoryWithoutId)}`
}

function parseInventoryAsset(value, kind, label) {
  const object = plainObject(value, label)
  exactKeys(object, ['id', 'sha256'], label)
  return Object.freeze({
    id: identifier(object.id, `${label}.id`),
    sha256: sha256(object.sha256, `${label}.sha256`),
    kind,
  })
}

export function parseArtifactReference(value, label = 'artifact reference') {
  const object = plainObject(value, label)
  if (object.storage === 'image') {
    exactKeys(object, ['id', 'imageBuildId', 'kind', 'sha256', 'storage'], label)
    imageBuildId(object.imageBuildId, `${label}.imageBuildId`)
  } else if (object.storage === 'store') {
    exactKeys(object, ['id', 'kind', 'sha256', 'storage'], label)
  } else {
    throw new TrustError(`${label}.storage must be image or store`)
  }
  if (!REFERENCE_KINDS.has(object.kind)) throw new TrustError(`${label}.kind is invalid`)
  return Object.freeze({
    storage: object.storage,
    ...(object.storage === 'image' ? { imageBuildId: object.imageBuildId } : {}),
    kind: object.kind,
    id: identifier(object.id, `${label}.id`),
    sha256: sha256(object.sha256, `${label}.sha256`),
  })
}

export function parseImageInventory(value) {
  const object = parseBytesOrObject(value, 'image inventory')
  exactKeys(object, [
    'authority', 'bootstrap', 'bootstrapApi', 'deployment', 'imageBuildId', 'platformRevision',
    'schema', 'targetSequence', 'updateApi',
  ], 'image inventory')
  if (object.schema !== 1) throw new TrustError('image inventory schema must be 1')
  if (object.bootstrapApi !== BOOTSTRAP_API) throw new TrustError('image inventory bootstrapApi must be 1')
  if (object.updateApi !== UPDATE_API) throw new TrustError('image inventory updateApi must be 1')
  const targetSequence = nonNegativeInteger(object.targetSequence, 'image inventory targetSequence')
  const parsedAuthority = authority(object.authority, targetSequence, 'image inventory authority')
  identifier(object.platformRevision, 'image inventory platformRevision')

  const bootstrap = plainObject(object.bootstrap, 'image inventory bootstrap')
  exactKeys(bootstrap, ['id', 'sha256', 'version'], 'image inventory bootstrap')
  const parsedBootstrap = Object.freeze({
    version: version(bootstrap.version, 'image inventory bootstrap.version'),
    ...parseInventoryAsset({ id: bootstrap.id, sha256: bootstrap.sha256 }, 'bootstrap', 'image inventory bootstrap artifact'),
  })

  const deployment = plainObject(object.deployment, 'image inventory deployment')
  exactKeys(deployment, [
    'dshVersion', 'environment', 'environmentVersion', 'id', 'pristine', 'runtime', 'systemPlugins',
  ], 'image inventory deployment')
  const parsedDeployment = Object.freeze({
    id: identifier(deployment.id, 'image inventory deployment.id'),
    dshVersion: version(deployment.dshVersion, 'image inventory deployment.dshVersion'),
    environmentVersion: version(deployment.environmentVersion, 'image inventory deployment.environmentVersion'),
    environment: parseInventoryAsset(deployment.environment, 'environment', 'image inventory deployment.environment'),
    pristine: parseInventoryAsset(deployment.pristine, 'pristine', 'image inventory deployment.pristine'),
    runtime: parseInventoryAsset(deployment.runtime, 'runtime', 'image inventory deployment.runtime'),
    systemPlugins: parseInventoryAsset(deployment.systemPlugins, 'system-plugins', 'image inventory deployment.systemPlugins'),
  })

  const withoutId = { ...object }
  delete withoutId.imageBuildId
  const expected = deriveImageBuildId(withoutId)
  imageBuildId(object.imageBuildId)
  if (object.imageBuildId !== expected) throw new TrustError('image inventory imageBuildId does not match its canonical content')

  return Object.freeze({
    schema: 1,
    imageBuildId: object.imageBuildId,
    authority: parsedAuthority,
    platformRevision: object.platformRevision,
    targetSequence,
    bootstrapApi: BOOTSTRAP_API,
    updateApi: UPDATE_API,
    bootstrap: parsedBootstrap,
    deployment: parsedDeployment,
    document: Object.freeze(object),
  })
}

function parseRecord(value, label, fields) {
  const object = parseBytesOrObject(value, label)
  exactKeys(object, ['id', 'schema', ...fields], label)
  if (object.schema !== 1) throw new TrustError(`${label} schema must be 1`)
  return object
}

function verifyRecordId(object, prefix, label) {
  const withoutId = { ...object }
  delete withoutId.id
  const expected = deriveRecordId(prefix, withoutId)
  if (object.id !== expected) throw new TrustError(`${label} id does not match its canonical content`)
  return object.id
}

export function parseBootstrapRecord(value) {
  const object = parseRecord(value, 'Bootstrap Record', [
    'artifact', 'bootstrapApi', 'targetSequence', 'version',
  ])
  if (object.bootstrapApi !== BOOTSTRAP_API) throw new TrustError('Bootstrap Record bootstrapApi must be 1')
  const parsed = {
    schema: 1,
    id: object.id,
    version: version(object.version, 'Bootstrap Record version'),
    bootstrapApi: BOOTSTRAP_API,
    targetSequence: nonNegativeInteger(object.targetSequence, 'Bootstrap Record targetSequence'),
    artifact: parseArtifactReference(object.artifact, 'Bootstrap Record artifact'),
  }
  verifyRecordId(object, 'bootstrap-record', 'Bootstrap Record')
  return Object.freeze(parsed)
}

function stringList(value, label) {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string' || entry === '' || entry.includes('\0'))) {
    throw new TrustError(`${label} must be a string array`)
  }
  if (new Set(value).size !== value.length) throw new TrustError(`${label} must not contain duplicates`)
  return Object.freeze([...value])
}

export function parseDeploymentRecord(value) {
  const object = parseRecord(value, 'Deployment Record', [
    'authority', 'dshVersion', 'environment', 'environmentVersion', 'pristine', 'receiptTokens',
    'runtime', 'snapshotId', 'systemPlugins', 'targetSequence',
  ])
  const targetSequence = nonNegativeInteger(object.targetSequence, 'Deployment Record targetSequence')
  const parsed = {
    schema: 1,
    id: object.id,
    authority: authority(object.authority, targetSequence, 'Deployment Record authority'),
    targetSequence,
    dshVersion: version(object.dshVersion, 'Deployment Record dshVersion'),
    environmentVersion: version(object.environmentVersion, 'Deployment Record environmentVersion'),
    environment: parseArtifactReference(object.environment, 'Deployment Record environment'),
    pristine: parseArtifactReference(object.pristine, 'Deployment Record pristine'),
    runtime: parseArtifactReference(object.runtime, 'Deployment Record runtime'),
    systemPlugins: parseArtifactReference(object.systemPlugins, 'Deployment Record systemPlugins'),
    receiptTokens: stringList(object.receiptTokens, 'Deployment Record receiptTokens'),
    snapshotId: object.snapshotId === null ? null : identifier(object.snapshotId, 'Deployment Record snapshotId'),
  }
  if (parsed.environment.kind !== 'environment' || parsed.pristine.kind !== 'pristine'
    || parsed.runtime.kind !== 'runtime' || parsed.systemPlugins.kind !== 'system-plugins') {
    throw new TrustError('Deployment Record references use the wrong kind')
  }
  const imageIds = [parsed.environment, parsed.pristine, parsed.runtime, parsed.systemPlugins]
    .filter(reference => reference.storage === 'image')
    .map(reference => reference.imageBuildId)
  if (new Set(imageIds).size > 1) throw new TrustError('Deployment Record image references must use one imageBuildId')
  verifyRecordId(object, 'deployment-record', 'Deployment Record')
  return Object.freeze(parsed)
}

export function parseSlots(value, recordPrefix, label = 'slots') {
  const object = parseBytesOrObject(value, label)
  exactKeys(object, ['current', 'generation', 'previous', 'schema'], label)
  if (object.schema !== 1) throw new TrustError(`${label} schema must be 1`)
  const parseId = (entry, field) => entry === null ? null : identifier(entry, `${label}.${field}`)
  const current = parseId(object.current, 'current')
  const previous = parseId(object.previous, 'previous')
  if (current === null) throw new TrustError(`${label}.current must not be null`)
  if (!current.startsWith(`${recordPrefix}-`) || (previous !== null && !previous.startsWith(`${recordPrefix}-`))) {
    throw new TrustError(`${label} contains an unexpected Record ID`)
  }
  if (current === previous) throw new TrustError(`${label} current and previous must differ`)
  return Object.freeze({ schema: 1, generation: positiveInteger(object.generation, `${label}.generation`), current, previous })
}

function withRecordId(prefix, content) {
  const document = { ...content }
  return Object.freeze({ ...document, id: deriveRecordId(prefix, document) })
}

export function recordsFromImageInventory(value) {
  const inventory = value?.document === undefined ? parseImageInventory(value) : value
  const imageReference = asset => ({
    storage: 'image',
    imageBuildId: inventory.imageBuildId,
    kind: asset.kind,
    id: asset.id,
    sha256: asset.sha256,
  })
  const bootstrap = withRecordId('bootstrap-record', {
    schema: 1,
    version: inventory.bootstrap.version,
    bootstrapApi: BOOTSTRAP_API,
    targetSequence: inventory.targetSequence,
    artifact: imageReference(inventory.bootstrap),
  })
  const deployment = withRecordId('deployment-record', {
    schema: 1,
    authority: inventory.authority,
    targetSequence: inventory.targetSequence,
    dshVersion: inventory.deployment.dshVersion,
    environmentVersion: inventory.deployment.environmentVersion,
    environment: imageReference(inventory.deployment.environment),
    pristine: imageReference(inventory.deployment.pristine),
    runtime: imageReference(inventory.deployment.runtime),
    systemPlugins: imageReference(inventory.deployment.systemPlugins),
    receiptTokens: [],
    snapshotId: null,
  })
  return Object.freeze({
    bootstrap: parseBootstrapRecord(bootstrap),
    deployment: parseDeploymentRecord(deployment),
  })
}
