import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { verifyDshWebReady } from '../../control-plane/hooks/dsh-web-ready.mjs'

async function fixture(routes) {
  const requests = new Map()
  const server = createServer((request, response) => {
    requests.set(request.url, (requests.get(request.url) ?? 0) + 1)
    const route = routes.get(`${request.method} ${request.url}`) ?? routes.get(request.url)
    response.writeHead(route?.status ?? 404, {
      'content-type': route?.type ?? 'text/plain',
      ...route?.headers,
    })
    response.end(route?.body ?? '')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port, requests }
}

test('DSH web readiness requires every boot manifest Plugin bundle', async () => {
  const manifest = JSON.stringify({ rev: 'one', entries: [
    { id: 'one', url: '/plugins/one/client.js?rev=one', rev: 'one' },
    { id: 'two', url: '/plugins/two/client.js?rev=two', rev: 'two' },
  ] })
  const routes = new Map([
    ['/', { status: 200, type: 'text/html', body: `<script>globalThis["__DSH_BOOT__"] = ${manifest}</script>` }],
    ['/plugins/one/client.js?rev=one', { status: 200, type: 'text/javascript', body: 'one' }],
    ['/plugins/two/client.js?rev=two', { status: 404 }],
    ['POST /api/pluginInventory/list', { status: 200, type: 'application/json', body: JSON.stringify({
      type: 'server-response',
      rpcId: 'dsh-platform-readiness',
      result: { ok: true, value: { entries: [{ moduleName: 'ready', enabled: true, fiberPhase: 'active' }] } },
    }) }],
  ])
  const context = await fixture(routes)
  try {
    await assert.rejects(verifyDshWebReady({ port: context.port, stabilityMs: 1, managedReady: async () => {} }), /returned HTTP 404/)
    routes.set('/plugins/two/client.js?rev=two', { status: 200, type: 'text/javascript', body: 'two' })
    await verifyDshWebReady({ port: context.port, stabilityMs: 1, managedReady: async () => {} })
    assert.equal(context.requests.get('/'), 3)
    assert.equal(context.requests.get('/plugins/one/client.js?rev=one'), 3)
    assert.equal(context.requests.get('/plugins/two/client.js?rev=two'), 3)
    assert.equal(context.requests.get('/api/pluginInventory/list'), 2)
  } finally {
    await new Promise(resolve => context.server.close(resolve))
  }
})

test('DSH web readiness exchanges the private launch token for an authenticated cookie', async () => {
  const manifest = JSON.stringify({ rev: 'one', entries: [
    { id: 'one', url: '/plugins/one/client.js?rev=one', rev: 'one' },
  ] })
  let expectedCookie = ''
  const routes = new Map([
    ['/?token=fixture-token', {
      status: 303,
      headers: { location: '/', 'set-cookie': 'dsh-auth-fixture=session; Path=/; HttpOnly; SameSite=Strict' },
    }],
  ])
  const context = await fixture(routes)
  context.server.removeAllListeners('request')
  context.server.on('request', (request, response) => {
    context.requests.set(request.url, (context.requests.get(request.url) ?? 0) + 1)
    if (request.url === '/?token=fixture-token') {
      response.writeHead(303, {
        location: '/',
        'set-cookie': 'dsh-auth-fixture=session; Path=/; HttpOnly; SameSite=Strict',
      })
      response.end()
      return
    }
    expectedCookie = request.headers.cookie ?? ''
    if (expectedCookie !== 'dsh-auth-fixture=session') {
      response.writeHead(401)
      response.end('unauthorized')
      return
    }
    if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<script>window.__DSH_BOOT__ = ${manifest}</script>`)
    } else if (request.url === '/plugins/one/client.js?rev=one') {
      response.writeHead(200, { 'content-type': 'text/javascript' })
      response.end('one')
    } else if (request.url === '/api/pluginInventory/list') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        type: 'server-response',
        rpcId: 'dsh-platform-readiness',
        result: { ok: true, value: { entries: [{ moduleName: 'ready', enabled: true, fiberPhase: 'active' }] } },
      }))
    } else {
      response.writeHead(404)
      response.end()
    }
  })
  try {
    await verifyDshWebReady({
      port: context.port,
      stabilityMs: 0,
      managedReady: async () => ({ ready: true, readyUrl: `http://127.0.0.1:${String(context.port)}/?token=fixture-token` }),
    })
    assert.equal(expectedCookie, 'dsh-auth-fixture=session')
    assert.equal(context.requests.get('/?token=fixture-token'), 1)
  } finally {
    await new Promise(resolve => context.server.close(resolve))
  }
})

test('DSH web readiness rejects enabled Plugins that are not active', async () => {
  const manifest = JSON.stringify({ rev: 'one', entries: [] })
  const routes = new Map([
    ['/', { status: 200, type: 'text/html', body: `<script>window.__DSH_BOOT__ = ${manifest}</script>` }],
    ['POST /api/pluginInventory/list', { status: 200, type: 'application/json', body: JSON.stringify({
      type: 'server-response',
      rpcId: 'dsh-platform-readiness',
      result: { ok: true, value: { entries: [
        { moduleName: 'active', enabled: true, fiberPhase: 'active' },
        { moduleName: 'disabled', enabled: false, fiberPhase: null },
        { moduleName: 'broken', enabled: true, fiberPhase: 'failed' },
      ] } },
    }) }],
  ])
  const context = await fixture(routes)
  try {
    await assert.rejects(
      verifyDshWebReady({ port: context.port, stabilityMs: 0, managedReady: async () => {} }),
      /DSH Plugins are not active: broken \(failed\)/,
    )
  } finally {
    await new Promise(resolve => context.server.close(resolve))
  }
})

test('DSH web readiness rejects Plugin inventory RPC failures', async () => {
  const manifest = JSON.stringify({ rev: 'one', entries: [] })
  const routes = new Map([
    ['/', { status: 200, type: 'text/html', body: `<script>window.__DSH_BOOT__ = ${manifest}</script>` }],
    ['POST /api/pluginInventory/list', { status: 200, type: 'application/json', body: JSON.stringify({
      type: 'server-response',
      rpcId: 'dsh-platform-readiness',
      result: { ok: false, error: { code: 'internal', message: 'loader unavailable', details: {} } },
    }) }],
  ])
  const context = await fixture(routes)
  try {
    await assert.rejects(
      verifyDshWebReady({ port: context.port, stabilityMs: 0, managedReady: async () => {} }),
      /DSH Plugin inventory is unavailable: loader unavailable/,
    )
  } finally {
    await new Promise(resolve => context.server.close(resolve))
  }
})

test('executes readiness checks when launched through the Bootstrap view symlink', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-ready-view-'))
  const executable = join(root, 'dsh-web-ready.mjs')
  await symlink(new URL('../../control-plane/hooks/dsh-web-ready.mjs', import.meta.url), executable)
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executable], {
      env: { ...process.env, DSH_PLATFORM_RUN: join(root, 'missing-run') },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stderr = []
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', code => resolve({ code, stderr: Buffer.concat(stderr).toString('utf8') }))
  })
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /dsh-lifecycle\.sock/)
})
