import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import test from 'node:test'
import {
  createBrowserAuthentication,
  AUTH_CSRF_COOKIE,
  AUTH_RETRY_COOKIE,
  DSH_SESSION_COOKIE,
  MANAGEMENT_SESSION_COOKIE,
} from '../lib/browser-auth.mjs'
import { safeReturnPath } from '../lib/proxy.mjs'

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server.address().port
}

async function close(server) {
  server.closeAllConnections?.()
  await new Promise(resolve => server.close(resolve))
}

function request(port, { path = '/', method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port, path, method, headers }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    outgoing.once('error', reject)
    outgoing.end(body)
  })
}

function assertInlineScriptsCompile(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1])
  assert.ok(scripts.length > 0, 'expected at least one inline script')
  for (const script of scripts) assert.doesNotThrow(() => new Function(script))
}

function fixture(initialState = 'never-initialized', options = {}) {
  let state = initialState
  const sessions = new Map()
  const managementSessions = new Map()
  const managementSources = new Map()
  const handoffs = new Map()
  const transitionNonces = new Map([['transition-valid', 'nonce-valid']])
  const continuations = new Map([['continuation-valid', null]])
  const calls = []
  const access = {
    request: async (method, path, body) => {
      calls.push({ method, path, body })
      if (path === '/v1/status') return {
        state,
        account: state === 'initialized'
          ? {
              managementAdditionalCredential: { enabled: options.managementAdditionalEnabled ?? true },
              managementAccess: options.managementAccess
                ?? { mode: 'compat', isolatedEntry: null, dshPublicOrigin: null },
            }
          : null,
      }
      if (path === '/v1/dsh/initialize') {
        state = 'initialized'
        sessions.set('dshs_created', body.origin)
        return { session: { token: 'dshs_created', csrfToken: 'dshc_created' } }
      }
      if (path === '/v1/dsh/reset-authentication') {
        if (body.setupKey !== 'dshak_valid') throw Object.assign(new Error('authentication reset key is invalid or expired'), {
          code: 'AUTHENTICATION_RESET_KEY_INVALID', statusCode: 401,
        })
        state = 'initialized'
        sessions.set('dshs_reset', body.origin)
        return { session: { token: 'dshs_reset', csrfToken: 'dshc_reset' } }
      }
      if (path === '/v1/dsh/login') {
        if (body.password !== 'correct password') throw Object.assign(new Error('username or password is incorrect'), {
          code: 'AUTHENTICATION_FAILED', statusCode: 401,
        })
        sessions.set('dshs_logged_in', body.origin)
        return { session: { token: 'dshs_logged_in', csrfToken: 'dshc_logged_in' } }
      }
      if (path === '/v1/sessions/validate') return {
        authenticated: body.kind === 'dsh'
          ? sessions.get(body.token) === body.origin
          : managementSessions.get(body.token) === body.origin
            && sessions.has(managementSources.get(body.token)),
      }
      if (path === '/v1/sessions/logout') {
        if (sessions.delete(body.token)) {
          for (const [token, source] of managementSources) {
            if (source !== body.token) continue
            managementSources.delete(token)
            managementSessions.delete(token)
          }
        }
        managementSessions.delete(body.token)
        managementSources.delete(body.token)
        return { authenticated: false }
      }
      if (path === '/v1/dsh/browser-logout') {
        let managementRevoked = 0
        for (const [token, source] of managementSources) {
          if (source !== body.dshToken) continue
          managementSources.delete(token)
          managementSessions.delete(token)
          managementRevoked += 1
        }
        if (typeof body.managementToken === 'string' && managementSessions.delete(body.managementToken)) {
          managementSources.delete(body.managementToken)
          managementRevoked += 1
        }
        const dshRevoked = body.scope === 'all' && sessions.delete(body.dshToken)
        return { authenticated: body.scope !== 'all', dshRevoked, managementRevoked }
      }
      if (path === '/v1/dsh/capabilities') {
        if (sessions.get(body.dshToken) !== body.origin) {
          throw Object.assign(new Error('session invalid'), { statusCode: 401 })
        }
        return { capability: { token: 'dshcap_plugin', expiresAt: new Date(Date.now() + 5_000).toISOString() } }
      }
      if (path === '/v1/management/handoffs') {
        if (sessions.get(body.dshToken) !== body.dshOrigin) throw Object.assign(new Error('session invalid'), { statusCode: 401 })
        handoffs.set('dshh_created', { targetOrigin: body.targetOrigin, dshToken: body.dshToken })
        return { handoff: { token: 'dshh_created' } }
      }
      if (path === '/v1/management/handoffs/consume') {
        const handoff = handoffs.get(body.token)
        if (handoff?.targetOrigin !== body.origin) throw Object.assign(new Error('handoff invalid'), { statusCode: 401 })
        handoffs.delete(body.token)
        managementSessions.set('dshms_exchanged', body.origin)
        managementSources.set('dshms_exchanged', handoff.dshToken)
        return { session: { token: 'dshms_exchanged', csrfToken: 'dshc_management' } }
      }
      if (path === '/v1/management/transitions/probe') {
        if (transitionNonces.get(body.transitionId) !== body.nonce) {
          throw Object.assign(new Error('transition probe is invalid'), {
            code: 'TRANSITION_PROBE_INVALID', statusCode: 401,
          })
        }
        transitionNonces.delete(body.transitionId)
        return { proof: 'proof-valid' }
      }
      if (path === '/v1/management/continuations/consume') {
        if (!continuations.has(body.token)) {
          throw Object.assign(new Error('continuation is invalid'), {
            code: 'CONTINUATION_INVALID', statusCode: 401,
          })
        }
        continuations.delete(body.token)
        managementSessions.set('dshms_continued', body.origin)
        return { session: { token: 'dshms_continued', csrfToken: 'dshc_continued' } }
      }
      throw new Error(`unexpected request ${method} ${path}`)
    },
  }
  const authentication = createBrowserAuthentication({ access, safeReturnPath })
  const server = createServer((incoming, response) => {
    const url = new URL(incoming.url, 'http://gateway.internal')
    void authentication.handle(incoming, response, url.pathname, url.searchParams).then(handled => {
      if (!handled) { response.writeHead(404); response.end() }
    })
  })
  return { access, authentication, calls, server, sessions, managementSessions, state: () => state }
}

