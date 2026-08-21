import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { chmod, rm } from 'node:fs/promises'
import { LoginRateLimiter } from './auth.mjs'

export const PLATFORM_AUTH_PREFIX = '/_dsh_platform/auth/'
export const PLATFORM_SESSION_COOKIE = 'dsh_platform_session'

export class PlatformAccessRateLimitError extends Error {}

function digest(value) {
  return createHash('sha256').update(value).digest()
}

function token(prefix) {
  return `${prefix}${randomBytes(32).toString('base64url')}`
}

function cookieValue(header, name) {
  if (typeof header !== 'string') return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    const value = part.slice(separator + 1).trim()
    return /^[A-Za-z0-9_-]+$/.test(value) ? value : undefined
  }
  return undefined
}

function equalSecret(left, rightDigest) {
  return timingSafeEqual(digest(left), rightDigest)
}

export class PlatformAccess {
  constructor({
    password = '',
    now = Date.now,
    temporaryKeyTtlMs = 10 * 60_000,
    sessionIdleMs = 30 * 60_000,
    sessionTtlMs = 8 * 60 * 60_000,
    rateLimiter = new LoginRateLimiter(),
  } = {}) {
    this.passwordEnabled = password !== ''
    this.passwordDigest = digest(password)
    this.now = now
    this.temporaryKeyTtlMs = temporaryKeyTtlMs
    this.sessionIdleMs = sessionIdleMs
    this.sessionTtlMs = sessionTtlMs
    this.rateLimiter = rateLimiter
    this.temporaryKeys = new Map()
    this.sessions = new Map()
  }

  prune() {
    const now = this.now()
    for (const [key, expiresAt] of this.temporaryKeys) {
      if (expiresAt <= now) this.temporaryKeys.delete(key)
    }
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now || session.lastSeenAt + this.sessionIdleMs <= now) this.sessions.delete(key)
    }
  }

  createTemporaryKey() {
    this.prune()
    this.temporaryKeys.clear()
    const value = token('dshp_')
    const expiresAt = this.now() + this.temporaryKeyTtlMs
    this.temporaryKeys.set(digest(value).toString('hex'), expiresAt)
    return Object.freeze({ key: value, expiresAt: new Date(expiresAt).toISOString() })
  }

  signIn(credential, client = 'unknown') {
    this.prune()
    if (typeof credential !== 'string' || credential.length > 512) return undefined
    if (!this.rateLimiter.allow(client)) throw new PlatformAccessRateLimitError('too many authentication attempts')
    let accepted = this.passwordEnabled && equalSecret(credential, this.passwordDigest)
    if (!accepted && credential.startsWith('dshp_')) {
      const key = digest(credential).toString('hex')
      const expiresAt = this.temporaryKeys.get(key)
      if (expiresAt !== undefined && expiresAt > this.now()) {
        accepted = true
      }
    }
    if (!accepted) {
      return undefined
    }
    this.rateLimiter.reset(client)
    const value = token('dshps_')
    const now = this.now()
    const sessionKey = digest(value).toString('hex')
    this.sessions.set(sessionKey, {
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + this.sessionTtlMs,
    })
    return value
  }

  isAuthenticated(request) {
    this.prune()
    const value = cookieValue(request.headers.cookie, PLATFORM_SESSION_COOKIE)
    if (value === undefined) return false
    const session = this.sessions.get(digest(value).toString('hex'))
    if (session === undefined) return false
    session.lastSeenAt = this.now()
    return true
  }

  logout(request) {
    const value = cookieValue(request.headers.cookie, PLATFORM_SESSION_COOKIE)
    if (value !== undefined) this.sessions.delete(digest(value).toString('hex'))
  }
}

