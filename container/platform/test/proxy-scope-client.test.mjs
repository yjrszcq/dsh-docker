import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test('routes enabled update fetches through the fixed outbound proxy entry', async context => {
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
  const root = await mkdtemp(join(tmpdir(), 'dsh-scoped-fetch-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const routingStatePath = join(root, 'routing.json')
  await writeFile(routingStatePath, JSON.stringify({ schema: 1, enabled: true, scopes: { updates: true } }))
  const scopedFetch = createScopedFetch('updates', { routingStatePath })
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

  const unavailable = createScopedFetch('updates', { routingStatePath })
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

test('restarts Proxy Manager after an unclean exit leaves its control socket behind', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-proxy-process-restart-'))
  const runRoot = join(root, 'run')
  const dataRoot = join(root, 'data')
  await mkdir(runRoot)
  const script = new URL('../../control-plane/services/outbound-proxy/index.mjs', import.meta.url).pathname
  const launch = () => spawn(process.execPath, [script], {
    env: { ...process.env, DSH_PLATFORM_DATA: dataRoot, DSH_PLATFORM_RUN: runRoot },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  const ready = child => {
    const stderr = []
    child.stderr.on('data', chunk => stderr.push(chunk))
    return Promise.race([
      once(child, 'message').then(([message]) => {
        assert.equal(message.componentReady, true)
      }),
      once(child, 'exit').then(([code, signal]) => {
        const detail = Buffer.concat(stderr).toString('utf8').trim()
        throw new Error(`Proxy Manager exited before readiness (${String(code)}, ${String(signal)})${detail === '' ? '' : `: ${detail}`}`)
      }),
    ])
  }
  const first = launch()
  let second
  let blocker
  let releaseBlocker
  try {
    await ready(first)
    const routing = JSON.parse(await readFile(join(runRoot, 'outbound-proxy-routing.json'), 'utf8'))
    assert.equal(routing.schema, 1)
    assert.equal(routing.enabled, false)
    assert.equal(routing.scopes.agentNetwork, false)
    assert.deepEqual(routing.environment, { allProxy: null })
    assert.deepEqual(routing.noProxy.system, ['localhost', '127.0.0.1', '::1'])
    assert.equal(JSON.stringify(routing).includes('password'), false)
    first.kill('SIGKILL')
    await once(first, 'exit')
    blocker = createServer()
    await new Promise((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(PROXY_SCOPE_PORTS.updates, '127.0.0.1', resolve)
    })
    releaseBlocker = setTimeout(() => blocker.close(), 100)
    second = launch()
    await ready(second)
    assert.equal(second.exitCode, null)
  } finally {
    clearTimeout(releaseBlocker)
    if (blocker?.listening) await new Promise(resolve => blocker.close(resolve))
    if (first.exitCode === null) first.kill('SIGKILL')
    if (second?.exitCode === null) {
      second.kill('SIGTERM')
      await once(second, 'exit')
    }
    await rm(root, { recursive: true, force: true })
  }
})

test('bypasses Proxy Manager when an update scope or the global proxy is disabled', async context => {
  const target = createServer((_request, response) => response.end('direct response'))
  context.after(() => close(target))
  const address = await listen(target, { host: '127.0.0.1', port: 0 })
  const root = await mkdtemp(join(tmpdir(), 'dsh-direct-fetch-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const routingStatePath = join(root, 'routing.json')
  const url = `http://127.0.0.1:${String(address.port)}/direct`
  for (const state of [
    { schema: 1, enabled: false, scopes: { updates: true } },
    { schema: 1, enabled: true, scopes: { updates: false } },
  ]) {
    await writeFile(routingStatePath, JSON.stringify(state))
    const fetch = createScopedFetch('updates', { routingStatePath })
    try {
      assert.equal(await (await fetch(url)).text(), 'direct response')
    } finally {
      await fetch.close()
    }
  }
})

test('rejects unknown outbound proxy scopes', () => {
  assert.throws(() => createScopedFetch('unknown'), /unknown outbound proxy scope/)
})
