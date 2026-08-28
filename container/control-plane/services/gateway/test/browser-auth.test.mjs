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

function fixture(initialState = 'never-initialized') {
  let state = initialState
  const sessions = new Map()
  const managementSessions = new Map()
  const handoffs = new Map()
  const calls = []
  const access = {
    request: async (method, path, body) => {
      calls.push({ method, path, body })
      if (path === '/v1/status') return { state }
      if (path === '/v1/dsh/initialize') {
        state = 'initialized'
        sessions.set('dshs_created', body.origin)
        return { session: { token: 'dshs_created', csrfToken: 'dshc_created' } }
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
      if (path === '/v1/management/login') {
        if (body.password !== 'correct password') throw Object.assign(new Error('username or password is incorrect'), {
          code: 'AUTHENTICATION_FAILED', statusCode: 401,
        })
        managementSessions.set('dshms_direct', body.origin)
        return { session: { token: 'dshms_direct', csrfToken: 'dshc_management' } }
      }
      if (path === '/v1/management/handoffs') {
        if (sessions.get(body.dshToken) !== body.dshOrigin) throw Object.assign(new Error('session invalid'), { statusCode: 401 })
        handoffs.set('dshh_created', body.targetOrigin)
        return { handoff: { token: 'dshh_created' } }
      }
      if (path === '/v1/management/handoffs/consume') {
        if (handoffs.get(body.token) !== body.origin) throw Object.assign(new Error('handoff invalid'), { statusCode: 401 })
        handoffs.delete(body.token)
        managementSessions.set('dshms_exchanged', body.origin)
        return { session: { token: 'dshms_exchanged', csrfToken: 'dshc_management' } }
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
  return { access, authentication, calls, server, sessions, state: () => state }
}

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
