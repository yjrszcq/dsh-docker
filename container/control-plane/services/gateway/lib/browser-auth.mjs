import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const AUTH_PREFIX = '/_dsh_platform/auth/'
export const ACCESS_PREFIX = '/_dsh_platform/access/'
export const TRANSITION_PREFIX = '/_dsh_platform/transition/'
export const DSH_SESSION_COOKIE = 'dsh_gateway_session'
export const DSH_CSRF_COOKIE = 'dsh_gateway_csrf'
export const AUTH_CSRF_COOKIE = 'dsh_auth_csrf'
export const AUTH_RETRY_COOKIE = 'dsh_auth_retry_source'
export const TOTP_LOGIN_COOKIE = 'dsh_totp_login'
export const MANAGEMENT_SESSION_COOKIE = 'dsh_management_compat_session'
export const MANAGEMENT_CSRF_COOKIE = 'dsh_management_csrf'
export const MANAGEMENT_PENDING_COOKIE = 'dsh_management_pending'

const RESERVED_COOKIES = new Set([
  DSH_SESSION_COOKIE,
  DSH_CSRF_COOKIE,
  AUTH_CSRF_COOKIE,
  AUTH_RETRY_COOKIE,
  TOTP_LOGIN_COOKIE,
  MANAGEMENT_SESSION_COOKIE,
  MANAGEMENT_CSRF_COOKIE,
  MANAGEMENT_PENDING_COOKIE,
  'dsh_management_secure_session',
])

export function isReservedCookieName(name) { return RESERVED_COOKIES.has(name) }

function token(prefix) { return `${prefix}_${randomBytes(32).toString('base64url')}` }
function digest(value) { return createHash('sha256').update(value).digest('base64url') }

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

function loginClient(request) {
  const remoteAddress = request.socket?.remoteAddress
  const ip = typeof remoteAddress === 'string' && remoteAddress.length <= 128
    ? remoteAddress.replace(/^::ffff:/, '') : null
  const header = request.headers['user-agent']
  const userAgent = typeof header === 'string' && header.length > 0
    ? header.slice(0, 512) : null
  return { ip, userAgent }
}

function authenticationSource(request) {
  const browser = cookieValue(request.headers.cookie, AUTH_RETRY_COOKIE)
  if (browser !== undefined) return `browser:${digest(browser)}`
  const ip = loginClient(request).ip
  return ip === null ? 'unknown' : `ip:${digest(ip)}`
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
    `${TOTP_LOGIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=${AUTH_PREFIX}; Max-Age=0${secureCookie(origin)}`,
  ]
}

function clearSessionCookies(origin) {
  return [
    `${DSH_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie(origin)}`,
    `${DSH_CSRF_COOKIE}=; SameSite=Strict; Path=/; Max-Age=0${secureCookie(origin)}`,
    `${AUTH_CSRF_COOKIE}=; HttpOnly; SameSite=Strict; Path=${AUTH_PREFIX}; Max-Age=0${secureCookie(origin)}`,
    `${TOTP_LOGIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=${AUTH_PREFIX}; Max-Age=0${secureCookie(origin)}`,
  ]
}

function clearInvalidBrowserSessionCookies(origin, managementPath = '/_dsh_platform/') {
  return [
    `${DSH_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie(origin)}`,
    `${DSH_CSRF_COOKIE}=; SameSite=Strict; Path=/; Max-Age=0${secureCookie(origin)}`,
    `${TOTP_LOGIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=${AUTH_PREFIX}; Max-Age=0${secureCookie(origin)}`,
    ...clearManagementCookies(origin, managementPath),
  ]
}

