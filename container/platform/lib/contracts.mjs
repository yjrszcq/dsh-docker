import { exactKeys, isoTimestamp, parseJsonDocument, plainObject, positiveSafeInteger, TrustError } from './validation.mjs'
import { parseArtifactList } from '../stage0/lib/artifacts.mjs'

function identifier(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value)) {
    throw new TrustError(`${label} is invalid`)
  }
  return value
}

function version(value, label) {
  if (typeof value !== 'string' || value === '' || value.length > 128 || /[\0/\\]/.test(value)) {
    throw new TrustError(`${label} is invalid`)
  }
  return value
}

function exactReference(value, label) {
  const object = plainObject(value, label)
  exactKeys(object, ['manifestArtifactId', 'signatureArtifactId', 'version'], label)
  const manifestArtifactId = identifier(object.manifestArtifactId, `${label}.manifestArtifactId`)
  const signatureArtifactId = identifier(object.signatureArtifactId, `${label}.signatureArtifactId`)
  if (manifestArtifactId === signatureArtifactId) throw new TrustError(`${label} manifest and signature Artifacts must differ`)
  return Object.freeze({
    version: version(object.version, `${label}.version`),
    manifestArtifactId,
    signatureArtifactId,
  })
}

function dshReference(value) {
  const object = plainObject(value, 'stable.desired.dsh')
  exactKeys(object, ['integrity', 'version'], 'stable.desired.dsh')
  if (typeof object.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(object.integrity)) {
    throw new TrustError('stable.desired.dsh.integrity must be npm SHA-512 integrity')
  }
  return Object.freeze({
    version: version(object.version, 'stable.desired.dsh.version'),
    integrity: object.integrity,
  })
}

function registryKey(value, label) {
  const object = plainObject(value, label)
  exactKeys(object, ['algorithm', 'expires', 'keyId', 'publicKey'], label)
  if (object.algorithm !== 'ECDSA-P256-SHA256') throw new TrustError(`${label}.algorithm is unsupported`)
  if (typeof object.keyId !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(object.keyId)) {
    throw new TrustError(`${label}.keyId is invalid`)
  }
  if (typeof object.publicKey !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(object.publicKey)) {
    throw new TrustError(`${label}.publicKey is invalid`)
  }
  if (object.expires !== null) isoTimestamp(object.expires, `${label}.expires`)
  return Object.freeze({ ...object })
}

export function parseOfficialDshPolicy(value, label = 'official DSH policy') {
  const object = plainObject(value, label)
  exactKeys(object, ['keys', 'packageName', 'registry'], label)
  if (object.registry !== 'https://registry.npmjs.org/') {
    throw new TrustError(`${label}.registry must be the official npm registry`)
  }
  if (object.packageName !== '@deepseek-ai/dsh') {
    throw new TrustError(`${label}.packageName must be @deepseek-ai/dsh`)
  }
  if (!Array.isArray(object.keys) || object.keys.length === 0) throw new TrustError(`${label}.keys must not be empty`)
  const keys = object.keys.map((entry, index) => registryKey(entry, `${label}.keys[${String(index)}]`))
  if (new Set(keys.map(key => key.keyId)).size !== keys.length) throw new TrustError(`${label}.keys must be unique`)
  return Object.freeze({ registry: object.registry, packageName: object.packageName, keys: Object.freeze(keys) })
}

