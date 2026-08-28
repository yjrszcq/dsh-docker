import { randomBytes, timingSafeEqual } from 'node:crypto'

export const AUTH_PREFIX = '/_dsh_platform/auth/'
export const ACCESS_PREFIX = '/_dsh_platform/access/'
export const TRANSITION_PREFIX = '/_dsh_platform/transition/'
export const DSH_SESSION_COOKIE = 'dsh_gateway_session'
export const DSH_CSRF_COOKIE = 'dsh_gateway_csrf'
export const AUTH_CSRF_COOKIE = 'dsh_auth_csrf'
export const MANAGEMENT_SESSION_COOKIE = 'dsh_management_compat_session'
export const MANAGEMENT_CSRF_COOKIE = 'dsh_management_csrf'
export const MANAGEMENT_PENDING_COOKIE = 'dsh_management_pending'

const RESERVED_COOKIES = new Set([
  DSH_SESSION_COOKIE,
  DSH_CSRF_COOKIE,
  AUTH_CSRF_COOKIE,
  MANAGEMENT_SESSION_COOKIE,
  MANAGEMENT_CSRF_COOKIE,
  MANAGEMENT_PENDING_COOKIE,
  'dsh_management_secure_session',
])

export function isReservedCookieName(name) { return RESERVED_COOKIES.has(name) }

function token(prefix) { return `${prefix}_${randomBytes(32).toString('base64url')}` }

export function cookieValue(header, name) {
  if (typeof header !== 'string') return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    const value = part.slice(separator + 1).trim()
    return /^[A-Za-z0-9_-]{1,512}$/.test(value) ? value : undefined
  }
  return undefined
}

export function stripReservedCookies(header) {
  if (typeof header !== 'string') return undefined
  const kept = header.split(';').map(value => value.trim()).filter(value => {
    const separator = value.indexOf('=')
    return separator > 0 && !RESERVED_COOKIES.has(value.slice(0, separator).trim())
  })
  return kept.length === 0 ? undefined : kept.join('; ')
}

function sameSecret(left, right) {
  const a = Buffer.from(left ?? '')
  const b = Buffer.from(right ?? '')
  return a.byteLength === b.byteLength && a.byteLength > 0 && timingSafeEqual(a, b)
}

function language(request) {
  return cookieValue(request.headers.cookie, 'dsh_locale') === 'zh'
    || (cookieValue(request.headers.cookie, 'dsh_locale') === undefined
      && /^zh\b/i.test(request.headers['accept-language'] ?? '')) ? 'zh' : 'en'
}

export function requestOrigin(request, { requireHeader = false } = {}) {
  const header = request.headers.origin
  if (typeof header === 'string') {
    try {
      const parsed = new URL(header)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username !== '' || parsed.password !== ''
        || parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== ''
        || parsed.host.toLowerCase() !== String(request.headers.host ?? '').toLowerCase()) return undefined
      return parsed.origin
    } catch { return undefined }
  }
  if (requireHeader) return undefined
  const protocol = request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
  try { return new URL(`${protocol}://${String(request.headers.host ?? '')}`).origin }
  catch { return undefined }
}

function requestTargetOrigin(request) {
  const protocol = request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
  try { return new URL(`${protocol}://${String(request.headers.host ?? '')}`).origin }
  catch { return undefined }
}

function canonicalOrigin(value) {
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === value ? parsed.origin : undefined
  } catch { return undefined }
}

function secureCookie(origin) { return origin.startsWith('https://') ? '; Secure' : '' }

function sessionCookies(session, origin) {
  return [
    `${DSH_SESSION_COOKIE}=${session.token}; HttpOnly; SameSite=Lax; Path=/${secureCookie(origin)}`,
    `${DSH_CSRF_COOKIE}=${session.csrfToken}; SameSite=Strict; Path=/${secureCookie(origin)}`,
    `${AUTH_CSRF_COOKIE}=; HttpOnly; SameSite=Strict; Path=${AUTH_PREFIX}; Max-Age=0${secureCookie(origin)}`,
  ]
}

function clearSessionCookies(origin) {
  return [
    `${DSH_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie(origin)}`,
    `${DSH_CSRF_COOKIE}=; SameSite=Strict; Path=/; Max-Age=0${secureCookie(origin)}`,
  ]
}

