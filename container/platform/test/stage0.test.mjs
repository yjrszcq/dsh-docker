import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { BootstrapSlots } from '../stage0/lib/slots.mjs'
import { BootstrapSupervisor } from '../stage0/lib/supervisor.mjs'
import { createTrustServer, listenUnix } from '../stage0/lib/trust-server.mjs'
import { TrustLedger } from '../stage0/lib/ledger.mjs'
import { VerifiedObjectStore } from '../stage0/lib/artifacts.mjs'
import { keyPair } from './helpers.mjs'

async function bootstrap(root, version, behavior) {
  const directory = join(root, version)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'index.mjs'), behavior)
  return directory
}

test('provisions a seed once and atomically tracks current and previous', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bootstrap-slots-'))
  const seeds = join(root, 'seeds')
  await bootstrap(seeds, '1.0.0', 'seed')
  await bootstrap(seeds, '2.0.0', 'next')
  const slots = new BootstrapSlots(join(root, 'data'))
  await slots.provisionSeed(join(seeds, '1.0.0'), '1.0.0')
  await slots.provisionSeed(join(seeds, '1.0.0'), '1.0.0')
  await slots.provisionSeed(join(seeds, '2.0.0'), '2.0.0')
  await slots.promote('2.0.0')
  assert.deepEqual(await slots.state(), { current: '2.0.0', previous: '1.0.0' })
  await slots.rollback()
  assert.deepEqual(await slots.state(), { current: '1.0.0', previous: '2.0.0' })
})

test('rolls back when the current Bootstrap exits before readiness', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bootstrap-supervisor-'))
  const seeds = join(root, 'seeds')
  await bootstrap(seeds, '1.0.0', 'process.send({ type: "ready", bootstrapApi: 1 }); setInterval(() => {}, 1000)')
  await bootstrap(seeds, '2.0.0', 'process.exit(2)')
  const slots = new BootstrapSlots(join(root, 'data'))
  await slots.provisionSeed(join(seeds, '1.0.0'), '1.0.0')
  await slots.provisionSeed(join(seeds, '2.0.0'), '2.0.0')
  await slots.promote('2.0.0')
  const supervisor = new BootstrapSupervisor({ slots, dataRoot: root, readyTimeoutMs: 1_000 })
  const child = await supervisor.startWithRollback()
  assert.equal(child.exitCode, null)
  assert.deepEqual(await slots.state(), { current: '1.0.0', previous: '2.0.0' })
  await supervisor.stop()
})

function unixRequest(socketPath, method, path, body) {
  return new Promise((resolve, reject) => {
    const requestBody = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const req = request({ socketPath, method, path, headers: requestBody === undefined ? {} : { 'content-length': requestBody.length } }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }))
    })
    req.once('error', reject)
    req.end(requestBody)
  })
}

test('exposes a bounded local Trust API without trust-root mutation routes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-trust-server-'))
  const recovery = keyPair()
  const ledger = new TrustLedger(join(root, 'trust'), recovery.publicKey)
  const objects = new VerifiedObjectStore({ root: join(root, 'trust'), untrustedRoot: join(root, 'downloads'), ledger })
  const server = createTrustServer({ ledger, objects })
  const socketPath = join(root, 'run', 'trust.sock')
  await listenUnix(server, socketPath)
  try {
    assert.deepEqual(await unixRequest(socketPath, 'GET', '/v1/status'), {
      status: 200,
      body: { keyringGeneration: null, targetSequence: null, officialDshVersion: null },
    })
    assert.equal((await unixRequest(socketPath, 'POST', '/v1/trust/reset', {})).status, 404)
    assert.equal((await readFile(socketPath).catch(error => error.code)), 'ENXIO')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('exposes only an injected Stage-0 Bootstrap staging operation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-stage-bootstrap-api-'))
  const recovery = keyPair()
  const ledger = new TrustLedger(join(root, 'trust'), recovery.publicKey)
  const objects = new VerifiedObjectStore({ root: join(root, 'trust'), untrustedRoot: join(root, 'downloads'), ledger })
  let staged
  const server = createTrustServer({
    ledger,
    objects,
    stageBootstrap: async (receipt, version) => { staged = { receipt, version } },
  })
  const socketPath = join(root, 'run', 'trust.sock')
  await listenUnix(server, socketPath)
  try {
    assert.equal((await unixRequest(socketPath, 'POST', '/v1/bootstrap/stage', {
      receipt: 'receipt-token', version: '2.0.0',
    })).status, 202)
    assert.deepEqual(staged, { receipt: 'receipt-token', version: '2.0.0' })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('official DSH Trust API accepts only a requested version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-official-api-'))
  const recovery = keyPair()
  const ledger = new TrustLedger(join(root, 'trust'), recovery.publicKey)
  const calls = []
  const objects = {
    ensureOfficialDsh: async version => {
      calls.push(version)
      return { authorityType: 'official-dsh', authorityVersion: version }
    },
    reconcileRevocations: async () => [],
    activeReceipts: async () => [],
  }
  const server = createTrustServer({ ledger, objects })
  const socketPath = join(root, 'run', 'trust.sock')
  await listenUnix(server, socketPath)
  try {
    const accepted = await unixRequest(socketPath, 'POST', '/v1/dsh/ensure', { version: '0.1.0-rc.8' })
    assert.equal(accepted.status, 200)
    assert.deepEqual(calls, ['0.1.0-rc.8'])
    for (const extra of [
      { version: '0.1.0-rc.8', url: 'https://mirror.example/dsh.tgz' },
      { version: '0.1.0-rc.8', expectedHash: '0'.repeat(64) },
      { version: '0.1.0-rc.8', sourcePath: '/data/downloads/untrusted/dsh.tgz' },
      { version: '0.1.0-rc.8', candidate: {} },
    ]) {
      assert.equal((await unixRequest(socketPath, 'POST', '/v1/dsh/ensure', extra)).status, 400)
    }
    assert.equal((await unixRequest(socketPath, 'POST', '/v1/artifacts/import-experimental', {
      candidate: {}, sourcePath: '/data/downloads/untrusted/dsh.tgz',
    })).status, 404)
    assert.deepEqual(calls, ['0.1.0-rc.8'])
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('Bootstrap archive installation rejects traversal before extraction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bootstrap-archive-'))
  const source = join(root, 'source')
  await mkdir(join(source, 'platform', 'bootstrap'), { recursive: true })
  await writeFile(join(source, 'platform', 'bootstrap', 'index.mjs'), 'process.exit(0)')
  const valid = join(root, 'valid.tgz')
  assert.equal(spawnSync('tar', ['-czf', valid, '-C', source, 'platform']).status, 0)
  const slots = new BootstrapSlots(join(root, 'slots'))
  await slots.installArchive(valid, '2.0.0')
  assert.match(await readFile(join(slots.versionPath('2.0.0'), 'platform', 'bootstrap', 'index.mjs'), 'utf8'), /exit/)

  const unsafe = join(root, 'unsafe.tgz')
  assert.equal(spawnSync('tar', ['-czf', unsafe, '--transform=s,^,../,', '-C', source, 'platform']).status, 0)
  await assert.rejects(slots.installArchive(unsafe, '3.0.0'), /unsafe path/)
})