export function parseStable(bytes) {
  const object = parseJsonDocument(bytes, 'stable')
  exactKeys(
    object,
    ['artifacts', 'desired', 'issuedAt', 'keyringGeneration', 'officialDshPolicy', 'schema', 'targetSequence', 'updateApi'],
    'stable',
  )
  if (object.schema !== 1) throw new TrustError('stable.schema must be 1')
  if (object.updateApi !== 1) throw new TrustError('stable.updateApi must be 1')
  const desired = plainObject(object.desired, 'stable.desired')
  exactKeys(desired, ['bootstrap', 'dsh', 'environment'], 'stable.desired')
  const artifacts = parseArtifactList(object.artifacts, 'stable.artifacts')
  const parsedDesired = Object.freeze({
    bootstrap: exactReference(desired.bootstrap, 'stable.desired.bootstrap'),
    environment: exactReference(desired.environment, 'stable.desired.environment'),
    dsh: dshReference(desired.dsh),
  })
  const artifactIds = new Set(artifacts.map(artifact => artifact.id))
  for (const artifactId of [
    parsedDesired.bootstrap.manifestArtifactId,
    parsedDesired.bootstrap.signatureArtifactId,
    parsedDesired.environment.manifestArtifactId,
    parsedDesired.environment.signatureArtifactId,
  ]) {
    if (!artifactIds.has(artifactId)) throw new TrustError(`stable desired Artifact ${JSON.stringify(artifactId)} is missing`)
  }
  return Object.freeze({
    document: object,
    keyringGeneration: positiveSafeInteger(object.keyringGeneration, 'stable.keyringGeneration'),
    targetSequence: positiveSafeInteger(object.targetSequence, 'stable.targetSequence'),
    issuedAt: isoTimestamp(object.issuedAt, 'stable.issuedAt'),
    artifacts,
    desired: parsedDesired,
    officialDshPolicy: parseOfficialDshPolicy(object.officialDshPolicy),
  })
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string' || entry.includes('\0'))) {
    throw new TrustError(`${label} must be a string array`)
  }
  return Object.freeze([...value])
}

function stringMap(value, label) {
  const object = plainObject(value, label)
  const result = {}
  for (const [key, entry] of Object.entries(object)) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || typeof entry !== 'string' || entry.includes('\0')) {
      throw new TrustError(`${label} contains an invalid environment entry`)
    }
    result[key] = entry
  }
  return Object.freeze(result)
}

function command(value, label) {
  const object = plainObject(value, label)
  exactKeys(object, ['args', 'executable', 'timeoutSeconds'], label)
  if (typeof object.executable !== 'string' || !object.executable.startsWith('/')) {
    throw new TrustError(`${label}.executable must be an absolute path`)
  }
  return Object.freeze({
    executable: object.executable,
    args: stringArray(object.args, `${label}.args`),
    timeoutSeconds: positiveSafeInteger(object.timeoutSeconds, `${label}.timeoutSeconds`),
  })
}

function optionalCommand(value, label) {
  return value === null ? null : command(value, label)
}

function parseHealth(value) {
  if (value === null) return null
  const object = plainObject(value, 'component.health')
  if (object.type === 'http') {
    exactKeys(object, ['host', 'intervalSeconds', 'path', 'port', 'timeoutSeconds', 'type'], 'component.health')
    if (object.host !== '127.0.0.1') throw new TrustError('HTTP health host must be 127.0.0.1')
    if (!Number.isInteger(object.port) || object.port < 1 || object.port > 65535) throw new TrustError('HTTP health port is invalid')
    if (typeof object.path !== 'string' || !object.path.startsWith('/')) throw new TrustError('HTTP health path is invalid')
  } else if (object.type === 'exec') {
    exactKeys(object, ['command', 'intervalSeconds', 'timeoutSeconds', 'type'], 'component.health')
    command(object.command, 'component.health.command')
  } else throw new TrustError('component.health.type must be http or exec')
  positiveSafeInteger(object.intervalSeconds, 'component.health.intervalSeconds')
  positiveSafeInteger(object.timeoutSeconds, 'component.health.timeoutSeconds')
  return Object.freeze(object)
}

export function parseComponentManifest(bytes) {
  const object = parseJsonDocument(bytes, 'component')
  exactKeys(
    object,
    ['command', 'environment', 'health', 'id', 'lifecycle', 'logging', 'schema', 'type'],
    'component',
  )
  if (object.schema !== 1) throw new TrustError('component.schema must be 1')
  if (!['service', 'oneshot', 'hook'].includes(object.type)) throw new TrustError('component.type is invalid')
  const lifecycle = plainObject(object.lifecycle, 'component.lifecycle')
  const phases = ['prepare', 'postStart', 'postStop', 'preStart', 'preStop', 'stop']
  exactKeys(lifecycle, phases, 'component.lifecycle')
  const logging = plainObject(object.logging, 'component.logging')
  exactKeys(logging, ['stderr', 'stdout'], 'component.logging')
  if (typeof logging.stdout !== 'boolean' || typeof logging.stderr !== 'boolean') {
    throw new TrustError('component logging flags must be booleans')
  }
  return Object.freeze({
    schema: object.schema,
    id: identifier(object.id, 'component.id'),
    type: object.type,
    command: command(object.command, 'component.command'),
    environment: stringMap(object.environment, 'component.environment'),
    lifecycle: Object.freeze(Object.fromEntries(phases.map(phase => [
      phase,
      optionalCommand(lifecycle[phase], `component.lifecycle.${phase}`),
    ]))),
    health: parseHealth(object.health),
    logging: Object.freeze({ stdout: logging.stdout, stderr: logging.stderr }),
  })
}