function managementCookies(session, origin, path = '/_dsh_platform/') {
  return [
    `${MANAGEMENT_SESSION_COOKIE}=${session.token}; HttpOnly; SameSite=Strict; Path=${path}${secureCookie(origin)}`,
    `${MANAGEMENT_CSRF_COOKIE}=${session.csrfToken}; SameSite=Strict; Path=${path}${secureCookie(origin)}`,
    `${MANAGEMENT_PENDING_COOKIE}=; HttpOnly; SameSite=Strict; Path=${AUTH_PREFIX}; Max-Age=0${secureCookie(origin)}`,
    `${AUTH_CSRF_COOKIE}=; HttpOnly; SameSite=Strict; Path=${AUTH_PREFIX}; Max-Age=0${secureCookie(origin)}`,
  ]
}

function clearManagementCookies(origin, path = '/_dsh_platform/') {
  return [
    `${MANAGEMENT_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=${path}; Max-Age=0${secureCookie(origin)}`,
    `${MANAGEMENT_CSRF_COOKIE}=; SameSite=Strict; Path=${path}; Max-Age=0${secureCookie(origin)}`,
    `${MANAGEMENT_PENDING_COOKIE}=; HttpOnly; SameSite=Strict; Path=${AUTH_PREFIX}; Max-Age=0${secureCookie(origin)}`,
  ]
}

function pendingCookie(pending, origin, authPrefix = AUTH_PREFIX) {
  return `${MANAGEMENT_PENDING_COOKIE}=${pending.token}; HttpOnly; SameSite=Strict; Path=${authPrefix}${secureCookie(origin)}`
}