test('Management transition probe exposes a proof only to its exact source Origin and consumes the nonce', async () => {
  const current = fixture('initialized')
  const port = await listen(current.server)
  try {
    const sourceOrigin = 'https://dsh.example'
    const path = '/_dsh_platform/transition/probe?transitionId=transition-valid&nonce=nonce-valid'
    const first = await request(port, {
      path,
      headers: { host: `127.0.0.1:${port}`, origin: sourceOrigin, accept: 'application/json' },
    })
    assert.equal(first.status, 200)
    assert.equal(first.headers['access-control-allow-origin'], sourceOrigin)
    assert.equal(first.headers['access-control-allow-credentials'], undefined)
    assert.equal(first.headers.vary, 'Origin')
    assert.deepEqual(JSON.parse(first.body), { proof: 'proof-valid' })
    const call = current.calls.find(value => value.path === '/v1/management/transitions/probe')
    assert.equal(call.body.sourceOrigin, sourceOrigin)
    assert.equal(call.body.candidateOrigin, `http://127.0.0.1:${port}`)

    const replay = await request(port, {
      path,
      headers: { host: `127.0.0.1:${port}`, origin: sourceOrigin, accept: 'application/json' },
    })
    assert.equal(replay.status, 401)
    assert.equal(replay.headers['access-control-allow-origin'], sourceOrigin)
  } finally { await close(current.server) }
})

