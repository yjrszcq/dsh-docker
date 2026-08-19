import { TrustError } from './validation.mjs'

function normalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TrustError('canonical JSON numbers must be safe integers')
    return value
  }
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'object') {
    const result = {}
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new TrustError('canonical JSON cannot contain undefined')
      result[key] = normalize(value[key])
    }
    return result
  }
  throw new TrustError(`canonical JSON cannot contain ${typeof value}`)
}

export function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(normalize(value))}\n`)
}
