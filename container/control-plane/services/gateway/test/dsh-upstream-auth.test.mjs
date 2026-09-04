import assert from 'node:assert/strict'
import { chmod, mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DshUpstreamAuthentication } from '../lib/dsh-upstream-auth.mjs'

async function listen(server, target, host) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(target, host, resolve)
  })
}

test('exchanges and caches the private DSH launch URL', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-upstream-auth-'))
  const socketPath = join(root, 'lifecycle.sock')
  let exchanges = 0
  const dsh = createServer((request, response) => {
    exchanges += 1
    assert.equal(request.url, '/?token=fixture-token')
    response.writeHead(303, {
      location: '/',
      'set-cookie': 'dsh-auth-fixture=signed; Path=/; HttpOnly; SameSite=Strict',
    })
    response.end()
  })
  await listen(dsh, 0, '127.0.0.1')
  const port = dsh.address().port
  const lifecycle = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      ready: true,
      readyUrl: `http://127.0.0.1:${String(port)}/?token=fixture-token`,
    }))
  })
  await listen(lifecycle, socketPath)
  await chmod(socketPath, 0o600)
  t.after(() => { dsh.close(); lifecycle.close() })
  const authentication = new DshUpstreamAuthentication({ socketPath, port })
  assert.equal(await authentication.cookie(), 'dsh-auth-fixture=signed')
  assert.equal(await authentication.cookie(), 'dsh-auth-fixture=signed')
  assert.equal(exchanges, 1)
})

test('keeps probing legacy DSH readiness without inventing a cookie', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-upstream-auth-legacy-'))
  const socketPath = join(root, 'lifecycle.sock')
  let now = 0
  let probes = 0
  const lifecycle = createServer((_request, response) => {
    probes += 1
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ready: true, readyUrl: null }))
  })
  await listen(lifecycle, socketPath)
  t.after(() => lifecycle.close())
  const authentication = new DshUpstreamAuthentication({ socketPath, now: () => now })
  assert.equal(await authentication.cookie(), null)
  assert.equal(await authentication.cookie(), null)
  assert.equal(probes, 1)
  now = 250
  assert.equal(await authentication.cookie(), null)
  assert.equal(probes, 2)
})