function sendJson(response, status, value, headers = {}) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`)
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': String(bytes.byteLength),
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  })
  response.end(bytes)
}

async function jsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > 64 * 1024) throw Object.assign(new Error('authentication request is too large'), { statusCode: 413 })
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw Object.assign(new Error('authentication request is invalid'), { statusCode: 400 }) }
}

function validBrowserMutation(request, csrf, cookieName = AUTH_CSRF_COOKIE) {
  const origin = requestOrigin(request, { requireHeader: true })
  const site = request.headers['sec-fetch-site']
  const mode = request.headers['sec-fetch-mode']
  return origin !== undefined
    && (site === undefined || site === 'same-origin')
    && (mode === undefined || mode === 'cors' || mode === 'same-origin')
    && typeof request.headers['content-type'] === 'string'
    && request.headers['content-type'].toLowerCase().startsWith('application/json')
    && sameSecret(cookieValue(request.headers.cookie, cookieName), csrf)
    && sameSecret(request.headers['x-dsh-csrf'], csrf)
}

function validSessionMutation(request, cookieName) {
  const csrf = cookieValue(request.headers.cookie, cookieName)
  const origin = requestOrigin(request, { requireHeader: true })
  const site = request.headers['sec-fetch-site']
  const mode = request.headers['sec-fetch-mode']
  return origin !== undefined
    && (site === undefined || site === 'same-origin')
    && (mode === undefined || mode === 'cors' || mode === 'same-origin')
    && sameSecret(request.headers['x-dsh-csrf'], csrf)
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function authenticationPage(request, state, csrf, returnPath) {
  const zh = language(request) === 'zh'
  const copy = zh ? {
    brand: 'HARNESS', username: '用户名', password: '密码', register: '注册', login: '登录',
    initializing: '正在创建管理员账户…', signingIn: '正在登录…',
    failed: '用户名或密码不正确，请重试。', concurrent: '管理员账户已创建，请使用现有账户登录。',
    migrationTitle: '需要迁移管理员认证', migrationDetail: '请在容器 Root 终端运行 dsh-platform access begin-migration，然后使用一次性密钥创建新账户。', setupKey: '迁移密钥',
    recoveryTitle: '需要恢复管理员认证', recoveryDetail: '认证状态损坏或缺失。请从容器 Root 终端执行 dsh-platform access status 查看恢复指引。',
    waitingTitle: '正在准备认证服务', waitingDetail: '平台正在确认本地管理员状态，请稍候。',
  } : {
    brand: 'HARNESS', username: 'Username', password: 'Password', register: 'Register', login: 'Sign in',
    initializing: 'Creating the administrator account…', signingIn: 'Signing in…',
    failed: 'The username or password is incorrect. Try again.', concurrent: 'The administrator account already exists. Sign in with it.',
    migrationTitle: 'Administrator migration required', migrationDetail: 'Run dsh-platform access begin-migration from a root container terminal, then create a new account with the one-time key.', setupKey: 'Migration key',
    recoveryTitle: 'Administrator recovery required', recoveryDetail: 'Authentication state is missing or damaged. Run dsh-platform access status from a root container terminal for recovery guidance.',
    waitingTitle: 'Preparing authentication', waitingDetail: 'The platform is determining local administrator state. Please wait.',
  }
  let content
  if (state === 'never-initialized' || state === 'initialized' || state === 'migration-required') {
    const initialize = state === 'never-initialized'
    const migration = state === 'migration-required'
    const submit = initialize || migration ? copy.register : copy.login
    content = `${migration ? `<h1>${copy.migrationTitle}</h1><p>${copy.migrationDetail}</p>` : ''}<form>${migration ? `<label>${copy.setupKey}<input name="setupKey" autocomplete="one-time-code" required maxlength="512" autofocus></label>` : ''}<label>${copy.username}<input name="username" autocomplete="username" required maxlength="256"${migration ? '' : ' autofocus'}></label><label>${copy.password}<input name="password" type="password" autocomplete="${initialize || migration ? 'new-password' : 'current-password'}" required maxlength="1024"></label><button type="submit">${submit}</button><p class="error" role="alert" hidden></p></form><script>const form=document.querySelector('form'),error=document.querySelector('.error'),button=form.querySelector('button');form.addEventListener('submit',async event=>{event.preventDefault();error.hidden=true;button.disabled=true;button.textContent=${JSON.stringify(initialize || migration ? copy.initializing : copy.signingIn)};const values=new FormData(form);try{const response=await fetch(${JSON.stringify(migration ? `${AUTH_PREFIX}migration` : `${AUTH_PREFIX}session`)},{method:'POST',headers:{'content-type':'application/json','x-dsh-csrf':${JSON.stringify(csrf)}},body:JSON.stringify({${migration ? "setupKey:values.get('setupKey')," : ''}username:values.get('username'),password:values.get('password')})});if(response.ok){location.replace(${JSON.stringify(returnPath)});return}const payload=await response.json().catch(()=>({}));error.textContent=payload.code==='ALREADY_INITIALIZED'?${JSON.stringify(copy.concurrent)}:${JSON.stringify(copy.failed)};error.hidden=false}catch{error.textContent=${JSON.stringify(copy.failed)};error.hidden=false}finally{button.disabled=false;button.textContent=${JSON.stringify(submit)}})</script>`
  } else if (state === 'recovery-required') {
    content = `<h1>${copy.recoveryTitle}</h1><p>${copy.recoveryDetail}</p>`
  } else content = `<h1>${copy.waitingTitle}</h1><p>${copy.waitingDetail}</p><script>setTimeout(()=>location.reload(),1000)</script>`
  return `<!doctype html><html lang="${zh ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(copy.brand)}</title><style>html{color-scheme:light dark}*{box-sizing:border-box}body{min-height:100dvh;margin:0;display:grid;place-items:center;background:#151517;color:#f3f3f4;font:14px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(400px,calc(100% - 32px));padding:28px;border:1px solid #3e3e42;border-radius:12px;background:#242426}.brand{text-align:center;margin:0 0 24px;font-size:18px;letter-spacing:.12em}h1{margin:0 0 8px;font-size:20px}p{margin:0;color:#aaaab0}form{display:grid;gap:16px}label{display:grid;gap:7px;font-weight:600}input{width:100%;padding:10px 12px;border:1px solid #55555b;border-radius:7px;background:#19191b;color:inherit;font:inherit}button{padding:10px 14px;border:0;border-radius:7px;background:#f2f2f3;color:#202124;font:600 14px/1.4 inherit;cursor:pointer}.error{color:#ff7777}[hidden]{display:none}@media(prefers-color-scheme:light){body{background:#f7f7f8;color:#202124}.card{background:#fff;border-color:#d7d7da}p{color:#6d6f76}input{background:#fff;border-color:#c7c8cc}button{background:#202124;color:#fff}}</style></head><body><main class="card"><div class="brand">${htmlEscape(copy.brand)}</div>${content}</main></body></html>`
}