function orderedReferences(value, artifacts, label) {
  if (!Array.isArray(value)) throw new TrustError(`${label} must be an array`)
  const result = value.map((entry, index) => {
    const object = plainObject(entry, `${label}[${String(index)}]`)
    exactKeys(object, ['id', 'sha256'], `${label}[${String(index)}]`)
    if (typeof object.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(object.sha256)) {
      throw new TrustError(`${label}[${String(index)}].sha256 must be a SHA-256 hex digest`)
    }
    if (!artifacts.some(artifact => artifact.sha256 === object.sha256)) {
      throw new TrustError(`${label}[${String(index)}] references a missing Artifact hash`)
    }
    return Object.freeze({
      id: identifier(object.id, `${label}[${String(index)}].id`),
      sha256: object.sha256,
    })
  })
  if (new Set(result.map(item => item.id)).size !== result.length) throw new TrustError(`${label} IDs must be unique`)
  return Object.freeze(result)
}

export function parseBootstrapManifest(bytes) {
  const manifest = parseCommonManifest(bytes, 'bootstrap')
  exactKeys(manifest.object, [...manifest.commonKeys, 'bootstrapApi', 'entrypoint'], 'bootstrap manifest')
  if (manifest.object.bootstrapApi !== 1) throw new TrustError('bootstrapApi must be 1')
  if (typeof manifest.object.entrypoint !== 'string' || !manifest.object.entrypoint.startsWith('/')) {
    throw new TrustError('bootstrap entrypoint must be absolute')
  }
  return Object.freeze({ ...manifest.common, bootstrapApi: 1, entrypoint: manifest.object.entrypoint })
}

export function parseEnvironmentManifest(bytes) {
  const manifest = parseCommonManifest(bytes, 'environment')
  exactKeys(
    manifest.object,
    [...manifest.commonKeys, 'bootstrapApi', 'components', 'patches', 'systemPlugins'],
    'environment manifest',
  )
  if (manifest.object.bootstrapApi !== 1) throw new TrustError('environment bootstrapApi must be 1')
  return Object.freeze({
    ...manifest.common,
    bootstrapApi: 1,
    components: orderedReferences(manifest.object.components, manifest.common.artifacts, 'environment components'),
    patches: orderedReferences(manifest.object.patches, manifest.common.artifacts, 'environment patches'),
    systemPlugins: orderedReferences(manifest.object.systemPlugins, manifest.common.artifacts, 'environment systemPlugins'),
  })
}

export function artifactForReference(manifest, reference) {
  const artifact = manifest.artifacts.find(candidate => candidate.sha256 === reference.sha256)
  if (artifact === undefined) throw new TrustError(`resource ${JSON.stringify(reference.id)} references a missing Artifact hash`)
  return artifact
}

function parseCommonManifest(bytes, expectedType) {
  const object = parseJsonDocument(bytes, `${expectedType} manifest`)
  const commonKeys = ['artifacts', 'issuedAt', 'keyringGeneration', 'manifestType', 'schema', 'targetSequence', 'version']
  if (object.schema !== 1) throw new TrustError(`${expectedType} manifest schema must be 1`)
  if (object.manifestType !== expectedType) throw new TrustError(`manifestType must be ${expectedType}`)
  return {
    object,
    commonKeys,
    common: {
      schema: 1,
      manifestType: expectedType,
      version: version(object.version, `${expectedType} manifest version`),
      keyringGeneration: positiveSafeInteger(object.keyringGeneration, `${expectedType} keyringGeneration`),
      targetSequence: positiveSafeInteger(object.targetSequence, `${expectedType} targetSequence`),
      issuedAt: isoTimestamp(object.issuedAt, `${expectedType} issuedAt`),
      artifacts: parseArtifactList(object.artifacts, `${expectedType} artifacts`),
    },
  }
}
