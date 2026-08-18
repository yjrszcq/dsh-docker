import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const LOGIN_PATH = '/_dsh_gateway/login'
export const LOGOUT_PATH = '/_dsh_gateway/logout'
export const SESSION_COOKIE = 'dsh_gateway_session'

const MAX_FORM_BYTES = 4096

function digest(value) {
  return createHash('sha256').update(value).digest()
}

function constantTimeEqual(left, right) {
  return timingSafeEqual(digest(left), digest(right))
}

function parseCookies(header) {
  const cookies = new Map()
  if (typeof header !== 'string') return cookies
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim())
  }
  return cookies
}

function isSecureRequest(request) {
  if (request.socket.encrypted === true) return true
  const forwarded = request.headers['x-forwarded-proto']
  return typeof forwarded === 'string' && forwarded.split(',', 1)[0].trim().toLowerCase() === 'https'
}

function sessionCookie(value, request, maxAge) {
  const attributes = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${String(maxAge)}`,
  ]
  if (isSecureRequest(request)) attributes.push('Secure')
  return attributes.join('; ')
}

function safeReturnPath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/'
}

function sendText(response, status, message, headers = {}) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    ...headers,
  })
  response.end(`${message}\n`)
}

function renderLogin(returnTo, incorrect = false) {
  const escapedReturn = returnTo.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  const error = incorrect ? '<p role="alert">密码不正确，请重试。</p>' : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH 访问验证</title><style>body{font:16px system-ui;margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f7f9;color:#171717}main{width:min(22rem,calc(100% - 3rem));padding:2rem;border:1px solid #ddd;border-radius:12px;background:white}h1{font-size:1.25rem}input,button{box-sizing:border-box;width:100%;padding:.75rem;margin-top:.75rem;font:inherit}button{cursor:pointer}p{color:#a21a1a}</style></head><body><main><h1>访问 DeepSeek Harness</h1>${error}<form method="post" action="${LOGIN_PATH}"><input type="hidden" name="return" value="${escapedReturn}"><label>密码<input name="password" type="password" required autofocus autocomplete="current-password"></label><button type="submit">进入</button></form></main></body></html>`
}

function sendLogin(response, returnTo, incorrect = false) {
  const body = Buffer.from(renderLogin(returnTo, incorrect))
  response.writeHead(incorrect ? 401 : 200, {
    'cache-control': 'no-store',
    'content-length': String(body.byteLength),
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'content-type': 'text/html; charset=utf-8',
    'x-content-type-options': 'nosniff',
  })
  response.end(body)
}

async function readForm(request) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.byteLength
    if (bytes > MAX_FORM_BYTES) throw new RangeError('login form is too large')
    chunks.push(chunk)
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
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

function isNavigation(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  if (request.headers['sec-fetch-mode'] === 'navigate') return true
  return request.headers.accept?.split(',').some(value => value.trim().startsWith('text/html')) === true
}

export function createPasswordAccess(password, { rateLimiter = new LoginRateLimiter() } = {}) {
  const enabled = password !== ''
  const passwordDigest = digest(password)
  const sessionToken = randomBytes(32).toString('base64url')

  function isAuthenticated(request) {
    const supplied = parseCookies(request.headers.cookie).get(SESSION_COOKIE)
    return typeof supplied === 'string' && constantTimeEqual(supplied, sessionToken)
  }

  async function handleHttp(request, response, pathname) {
    if (!enabled) return false

    if (pathname === LOGIN_PATH && request.method === 'GET') {
      const target = new URL(request.url ?? LOGIN_PATH, 'http://gateway.internal').searchParams.get('return')
      sendLogin(response, safeReturnPath(target))
      return true
    }

    if (pathname === LOGIN_PATH && request.method === 'POST') {
      const client = request.socket.remoteAddress ?? 'unknown'
      if (!rateLimiter.allow(client)) {
        sendText(response, 429, 'too many login attempts', { 'retry-after': '60' })
        return true
      }
      let form
      try {
        form = await readForm(request)
      } catch (error) {
        sendText(response, error instanceof RangeError ? 413 : 400, 'invalid login form')
        return true
      }
      const supplied = form.get('password') ?? ''
      const target = safeReturnPath(form.get('return'))
      if (!timingSafeEqual(digest(supplied), passwordDigest)) {
        sendLogin(response, target, true)
        return true
      }
      rateLimiter.reset(client)
      response.writeHead(303, {
        'cache-control': 'no-store',
        location: target,
        'set-cookie': sessionCookie(sessionToken, request, 86_400),
      })
      response.end()
      return true
    }

    if (pathname === LOGOUT_PATH && request.method === 'POST') {
      response.writeHead(303, {
        'cache-control': 'no-store',
        location: LOGIN_PATH,
        'set-cookie': sessionCookie('', request, 0),
      })
      response.end()
      return true
    }

    if (isAuthenticated(request)) return false
    if (isNavigation(request)) {
      const target = safeReturnPath(request.url)
      response.writeHead(303, {
        'cache-control': 'no-store',
        location: `${LOGIN_PATH}?return=${encodeURIComponent(target)}`,
      })
      response.end()
    } else {
      sendText(response, 401, 'authentication required')
    }
    return true
  }

  return Object.freeze({
    enabled,
    handleHttp,
    isAuthenticated,
  })
}