function managementLoginPage(request, csrf, { pending = false, authPrefix = AUTH_PREFIX, consolePath = '/_dsh_platform/console/' } = {}) {
  const zh = language(request) === 'zh'
  const copy = zh ? {
    title: 'DSH 管理中心', detail: pending ? '请输入管理中心附加密码。' : '使用本地管理员账户登录。',
    username: '用户名', password: pending ? '附加密码' : '密码', submit: '登录', failed: '验证失败，请重试。',
  } : {
    title: 'DSH Management Console', detail: pending ? 'Enter the additional Management password.' : 'Sign in with the local administrator account.',
    username: 'Username', password: pending ? 'Additional password' : 'Password', submit: 'Sign in', failed: 'Authentication failed. Try again.',
  }
  return `<!doctype html><html lang="${zh ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${copy.title}</title><style>html{color-scheme:light dark}*{box-sizing:border-box}body{min-height:100dvh;margin:0;display:grid;place-items:center;background:#151517;color:#f3f3f4;font:14px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(400px,calc(100% - 32px));padding:28px;border:1px solid #3e3e42;border-radius:12px;background:#242426}h1{margin:0 0 6px;font-size:20px}p{margin:0 0 22px;color:#aaaab0}form{display:grid;gap:16px}label{display:grid;gap:7px;font-weight:600}input{width:100%;padding:10px 12px;border:1px solid #55555b;border-radius:7px;background:#19191b;color:inherit;font:inherit}button{padding:10px 14px;border:0;border-radius:7px;background:#f2f2f3;color:#202124;font:600 14px/1.4 inherit;cursor:pointer}.error{color:#ff7777}[hidden]{display:none}@media(prefers-color-scheme:light){body{background:#f7f7f8;color:#202124}.card{background:#fff;border-color:#d7d7da}p{color:#6d6f76}input{background:#fff;border-color:#c7c8cc}button{background:#202124;color:#fff}}</style></head><body><main class="card"><h1>${copy.title}</h1><p>${copy.detail}</p><form>${pending ? '' : `<label>${copy.username}<input name="username" autocomplete="username" required maxlength="256" autofocus></label>`}<label>${copy.password}<input name="password" type="password" autocomplete="current-password" required maxlength="1024"${pending ? ' autofocus' : ''}></label><button type="submit">${copy.submit}</button><p class="error" role="alert" hidden>${copy.failed}</p></form></main><script>const form=document.querySelector('form'),error=document.querySelector('.error');form.addEventListener('submit',async event=>{event.preventDefault();error.hidden=true;const values=new FormData(form);const response=await fetch(${JSON.stringify(pending ? `${authPrefix}management/pending` : `${authPrefix}management/session`)},{method:'POST',headers:{'content-type':'application/json','x-dsh-csrf':${JSON.stringify(csrf)}},body:JSON.stringify({${pending ? '' : "username:values.get('username'),"}password:values.get('password')})});if(response.ok){location.replace(response.status===202?${JSON.stringify(`${authPrefix}management/pending`)}:${JSON.stringify(consolePath)})}else{error.hidden=false;form.elements.password.select()}})</script></body></html>`
}

