import { exactKeys, parseJsonDocument, TrustError } from './validation.mjs'

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function parseSemver(value, label) {
  if (typeof value !== 'string') throw new TrustError(`${label} must be a semantic version`)
  const match = SEMVER.exec(value)
  if (match === null) throw new TrustError(`${label} must be a semantic version`)
  const prerelease = match[4] === undefined ? [] : match[4].split('.')
  for (const identifier of prerelease) {
    if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0')) {
      throw new TrustError(`${label} has an invalid numeric prerelease identifier`)
    }
  }
  return {
    core: match.slice(1, 4),
    prerelease,
  }
}

function compareNumeric(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) return compareNumeric(left, right)
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function compareDshVersions(leftValue, rightValue) {
  const left = parseSemver(leftValue, 'left DSH version')
  const right = parseSemver(rightValue, 'right DSH version')
  for (let index = 0; index < left.core.length; index += 1) {
    const compared = compareNumeric(left.core[index], right.core[index])
    if (compared !== 0) return compared
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1
    if (right.prerelease[index] === undefined) return 1
    const compared = compareIdentifier(left.prerelease[index], right.prerelease[index])
    if (compared !== 0) return Math.sign(compared)
  }
  return 0
}

export function parseSupportedTarget(bytes) {
  const object = parseJsonDocument(bytes, 'supported target')
  exactKeys(object, ['environment', 'latestSupportedDsh', 'schema'], 'supported target')
  if (object.schema !== 1) throw new TrustError('supported target schema must be 1')
  parseSemver(object.latestSupportedDsh, 'latestSupportedDsh')
  if (typeof object.environment !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(object.environment)) {
    throw new TrustError('supported target environment is invalid')
  }
  return Object.freeze({
    schema: 1,
    latestSupportedDsh: object.latestSupportedDsh,
    environment: object.environment,
  })
}

export function validateSupportedTarget(targetBytes, environmentDefinitionBytes) {
  const target = parseSupportedTarget(targetBytes)
  const definition = parseJsonDocument(environmentDefinitionBytes, 'environment definition')
  if (definition.version !== target.environment) {
    throw new TrustError(`supported Environment ${JSON.stringify(target.environment)} does not match definition ${JSON.stringify(definition.version)}`)
  }
  return target
}

export function advanceSupportedDsh(target, upstreamVersion) {
  parseSemver(upstreamVersion, 'upstream DSH version')
  const comparison = compareDshVersions(upstreamVersion, target.latestSupportedDsh)
  if (comparison < 0) throw new TrustError('upstream DSH version would roll back Latest Supported')
  if (comparison === 0) return Object.freeze({ changed: false, target })
  return Object.freeze({
    changed: true,
    target: Object.freeze({ ...target, latestSupportedDsh: upstreamVersion }),
  })
}
