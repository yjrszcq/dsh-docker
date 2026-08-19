export class TrustError extends Error {
  constructor(message, code = 'TRUST_INVALID') {
    super(message)
    this.name = 'TrustError'
    this.code = code
  }
}

export function plainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TrustError(`${label} must be an object`)
  }
  return value
}

export function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TrustError(`${label} fields must be exactly: ${wanted.join(', ')}`)
  }
}

export function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TrustError(`${label} must be a positive safe integer`)
  }
  return value
}

export function isoTimestamp(value, label) {
  if (typeof value !== 'string') throw new TrustError(`${label} must be an ISO timestamp`)
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new TrustError(`${label} must be a canonical ISO timestamp`)
  }
  return value
}

export function parseJsonDocument(bytes, label) {
  if (!Buffer.isBuffer(bytes)) throw new TrustError(`${label} must be bytes`)
  let value
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new TrustError(`${label} must contain valid JSON`)
  }
  return plainObject(value, label)
}