test('Management continuation requires a top-level navigation and creates one session once', async () => {
  const current = fixture('initialized')
  const port = await listen(current.server)
  try {
    const path = '/_dsh_platform/transition/continue?token=continuation-valid'
    const forbidden = await request(port, {
      path,
      headers: { host: `127.0.0.1:${port}`, 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' },
    })
    assert.equal(forbidden.status, 403)

    const consumed = await request(port, {
      path,
      headers: { host: `127.0.0.1:${port}`, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
    })
    assert.equal(consumed.status, 200)
    assert.match(consumed.body, /location\.replace\("\/_dsh_platform\/console\/"\)/)
    assert.match(consumed.headers['set-cookie'][0], new RegExp(`^${MANAGEMENT_SESSION_COOKIE}=dshms_continued`))
    assert.match(consumed.headers['set-cookie'][0], /Path=\/_dsh_platform\//)

    const replay = await request(port, {
      path,
      headers: { host: `127.0.0.1:${port}`, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
    })
    assert.equal(replay.status, 401)
  } finally { await close(current.server) }
})

test('isolated Management continuation creates root-path cookies and enters from its own Origin', async () => {
  const current = fixture('initialized')
  const isolated = createBrowserAuthentication({
    access: current.access,
    safeReturnPath,
    paths: { authPrefix: '/auth/', accessPrefix: '/access/', transitionPrefix: '/transition/', consolePath: '/' },
  })
  const server = createServer((incoming, response) => {
    const url = new URL(incoming.url, 'http://gateway.internal')
    void isolated.handle(incoming, response, url.pathname, url.searchParams).then(handled => {
      if (!handled) { response.writeHead(404); response.end() }
    })
  })
  const port = await listen(server)
  try {
    const consumed = await request(port, {
      path: '/transition/continue?token=continuation-valid',
      headers: { host: `127.0.0.1:${port}`, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
    })
    assert.equal(consumed.status, 200)
    assert.match(consumed.body, /location\.replace\("\/"\)/)
    assert.match(consumed.headers['set-cookie'][0], new RegExp(`^${MANAGEMENT_SESSION_COOKIE}=dshms_continued`))
    assert.match(consumed.headers['set-cookie'][0], /Path=\//)
    assert.doesNotMatch(consumed.headers['set-cookie'][0], /Path=\/_dsh_platform\//)
  } finally { await close(server) }
})

test('renders state-driven initialization and recovery pages without exposing account material', async () => {
  for (const [state, expected] of [
    ['classification-pending', /Preparing authentication/],
    ['never-initialized', /autocomplete="new-password"/],
    ['initialized', /autocomplete="current-password"/],
    ['migration-required', /Administrator migration required/],
    ['recovery-required', /Administrator recovery required/],
  ]) {
    const current = fixture(state)
    const port = await listen(current.server)
    try {
      const response = await request(port, {
        path: '/_dsh_platform/auth/?return=https://evil.example/',
        headers: { host: `127.0.0.1:${port}`, 'accept-language': 'en' },
      })
      assert.equal(response.status, 200)
      assert.match(response.body, expected)
      assert.match(response.headers['cache-control'], /no-store/)
      assert.match(response.headers['x-dsh-csrf'], /^dsha_/)
      assert.match(response.headers['set-cookie'][1], new RegExp(`^${AUTH_RETRY_COOKIE}=dshr_`))
      assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/)
      assert.doesNotMatch(response.body, /https:\/\/evil\.example/)
      if (state === 'classification-pending') {
        assert.match(response.body, /setTimeout\(\(\)=>location\.reload\(\),1000\)/)
        assert.doesNotMatch(response.body, /<form/)
      } else if (state !== 'recovery-required') {
        assertInlineScriptsCompile(response.body)
        assert.match(response.body, /<form method="post" action="\/_dsh_platform\/auth\/(?:session(?:\?return=[^"]+)?|reset)" novalidate>/)
        assert.doesNotMatch(response.body, /elements\.username\.addEventListener\('input'/)
        if (state === 'never-initialized' || state === 'migration-required') {
          assert.match(response.body, /class="field-error" data-field-error="username"[^>]*hidden/)
          assert.match(response.body, /class="field-error" data-field-error="password"[^>]*hidden/)
          assert.match(response.body, /form\.elements\.password\.addEventListener\('input'/)
        } else {
          assert.doesNotMatch(response.body, /class="field-error"|invalidUsername|invalidPassword|validateField/)
          assert.doesNotMatch(response.body, /minlength="8"|pattern="/)
        }
        if (state === 'never-initialized') {
          assert.doesNotMatch(response.body, /name="setupKey"/)
          assert.doesNotMatch(response.body, /<h1>/)
        }
      } else {
        assert.match(response.body, /href="\/_dsh_platform\/auth\/reset\?return=/)
        assert.doesNotMatch(response.body, /name="setupKey"/)
      }
    } finally { await close(current.server) }
  }
})

test('a DSH session exchanges once for a separate Management session', async () => {
  const current = fixture('initialized')
  const port = await listen(current.server)
  try {
    const origin = `http://127.0.0.1:${port}`
    current.sessions.set('dshs_existing', origin)
    const response = { writeHead(status, headers) { this.status = status; this.headers = headers }, end() {} }
    await current.authentication.enterManagement({
      headers: { host: `127.0.0.1:${port}`, cookie: `${DSH_SESSION_COOKIE}=dshs_existing` },
    }, response)
    assert.equal(response.status, 303)
    assert.match(response.headers.location, /management\/handoff\?token=dshh_created$/)

    const exchanged = await request(port, {
      path: response.headers.location,
      headers: { host: `127.0.0.1:${port}`, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
    })
    assert.equal(exchanged.status, 200)
    assert.match(exchanged.body, /location\.replace\("\/_dsh_platform\/console\/"\)/)
    assert.match(exchanged.headers['set-cookie'][0], new RegExp(`^${MANAGEMENT_SESSION_COOKIE}=dshms_exchanged`))
    const replay = await request(port, {
      path: response.headers.location,
      headers: { host: `127.0.0.1:${port}`, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
    })
    assert.equal(replay.status, 401)
  } finally { await close(current.server) }
})

test('a Management handoff preserves the fixed Authentication settings destination', async () => {
  const current = fixture('initialized')
  const port = await listen(current.server)
  try {
    const origin = `http://127.0.0.1:${port}`
    current.sessions.set('dshs_existing', origin)
    const response = { writeHead(status, headers) { this.status = status; this.headers = headers }, end() {} }
    await current.authentication.enterManagement({
      headers: { host: `127.0.0.1:${port}`, cookie: `${DSH_SESSION_COOKIE}=dshs_existing` },
    }, response, new URLSearchParams('tab=auth-settings'))
    assert.equal(response.status, 303)
    assert.match(response.headers.location, /management\/handoff\?token=dshh_created&tab=auth-settings$/)

    const exchanged = await request(port, {
      path: response.headers.location,
      headers: { host: `127.0.0.1:${port}`, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
    })
    assert.equal(exchanged.status, 200)
    assert.match(exchanged.body, /location\.replace\("\/_dsh_platform\/console\/#auth-settings"\)/)
  } finally { await close(current.server) }
})

test('initialization requires same-origin JSON and a matching login CSRF token', async () => {
  const current = fixture()
  const port = await listen(current.server)
  try {
    const page = await request(port, {
      path: '/_dsh_platform/auth/', headers: { host: `127.0.0.1:${port}` },
    })
    const csrfCookie = page.headers['set-cookie'][0].split(';')[0]
    const retryCookie = page.headers['set-cookie'][1].split(';')[0]
    const browserCookies = `${csrfCookie}; ${retryCookie}`
    const csrf = csrfCookie.split('=')[1]
    const rejected = await request(port, {
      path: '/_dsh_platform/auth/session', method: 'POST',
      headers: {
        host: `127.0.0.1:${port}`, origin: 'https://evil.example',
        cookie: browserCookies, 'content-type': 'application/json', 'x-dsh-csrf': csrf,
      },
      body: JSON.stringify({ username: 'admin', password: 'correct password' }),
    })
    assert.equal(rejected.status, 403)

    const initialized = await request(port, {
      path: '/_dsh_platform/auth/session', method: 'POST',
      headers: {
        host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`,
        cookie: browserCookies, 'content-type': 'application/json', 'x-dsh-csrf': csrf,
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'user-agent': 'Session Test Browser',
      },
      body: JSON.stringify({ username: 'admin', password: 'correct password' }),
    })
    assert.equal(initialized.status, 201)
    assert.equal(current.state(), 'initialized')
    assert.match(initialized.headers['set-cookie'][0], new RegExp(`^${DSH_SESSION_COOKIE}=dshs_created`))
    const initialization = current.calls.find(call => call.path === '/v1/dsh/initialize')
    assert.equal(initialization.body.client.userAgent, 'Session Test Browser')
    assert.equal(initialization.body.client.ip, '127.0.0.1')
    assert.match(initialization.body.authenticationSource, /^browser:[A-Za-z0-9_-]+$/)
  } finally { await close(current.server) }
})

test('parallel login pages share a stable context and stale submissions never become credential failures', async () => {
  const current = fixture('initialized')
  const port = await listen(current.server)
  try {
    const host = `127.0.0.1:${port}`
    const origin = `http://${host}`
    const first = await request(port, { path: '/_dsh_platform/auth/', headers: { host } })
    const firstCsrfCookie = first.headers['set-cookie'][0].split(';')[0]
    const firstRetryCookie = first.headers['set-cookie'][1].split(';')[0]
    const firstCsrf = firstCsrfCookie.split('=')[1]
    const second = await request(port, {
      path: '/_dsh_platform/auth/',
      headers: { host, cookie: `${firstCsrfCookie}; ${firstRetryCookie}` },
    })
    const secondCsrfCookie = second.headers['set-cookie'][0].split(';')[0]
    assert.equal(secondCsrfCookie, firstCsrfCookie)

    const stale = await request(port, {
      path: '/_dsh_platform/auth/session', method: 'POST',
      headers: {
        host, origin, cookie: `${AUTH_CSRF_COOKIE}=dsha_newer; ${firstRetryCookie}`,
        'content-type': 'application/json', 'x-dsh-csrf': firstCsrf,
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
      },
      body: JSON.stringify({ username: 'admin', password: 'correct password' }),
    })
    assert.equal(stale.status, 409)
    assert.equal(JSON.parse(stale.body).code, 'AUTHENTICATION_CONTEXT_STALE')
    assert.equal(current.calls.some(call => call.path === '/v1/dsh/login'), false)
    assert.match(first.body, /AUTHENTICATION_CONTEXT_STALE/)
    assert.match(first.body, /auth\/context/)

    const refreshed = await request(port, {
      path: '/_dsh_platform/auth/context',
      headers: {
        host, cookie: `${AUTH_CSRF_COOKIE}=dsha_newer; ${firstRetryCookie}`,
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
      },
    })
    assert.equal(refreshed.status, 200)
    assert.equal(JSON.parse(refreshed.body).csrfToken, 'dsha_newer')
    const recovered = await request(port, {
      path: '/_dsh_platform/auth/session', method: 'POST',
      headers: {
        host, origin, cookie: `${AUTH_CSRF_COOKIE}=dsha_newer; ${firstRetryCookie}`,
        'content-type': 'application/json', 'x-dsh-csrf': 'dsha_newer',
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
      },
      body: JSON.stringify({ username: 'admin', password: 'correct password' }),
    })
    assert.equal(recovered.status, 200)
    assert.equal(current.calls.filter(call => call.path === '/v1/dsh/login').length, 1)
  } finally { await close(current.server) }
})

test('login reports an unavailable Access Manager instead of a credential failure', async () => {
  const access = {
    request: async (_method, path) => {
      if (path === '/v1/status') return { state: 'initialized' }
      throw new Error('access socket unavailable')
    },
  }
  const authentication = createBrowserAuthentication({ access, safeReturnPath })
  const server = createServer((incoming, response) => {
    const url = new URL(incoming.url, 'http://gateway.internal')
    void authentication.handle(incoming, response, url.pathname, url.searchParams)
  })
  const port = await listen(server)
  try {
    const origin = `http://127.0.0.1:${port}`
    const page = await request(port, {
      path: '/_dsh_platform/auth/', headers: { host: `127.0.0.1:${port}` },
    })
    const csrfCookie = page.headers['set-cookie'][0].split(';')[0]
    const csrf = csrfCookie.split('=')[1]
    const response = await request(port, {
      path: '/_dsh_platform/auth/session', method: 'POST',
      headers: {
        host: `127.0.0.1:${port}`, origin, cookie: csrfCookie,
        'content-type': 'application/json', 'x-dsh-csrf': csrf,
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
      },
      body: JSON.stringify({ username: 'admin', password: 'correct password' }),
    })
    assert.equal(response.status, 503)
    assert.equal(JSON.parse(response.body).code, 'ACCESS_MANAGER_UNAVAILABLE')
    assert.match(page.body, /authentication service is temporarily unavailable/i)
  } finally { await close(server) }
})

test('login waits for a restarting Access Manager before submitting credentials once', async () => {
  let restarting = false
  let statusAttempts = 0
  let loginAttempts = 0
  const access = {
    request: async (_method, path) => {
      if (path === '/v1/status') {
        statusAttempts += 1
        if (restarting && statusAttempts < 4) throw new Error('access socket unavailable')
        return { state: 'initialized', account: { managementAccess: { mode: 'compat' } } }
      }
      if (path === '/v1/dsh/login') {
        loginAttempts += 1
        return { session: { token: 'dshs_restarted', csrfToken: 'dshc_restarted' } }
      }
      if (path === '/v1/sessions/validate') return { authenticated: false }
      throw new Error(`unexpected Access request: ${path}`)
    },
  }
  const authentication = createBrowserAuthentication({ access, safeReturnPath, wait: async () => {} })
  const server = createServer((incoming, response) => {
    const url = new URL(incoming.url, 'http://gateway.internal')
    void authentication.handle(incoming, response, url.pathname, url.searchParams)
  })
  const port = await listen(server)
  try {
    const host = `127.0.0.1:${port}`
    const origin = `http://${host}`
    const page = await request(port, { path: '/_dsh_platform/auth/', headers: { host } })
    const csrfCookie = page.headers['set-cookie'][0].split(';')[0]
    const retryCookie = page.headers['set-cookie'][1].split(';')[0]
    const csrf = csrfCookie.split('=')[1]
    statusAttempts = 0
    restarting = true
    const response = await request(port, {
      path: '/_dsh_platform/auth/session', method: 'POST',
      headers: {
        host, origin, cookie: `${csrfCookie}; ${retryCookie}`,
        'content-type': 'application/json', 'x-dsh-csrf': csrf,
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
      },
      body: JSON.stringify({ username: 'admin', password: 'correct password' }),
    })
    assert.equal(response.status, 200)
    assert.equal(statusAttempts, 4)
    assert.equal(loginAttempts, 1)
  } finally { await close(server) }
})

test('login preserves explicit Access Manager rate limits', async () => {
  const access = {
    request: async (_method, path) => {
      if (path === '/v1/status') return { state: 'initialized' }
      throw Object.assign(new Error('authentication is temporarily unavailable'), {
        statusCode: 429,
        code: 'AUTHENTICATION_RETRY_REQUIRED',
        retryAfterSeconds: 7,
      })
    },
  }
  const authentication = createBrowserAuthentication({ access, safeReturnPath })
  const server = createServer((incoming, response) => {
    const url = new URL(incoming.url, 'http://gateway.internal')
    void authentication.handle(incoming, response, url.pathname, url.searchParams)
  })
  const port = await listen(server)
  try {
    const origin = `http://127.0.0.1:${port}`
    const page = await request(port, {
      path: '/_dsh_platform/auth/', headers: { host: `127.0.0.1:${port}` },
    })
    const csrfCookie = page.headers['set-cookie'][0].split(';')[0]
    const csrf = csrfCookie.split('=')[1]
    const response = await request(port, {
      path: '/_dsh_platform/auth/session', method: 'POST',
      headers: {
        host: `127.0.0.1:${port}`, origin, cookie: csrfCookie,
        'content-type': 'application/json', 'x-dsh-csrf': csrf,
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
      },
      body: JSON.stringify({ username: 'admin', password: 'wrong password' }),
    })
    assert.equal(response.status, 429)
    assert.equal(response.headers['retry-after'], '7')
    assert.deepEqual(JSON.parse(response.body), {
      error: 'authentication is temporarily unavailable',
      code: 'AUTHENTICATION_RETRY_REQUIRED',
      retryAfterSeconds: 7,
    })
  } finally { await close(server) }
})

test('legacy migration exchanges a root-issued authentication reset key for a DSH session', async () => {
  const current = fixture('migration-required')
  const port = await listen(current.server)
  try {
    const origin = `http://127.0.0.1:${port}`
    const page = await request(port, {
      path: '/_dsh_platform/auth/', headers: { host: `127.0.0.1:${port}`, 'accept-language': 'en' },
    })
    assert.match(page.body, /name="setupKey"/)
    assert.match(page.body, /method="post"/)
    assert.match(page.body, /Use 8 to 1024 characters\. Unicode letters, numbers, spaces, and symbols are supported; control and bidirectional-control characters are not\./)
    assert.match(page.body, /The authentication reset key is invalid, expired, or already used\./)
    assert.match(page.body, /name="username"[^>]+pattern="\[\^\\p\{Cc\}/)
    assert.match(page.body, /name="password"[^>]+minlength="8"[^>]+pattern="\[\^\\p\{Cc\}/)
    assert.doesNotMatch(page.body, /name="password"[^>]*value=/)
    assertInlineScriptsCompile(page.body)
    const csrfCookie = page.headers['set-cookie'][0].split(';')[0]
    const csrf = csrfCookie.split('=')[1]
    const migrated = await request(port, {
      path: '/_dsh_platform/auth/reset', method: 'POST',
      headers: {
        host: `127.0.0.1:${port}`, origin, cookie: csrfCookie,
        'content-type': 'application/json', 'x-dsh-csrf': csrf,
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
      },
      body: JSON.stringify({ setupKey: 'dshak_valid', username: 'admin', password: 'correct password' }),
    })
    assert.equal(migrated.status, 201)
    assert.match(migrated.headers['set-cookie'][0], new RegExp(`^${DSH_SESSION_COOKIE}=dshs_reset`))
    assert.equal(current.calls.some(call => call.path === '/v1/dsh/reset-authentication'), true)
  } finally { await close(current.server) }
})

test('migration and initialization pages distinguish registration errors from login failures', async () => {
  for (const [state, language, expected] of [
    ['never-initialized', 'zh-CN', ['密码支持 8 至 1024 个字符，可使用中文、字母、数字、空格和符号；不能包含控制字符或双向控制字符。', '无法创建管理员账户，请检查填写内容后重试。']],
    ['migration-required', 'zh-CN', ['认证重置密钥无效、已过期或已使用，请重新生成。', '密码支持 8 至 1024 个字符，可使用中文、字母、数字、空格和符号；不能包含控制字符或双向控制字符。']],
    ['never-initialized', 'en', ['Use 8 to 1024 characters. Unicode letters, numbers, spaces, and symbols are supported; control and bidirectional-control characters are not.', 'The administrator account could not be created.']],
  ]) {
    const current = fixture(state)
    const port = await listen(current.server)
    try {
      const page = await request(port, {
        path: '/_dsh_platform/auth/',
        headers: { host: `127.0.0.1:${port}`, 'accept-language': language },
      })
      for (const message of expected) assert.match(page.body, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      assertInlineScriptsCompile(page.body)
    } finally { await close(current.server) }
  }
})

test('damaged authentication requires an explicit reset page and never places credentials in its URL', async () => {
  const current = fixture('recovery-required')
  const port = await listen(current.server)
  try {
    const origin = `http://127.0.0.1:${port}`
    const recovery = await request(port, {
      path: '/_dsh_platform/auth/', headers: { host: `127.0.0.1:${port}`, 'accept-language': 'en' },
    })
    assert.match(recovery.body, /Reset administrator authentication/)
    assert.doesNotMatch(recovery.body, /name="(?:setupKey|username|password)"/)

    const page = await request(port, {
      path: '/_dsh_platform/auth/reset?return=%2Fsettings',
      headers: { host: `127.0.0.1:${port}`, 'accept-language': 'en' },
    })
    assert.equal(page.status, 200)
    assert.match(page.body, /<form method="post" action="\/_dsh_platform\/auth\/reset" novalidate>/)
    assert.doesNotMatch(page.body, /dshak_valid|username=|password=/)
    const csrfCookie = page.headers['set-cookie'][0].split(';')[0]
    const csrf = csrfCookie.split('=')[1]
    const reset = await request(port, {
      path: '/_dsh_platform/auth/reset', method: 'POST',
      headers: {
        host: `127.0.0.1:${port}`, origin, cookie: csrfCookie,
        'content-type': 'application/json', 'x-dsh-csrf': csrf,
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
      },
      body: JSON.stringify({ setupKey: 'dshak_valid', username: 'recovered', password: 'correct password' }),
    })
    assert.equal(reset.status, 201)
    assert.equal(current.calls.some(call => call.path === '/v1/dsh/reset-authentication'), true)
  } finally { await close(current.server) }
})

test('login sessions are origin-bound and safe return paths remain local', async () => {
  const current = fixture('initialized')
  const port = await listen(current.server)
  try {
    const page = await request(port, {
      path: '/_dsh_platform/auth/?return=%2Fsettings%3Fsection%3Dplugins',
      headers: { host: `127.0.0.1:${port}` },
    })
    assert.doesNotMatch(page.body, /Administrator sign in|Enter the local administrator account/)
    assert.doesNotMatch(page.body, /<h1>/)
    const csrfCookie = page.headers['set-cookie'][0].split(';')[0]
    const csrf = csrfCookie.split('=')[1]
    const login = await request(port, {
      path: '/_dsh_platform/auth/session', method: 'POST',
      headers: {
        host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`,
        cookie: csrfCookie, 'content-type': 'application/json', 'x-dsh-csrf': csrf,
      },
      body: JSON.stringify({ username: 'admin', password: 'correct password' }),
    })
    assert.equal(login.status, 200)
    const sessionCookie = login.headers['set-cookie'][0].split(';')[0]
    assert.equal((await current.authentication.validateDsh({ headers: {
      host: `127.0.0.1:${port}`, cookie: sessionCookie,
    } })).authenticated, true)
    assert.equal((await current.authentication.validateDsh({ headers: {
      host: 'different.example', cookie: sessionCookie,
    } })).authenticated, false)
    assert.equal(safeReturnPath('//evil.example'), '/')
    assert.equal(safeReturnPath('/settings?section=plugins'), '/settings?section=plugins')
  } finally { await close(current.server) }
})

test('direct Management access requires a DSH login before exchanging a Management session', async () => {
  const current = fixture('initialized', { managementAdditionalEnabled: false })
  const port = await listen(current.server)
  try {
    const origin = `http://127.0.0.1:${port}`
    const staleCookies = `${DSH_SESSION_COOKIE}=dshs_previous_instance; ${MANAGEMENT_SESSION_COOKIE}=dshms_previous_instance`
    const entry = await request(port, {
      path: '/_dsh_platform/auth/management', headers: {
        host: `127.0.0.1:${port}`, cookie: staleCookies,
      },
    })
    assert.equal(entry.status, 303)
    const loginEntry = new URL(entry.headers.location)
    assert.equal(loginEntry.origin, origin)
    assert.equal(loginEntry.pathname, '/_dsh_platform/auth/')
    assert.equal(loginEntry.searchParams.get('return'), '/_dsh_platform/auth/management/start')
    const page = await request(port, {
      path: `${loginEntry.pathname}${loginEntry.search}`, headers: {
        host: `127.0.0.1:${port}`, cookie: staleCookies,
      },
    })
    assert.doesNotMatch(page.body, /field-error|invalidUsername|invalidPassword|validateField/)
    assert.doesNotMatch(page.body, /minlength="8"|pattern="/)
    const loginCsrfCookie = page.headers['set-cookie'][0].split(';')[0]
    const loginCsrf = loginCsrfCookie.split('=')[1]
    const dshLogin = await request(port, {
      path: '/_dsh_platform/auth/session?return=%2F_dsh_platform%2Fauth%2Fmanagement%2Fstart', method: 'POST',
      headers: {
        host: `127.0.0.1:${port}`, origin, cookie: loginCsrfCookie,
        'content-type': 'application/json', 'x-dsh-csrf': loginCsrf,
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
      },
      body: JSON.stringify({ username: 'admin', password: 'correct password' }),
    })
    assert.equal(dshLogin.status, 200)
    const loginResult = JSON.parse(dshLogin.body)
    assert.equal(loginResult.authenticated, true)
    assert.match(loginResult.next, /^\/_dsh_platform\/auth\/management\/handoff\?token=dshh_created$/)
    const dshCookie = dshLogin.headers['set-cookie'][0].split(';')[0]
    const exchanged = await request(port, {
      path: loginResult.next,
      headers: { host: `127.0.0.1:${port}`, cookie: dshCookie },
    })
    assert.equal(exchanged.status, 200)
    assert.match(exchanged.body, /location\.replace\("\/_dsh_platform\/console\/"\)/)
    assert.match(exchanged.headers['set-cookie'][0], new RegExp(`^${MANAGEMENT_SESSION_COOKIE}=dshms_exchanged`))
    assert.equal(current.calls.some(call => call.path === '/v1/management/login'), false)
    assert.equal((await request(port, {
      path: '/_dsh_platform/auth/management/session', method: 'POST',
      headers: { host: `127.0.0.1:${port}`, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'correct password' }),
    })).status, 404)
  } finally { await close(current.server) }
})

test('isolated Management sends the first login layer to the verified DSH Origin', async () => {
  const current = fixture('initialized', {
    managementAccess: {
      mode: 'isolated',
      dshPublicOrigin: 'https://dsh.example',
      isolatedEntry: { kind: 'public', managementPublicOrigin: 'https://manage.example' },
    },
  })
  const isolated = createBrowserAuthentication({
    access: current.access,
    safeReturnPath,
    paths: { authPrefix: '/auth/', accessPrefix: '/access/', transitionPrefix: '/transition/', consolePath: '/' },
  })
  const response = { writeHead(status, headers) { this.status = status; this.headers = headers }, end() {} }
  await isolated.enterManagement({ headers: { host: 'manage.example' } }, response)
  assert.equal(response.status, 303)
  const entry = new URL(response.headers.location)
  assert.equal(entry.origin, 'https://dsh.example')
  assert.equal(entry.pathname, '/_dsh_platform/auth/')
  assert.equal(entry.searchParams.get('return'), '/_dsh_platform/auth/management/start')
})

test('DSH browser logout exposes only additional-password state and revokes the requested sessions', async () => {
  const current = fixture('initialized')
  const port = await listen(current.server)
  try {
    const host = `127.0.0.1:${port}`
    const origin = `http://${host}`
    current.sessions.set('dshs_existing', origin)
    current.managementSessions.set('dshms_existing', origin)
    const dshCookies = `${DSH_SESSION_COOKIE}=dshs_existing; dsh_gateway_csrf=dshc_existing`
    const managementCookie = `${MANAGEMENT_SESSION_COOKIE}=dshms_existing`

    const context = await request(port, {
      path: '/_dsh_platform/auth/session-context', headers: { host, cookie: dshCookies },
    })
    assert.equal(context.status, 200)
    assert.deepEqual(JSON.parse(context.body), { managementAdditionalPasswordEnabled: true })
    assert.doesNotMatch(context.body, /account|username|verifier|password.*version/i)

    const managementOnly = await request(port, {
      path: '/_dsh_platform/auth/browser-logout', method: 'POST',
      headers: {
        host, origin, cookie: `${dshCookies}; ${managementCookie}`,
        'content-type': 'application/json', 'x-dsh-csrf': 'dshc_existing',
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
      },
      body: JSON.stringify({ scope: 'management' }),
    })
    assert.equal(managementOnly.status, 200)
    assert.equal(current.sessions.has('dshs_existing'), true)
    assert.equal(current.managementSessions.has('dshms_existing'), false)
    assert.equal(managementOnly.headers['set-cookie'].some(value => value.startsWith(`${DSH_SESSION_COOKIE}=`)), false)
    assert.equal(managementOnly.headers['set-cookie'].some(value => value.startsWith(`${MANAGEMENT_SESSION_COOKIE}=`)), true)

    const all = await request(port, {
      path: '/_dsh_platform/auth/browser-logout', method: 'POST',
      headers: {
        host, origin, cookie: dshCookies,
        'content-type': 'application/json', 'x-dsh-csrf': 'dshc_existing',
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
      },
      body: JSON.stringify({ scope: 'all' }),
    })
    assert.equal(all.status, 200)
    assert.equal(current.sessions.has('dshs_existing'), false)
    assert.equal(all.headers['set-cookie'].some(value => value.startsWith(`${DSH_SESSION_COOKIE}=`)), true)
    assert.equal(all.headers['set-cookie'].some(value => value.startsWith(`${MANAGEMENT_SESSION_COOKIE}=`)), true)
    assert.equal(all.headers['set-cookie'].some(value => value.startsWith(`${AUTH_CSRF_COOKIE}=`)), true)
    const logoutCall = current.calls.find(value => value.path === '/v1/dsh/browser-logout' && value.body.scope === 'all')
    assert.equal(logoutCall.body.dshOrigin, origin)
    assert.equal(logoutCall.body.dshToken, 'dshs_existing')
  } finally { await close(current.server) }
})

test('DSH browser sessions authorize only path-bound Plugin API capabilities', async () => {
  const current = fixture('initialized')
  current.sessions.set('dshs_existing', 'http://dsh.example')
  const authorization = await current.authentication.authorizePlugin({
    headers: {
      host: 'dsh.example',
      origin: 'http://dsh.example',
      cookie: `${DSH_SESSION_COOKIE}=dshs_existing; dsh_gateway_csrf=dshc_existing`,
      'x-dsh-csrf': 'dshc_existing',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
    },
  }, {
    method: 'POST', target: '/_dsh_platform/api/v1/restart-dsh', requireCsrf: true,
  })
  assert.equal(authorization.authorized, true)
  assert.equal(authorization.capability.token, 'dshcap_plugin')
  const call = current.calls.find(value => value.path === '/v1/dsh/capabilities')
  assert.deepEqual(call.body, {
    dshToken: 'dshs_existing',
    origin: 'http://dsh.example',
    csrfToken: 'dshc_existing',
    requireCsrf: true,
    method: 'POST',
    target: '/_dsh_platform/api/v1/restart-dsh',
  })
  assert.equal((await current.authentication.authorizePlugin({
    headers: {
      host: 'dsh.example', origin: 'http://dsh.example',
      cookie: `${DSH_SESSION_COOKIE}=missing`, 'sec-fetch-site': 'same-origin',
    },
  }, { method: 'GET', target: '/_dsh_platform/api/v1/status' })).authorized, false)
})

test('Management pending page asks only for the additional password', () => {
  const current = fixture('initialized')
  return listen(current.server).then(async port => {
    try {
      const page = await request(port, {
        path: '/_dsh_platform/auth/management/pending',
        headers: {
          host: `127.0.0.1:${port}`,
          cookie: 'dsh_management_pending=dshmp_pending',
        },
      })
      assert.equal(page.status, 200)
      assertInlineScriptsCompile(page.body)
      assert.match(page.body, /Management console password/)
      assert.match(page.body, /AUTHENTICATION_RETRY_REQUIRED/)
      assert.match(page.body, /AUTHENTICATION_RATE_LIMITED/)
      assert.match(page.body, /AUTHENTICATION_CONTEXT_STALE/)
      assert.match(page.body, /auth\/context/)
      assert.match(page.body, /<form method="post" action="\/_dsh_platform\/auth\/management\/pending" novalidate>/)
      assert.doesNotMatch(page.body, /minlength="8"|pattern="|field-error|Use 8 to 1024 characters/)
      assert.doesNotMatch(page.body, /name="username"|management\/session/)
    } finally { await close(current.server) }
  })
})
