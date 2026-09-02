import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const CODE_PATTERN = /^\d{6}$/

function digest(value) { return createHash('sha256').update(value).digest('hex') }

function token(prefix, random) { return `${prefix}_${random(32).toString('base64url')}` }

function base32Encode(value) {
  let bits = 0
  let buffer = 0
  let output = ''
  for (const byte of value) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31]
  return output
}

function base32Decode(value) {
  if (typeof value !== 'string' || value.length === 0 || /[^A-Z2-7]/u.test(value)) return undefined
  let bits = 0
  let buffer = 0
  const output = []
  for (const character of value) {
    buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(character)
    bits += 5
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(output)
}

function counterBuffer(counter) {
  const value = Buffer.alloc(8)
  value.writeBigUInt64BE(BigInt(counter))
  return value
}

export function generateTotpSecret(random = randomBytes) {
  return base32Encode(random(20))
}

export function validTotpSecret(secret) {
  return base32Decode(secret)?.byteLength === 20
}

export function totpCode(secret, { now = Date.now(), offset = 0 } = {}) {
  const key = base32Decode(secret)
  if (key?.byteLength !== 20) throw new TypeError('TOTP secret is invalid')
  const counter = Math.floor(now / 30_000) + offset
  const hmac = createHmac('sha1', key).update(counterBuffer(counter)).digest()
  const position = hmac.at(-1) & 15
  const value = (hmac.readUInt32BE(position) & 0x7fffffff) % 1_000_000
  return String(value).padStart(6, '0')
}

export function verifyTotpCode(code, secret, { now = Date.now(), window = 1 } = {}) {
  if (typeof code !== 'string' || !CODE_PATTERN.test(code)) return false
  const actual = Buffer.from(code)
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = Buffer.from(totpCode(secret, { now, offset }))
    if (timingSafeEqual(actual, expected)) return true
  }
  return false
}

export function totpUri({ secret, username, issuer = 'DSH Docker' }) {
  if (!validTotpSecret(secret)) throw new TypeError('TOTP secret is invalid')
  const label = `${issuer}:${username}`
  const query = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' })
  return `otpauth://totp/${encodeURIComponent(label)}?${query}`
}

export class TotpFlowStore {
  constructor({ now = Date.now, random = randomBytes, enrollmentTtlMs = 5 * 60_000, loginTtlMs = 5 * 60_000 } = {}) {
    this.now = now
    this.random = random
    this.enrollmentTtlMs = enrollmentTtlMs
    this.loginTtlMs = loginTtlMs
    this.enrollments = new Map()
    this.logins = new Map()
  }

  prune() {
    const current = this.now()
    for (const [key, value] of this.enrollments) if (value.expiresAt <= current) this.enrollments.delete(key)
    for (const [key, value] of this.logins) if (value.expiresAt <= current) this.logins.delete(key)
  }

  createEnrollment(account, sessionId) {
    this.prune()
    for (const [key, value] of this.enrollments) {
      if (value.accountId === account.accountId && value.sessionId === sessionId) this.enrollments.delete(key)
    }
    const value = token('dshte', this.random)
    const secret = generateTotpSecret(this.random)
    const expiresAt = this.now() + this.enrollmentTtlMs
    this.enrollments.set(digest(value), {
      accountId: account.accountId,
      accountRevision: account.revision,
      sessionId,
      secret,
      confirmed: false,
      expiresAt,
    })
    return Object.freeze({ token: value, secret, expiresAt: new Date(expiresAt).toISOString() })
  }

  enrollment(value, account, sessionId) {
    this.prune()
    if (typeof value !== 'string' || value.length > 512) return undefined
    const key = digest(value)
    const enrollment = this.enrollments.get(key)
    if (enrollment === undefined || enrollment.accountId !== account.accountId
      || enrollment.accountRevision !== account.revision || enrollment.sessionId !== sessionId) return undefined
    return { key, value: enrollment }
  }

  cancelEnrollment(value, account, sessionId) {
    const enrollment = this.enrollment(value, account, sessionId)
    return enrollment === undefined ? false : this.enrollments.delete(enrollment.key)
  }