function managementCookies(session, origin, path = '/_dsh_platform/') {
  return [
    `${MANAGEMENT_SESSION_COOKIE}=${session.token}; HttpOnly; SameSite=Strict; Path=${path}${secureCookie(origin)}`,
    `${MANAGEMENT_CSRF_COOKIE}=${session.csrfToken}; SameSite=Strict; Path=${path}${secureCookie(origin)}`,
    `${MANAGEMENT_PENDING_COOKIE}=; HttpOnly; SameSite=Strict; Path=${AUTH_PREFIX}; Max-Age=0${secureCookie(origin)}`,
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

function totpLoginCookie(challenge, origin, authPrefix = AUTH_PREFIX) {
  return `${TOTP_LOGIN_COOKIE}=${challenge.token}; HttpOnly; SameSite=Strict; Path=${authPrefix}; Max-Age=300${secureCookie(origin)}`
}

function authenticationContext(request, origin, authPrefix = AUTH_PREFIX) {
  const csrfToken = cookieValue(request.headers.cookie, AUTH_CSRF_COOKIE) ?? token('dsha')
  const retrySource = cookieValue(request.headers.cookie, AUTH_RETRY_COOKIE) ?? token('dshr')
  return {
    csrfToken,
    cookies: [
      `${AUTH_CSRF_COOKIE}=${csrfToken}; HttpOnly; SameSite=Strict; Path=${authPrefix}${secureCookie(origin)}`,
      `${AUTH_RETRY_COOKIE}=${retrySource}; HttpOnly; SameSite=Strict; Path=${authPrefix}${secureCookie(origin)}`,
    ],
  }
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

function sendSameOriginNavigation(response, target, cookies) {
  const scriptTarget = JSON.stringify(target)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
  const body = Buffer.from(`<!doctype html><meta charset="utf-8"><script>location.replace(${scriptTarget})</script>`)
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-length': String(body.byteLength),
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    'content-type': 'text/html; charset=utf-8',
    'referrer-policy': 'no-referrer',
    ...(cookies === undefined ? {} : { 'set-cookie': cookies }),
  })
  response.end(body)
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

function validBrowserMutationShape(request) {
  const origin = requestOrigin(request, { requireHeader: true })
  const site = request.headers['sec-fetch-site']
  const mode = request.headers['sec-fetch-mode']
  return origin !== undefined
    && (site === undefined || site === 'same-origin')
    && (mode === undefined || mode === 'cors' || mode === 'same-origin')
    && typeof request.headers['content-type'] === 'string'
    && request.headers['content-type'].toLowerCase().startsWith('application/json')
}

function validBrowserMutation(request, csrf) {
  return validBrowserMutationShape(request) && sameSecret(request.headers['x-dsh-csrf'], csrf)
}

function validAuthenticationContextRequest(request) {
  const site = request.headers['sec-fetch-site']
  const mode = request.headers['sec-fetch-mode']
  return requestOrigin(request) !== undefined
    && (site === undefined || site === 'same-origin')
    && (mode === undefined || mode === 'cors' || mode === 'same-origin')
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

function authenticationCountdownScript(submitLabel) {
  return `let retryUntil=0,retryTimer;function showRetryCountdown(template,seconds){retryUntil=Date.now()+seconds*1000;clearTimeout(retryTimer);button.disabled=true;const tick=()=>{const remaining=Math.max(0,Math.ceil((retryUntil-Date.now())/1000));if(remaining>0){error.textContent=template.replace('{seconds}',String(remaining));error.hidden=false;retryTimer=setTimeout(tick,Math.min(1000,Math.max(1,retryUntil-Date.now())));return}retryUntil=0;error.textContent='';error.hidden=true;button.disabled=false;button.textContent=${JSON.stringify(submitLabel)}};tick()}function showRetryFailure(payload){const template=payload.code==='AUTHENTICATION_RETRY_REQUIRED'&&Number.isInteger(payload.retryAfterSeconds)?retryMessage:payload.code==='AUTHENTICATION_RATE_LIMITED'&&Number.isInteger(payload.retryAfterSeconds)?rateLimitMessage:null;if(template===null)return false;showRetryCountdown(template,payload.retryAfterSeconds);return true}`
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

const USERNAME_INPUT_PATTERN = String.raw`[^\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]{1,64}`
const PASSWORD_INPUT_PATTERN = String.raw`[^\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]{8,1024}`

function authenticationPage(request, state, csrf, authenticationContextId, returnPath, { resetForm = false } = {}) {
  const zh = language(request) === 'zh'
  const copy = zh ? {
    brand: 'HARNESS', username: '用户名', password: '密码', totp: '动态验证码', register: '注册', login: '登录',
    initializing: '正在创建管理员账户…', signingIn: '正在登录…', resetting: '正在重置管理员认证…',
    failed: '用户名或密码不正确，请重试。', registrationFailed: '无法创建管理员账户，请检查填写内容后重试。',
    concurrent: '管理员账户已创建，请使用现有账户登录。',
    invalidUsername: '用户名支持 1 至 64 个字符，可使用中文、字母、数字、空格和常用符号；不能包含控制字符或双向控制字符。',
    invalidPassword: '密码支持 8 至 1024 个字符，可使用中文、字母、数字、空格和符号；不能包含控制字符或双向控制字符。',
    retryRequired: '当前浏览器已连续多次输入错误，请在 {seconds} 秒后重试。',
    rateLimited: '管理员登录尝试过多，请在 {seconds} 秒后重试。',
    totpRequired: '请输入身份验证器中的 6 位动态验证码。', totpFailed: '动态验证码不正确，请重试。',
    loginUpdated: '登录状态已更新，请重新输入主密码。',
    totpRetryRequired: '动态验证码连续多次错误，请在 {seconds} 秒后重试。',
    totpRateLimited: '动态验证码尝试次数过多，请在 {seconds} 秒后重试。',
    serviceUnavailable: '认证服务暂不可用，请稍后重试。',
    invalidResetKey: '认证重置密钥无效、已过期或已使用，请重新生成。',
    migrationTitle: '需要迁移管理员认证', migrationDetail: '请在容器 Root 终端运行 dsh-platform access generate-key，然后使用一次性密钥创建新账户。',
    resetTitle: '重置管理员认证', resetDetail: '请先在容器 Root 终端运行 dsh-platform access generate-key。重置会替换损坏或缺失的管理员账户。', setupKey: '认证重置密钥',
    recoveryTitle: '需要恢复管理员认证', recoveryDetail: '认证状态损坏或缺失。请使用 Root 终端生成认证重置密钥，然后重新创建管理员账户。', recoveryAction: '重置管理员认证',
    waitingTitle: '正在准备认证服务', waitingDetail: '平台正在确认本地管理员状态，请稍候。',
  } : {
    brand: 'HARNESS', username: 'Username', password: 'Password', totp: 'Authentication code', register: 'Register', login: 'Sign in',
    initializing: 'Creating the administrator account…', signingIn: 'Signing in…', resetting: 'Resetting administrator authentication…',
    failed: 'The username or password is incorrect. Try again.', registrationFailed: 'The administrator account could not be created. Check the entered values and try again.',
    concurrent: 'The administrator account already exists. Sign in with it.',
    invalidUsername: 'Use 1 to 64 characters. Unicode letters, numbers, spaces, and common symbols are supported; control and bidirectional-control characters are not.',
    invalidPassword: 'Use 8 to 1024 characters. Unicode letters, numbers, spaces, and symbols are supported; control and bidirectional-control characters are not.',
    retryRequired: 'This browser has made several consecutive failed attempts. Try again in {seconds} seconds.',
    rateLimited: 'Too many administrator sign-in attempts. Try again in {seconds} seconds.',
    totpRequired: 'Enter the 6-digit code from your authenticator app.', totpFailed: 'The authentication code is incorrect. Try again.',
    loginUpdated: 'The sign-in state has changed. Enter the main password again.',
    totpRetryRequired: 'Too many incorrect codes. Try again in {seconds} seconds.',
    totpRateLimited: 'Too many authentication-code attempts. Try again in {seconds} seconds.',
    serviceUnavailable: 'The authentication service is temporarily unavailable. Try again shortly.',
    invalidResetKey: 'The authentication reset key is invalid, expired, or already used. Generate a new key.',
    migrationTitle: 'Administrator migration required', migrationDetail: 'Run dsh-platform access generate-key from a root container terminal, then create a new account with the one-time key.',
    resetTitle: 'Reset administrator authentication', resetDetail: 'First run dsh-platform access generate-key from a root container terminal. Resetting replaces the missing or damaged administrator account.', setupKey: 'Authentication reset key',
    recoveryTitle: 'Administrator recovery required', recoveryDetail: 'Authentication state is missing or damaged. Generate an authentication reset key from a root container terminal, then recreate the administrator account.', recoveryAction: 'Reset administrator authentication',
    waitingTitle: 'Preparing authentication', waitingDetail: 'The platform is determining local administrator state. Please wait.',
  }
  let content
  if (state === 'never-initialized' || state === 'initialized' || state === 'migration-required'
    || (state === 'recovery-required' && resetForm)) {
    const initialize = state === 'never-initialized'
    const reset = state === 'migration-required' || state === 'recovery-required'
    const validateCredentials = initialize || reset
    const submit = initialize ? copy.register : reset ? copy.recoveryAction : copy.login
    const submitPath = reset
      ? `${AUTH_PREFIX}reset`
      : `${AUTH_PREFIX}session?return=${encodeURIComponent(returnPath)}`
    const registrationErrors = {
      ALREADY_INITIALIZED: copy.concurrent,
      USERNAME_INVALID: copy.invalidUsername,
      PASSWORD_POLICY_VIOLATION: copy.invalidPassword,
      AUTHENTICATION_RESET_KEY_INVALID: copy.invalidResetKey,
      ACCESS_MANAGER_UNAVAILABLE: copy.serviceUnavailable,
    }
    const fallbackError = initialize || reset ? copy.registrationFailed : copy.failed
    const context = reset
      ? `<h1>${state === 'migration-required' ? copy.migrationTitle : copy.resetTitle}</h1><p class="detail">${state === 'migration-required' ? copy.migrationDetail : copy.resetDetail}</p>`
      : ''
    const usernameValidation = validateCredentials
      ? ` required pattern="${htmlEscape(USERNAME_INPUT_PATTERN)}"` : ''
    const passwordValidation = validateCredentials
      ? ` required minlength="8" pattern="${htmlEscape(PASSWORD_INPUT_PATTERN)}"` : ''
    const usernameError = validateCredentials
      ? `<small class="field-error" data-field-error="username" role="alert" hidden>${htmlEscape(copy.invalidUsername)}</small>` : ''
    const passwordError = validateCredentials
      ? `<small class="field-error" data-field-error="password" role="alert" hidden>${htmlEscape(copy.invalidPassword)}</small>` : ''
    const validationScript = validateCredentials
      ? `function validateField(name){const input=form.elements[name],message=form.querySelector('[data-field-error="'+name+'"]'),valid=input.validity.valid;message.hidden=valid;return valid}form.elements.password.addEventListener('input',()=>validateField('password'));`
      : ''
    // Field hints are presentation-only. The Access Manager remains the sole
    // authority for registration, recovery, and credential validation.
    const validationGate = validateCredentials
      ? `validateField('username');validateField('password');` : ''
    const totpField = state === 'initialized'
      ? `<label id="totp-field" hidden>${copy.totp}<input name="totpCode" autocomplete="one-time-code" inputmode="numeric" maxlength="6"></label>` : ''
    content = `${context}<form method="post" action="${htmlEscape(submitPath)}" novalidate>${reset ? `<label>${copy.setupKey}<input name="setupKey" autocomplete="one-time-code" required maxlength="512" autofocus></label>` : ''}<label data-credential-field>${copy.username}<input name="username" autocomplete="username" maxlength="256"${usernameValidation}${reset ? '' : ' autofocus'}>${usernameError}</label><label data-credential-field>${copy.password}<input name="password" type="password" autocomplete="${validateCredentials ? 'new-password' : 'current-password'}" maxlength="1024"${passwordValidation}>${passwordError}</label>${totpField}<button type="submit">${submit}</button><p class="error" role="alert" hidden></p></form><script>const form=document.querySelector('form'),error=document.querySelector('.error'),button=form.querySelector('button'),totpField=document.querySelector('#totp-field'),failureMessages=${JSON.stringify(registrationErrors)},retryMessage=${JSON.stringify(copy.retryRequired)},rateLimitMessage=${JSON.stringify(copy.rateLimited)},totpRetryMessage=${JSON.stringify(copy.totpRetryRequired)},totpRateLimitMessage=${JSON.stringify(copy.totpRateLimited)};let csrfToken=${JSON.stringify(csrf)},authenticationContextId=${JSON.stringify(authenticationContextId)},totpPending=false;${authenticationCountdownScript(submit)}${validationScript}function showTotp(){totpPending=true;for(const field of form.querySelectorAll('[data-credential-field]'))field.hidden=true;totpField.hidden=false;form.elements.password.value='';error.textContent=${JSON.stringify(copy.totpRequired)};error.hidden=false;form.elements.totpCode.focus()}function resetTotp(message){totpPending=false;for(const field of form.querySelectorAll('[data-credential-field]'))field.hidden=false;totpField.hidden=true;form.elements.totpCode.value='';error.textContent=message;error.hidden=false;form.elements.username.focus()}async function submitAuthentication(values,retry=true){const requestBody=totpPending?{totpCode:values.get('totpCode')}:{${reset ? "setupKey:values.get('setupKey')," : ''}username:values.get('username'),password:values.get('password')},body=JSON.stringify({...requestBody,authenticationContext:authenticationContextId}),response=await fetch(${JSON.stringify(submitPath)},{method:'POST',headers:{'content-type':'application/json','x-dsh-csrf':csrfToken},body});const payload=await response.json().catch(()=>({}));if(response.status===409&&payload.code==='AUTHENTICATION_CONTEXT_STALE'&&retry&&!totpPending){const refreshed=await fetch(${JSON.stringify(`${AUTH_PREFIX}context`)},{headers:{accept:'application/json'},cache:'no-store'}),next=await refreshed.json().catch(()=>({}));if(refreshed.ok&&typeof next.csrfToken==='string'&&typeof next.authenticationContext==='string'){csrfToken=next.csrfToken;authenticationContextId=next.authenticationContext;return submitAuthentication(values,false)}}return{response,payload}}form.addEventListener('submit',async event=>{event.preventDefault();error.hidden=true;if(!totpPending){${validationGate}}button.disabled=true;button.textContent=${JSON.stringify(initialize ? copy.initializing : reset ? copy.resetting : copy.signingIn)};const values=new FormData(form);try{const{response,payload}=await submitAuthentication(values);if(response.ok&&payload.totpRequired===true){showTotp();return}if(response.ok){location.replace(typeof payload.next==='string'?payload.next:${JSON.stringify(returnPath)});return}if(totpPending){if(payload.code==='TOTP_LOGIN_INVALID'||payload.code==='AUTHENTICATION_CONTEXT_STALE'){resetTotp(${JSON.stringify(copy.loginUpdated)})}else if(payload.code==='TOTP_RETRY_REQUIRED'||payload.code==='TOTP_RATE_LIMITED'){showRetryCountdown(payload.code==='TOTP_RATE_LIMITED'?totpRateLimitMessage:totpRetryMessage,payload.retryAfterSeconds)}else{error.textContent=${JSON.stringify(copy.totpFailed)};error.hidden=false;form.elements.totpCode.select()}}else if(!showRetryFailure(payload)){error.textContent=failureMessages[payload.code]??${JSON.stringify(fallbackError)};error.hidden=false}}catch{error.textContent=${JSON.stringify(copy.serviceUnavailable)};error.hidden=false}finally{if(retryUntil<=Date.now())button.disabled=false;button.textContent=${JSON.stringify(submit)}}})</script>`
    if (state === 'initialized') {
      content += `<script>(()=>{const input=document.querySelector('input[name="totpCode"]'),form=input.form,button=form.querySelector('button'),error=form.querySelector('.error'),initialMessage=${JSON.stringify(copy.totpRequired)};const sync=()=>{error.hidden=true;error.textContent='';button.disabled=input.value.length!==6};input.addEventListener('focus',()=>queueMicrotask(()=>{if(error.textContent===initialMessage)sync()}));input.addEventListener('input',sync)})()</script>`
    }
  } else if (state === 'recovery-required') {
    const resetPath = `${AUTH_PREFIX}reset?return=${encodeURIComponent(returnPath)}`
    content = `<h1>${copy.recoveryTitle}</h1><p class="detail">${copy.recoveryDetail}</p><a class="button" href="${htmlEscape(resetPath)}">${copy.recoveryAction}</a>`
  } else content = `<h1>${copy.waitingTitle}</h1><p>${copy.waitingDetail}</p><script>setTimeout(()=>location.reload(),1000)</script>`
  return `<!doctype html><html lang="${zh ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(copy.brand)}</title><style>html{color-scheme:light dark}*{box-sizing:border-box}body{min-height:100dvh;margin:0;display:grid;place-items:center;background:#151517;color:#f3f3f4;font:14px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(400px,calc(100% - 32px));padding:28px;border:1px solid #3e3e42;border-radius:12px;background:#242426}.brand{text-align:center;margin:0 0 24px;font-size:18px;letter-spacing:.12em}h1{margin:0 0 8px;font-size:20px}p{margin:0;color:#aaaab0}.detail{margin-bottom:20px}form{display:grid;gap:16px}label{display:grid;gap:7px;font-weight:600}input{width:100%;padding:10px 12px;border:1px solid #55555b;border-radius:7px;background:#19191b;color:inherit;font:inherit}button,.button{display:block;width:100%;padding:10px 14px;border:0;border-radius:7px;background:#f2f2f3;color:#202124;font:600 14px/1.4 inherit;text-align:center;text-decoration:none;cursor:pointer}.error{color:#ff7777}[hidden]{display:none}@media(prefers-color-scheme:light){body{background:#f7f7f8;color:#202124}.card{background:#fff;border-color:#d7d7da}p{color:#6d6f76}input{background:#fff;border-color:#c7c8cc}button,.button{background:#202124;color:#fff}}</style></head><body><main class="card"><div class="brand">${htmlEscape(copy.brand)}</div>${content}</main></body></html>`
}

function managementTabSuffix(searchParams) {
  return searchParams?.get('tab') === 'auth-settings' ? '?tab=auth-settings' : ''
}

function managementConsoleDestination(searchParams, consolePath) {
  return searchParams?.get('tab') === 'auth-settings' ? `${consolePath}#auth-settings` : consolePath
}

function managementLoginPage(request, csrf, authenticationContextId, mainCredentialVersion, {
  authPrefix = AUTH_PREFIX,
  consolePath = '/_dsh_platform/console/',
  searchParams = new URLSearchParams(),
} = {}) {
  const zh = language(request) === 'zh'
  const copy = zh ? {
    title: 'DSH 管理中心', detail: '请输入管理中心密码。',
    password: '管理中心密码', submit: '登录', failed: '验证失败，请重试。',
    retryRequired: '当前浏览器已连续多次输入错误，请在 {seconds} 秒后重试。',
    rateLimited: '管理员登录尝试过多，请在 {seconds} 秒后重试。',
    serviceUnavailable: '认证服务暂不可用，请稍后重试。',
  } : {
    title: 'DSH Management Console', detail: 'Enter the Management console password.',
    password: 'Management console password', submit: 'Sign in', failed: 'Authentication failed. Try again.',
    retryRequired: 'This browser has made several consecutive failed attempts. Try again in {seconds} seconds.',
    rateLimited: 'Too many administrator sign-in attempts. Try again in {seconds} seconds.',
    serviceUnavailable: 'The authentication service is temporarily unavailable. Try again shortly.',
  }
  const submitPath = `${authPrefix}management/pending${managementTabSuffix(searchParams)}`
  const destination = managementConsoleDestination(searchParams, consolePath)
  return `<!doctype html><html lang="${zh ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${copy.title}</title><style>html{color-scheme:light dark}*{box-sizing:border-box}body{min-height:100dvh;margin:0;display:grid;place-items:center;background:#151517;color:#f3f3f4;font:14px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(400px,calc(100% - 32px));padding:28px;border:1px solid #3e3e42;border-radius:12px;background:#242426}h1{margin:0 0 6px;font-size:20px}p{margin:0 0 22px;color:#aaaab0}form{display:grid;gap:16px}label{display:grid;gap:7px;font-weight:600}input{width:100%;padding:10px 12px;border:1px solid #55555b;border-radius:7px;background:#19191b;color:inherit;font:inherit}button{padding:10px 14px;border:0;border-radius:7px;background:#f2f2f3;color:#202124;font:600 14px/1.4 inherit;cursor:pointer}.error{color:#ff7777}[hidden]{display:none}@media(prefers-color-scheme:light){body{background:#f7f7f8;color:#202124}.card{background:#fff;border-color:#d7d7da}p{color:#6d6f76}input{background:#fff;border-color:#c7c8cc}button{background:#202124;color:#fff}}</style></head><body><main class="card"><h1>${copy.title}</h1><p>${copy.detail}</p><form method="post" action="${htmlEscape(submitPath)}" novalidate><label>${copy.password}<input name="password" type="password" autocomplete="current-password" maxlength="1024" autofocus></label><button type="submit">${copy.submit}</button><p class="error" role="alert" hidden>${copy.failed}</p></form></main><script>const form=document.querySelector('form'),error=document.querySelector('.error'),button=form.querySelector('button'),retryMessage=${JSON.stringify(copy.retryRequired)},rateLimitMessage=${JSON.stringify(copy.rateLimited)},mainCredentialVersion=${JSON.stringify(mainCredentialVersion)};let csrfToken=${JSON.stringify(csrf)},authenticationContextId=${JSON.stringify(authenticationContextId)};${authenticationCountdownScript(copy.submit)}async function submitAuthentication(password,retry=true){const body=JSON.stringify({password,authenticationContext:authenticationContextId}),response=await fetch(${JSON.stringify(submitPath)},{method:'POST',headers:{'content-type':'application/json','x-dsh-csrf':csrfToken},body});const payload=await response.json().catch(()=>({}));if(response.status===409&&payload.code==='AUTHENTICATION_CONTEXT_STALE'&&retry){const refreshed=await fetch(${JSON.stringify(`${authPrefix}context`)},{headers:{accept:'application/json'},cache:'no-store'}),next=await refreshed.json().catch(()=>({}));if(refreshed.ok&&(next.managementAdditionalPasswordEnabled===false||next.mainCredentialVersion!==mainCredentialVersion)){location.replace(${JSON.stringify(`${authPrefix}management${managementTabSuffix(searchParams)}`)});return new Promise(()=>{})}if(refreshed.ok&&typeof next.csrfToken==='string'&&typeof next.authenticationContext==='string'){csrfToken=next.csrfToken;authenticationContextId=next.authenticationContext;return submitAuthentication(password,false)}}return{response,payload}}form.addEventListener('submit',async event=>{event.preventDefault();error.hidden=true;button.disabled=true;const values=new FormData(form);try{const{response,payload}=await submitAuthentication(values.get('password'));if(response.ok){location.replace(${JSON.stringify(destination)});return}if(!showRetryFailure(payload)){error.textContent=payload.code==='ACCESS_MANAGER_UNAVAILABLE'?${JSON.stringify(copy.serviceUnavailable)}:${JSON.stringify(copy.failed)};error.hidden=false;form.elements.password.select()}}catch{error.textContent=${JSON.stringify(copy.serviceUnavailable)};error.hidden=false}finally{if(retryUntil<=Date.now())button.disabled=false}})</script></body></html>`
}

export function createBrowserAuthentication({
  access,
  safeReturnPath,
  report = async () => {},
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
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
  const accessFailureBody = (error, fallback) => ({
    error: error.message,
    code: accessFailureCode(error, fallback),
    ...(Number.isInteger(error?.retryAfterSeconds)
      ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
  })
  const accessFailureHeaders = error => Number.isInteger(error?.retryAfterSeconds)
    ? { 'retry-after': String(error.retryAfterSeconds) } : {}
  const isAuthenticationDenial = error => [401, 403].includes(error?.statusCode)

  async function status() { return accessRequest('GET', '/v1/status') }

  async function authenticationStatus() {
    for (let attempt = 0; ; attempt++) {
      let current
      try { current = await status() }
      catch (error) {
        if (error?.browserAuthenticationBackend !== true || attempt >= 20) throw error
        await wait(250)
        continue
      }
      if (current.state !== 'classification-pending' || attempt >= 20) return current
      await wait(250)
    }
  }

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

  async function authorizePlugin(request, { method, target, requireCsrf = false } = {}) {
    const origin = requestOrigin(request)
    const dshToken = cookieValue(request.headers.cookie, DSH_SESSION_COOKIE)
    if (origin === undefined || dshToken === undefined) return { authorized: false }
    if (requireCsrf && !validSessionMutation(request, DSH_CSRF_COOKIE)) return { authorized: false }
    try {
      const result = await accessRequest('POST', '/v1/dsh/capabilities', {
        dshToken,
        origin,
        csrfToken: requireCsrf ? request.headers['x-dsh-csrf'] : undefined,
        requireCsrf,
        method,
        target,
      })
      return { authorized: true, capability: result.capability }
    } catch (error) {
      if (isAuthenticationDenial(error)) return { authorized: false }
      throw error
    }
  }

  async function sendManagementLogin(request, response, origin, searchParams) {
    const authContext = authenticationContext(request, origin, authPrefix)
    const current = await authenticationStatus()
    const bytes = Buffer.from(managementLoginPage(
      request, authContext.csrfToken, current.authenticationContext,
      current.account?.mainCredentialVersion, { authPrefix, consolePath, searchParams },
    ))
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-length': String(bytes.byteLength),
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'content-type': 'text/html; charset=utf-8',
      'cross-origin-opener-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
      'set-cookie': authContext.cookies,
      'x-content-type-options': 'nosniff',
    })
    response.end(bytes)
  }

  async function enterManagement(request, response, searchParams) {
    const origin = requestOrigin(request)
    if (origin === undefined) { sendJson(response, 400, { error: 'request origin is invalid' }); return }
    const current = await status()
    const valid = await validateDsh(request)
    if (!valid.authenticated) {
      const dshOrigin = current.account?.managementAccess?.mode === 'isolated'
        ? current.account.managementAccess.dshPublicOrigin
        : origin
      if (typeof dshOrigin !== 'string') {
        sendJson(response, 409, { error: 'DSH authentication entry is unavailable' })
        return
      }
      response.writeHead(303, {
        'cache-control': 'no-store',
        location: `${dshOrigin}${AUTH_PREFIX}?return=${encodeURIComponent(`${AUTH_PREFIX}management/start${managementTabSuffix(searchParams)}`)}`,
        'referrer-policy': 'no-referrer',
      })
      response.end()
      return
    }
    const entry = current.account?.managementAccess?.isolatedEntry
    if (current.account?.managementAccess?.mode === 'isolated' && entry?.kind === 'local-only') {
      const targetOrigin = entry.managementLocalOrigin
      if (typeof targetOrigin !== 'string') { sendJson(response, 409, { error: 'local Management entry is unavailable' }); return }
      const created = await accessRequest('POST', '/v1/management/handoffs', {
        dshToken: cookieValue(request.headers.cookie, DSH_SESSION_COOKIE),
        dshOrigin: origin,
        targetOrigin,
      })
      response.writeHead(303, {
        'cache-control': 'no-store',
        location: `${targetOrigin}/auth/management/handoff?token=${encodeURIComponent(created.handoff.token)}${managementTabSuffix(searchParams).replace('?', '&')}`,
        'referrer-policy': 'no-referrer',
      })
      response.end()
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
        ? `${targetOrigin}/auth/management/handoff?token=${encodeURIComponent(created.handoff.token)}${managementTabSuffix(searchParams).replace('?', '&')}`
        : `${AUTH_PREFIX}management/handoff?token=${encodeURIComponent(created.handoff.token)}${managementTabSuffix(searchParams).replace('?', '&')}`,
      'referrer-policy': 'no-referrer',
    })
    response.end()
  }

  async function managementHandoffLocation(current, { dshToken, dshOrigin }) {
    const entry = current.account?.managementAccess?.isolatedEntry
    const isolated = current.account?.managementAccess?.mode === 'isolated'
    const targetOrigin = isolated
      ? entry?.kind === 'local-only' ? entry.managementLocalOrigin : entry?.managementPublicOrigin
      : dshOrigin
    if (typeof targetOrigin !== 'string') throw Object.assign(new Error('Management entry is unavailable'), {
      code: 'MANAGEMENT_ENTRY_UNAVAILABLE', statusCode: 409,
    })
    const created = await accessRequest('POST', '/v1/management/handoffs', { dshToken, dshOrigin, targetOrigin })
    return isolated
      ? `${targetOrigin}/auth/management/handoff?token=${encodeURIComponent(created.handoff.token)}`
      : `${authPrefix}management/handoff?token=${encodeURIComponent(created.handoff.token)}`
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
        sendSameOriginNavigation(response, consolePath, managementCookies(result.session, origin, managementCookiePath))
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
    if (pathname === authPrefix + 'context' && request.method === 'GET') {
      if (!validAuthenticationContextRequest(request)) {
        sendJson(response, 403, { error: 'authentication context request rejected', code: 'REQUEST_FORBIDDEN' })
        return true
      }
      const origin = requestOrigin(request)
      const authContext = authenticationContext(request, origin, authPrefix)
      const current = await authenticationStatus()
      sendJson(response, 200, {
        csrfToken: authContext.csrfToken,
        authenticationContext: current.authenticationContext,
        managementAdditionalPasswordEnabled:
          current.account?.managementAdditionalCredential?.enabled === true,
        mainCredentialVersion: current.account?.mainCredentialVersion ?? null,
      }, { 'set-cookie': authContext.cookies })
      return true
    }
    const authenticationEntry = pathname === authPrefix.slice(0, -1) || pathname === authPrefix
    const authenticationReset = pathname === authPrefix + 'reset'
    if (authenticationEntry || (authenticationReset && ['GET', 'HEAD'].includes(request.method ?? 'GET'))) {
      if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) return false
      const current = await status()
      const valid = await validateDsh(request)
      const returnPath = safeReturnPath(searchParams.get('return'))
      if (current.state === 'initialized' && valid.authenticated) {
        sendSameOriginNavigation(response, returnPath)
        return true
      }
      const origin = requestOrigin(request) ?? 'http://invalid.local'
      const authContext = authenticationContext(request, origin, authPrefix)
      const resetForm = authenticationReset && current.state === 'recovery-required'
      if (authenticationReset && !resetForm) {
        response.writeHead(303, { 'cache-control': 'no-store', location: `${authPrefix}?return=${encodeURIComponent(returnPath)}` })
        response.end()
        return true
      }
      const bytes = Buffer.from(authenticationPage(
        request, current.state, authContext.csrfToken, current.authenticationContext, returnPath, { resetForm },
      ))
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': String(bytes.byteLength),
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        'content-type': 'text/html; charset=utf-8',
        'referrer-policy': 'no-referrer',
        'set-cookie': [
          ...authContext.cookies,
          ...clearInvalidBrowserSessionCookies(origin, managementCookiePath),
        ],
        'x-dsh-csrf': authContext.csrfToken,
        'x-content-type-options': 'nosniff',
      })
      response.end(request.method === 'HEAD' ? undefined : bytes)
      return true
    }
    if (pathname === authPrefix + 'session' && request.method === 'POST') {
      const csrf = cookieValue(request.headers.cookie, AUTH_CSRF_COOKIE)
      if (!validBrowserMutationShape(request)) {
        sendJson(response, 403, { error: 'authentication request rejected', code: 'REQUEST_FORBIDDEN' })
        return true
      }
      if (!validBrowserMutation(request, csrf)) {
        sendJson(response, 409, { error: 'authentication context is stale', code: 'AUTHENTICATION_CONTEXT_STALE' })
        return true
      }
      const origin = requestOrigin(request, { requireHeader: true })
      const value = await jsonBody(request)
      const current = await authenticationStatus()
      const completingTotp = current.state === 'initialized' && typeof value.totpCode === 'string'
      const route = current.state === 'never-initialized'
        ? '/v1/dsh/initialize' : completingTotp ? '/v1/dsh/totp/complete' : '/v1/dsh/login'
      if (!['never-initialized', 'initialized'].includes(current.state)) {
        sendJson(response, 409, { error: 'administrator access is unavailable', code: 'ACCESS_UNAVAILABLE' })
        return true
      }
      try {
        const result = await accessRequest('POST', route, {
          ...value,
          origin,
          client: loginClient(request),
          authenticationSource: authenticationSource(request),
          ...(completingTotp
            ? { challengeToken: cookieValue(request.headers.cookie, TOTP_LOGIN_COOKIE), code: value.totpCode }
            : {}),
        })
        if (result.totpRequired === true && result.challenge !== undefined) {
          sendJson(response, 202, { authenticated: false, totpRequired: true }, {
            'set-cookie': totpLoginCookie(result.challenge, origin, authPrefix),
          })
          return true
        }
        const returnPath = safeReturnPath(searchParams.get('return'))
        const next = current.state === 'initialized' && returnPath === `${authPrefix}management/start`
          ? await managementHandoffLocation(current, { dshToken: result.session.token, dshOrigin: origin })
          : returnPath
        await report(current.state === 'never-initialized' ? 'gateway.access.initialized' : 'gateway.access.logged-in')
        sendJson(response, current.state === 'never-initialized' ? 201 : 200, { authenticated: true, next }, {
          'set-cookie': sessionCookies(result.session, origin),
        })
      } catch (error) {
        await report('gateway.access.login-failed', { code: error.code ?? null, level: 'warning' })
        sendJson(response, accessFailureStatus(error), accessFailureBody(error, 'AUTHENTICATION_FAILED'), accessFailureHeaders(error))
      }
      return true
    }
    if (pathname === authPrefix + 'reset' && request.method === 'POST') {
      const csrf = cookieValue(request.headers.cookie, AUTH_CSRF_COOKIE)
      if (!validBrowserMutationShape(request)) {
        sendJson(response, 403, { error: 'authentication reset request rejected', code: 'REQUEST_FORBIDDEN' })
        return true
      }
      if (!validBrowserMutation(request, csrf)) {
        sendJson(response, 409, { error: 'authentication context is stale', code: 'AUTHENTICATION_CONTEXT_STALE' })
        return true
      }
      const origin = requestOrigin(request, { requireHeader: true })
      const current = await authenticationStatus()
      if (!['migration-required', 'recovery-required'].includes(current.state)) {
        sendJson(response, 409, { error: 'administrator authentication reset is unavailable', code: 'AUTHENTICATION_RESET_UNAVAILABLE' })
        return true
      }
      try {
        const result = await accessRequest('POST', '/v1/dsh/reset-authentication', {
          ...await jsonBody(request),
          origin,
          client: loginClient(request),
          authenticationSource: authenticationSource(request),
        })
        await report('gateway.access.authentication-reset', { previousState: current.state })
        sendJson(response, 201, { authenticated: true }, { 'set-cookie': sessionCookies(result.session, origin) })
      } catch (error) {
        await report('gateway.access.authentication-reset-failed', { code: error.code ?? null, level: 'warning' })
        sendJson(response, accessFailureStatus(error), { error: error.message, code: accessFailureCode(error, 'AUTHENTICATION_RESET_FAILED') })
      }
      return true
    }
    if (pathname === authPrefix + 'session-context' && request.method === 'GET') {
      const valid = await validateDsh(request)
      if (!valid.authenticated) {
        sendJson(response, 401, { error: 'authentication required', code: 'AUTHENTICATION_REQUIRED' })
        return true
      }
      const current = await status()
      sendJson(response, 200, {
        managementAdditionalPasswordEnabled:
          current.account?.managementAdditionalCredential?.enabled === true,
      })
      return true
    }
    if (pathname === authPrefix + 'browser-logout' && request.method === 'POST') {
      const valid = await validateDsh(request, { requireCsrf: true })
      const origin = requestOrigin(request, { requireHeader: true })
      if (!valid.authenticated || origin === undefined) {
        sendJson(response, 403, { error: 'logout request rejected', code: 'REQUEST_FORBIDDEN' })
        return true
      }
      const value = await jsonBody(request)
      if (!['management', 'all'].includes(value.scope)) {
        sendJson(response, 400, { error: 'logout scope is invalid', code: 'REQUEST_INVALID' })
        return true
      }
      const result = await accessRequest('POST', '/v1/dsh/browser-logout', {
        scope: value.scope,
        dshToken: cookieValue(request.headers.cookie, DSH_SESSION_COOKIE),
        dshOrigin: origin,
        managementToken: cookieValue(request.headers.cookie, MANAGEMENT_SESSION_COOKIE),
      })
      const cookies = value.scope === 'all'
        ? [...clearSessionCookies(origin), ...clearManagementCookies(origin, managementCookiePath)]
        : clearManagementCookies(origin, managementCookiePath)
      await report('gateway.access.browser-sessions-logged-out', { scope: value.scope })
      sendJson(response, 200, result, { 'set-cookie': cookies })
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
      sendJson(response, 200, { authenticated: false }, {
        'set-cookie': [...clearSessionCookies(origin), ...clearManagementCookies(origin, managementCookiePath)],
      })
      return true
    }
    if (pathname === authPrefix + 'management' && ['GET', 'HEAD'].includes(request.method ?? 'GET')) {
      await enterManagement(request, response, searchParams)
      return true
    }
    if (pathname === authPrefix + 'management/start' && ['GET', 'HEAD'].includes(request.method ?? 'GET')) {
      await enterManagement(request, response, searchParams)
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
          sendSameOriginNavigation(response, `${authPrefix}management/pending${managementTabSuffix(searchParams)}`, pendingCookie(result.pending, origin, authPrefix))
        } else {
          sendSameOriginNavigation(response, managementConsoleDestination(searchParams, consolePath), managementCookies(result.session, origin, managementCookiePath))
        }
      } catch (error) {
        sendJson(response, accessFailureStatus(error), { error: error.message, code: accessFailureCode(error, 'HANDOFF_INVALID') })
      }
      return true
    }
    if (pathname === authPrefix + 'management/pending' && ['GET', 'HEAD'].includes(request.method ?? 'GET')) {
      const origin = requestOrigin(request)
      if (origin === undefined || cookieValue(request.headers.cookie, MANAGEMENT_PENDING_COOKIE) === undefined) {
        response.writeHead(303, { 'cache-control': 'no-store', location: `${authPrefix}management${managementTabSuffix(searchParams)}` })
        response.end()
      } else await sendManagementLogin(request, response, origin, searchParams)
      return true
    }
    if (pathname === authPrefix + 'management/pending' && request.method === 'POST') {
      const csrf = cookieValue(request.headers.cookie, AUTH_CSRF_COOKIE)
      if (!validBrowserMutationShape(request)) {
        sendJson(response, 403, { error: 'authentication request rejected', code: 'REQUEST_FORBIDDEN' })
        return true
      }
      if (!validBrowserMutation(request, csrf)) {
        sendJson(response, 409, { error: 'authentication context is stale', code: 'AUTHENTICATION_CONTEXT_STALE' })
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
        sendJson(response, accessFailureStatus(error), accessFailureBody(error, 'AUTHENTICATION_FAILED'), accessFailureHeaders(error))
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

  return Object.freeze({ status, validateDsh, validateManagement, authorizeManagement, authorizePlugin, enterManagement, handle })
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
