import { createHash, timingSafeEqual } from 'node:crypto'

export const BASIC_AUTH_CHALLENGE = 'Basic realm="DeepSeek Harness", charset="UTF-8"'

function digest(value) {
  return createHash('sha256').update(value).digest()
}

function credentialsFromAuthorization(header) {
  if (typeof header !== 'string') return undefined
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header)
  if (match === null || match[1].length % 4 !== 0) return undefined
  const credentials = Buffer.from(match[1], 'base64').toString('utf8')
  const separator = credentials.indexOf(':')
  return separator < 0 ? undefined : {
    username: credentials.slice(0, separator),
    password: credentials.slice(separator + 1),
  }
}

function sendText(response, status, message, headers = {}) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    ...headers,
  })
  response.end(`${message}\n`)
}

export class LoginRateLimiter {
  constructor({
    attempts = 5,
    globalAttempts = 100,
    maxClients = 1024,
    windowMs = 60_000,
    now = Date.now,
  } = {}) {
    this.attempts = attempts
    this.globalAttempts = globalAttempts
    this.maxClients = maxClients
    this.windowMs = windowMs
    this.now = now
    this.clients = new Map()
    this.global = { count: 0, resetAt: 0 }
  }

  allow(client) {
    const now = this.now()
    if (this.global.resetAt <= now) this.global = { count: 0, resetAt: now + this.windowMs }
    this.global.count += 1
    if (this.global.count > this.globalAttempts) return false

    const current = this.clients.get(client)
    if (current === undefined || current.resetAt <= now) {
      if (this.clients.size >= this.maxClients) {
        for (const [key, value] of this.clients) {
          if (value.resetAt <= now) this.clients.delete(key)
        }
      }
      if (!this.clients.has(client) && this.clients.size >= this.maxClients) return false
      this.clients.set(client, { count: 1, resetAt: now + this.windowMs })
      return true
    }
    current.count += 1
    return current.count <= this.attempts
  }

  reset(client) {
    this.clients.delete(client)
  }
}

export function createPasswordAccess(password, {
  rateLimiter = new LoginRateLimiter(),
  username = '',
} = {}) {
  const enabled = password !== ''
  const passwordDigest = digest(password)
  const usernameDigest = digest(username)

  function isAuthenticated(request) {
    if (!enabled) return true
    const supplied = credentialsFromAuthorization(request.headers.authorization)
    if (supplied === undefined) return false
    const passwordMatches = timingSafeEqual(digest(supplied.password), passwordDigest)
    const usernameMatches = timingSafeEqual(digest(supplied.username), usernameDigest)
    return passwordMatches && (username === '' || usernameMatches)
  }

  function handleHttp(request, response) {
    if (!enabled) return false
    const client = request.socket.remoteAddress ?? 'unknown'
    if (isAuthenticated(request)) {
      rateLimiter.reset(client)
      return false
    }
    if (!rateLimiter.allow(client)) {
      sendText(response, 429, 'too many authentication attempts', { 'retry-after': '60' })
      return true
    }
    sendText(response, 401, 'authentication required', {
      'www-authenticate': BASIC_AUTH_CHALLENGE,
    })
    return true
  }

  return Object.freeze({
    enabled,
    handleHttp,
    isAuthenticated,
  })
}
