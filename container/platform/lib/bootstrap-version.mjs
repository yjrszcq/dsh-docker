export function parseBootstrapVersion(value, label = 'Bootstrap VERSION') {
  if (typeof value !== 'string') throw new Error(`${label} is invalid`)
  const normalized = value.endsWith('\r\n')
    ? value.slice(0, -2)
    : value.endsWith('\n') ? value.slice(0, -1) : value
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`${label} is invalid`)
  }
  if (normalized.split('.').some(part => !Number.isSafeInteger(Number(part)))) {
    throw new Error(`${label} is invalid`)
  }
  return normalized
}

function compareBootstrapVersions(left, right) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index]
  }
  return 0
}

export function validateBootstrapContentTransition({ previousVersion, previousSha256, nextVersion, nextSha256 }) {
  parseBootstrapVersion(previousVersion, 'previous Bootstrap version')
  parseBootstrapVersion(nextVersion, 'next Bootstrap version')
  if (previousSha256 === nextSha256) return
  if (compareBootstrapVersions(nextVersion, previousVersion) <= 0) {
    throw new Error('Bootstrap content changed without increasing Bootstrap VERSION')
  }
}