function sendJson(response, status, value, headers = {}) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`)
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': String(body.byteLength),
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  })
  response.end(body)
}

async function jsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > 4096) throw new Error('authentication request is too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function loginPage(request, access) {
  const cookie = request.headers.cookie ?? ''
  const language = /(?:^|;\s*)dsh_locale=(zh|en)(?:;|$)/.exec(cookie)?.[1]
    ?? (/^zh\b/i.test(request.headers['accept-language'] ?? '') ? 'zh' : 'en')
  const zh = language === 'zh'
  const copy = zh
    ? access.passwordEnabled
      ? { title: 'DSH 管理中心', detail: '此页面独立于 DSH，需要单独验证访问权限。', label: '平台密码或临时访问密钥', submit: '登录', failed: '验证失败，请检查密码或重新生成访问密钥。' }
      : { title: 'DSH 管理中心', detail: '请先在容器终端运行 dsh-platform access create 生成临时访问密钥。', label: '临时访问密钥', submit: '登录', failed: '访问密钥无效或已过期，请重新生成。' }
    : access.passwordEnabled
      ? { title: 'DSH Management Console', detail: 'This console is independent of DSH and requires separate access.', label: 'Platform password or temporary access key', submit: 'Sign in', failed: 'Authentication failed. Check the password or create a new access key.' }
      : { title: 'DSH Management Console', detail: 'Run dsh-platform access create in the container terminal to create a temporary access key.', label: 'Temporary access key', submit: 'Sign in', failed: 'The access key is invalid or expired. Create a new key.' }
  return `<!doctype html><html lang="${zh ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${copy.title}</title><style>html{color-scheme:light dark}*{box-sizing:border-box}body{min-height:100dvh;margin:0;display:grid;place-items:center;background:#f7f7f8;color:#202124;font:14px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.login{width:min(400px,calc(100% - 32px));padding:28px;border:1px solid #d7d7da;border-radius:8px;background:#fff}h1{margin:0 0 6px;font-size:20px;letter-spacing:0}p{margin:0 0 24px;color:#6d6f76}label{display:grid;gap:8px;font-weight:600}input{width:100%;padding:10px 12px;border:1px solid #c7c8cc;border-radius:6px;background:transparent;color:inherit;font:inherit}button{margin-top:16px;width:100%;padding:10px 14px;border:0;border-radius:6px;background:#202124;color:#fff;font:600 14px/1.4 inherit;cursor:pointer}.error{margin:14px 0 0;color:#c62828}[hidden]{display:none}@media(prefers-color-scheme:dark){body{background:#151517;color:#f3f3f4}.login{background:#242426;border-color:#444449}p{color:#aaaab0}input{border-color:#55555b}button{background:#f2f2f3;color:#202124}.error{color:#ff7777}}</style></head><body><main class="login"><h1>${copy.title}</h1><p>${copy.detail}</p><form><label>${copy.label}<input name="credential" type="password" autocomplete="current-password" required maxlength="512" autofocus></label><button type="submit">${copy.submit}</button><p class="error" role="alert" hidden>${copy.failed}</p></form></main><script>const form=document.querySelector('form');const error=document.querySelector('.error');form.addEventListener('submit',async event=>{event.preventDefault();error.hidden=true;const credential=new FormData(form).get('credential');const response=await fetch('/_dsh_platform/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({credential})});if(response.ok){const next=new URLSearchParams(location.search).get('next');location.replace(next&&next.startsWith('/_dsh_platform/')?next:'/_dsh_platform/console/')}else{error.hidden=false;form.elements.credential.select()}})</script></body></html>`
}

export async function handlePlatformAuthRequest(request, response, access, pathname, { report = async () => {} } = {}) {
  if (pathname === PLATFORM_AUTH_PREFIX || pathname === PLATFORM_AUTH_PREFIX.slice(0, -1)) {
    if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) return false
    const body = Buffer.from(loginPage(request, access))
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'content-length': String(body.byteLength),
      'content-type': 'text/html; charset=utf-8',
      'x-content-type-options': 'nosniff',
    })
    response.end(request.method === 'HEAD' ? undefined : body)
    return true
  }
  if (pathname === `${PLATFORM_AUTH_PREFIX}session` && request.method === 'POST') {
    const body = await jsonBody(request)
    const client = request.socket.remoteAddress ?? 'unknown'
    let session
    try {
      session = access.signIn(body?.credential, client)
    } catch (error) {
      if (error instanceof PlatformAccessRateLimitError) {
        await report('gateway.platform-auth.rate-limited')
        sendJson(response, 429, { error: error.message }, { 'retry-after': '60' })
        return true
      }
      throw error
    }
    if (session === undefined) {
      await report('gateway.platform-auth.failed')
      sendJson(response, 401, { error: 'authentication failed' })
    } else {
      await report('gateway.platform-auth.succeeded')
      sendJson(response, 200, { authenticated: true }, {
        'set-cookie': `${PLATFORM_SESSION_COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/_dsh_platform/`,
      })
    }
    return true
  }
  if (pathname === `${PLATFORM_AUTH_PREFIX}logout` && request.method === 'POST') {
    access.logout(request)
    await report('gateway.platform-auth.logged-out')
    sendJson(response, 200, { authenticated: false }, {
      'set-cookie': `${PLATFORM_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/_dsh_platform/; Max-Age=0`,
    })
    return true
  }
  return false
}

export function rejectPlatformAccess(request, response) {
  const url = new URL(request.url ?? '/', 'http://gateway.internal')
  const navigation = request.method === 'GET'
    && (request.headers['sec-fetch-mode'] === 'navigate' || request.headers.accept?.includes('text/html'))
  if (navigation) {
    response.writeHead(303, {
      'cache-control': 'no-store',
      location: `${PLATFORM_AUTH_PREFIX}?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`,
    })
    response.end()
  } else sendJson(response, 401, { error: 'platform authentication required' })
}

export function createPlatformAccessControlServer(access, { report = async () => {} } = {}) {
  return createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://gateway-access.internal').pathname
      if (request.method === 'POST' && pathname === '/v1/sessions/validate') {
        const body = await jsonBody(request)
        sendJson(response, 200, { authenticated: access.isAuthenticated({ headers: { cookie: body?.cookie } }) })
        return
      }
      if (request.method !== 'POST' || pathname !== '/v1/keys') {
        sendJson(response, 404, { error: 'not found' })
        return
      }
      const created = access.createTemporaryKey()
      await report('gateway.platform-access-key.created', { expiresAt: created.expiresAt })
      sendJson(response, 201, created)
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'request failed' })
    }
  })
}

export async function listenPlatformAccessControl(server, socketPath) {
  await rm(socketPath, { force: true })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)
      resolve()
    })
  })
  await chmod(socketPath, 0o600)
}