export function createBrowserAuthentication({
  access,
  safeReturnPath,
  report = async () => {},
  paths: {
    authPrefix = AUTH_PREFIX,
    accessPrefix = ACCESS_PREFIX,
    transitionPrefix = TRANSITION_PREFIX,
    consolePath = '/_dsh_platform/console/',
  } = {},
}) {
  const managementCookiePath = consolePath === '/' ? '/' : '/_dsh_platform/'
  async function accessRequest(method, path, body) {
    try { return await access.request(method, path, body) }
    catch (error) {
      if (error !== null && typeof error === 'object'
        && (!Number.isInteger(error.statusCode) || error.statusCode >= 500)) {
        error.browserAuthenticationBackend = true
      }
      throw error
    }
  }

  const accessFailureStatus = error => Number.isInteger(error?.statusCode) ? error.statusCode : 503
  const accessFailureCode = (error, fallback) => Number.isInteger(error?.statusCode)
    ? error.code ?? fallback
    : 'ACCESS_MANAGER_UNAVAILABLE'
  const isAuthenticationDenial = error => [401, 403].includes(error?.statusCode)

  async function status() { return accessRequest('GET', '/v1/status') }

  async function validateDsh(request, { requireCsrf = false } = {}) {
    const origin = requestOrigin(request)
    const value = cookieValue(request.headers.cookie, DSH_SESSION_COOKIE)
    if (origin === undefined || value === undefined) return { authenticated: false }
    if (requireCsrf && !validSessionMutation(request, DSH_CSRF_COOKIE)) return { authenticated: false }
    return accessRequest('POST', '/v1/sessions/validate', {
      kind: 'dsh', token: value, origin,
      requireCsrf,
      csrfToken: requireCsrf ? request.headers['x-dsh-csrf'] : undefined,
    }).catch(error => {
      if (isAuthenticationDenial(error)) return { authenticated: false }
      throw error
    })
  }

  async function validateManagement(request, { requireCsrf = false } = {}) {
    const origin = requestOrigin(request)
    const value = cookieValue(request.headers.cookie, MANAGEMENT_SESSION_COOKIE)
    if (origin === undefined || value === undefined) return { authenticated: false }
    if (requireCsrf && !validSessionMutation(request, MANAGEMENT_CSRF_COOKIE)) return { authenticated: false }
    return accessRequest('POST', '/v1/sessions/validate', {
      kind: 'management', token: value, origin,
      requireCsrf,
      csrfToken: requireCsrf ? request.headers['x-dsh-csrf'] : undefined,
    }).catch(error => {
      if (isAuthenticationDenial(error)) return { authenticated: false }
      throw error
    })
  }

  async function authorizeManagement(request, { audience, method, target, requireCsrf = false } = {}) {
    const origin = requestOrigin(request)
    const managementToken = cookieValue(request.headers.cookie, MANAGEMENT_SESSION_COOKIE)
    if (origin === undefined || managementToken === undefined) return { authorized: false }
    if (requireCsrf && !validSessionMutation(request, MANAGEMENT_CSRF_COOKIE)) return { authorized: false }
    try {
      const result = await accessRequest('POST', '/v1/capabilities', {
        managementToken,
        origin,
        csrfToken: requireCsrf ? request.headers['x-dsh-csrf'] : undefined,
        requireCsrf,
        audience,
        method,
        target,
      })
      return { authorized: true, capability: result.capability }
    } catch (error) {
      if (isAuthenticationDenial(error)) return { authorized: false }
      throw error
    }
  }

  function sendManagementLogin(request, response, origin, { pending = false } = {}) {
    const csrf = token('dshma')
    const bytes = Buffer.from(managementLoginPage(request, csrf, { pending, authPrefix, consolePath }))
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-length': String(bytes.byteLength),
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'content-type': 'text/html; charset=utf-8',
      'cross-origin-opener-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
      'set-cookie': `${AUTH_CSRF_COOKIE}=${csrf}; HttpOnly; SameSite=Strict; Path=${authPrefix}${secureCookie(origin)}`,
      'x-content-type-options': 'nosniff',
    })
    response.end(bytes)
  }

  async function enterManagement(request, response) {
    const origin = requestOrigin(request)
    if (origin === undefined) { sendJson(response, 400, { error: 'request origin is invalid' }); return }
    const valid = await validateDsh(request)
    if (!valid.authenticated) {
      response.writeHead(303, { 'cache-control': 'no-store', location: `${authPrefix}management` })
      response.end()
      return
    }
    const current = await status()
    const entry = current.account?.managementAccess?.isolatedEntry
    if (current.account?.managementAccess?.mode === 'isolated' && entry?.kind === 'local-only') {
      const zh = language(request) === 'zh'
      const body = Buffer.from(`<!doctype html><html lang="${zh ? 'zh-CN' : 'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH Management</title><body><main><h1>${zh ? '管理中心仅允许本机访问' : 'Management is local-only'}</h1><p>${zh ? '请在容器宿主机映射 3081 端口，并通过实际 loopback 地址登录。' : 'Map container port 3081 on the host and sign in through the actual loopback address.'}</p></main></body></html>`)
      response.writeHead(200, { 'cache-control': 'no-store', 'content-length': String(body.byteLength), 'content-type': 'text/html; charset=utf-8' })
      response.end(body)
      return
    }
    const targetOrigin = current.account?.managementAccess?.mode === 'isolated'
      ? entry?.managementPublicOrigin
      : origin
    if (typeof targetOrigin !== 'string') { sendJson(response, 409, { error: 'Management entry is unavailable' }); return }
    const created = await accessRequest('POST', '/v1/management/handoffs', {
      dshToken: cookieValue(request.headers.cookie, DSH_SESSION_COOKIE),
      dshOrigin: origin,
      targetOrigin,
    })
    response.writeHead(303, {
      'cache-control': 'no-store',
      location: current.account?.managementAccess?.mode === 'isolated'
        ? `${targetOrigin}/auth/management/handoff?token=${encodeURIComponent(created.handoff.token)}`
        : `${AUTH_PREFIX}management/handoff?token=${encodeURIComponent(created.handoff.token)}`,
      'referrer-policy': 'no-referrer',
    })
    response.end()
  }

  async function handle(request, response, pathname, searchParams) {
    if (pathname === transitionPrefix + 'probe' && request.method === 'GET') {
      const sourceOrigin = canonicalOrigin(request.headers.origin)
      const candidateOrigin = requestTargetOrigin(request)
      if (sourceOrigin === undefined || candidateOrigin === undefined) {
        sendJson(response, 400, { error: 'transition probe origin is invalid', code: 'TRANSITION_PROBE_INVALID' })
        return true
      }
      try {
        const result = await accessRequest('POST', '/v1/management/transitions/probe', {
          transitionId: searchParams.get('transitionId'),
          nonce: searchParams.get('nonce'),
          sourceOrigin,
          candidateOrigin,
        })
        sendJson(response, 200, result, {
          'access-control-allow-origin': sourceOrigin,
          'access-control-expose-headers': 'content-type',
          vary: 'Origin',
        })
      } catch (error) {
        sendJson(response, accessFailureStatus(error), { error: error.message, code: accessFailureCode(error, 'TRANSITION_PROBE_INVALID') }, {
          'access-control-allow-origin': sourceOrigin,
          vary: 'Origin',
        })
      }
      return true
    }
    if (pathname === transitionPrefix + 'continue' && request.method === 'GET') {
      const origin = requestTargetOrigin(request)
      const topLevel = request.headers['sec-fetch-mode'] === undefined
        || (request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document')
      if (!topLevel || origin === undefined) {
        sendJson(response, 403, { error: 'Management continuation is forbidden', code: 'REQUEST_FORBIDDEN' })
        return true
      }
      try {
        const result = await accessRequest('POST', '/v1/management/continuations/consume', {
          token: searchParams.get('token'), origin,
        })
        response.writeHead(303, {
          'cache-control': 'no-store', location: consolePath,
          'referrer-policy': 'no-referrer', 'set-cookie': managementCookies(result.session, origin, managementCookiePath),
        })
        response.end()
      } catch (error) {
        sendJson(response, accessFailureStatus(error), { error: error.message, code: accessFailureCode(error, 'CONTINUATION_INVALID') })
      }
      return true
    }
    if (pathname === accessPrefix + 'status' && request.method === 'GET') {
      const current = await status()
      sendJson(response, 200, { state: current.state })
      return true
    }
    if (pathname === authPrefix.slice(0, -1) || pathname === authPrefix) {
      if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) return false
      const current = await status()
      const valid = await validateDsh(request)
      const returnPath = safeReturnPath(searchParams.get('return'))
      if (current.state === 'initialized' && valid.authenticated) {
        response.writeHead(303, { 'cache-control': 'no-store', location: returnPath })
        response.end()
        return true
      }
      const csrf = token('dsha')
      const origin = requestOrigin(request) ?? 'http://invalid.local'
      const bytes = Buffer.from(authenticationPage(request, current.state, csrf, returnPath))
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': String(bytes.byteLength),
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        'content-type': 'text/html; charset=utf-8',
        'referrer-policy': 'no-referrer',
        'set-cookie': `${AUTH_CSRF_COOKIE}=${csrf}; HttpOnly; SameSite=Strict; Path=${authPrefix}${secureCookie(origin)}`,
        'x-content-type-options': 'nosniff',
      })
      response.end(request.method === 'HEAD' ? undefined : bytes)
      return true
    }
    if (pathname === authPrefix + 'session' && request.method === 'POST') {
      const csrf = cookieValue(request.headers.cookie, AUTH_CSRF_COOKIE)
      if (!validBrowserMutation(request, csrf)) {
        sendJson(response, 403, { error: 'authentication request rejected', code: 'REQUEST_FORBIDDEN' })
        return true
      }
      const origin = requestOrigin(request, { requireHeader: true })
      const value = await jsonBody(request)
      const current = await status()
      const route = current.state === 'never-initialized' ? '/v1/dsh/initialize' : '/v1/dsh/login'
      if (!['never-initialized', 'initialized'].includes(current.state)) {
        sendJson(response, 409, { error: 'administrator access is unavailable', code: 'ACCESS_UNAVAILABLE' })
        return true
      }
      try {
        const result = await accessRequest('POST', route, { ...value, origin })
        await report(current.state === 'never-initialized' ? 'gateway.access.initialized' : 'gateway.access.logged-in')
        sendJson(response, current.state === 'never-initialized' ? 201 : 200, { authenticated: true }, {
          'set-cookie': sessionCookies(result.session, origin),
        })
      } catch (error) {
        await report('gateway.access.login-failed', { code: error.code ?? null, level: 'warning' })
        sendJson(response, accessFailureStatus(error), { error: error.message, code: accessFailureCode(error, 'AUTHENTICATION_FAILED') })
      }
      return true
    }
    if (pathname === authPrefix + 'migration' && request.method === 'POST') {
      const csrf = cookieValue(request.headers.cookie, AUTH_CSRF_COOKIE)
      if (!validBrowserMutation(request, csrf)) {
        sendJson(response, 403, { error: 'migration request rejected', code: 'REQUEST_FORBIDDEN' })
        return true
      }
      const origin = requestOrigin(request, { requireHeader: true })
      try {
        const result = await accessRequest('POST', '/v1/dsh/migrate', { ...await jsonBody(request), origin })
        await report('gateway.access.migrated')
        sendJson(response, 201, { authenticated: true }, { 'set-cookie': sessionCookies(result.session, origin) })
      } catch (error) {
        await report('gateway.access.migration-failed', { code: error.code ?? null, level: 'warning' })
        sendJson(response, accessFailureStatus(error), { error: error.message, code: accessFailureCode(error, 'MIGRATION_FAILED') })
      }
      return true
    }
    if (pathname === authPrefix + 'logout' && request.method === 'POST') {
      const valid = await validateDsh(request, { requireCsrf: true })
      const origin = requestOrigin(request, { requireHeader: true })
      if (!validBrowserMutation(request, cookieValue(request.headers.cookie, DSH_CSRF_COOKIE), DSH_CSRF_COOKIE)
        || !valid.authenticated) {
        sendJson(response, 403, { error: 'logout request rejected', code: 'REQUEST_FORBIDDEN' })
        return true
      }
      await accessRequest('POST', '/v1/sessions/logout', {
        kind: 'dsh', token: cookieValue(request.headers.cookie, DSH_SESSION_COOKIE),
      })
      sendJson(response, 200, { authenticated: false }, { 'set-cookie': clearSessionCookies(origin) })
      return true
    }
    if (pathname === authPrefix + 'management' && ['GET', 'HEAD'].includes(request.method ?? 'GET')) {
      const origin = requestOrigin(request)
      if (origin === undefined) { sendJson(response, 400, { error: 'request origin is invalid' }); return true }
      const valid = await validateManagement(request)
      if (valid.authenticated) {
        response.writeHead(303, { 'cache-control': 'no-store', location: consolePath })
        response.end()
      } else sendManagementLogin(request, response, origin)
      return true
    }
    if (pathname === authPrefix + 'management/session' && request.method === 'POST') {
      const csrf = cookieValue(request.headers.cookie, AUTH_CSRF_COOKIE)
      if (!validBrowserMutation(request, csrf)) {
        sendJson(response, 403, { error: 'authentication request rejected', code: 'REQUEST_FORBIDDEN' })
        return true
      }
      const origin = requestOrigin(request, { requireHeader: true })
      try {
        const result = await accessRequest('POST', '/v1/management/login', { ...await jsonBody(request), origin })
        if (result.pending !== undefined) {
          sendJson(response, 202, { pending: true }, { 'set-cookie': pendingCookie(result.pending, origin, authPrefix) })
        } else sendJson(response, 200, { authenticated: true }, { 'set-cookie': managementCookies(result.session, origin, managementCookiePath) })
      } catch (error) {
        sendJson(response, accessFailureStatus(error), { error: error.message, code: accessFailureCode(error, 'AUTHENTICATION_FAILED') })
      }
      return true
    }
    if (pathname === authPrefix + 'management/handoff' && request.method === 'GET') {
      const topLevel = request.headers['sec-fetch-mode'] === undefined
        || (request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document')
      const origin = requestOrigin(request)
      if (!topLevel || origin === undefined) {
        sendJson(response, 403, { error: 'handoff request rejected', code: 'REQUEST_FORBIDDEN' })
        return true
      }
      try {
        const result = await accessRequest('POST', '/v1/management/handoffs/consume', {
          token: searchParams.get('token'), origin,
        })
        if (result.pending !== undefined) {
          response.writeHead(303, {
            'cache-control': 'no-store', location: `${authPrefix}management/pending`,
            'referrer-policy': 'no-referrer', 'set-cookie': pendingCookie(result.pending, origin, authPrefix),
          })
        } else {
          response.writeHead(303, {
            'cache-control': 'no-store', location: consolePath,
            'referrer-policy': 'no-referrer', 'set-cookie': managementCookies(result.session, origin, managementCookiePath),
          })
        }
        response.end()
      } catch (error) {
        sendJson(response, accessFailureStatus(error), { error: error.message, code: accessFailureCode(error, 'HANDOFF_INVALID') })
      }
      return true
    }
    if (pathname === authPrefix + 'management/pending' && ['GET', 'HEAD'].includes(request.method ?? 'GET')) {
      const origin = requestOrigin(request)
      if (origin === undefined || cookieValue(request.headers.cookie, MANAGEMENT_PENDING_COOKIE) === undefined) {
        response.writeHead(303, { 'cache-control': 'no-store', location: `${authPrefix}management` })
        response.end()
      } else sendManagementLogin(request, response, origin, { pending: true })
      return true
    }
    if (pathname === authPrefix + 'management/pending' && request.method === 'POST') {
      const csrf = cookieValue(request.headers.cookie, AUTH_CSRF_COOKIE)
      if (!validBrowserMutation(request, csrf)) {
        sendJson(response, 403, { error: 'authentication request rejected', code: 'REQUEST_FORBIDDEN' })
        return true
      }
      const origin = requestOrigin(request, { requireHeader: true })
      try {
        const result = await accessRequest('POST', '/v1/management/pending/complete', {
          ...await jsonBody(request), origin,
          pendingToken: cookieValue(request.headers.cookie, MANAGEMENT_PENDING_COOKIE),
        })
        sendJson(response, 200, { authenticated: true }, { 'set-cookie': managementCookies(result.session, origin, managementCookiePath) })
      } catch (error) {
        sendJson(response, accessFailureStatus(error), { error: error.message, code: accessFailureCode(error, 'AUTHENTICATION_FAILED') })
      }
      return true
    }
    if (pathname === authPrefix + 'management/logout' && request.method === 'POST') {
      const valid = await validateManagement(request, { requireCsrf: true })
      const origin = requestOrigin(request, { requireHeader: true })
      if (!valid.authenticated || origin === undefined) {
        sendJson(response, 403, { error: 'logout request rejected', code: 'REQUEST_FORBIDDEN' })
        return true
      }
      await accessRequest('POST', '/v1/sessions/logout', {
        kind: 'management', token: cookieValue(request.headers.cookie, MANAGEMENT_SESSION_COOKIE),
      })
      sendJson(response, 200, { authenticated: false }, { 'set-cookie': clearManagementCookies(origin, managementCookiePath) })
      return true
    }
    return false
  }

  return Object.freeze({ status, validateDsh, validateManagement, authorizeManagement, enterManagement, handle })
}

export function rejectDshAuthentication(request, response, safeReturnPath) {
  const url = new URL(request.url ?? '/', 'http://gateway.internal')
  const navigation = request.method === 'GET'
    && (request.headers['sec-fetch-mode'] === 'navigate' || request.headers.accept?.includes('text/html'))
  if (navigation) {
    const returnPath = safeReturnPath(`${url.pathname}${url.search}${url.hash}`)
    response.writeHead(303, {
      'cache-control': 'no-store',
      location: `${AUTH_PREFIX}?return=${encodeURIComponent(returnPath)}`,
    })
    response.end()
  } else sendJson(response, 401, { error: 'authentication required', code: 'AUTHENTICATION_REQUIRED' })
}