  confirmEnrollment(key) {
    const enrollment = this.enrollments.get(key)
    if (enrollment === undefined) return false
    enrollment.confirmed = true
    return true
  }

  consumeEnrollment(key) { return this.enrollments.delete(key) }

  createLogin(account, details) {
    this.prune()
    const value = token('dshtl', this.random)
    const expiresAt = this.now() + this.loginTtlMs
    this.logins.set(digest(value), {
      accountId: account.accountId,
      accountRevision: account.revision,
      ...details,
      expiresAt,
    })
    return Object.freeze({ token: value, expiresAt: new Date(expiresAt).toISOString() })
  }

  login(value, account) {
    this.prune()
    if (typeof value !== 'string' || value.length > 512) return undefined
    const key = digest(value)
    const login = this.logins.get(key)
    if (login === undefined || login.accountId !== account.accountId
      || login.accountRevision !== account.revision) return undefined
    return { key, value: login }
  }

  consumeLogin(key) { return this.logins.delete(key) }

  clear() {
    this.enrollments.clear()
    this.logins.clear()
  }
}

export class TotpRetryLimiter {
  constructor({
    now = Date.now,
    threshold = 3,
    retryMs = 10_000,
    dailyWindowMs = 24 * 60 * 60_000,
    sourceDailyLimit = 25,
    globalDailyLimit = 50,
  } = {}) {
    this.now = now
    this.threshold = threshold
    this.retryMs = retryMs
    this.dailyWindowMs = dailyWindowMs
    this.sourceDailyLimit = sourceDailyLimit
    this.globalDailyLimit = globalDailyLimit
    this.entries = new Map()
    this.globalFailures = new Map()
  }

  key(accountId, source) { return `${accountId}\u0000${source}` }

  prune(values) {
    const cutoff = this.now() - this.dailyWindowMs
    while (values.length > 0 && values[0] <= cutoff) values.shift()
  }

  retry(accountId, source) {
    const entry = this.entries.get(this.key(accountId, source))
    const global = this.globalFailures.get(accountId) ?? []
    if (entry !== undefined) this.prune(entry.failuresInWindow)
    this.prune(global)
    const until = values => Math.max(1, Math.ceil((values[0] + this.dailyWindowMs - this.now()) / 1000))
    if (global.length >= this.globalDailyLimit) return { kind: 'rate', retryAfterSeconds: until(global) }
    if (entry?.failuresInWindow.length >= this.sourceDailyLimit) {
      return { kind: 'rate', retryAfterSeconds: until(entry.failuresInWindow) }
    }
    if (entry !== undefined && entry.blockedUntil > this.now()) {
      return { kind: 'retry', retryAfterSeconds: Math.max(1, Math.ceil((entry.blockedUntil - this.now()) / 1000)) }
    }
    return { kind: null, retryAfterSeconds: 0 }
  }

  fail(accountId, source) {
    const key = this.key(accountId, source)
    const entry = this.entries.get(key) ?? { consecutiveFailures: 0, blockedUntil: 0, failuresInWindow: [] }
    const global = this.globalFailures.get(accountId) ?? []
    this.prune(entry.failuresInWindow)
    this.prune(global)
    entry.consecutiveFailures += 1
    entry.failuresInWindow.push(this.now())
    global.push(this.now())
    if (entry.consecutiveFailures >= this.threshold) entry.blockedUntil = this.now() + this.retryMs
    this.entries.set(key, entry)
    this.globalFailures.set(accountId, global)
    return this.retry(accountId, source)
  }

  succeed(accountId, source) {
    const entry = this.entries.get(this.key(accountId, source))
    if (entry === undefined) return
    entry.consecutiveFailures = 0
    entry.blockedUntil = 0
  }

  clearDailyLimits(accountId, { globalOnly = false } = {}) {
    let cleared = this.globalFailures.delete(accountId) ? 1 : 0
    if (globalOnly) return { cleared }
    for (const [key, entry] of this.entries) {
      if (!key.startsWith(`${accountId}\u0000`)) continue
      if (entry.failuresInWindow.length > 0) {
        entry.failuresInWindow = []
        cleared += 1
      }
    }
    return { cleared }
  }
}
