import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { createScopedFetch, PROXY_SCOPE_PORTS } from '../../control-plane/services/management/scoped-fetch.mjs'

async function listen(server, options = {}) {
  server.listen(options)
  await once(server, 'listening')
  return server.address()
}

async function close(server) {
  if (!server.listening) return
  server.closeAllConnections?.()
  await new Promise((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
}

test('routes update fetches only through the fixed outbound proxy entry', async context => {
  const target = createServer((_request, response) => response.end('scoped response'))
  context.after(() => close(target))
  const targetAddress = await listen(target, { host: '127.0.0.1', port: 0 })
  const authorities = []
  const proxy = createServer((request, response) => {
    authorities.push(request.url)
    response.end('scoped response')
  })
  const proxySockets = new Set()
  proxy.on('connection', socket => {
    proxySockets.add(socket)
    socket.once('close', () => proxySockets.delete(socket))
  })
  context.after(() => close(proxy))
  await listen(proxy, { host: '127.0.0.1', port: PROXY_SCOPE_PORTS.updates })
  const scopedFetch = createScopedFetch('updates')
  try {
    const url = `http://127.0.0.1:${String(targetAddress.port)}/metadata`
    const response = await scopedFetch(url)
    assert.equal(await response.text(), 'scoped response')
    assert.deepEqual(authorities, [url])
  } finally {
    await scopedFetch.close()
    for (const socket of proxySockets) socket.destroy()
    await close(proxy)
  }

  const unavailable = createScopedFetch('updates')
  try {
    await assert.rejects(
      unavailable(`http://127.0.0.1:${String(targetAddress.port)}/would-be-direct`, {
        signal: AbortSignal.timeout(500),
      }),
      /fetch failed|ECONNREFUSED|proxy/i,
    )
  } finally {
    await unavailable.close()
  }
})

test('rejects unknown outbound proxy scopes', () => {
  assert.throws(() => createScopedFetch('unknown'), /unknown outbound proxy scope/)
})
