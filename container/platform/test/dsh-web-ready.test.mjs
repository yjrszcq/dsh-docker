import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { verifyDshWebReady } from '../../control-plane/hooks/dsh-web-ready.mjs'

async function fixture(routes) {
  const requests = new Map()
  const server = createServer((request, response) => {
    requests.set(request.url, (requests.get(request.url) ?? 0) + 1)
    const route = routes.get(request.url)
    response.writeHead(route?.status ?? 404, { 'content-type': route?.type ?? 'text/plain' })
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
    ['/', { status: 200, type: 'text/html', body: `<script>window.__DSH_BOOT__ = ${manifest}</script>` }],
    ['/plugins/one/client.js?rev=one', { status: 200, type: 'text/javascript', body: 'one' }],
    ['/plugins/two/client.js?rev=two', { status: 404 }],
  ])
  const context = await fixture(routes)
  try {
    await assert.rejects(verifyDshWebReady({ port: context.port, stabilityMs: 1 }), /returned HTTP 404/)
    routes.set('/plugins/two/client.js?rev=two', { status: 200, type: 'text/javascript', body: 'two' })
    await verifyDshWebReady({ port: context.port, stabilityMs: 1 })
    assert.equal(context.requests.get('/'), 3)
    assert.equal(context.requests.get('/plugins/one/client.js?rev=one'), 3)
    assert.equal(context.requests.get('/plugins/two/client.js?rev=two'), 3)
  } finally {
    await new Promise(resolve => context.server.close(resolve))
  }
})
