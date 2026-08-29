import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { AccessError } from './errors.mjs'

const scrypt = promisify(scryptCallback)
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u
const CONTROL_CHARACTERS = /\p{Cc}/u

export const SCRYPT_POLICY = Object.freeze({ N: 32768, r: 8, p: 1, keyLength: 32, maxmem: 64 * 1024 * 1024 })

function codePoints(value) { return [...value].length }

export function normalizeUsername(input) {
  if (typeof input !== 'string') throw new AccessError('USERNAME_INVALID', 'username is invalid')
  const value = input.trim().normalize('NFC')
  const bytes = Buffer.byteLength(value, 'utf8')
  if (value.length === 0 || codePoints(value) > 64 || bytes > 256
    || CONTROL_CHARACTERS.test(value) || BIDI_CONTROLS.test(value)) {
    throw new AccessError('USERNAME_INVALID', 'username is invalid')
  }
  return value
}

export function normalizePassword(input) {
  if (typeof input !== 'string') throw new AccessError('PASSWORD_POLICY_VIOLATION', 'password does not meet policy')
  const value = input.normalize('NFC')
  const length = codePoints(value)
  if (length < 8 || length > 1024 || Buffer.byteLength(value, 'utf8') > 1024
    || CONTROL_CHARACTERS.test(value) || BIDI_CONTROLS.test(value)) {
    throw new AccessError('PASSWORD_POLICY_VIOLATION', 'password does not meet policy')
  }
  return value
}

function validParameters(value) {
  return value !== null && typeof value === 'object'
    && Number.isInteger(value.N) && value.N >= 2
    && Number.isInteger(value.r) && value.r > 0
    && Number.isInteger(value.p) && value.p > 0
    && Number.isInteger(value.keyLength) && value.keyLength >= 16
    && Number.isInteger(value.maxmem) && value.maxmem >= 1024 * 1024
}

export async function createCredential(password, {
  version = 1,
  policy = SCRYPT_POLICY,
  now = () => new Date(),
  random = randomBytes,
  derive = scrypt,
} = {}) {
  const normalized = normalizePassword(password)
  const salt = random(16)
  const hash = await derive(normalized, salt, policy.keyLength, {
    N: policy.N, r: policy.r, p: policy.p, maxmem: policy.maxmem,
  })
  return Object.freeze({
    version,
    algorithm: 'scrypt',
    parameters: { ...policy },
    salt: Buffer.from(salt).toString('base64url'),
    hash: Buffer.from(hash).toString('base64url'),
    changedAt: now().toISOString(),
  })
}

export function validCredential(value) {
  if (value === null || typeof value !== 'object' || value.algorithm !== 'scrypt'
    || !Number.isInteger(value.version) || value.version < 1 || !validParameters(value.parameters)
    || typeof value.salt !== 'string' || typeof value.hash !== 'string'
    || typeof value.changedAt !== 'string') return false
  try {
    return Buffer.from(value.salt, 'base64url').byteLength >= 16
      && Buffer.from(value.hash, 'base64url').byteLength === value.parameters.keyLength
      && Number.isFinite(Date.parse(value.changedAt))
  } catch { return false }
}

export async function verifyCredential(password, credential, { derive = scrypt } = {}) {
  if (!validCredential(credential)) return false
  let normalized
  try { normalized = normalizePassword(password) } catch { return false }
  const expected = Buffer.from(credential.hash, 'base64url')
  const salt = Buffer.from(credential.salt, 'base64url')
  const parameters = credential.parameters
  const actual = Buffer.from(await derive(normalized, salt, parameters.keyLength, {
    N: parameters.N, r: parameters.r, p: parameters.p, maxmem: parameters.maxmem,
  }))
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
}
