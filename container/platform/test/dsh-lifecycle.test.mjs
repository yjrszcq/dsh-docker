import assert from 'node:assert/strict'
import { request } from 'node:http'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createDshLifecycleServer,
  DshLifecycleBroker,
  listenDshLifecycle,
} from '../bootstrap/lib/dsh-lifecycle.mjs'

function call(socketPath, path, body) {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path, method: 'POST', headers: { 'content-type': 'application/json' } }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }))
    })
    req.once('error', reject)
    req.end(JSON.stringify(body))
  })
}

test('authorizes exactly one claim for each supervised DSH launch', async () => {
  const reports = []
  const broker = new DshLifecycleBroker({ report: (message, fields) => reports.push({ message, fields }) })
  const unrelated = broker.prepareLaunch('gateway')
  assert.deepEqual(unrelated.environment, {})

  const launch = broker.prepareLaunch('dsh-runtime')
  const first = broker.claim(launch.environment.DSH_PLATFORM_LAUNCH_TOKEN)
  assert.match(first.sessionId, /^[0-9a-f-]{36}$/)
  assert.throws(() => broker.claim(launch.environment.DSH_PLATFORM_LAUNCH_TOKEN), /already consumed/)
  launch.release()
  await assert.rejects(broker.signal(first.sessionId, 'SIGTERM'), /session is invalid/)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(reports.map(value => value.message), [
    'dsh.launch.authorized', 'dsh.launch.claimed', 'dsh.launch.released',
  ])
})

test('invalidates an old launch without allowing its cleanup to release the replacement', () => {
  const broker = new DshLifecycleBroker()
  const oldLaunch = broker.prepareLaunch('dsh-runtime')
  const nextLaunch = broker.prepareLaunch('dsh-runtime')
  oldLaunch.release()
  const session = broker.claim(nextLaunch.environment.DSH_PLATFORM_LAUNCH_TOKEN)
  assert.match(session.sessionId, /^[0-9a-f-]{36}$/)
})

test('returns restart only for an active session outside an owned shutdown', async () => {
  let owned = false
  const broker = new DshLifecycleBroker({ shouldTerminate: async () => owned })
  const launch = broker.prepareLaunch('dsh-runtime')
  const { sessionId } = broker.claim(launch.environment.DSH_PLATFORM_LAUNCH_TOKEN)
  assert.deepEqual(await broker.signal(sessionId, 'SIGTERM'), { disposition: 'request-restart' })
  owned = true
  assert.deepEqual(await broker.signal(sessionId, 'SIGTERM'), { disposition: 'terminate' })
  owned = false
  broker.beginShutdown()
  assert.deepEqual(await broker.signal(sessionId, 'SIGTERM'), { disposition: 'terminate' })
  await assert.rejects(broker.signal(sessionId, 'SIGINT'), /signal is invalid/)
})

test('serves only claim and signal over a private Unix socket', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-broker-'))
  const socketPath = join(root, 'dsh-lifecycle.sock')
  const broker = new DshLifecycleBroker()
  const server = createDshLifecycleServer(broker)
  t.after(() => server.close())
  await listenDshLifecycle(server, socketPath)
  assert.equal((await stat(socketPath)).mode & 0o777, 0o600)

  const launch = broker.prepareLaunch('dsh-runtime')
  const claim = await call(socketPath, '/v1/runtime/claim', {
    launchToken: launch.environment.DSH_PLATFORM_LAUNCH_TOKEN,
  })
  assert.equal(claim.status, 200)
  const signal = await call(socketPath, '/v1/runtime/signal', {
    sessionId: claim.body.sessionId,
    signal: 'SIGTERM',
  })
  assert.deepEqual(signal, { status: 200, body: { disposition: 'request-restart' } })
  assert.equal((await call(socketPath, '/v1/runtime/claim', {
    launchToken: launch.environment.DSH_PLATFORM_LAUNCH_TOKEN,
  })).status, 409)
  assert.equal((await call(socketPath, '/v1/unknown', {})).status, 404)
})
