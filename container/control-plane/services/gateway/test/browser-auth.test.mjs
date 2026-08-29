import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import test from 'node:test'
import {
  createBrowserAuthentication,
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

function fixture(initialState = 'never-initialized') {
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
          ? { managementAdditionalCredential: { enabled: true } }
          : null,
      }
      if (path === '/v1/dsh/initialize') {
        state = 'initialized'
        sessions.set('dshs_created', body.origin)
        return { session: { token: 'dshs_created', csrfToken: 'dshc_created' } }
      }
      if (path === '/v1/dsh/migrate') {
        if (body.setupKey !== 'dshmk_valid') throw Object.assign(new Error('migration setup key is invalid or expired'), {
          code: 'MIGRATION_KEY_INVALID', statusCode: 401,
        })
        state = 'initialized'
        sessions.set('dshs_migrated', body.origin)
        return { session: { token: 'dshs_migrated', csrfToken: 'dshc_migrated' } }
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
          : managementSessions.get(body.token) === body.origin,
      }
      if (path === '/v1/sessions/logout') {
        sessions.delete(body.token)
        managementSessions.delete(body.token)
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
      if (path === '/v1/management/login') {
        if (body.password !== 'correct password') throw Object.assign(new Error('username or password is incorrect'), {
          code: 'AUTHENTICATION_FAILED', statusCode: 401,
        })
        managementSessions.set('dshms_direct', body.origin)
        return { session: { token: 'dshms_direct', csrfToken: 'dshc_management' } }
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
    assert.equal(consumed.status, 303)
    assert.equal(consumed.headers.location, '/_dsh_platform/console/')
    assert.match(consumed.headers['set-cookie'][0], new RegExp(`^${MANAGEMENT_SESSION_COOKIE}=dshms_continued`))
    assert.match(consumed.headers['set-cookie'][0], /Path=\/_dsh_platform\//)

    const replay = await request(port, {
      path,
      headers: { host: `127.0.0.1:${port}`, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
    })
    assert.equal(replay.status, 401)
  } finally { await close(current.server) }
})

test('isolated Management continuation creates root-path cookies and redirects to root', async () => {
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
    assert.equal(consumed.status, 303)
    assert.equal(consumed.headers.location, '/')
    assert.match(consumed.headers['set-cookie'][0], new RegExp(`^${MANAGEMENT_SESSION_COOKIE}=dshms_continued`))
    assert.match(consumed.headers['set-cookie'][0], /Path=\//)
    assert.doesNotMatch(consumed.headers['set-cookie'][0], /Path=\/_dsh_platform\//)
  } finally { await close(server) }
})

test('renders state-driven initialization and recovery pages without exposing account material', async () => {
  for (const [state, expected] of [
    ['never-initialized', /autocomplete="new-password"/],
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
      assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/)
      assert.doesNotMatch(response.body, /https:\/\/evil\.example/)
      if (state !== 'recovery-required') {
        assertInlineScriptsCompile(response.body)
        assert.match(response.body, /<form method="post" action="\/_dsh_platform\/auth\/(?:session|migration)">/)
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
    assert.equal(exchanged.status, 303)
    assert.equal(exchanged.headers.location, '/_dsh_platform/console/')
    assert.match(exchanged.headers['set-cookie'][0], new RegExp(`^${MANAGEMENT_SESSION_COOKIE}=dshms_exchanged`))
    const replay = await request(port, {
      path: response.headers.location,
      headers: { host: `127.0.0.1:${port}`, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
    })
    assert.equal(replay.status, 401)
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
    const csrf = csrfCookie.split('=')[1]
    const rejected = await request(port, {
      path: '/_dsh_platform/auth/session', method: 'POST',
      headers: {
        host: `127.0.0.1:${port}`, origin: 'https://evil.example',
        cookie: csrfCookie, 'content-type': 'application/json', 'x-dsh-csrf': csrf,
      },
      body: JSON.stringify({ username: 'admin', password: 'correct password' }),
    })
    assert.equal(rejected.status, 403)

    const initialized = await request(port, {
      path: '/_dsh_platform/auth/session', method: 'POST',
      headers: {
        host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`,
        cookie: csrfCookie, 'content-type': 'application/json', 'x-dsh-csrf': csrf,
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
      },
      body: JSON.stringify({ username: 'admin', password: 'correct password' }),
    })
    assert.equal(initialized.status, 201)
    assert.equal(current.state(), 'initialized')
    assert.match(initialized.headers['set-cookie'][0], new RegExp(`^${DSH_SESSION_COOKIE}=dshs_created`))
    assert.equal(current.calls.some(call => call.path === '/v1/dsh/initialize'), true)
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
  } finally { await close(server) }
})

test('login preserves explicit Access Manager rate limits', async () => {
  const access = {
    request: async (_method, path) => {
      if (path === '/v1/status') return { state: 'initialized' }
      throw Object.assign(new Error('authentication is temporarily unavailable'), {
        statusCode: 429,
        code: 'AUTHENTICATION_RATE_LIMITED',
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
    assert.equal(JSON.parse(response.body).code, 'AUTHENTICATION_RATE_LIMITED')
  } finally { await close(server) }
})

test('legacy migration exchanges a root-issued setup key for a DSH session', async () => {
  const current = fixture('migration-required')
  const port = await listen(current.server)
  try {
    const origin = `http://127.0.0.1:${port}`
    const page = await request(port, {
      path: '/_dsh_platform/auth/', headers: { host: `127.0.0.1:${port}`, 'accept-language': 'en' },
    })
    assert.match(page.body, /name="setupKey"/)
    const csrfCookie = page.headers['set-cookie'][0].split(';')[0]
    const csrf = csrfCookie.split('=')[1]
    const migrated = await request(port, {
      path: '/_dsh_platform/auth/migration', method: 'POST',
      headers: {
        host: `127.0.0.1:${port}`, origin, cookie: csrfCookie,
        'content-type': 'application/json', 'x-dsh-csrf': csrf,
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
      },
      body: JSON.stringify({ setupKey: 'dshmk_valid', username: 'admin', password: 'correct password' }),
    })
    assert.equal(migrated.status, 201)
    assert.match(migrated.headers['set-cookie'][0], new RegExp(`^${DSH_SESSION_COOKIE}=dshs_migrated`))
    assert.equal(current.calls.some(call => call.path === '/v1/dsh/migrate'), true)
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

test('direct Management login creates and explicitly revokes only a Management session', async () => {
  const current = fixture('initialized')
  const port = await listen(current.server)
  try {
    const origin = `http://127.0.0.1:${port}`
    const page = await request(port, {
      path: '/_dsh_platform/auth/management', headers: { host: `127.0.0.1:${port}` },
    })
    assertInlineScriptsCompile(page.body)
    assert.match(page.body, /<form method="post" action="\/_dsh_platform\/auth\/management\/session">/)
    const loginCsrfCookie = page.headers['set-cookie'][0].split(';')[0]
    const loginCsrf = loginCsrfCookie.split('=')[1]
    const login = await request(port, {
      path: '/_dsh_platform/auth/management/session', method: 'POST',
      headers: {
        host: `127.0.0.1:${port}`, origin, cookie: loginCsrfCookie,
        'content-type': 'application/json', 'x-dsh-csrf': loginCsrf,
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
      },
      body: JSON.stringify({ username: 'admin', password: 'correct password' }),
    })
    assert.equal(login.status, 200)
    const managementCookie = login.headers['set-cookie'][0].split(';')[0]
    const managementCsrfCookie = login.headers['set-cookie'][1].split(';')[0]
    const managementCsrf = managementCsrfCookie.split('=')[1]
    assert.match(managementCookie, new RegExp(`^${MANAGEMENT_SESSION_COOKIE}=dshms_direct`))
    assert.equal((await current.authentication.validateManagement({ headers: {
      host: `127.0.0.1:${port}`, cookie: managementCookie,
    } })).authenticated, true)

    const logout = await request(port, {
      path: '/_dsh_platform/auth/management/logout', method: 'POST',
      headers: {
        host: `127.0.0.1:${port}`, origin,
        cookie: `${managementCookie}; ${managementCsrfCookie}`,
        'content-type': 'application/json', 'x-dsh-csrf': managementCsrf,
        'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
      },
      body: '{}',
    })
    assert.equal(logout.status, 200)
    assert.equal((await current.authentication.validateManagement({ headers: {
      host: `127.0.0.1:${port}`, cookie: managementCookie,
    } })).authenticated, false)
  } finally { await close(current.server) }
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

test('Management login page routes a pending additional-password result to its challenge', () => {
  const current = fixture('initialized')
  return listen(current.server).then(async port => {
    try {
      const page = await request(port, {
        path: '/_dsh_platform/auth/management', headers: { host: `127.0.0.1:${port}` },
      })
      assert.match(page.body, /response\.status===202/)
      assert.match(page.body, /management\/pending/)
    } finally { await close(current.server) }
  })
})
