import assert from 'node:assert/strict'
import { cp, lstat, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { BootstrapManager } from '../stage0/lib/slots.mjs'
import { BootstrapSupervisor } from '../stage0/lib/supervisor.mjs'
import { createTrustServer, listenUnix } from '../stage0/lib/trust-server.mjs'
import { createRecoveryServer, listenRecovery } from '../stage0/lib/recovery-server.mjs'
import { TrustLedger } from '../stage0/lib/ledger.mjs'
import { VerifiedObjectStore } from '../stage0/lib/artifacts.mjs'
import { keyPair } from './helpers.mjs'
import {
  deriveImageBuildId,
  deriveRecordId,
  parseImageInventory,
  recordsFromImageInventory,
} from '../lib/deployment-contracts.mjs'
import { hashTree } from '../lib/tree-hash.mjs'

async function bootstrap(root, version, behavior) {
  const directory = join(root, version)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'index.mjs'), behavior)
  return directory
}

async function imageBootstrap(root, version, sequence, behavior = 'seed', revision = `revision-${String(sequence)}`, authority = 'stable') {
  const seedRoot = join(root, `seed-${revision}`)
  const bootstrapRoot = await bootstrap(join(seedRoot, 'bootstrap'), version, behavior)
  const bootstrapSha256 = await hashTree(bootstrapRoot)
  const content = {
    schema: 1,
    authority,
    platformRevision: revision,
    targetSequence: sequence,
    bootstrapApi: 1,
    updateApi: 1,
    bootstrap: { version, id: version, sha256: bootstrapSha256 },
    deployment: {
      id: `deployment-${String(sequence)}`,
      dshVersion: `0.1.0-rc.${String(sequence)}`,
      environmentVersion: '2026.08.20.1',
      environment: { id: 'environment', sha256: '1'.repeat(64) },
      pristine: { id: 'pristine', sha256: '2'.repeat(64) },
      runtime: { id: 'runtime', sha256: '3'.repeat(64) },
      systemPlugins: { id: 'system-plugins', sha256: '4'.repeat(64) },
    },
  }
  const inventory = parseImageInventory({ ...content, imageBuildId: deriveImageBuildId(content) })
  return { seedRoot, inventory, record: recordsFromImageInventory(inventory).bootstrap }
}

function bootstrapManager(root, image) {
  return new BootstrapManager({
    stateRoot: join(root, 'state'),
    storeRoot: join(root, 'store'),
    seedRoot: image.seedRoot,
    inventory: image.inventory,
  })
}

async function storeBootstrap(manager, version, sequence, behavior) {
  const id = `bootstrap-${version}`
  const path = await bootstrap(manager.storeRoot, id, behavior)
  const sha256 = await hashTree(path)
  const content = {
    schema: 1,
    version,
    bootstrapApi: 1,
    targetSequence: sequence,
    artifact: { storage: 'store', kind: 'bootstrap', id, sha256 },
  }
  return manager.writeRecord({ ...content, id: deriveRecordId('bootstrap-record', content) })
}

test('tracks immutable Bootstrap Records in one generation-based slots file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bootstrap-records-'))
  const image = await imageBootstrap(root, '1.0.0', 1)
  const manager = bootstrapManager(root, image)
  await manager.reconcileImage(image.record)
  const managed = await storeBootstrap(manager, '2.0.0', 2, 'next')
  await manager.promote(managed.id)
  let state = await manager.state()
  assert.equal(state.current, managed.id)
  assert.equal(state.previous, image.record.id)
  assert.equal(state.generation, 2)
  await manager.rollback()
  state = await manager.state()
  assert.equal(state.current, image.record.id)
  assert.equal(state.previous, managed.id)
  assert.equal(state.generation, 3)
})

test('Stage-0 collects only Bootstrap assets outside current and previous', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bootstrap-gc-'))
  const image = await imageBootstrap(root, '1.0.0', 1)
  const manager = bootstrapManager(root, image)
  await manager.reconcileImage(image.record)
  const retained = await storeBootstrap(manager, '2.0.0', 2, 'retained')
  await manager.promote(retained.id)
  const orphan = await storeBootstrap(manager, '3.0.0', 3, 'orphan')
  const removed = await manager.collectGarbage()
  assert.deepEqual(removed.records, [orphan.id])
  await assert.rejects(lstat(manager.recordPath(orphan.id)), { code: 'ENOENT' })
  await assert.rejects(lstat(join(manager.storeRoot, orphan.artifact.id)), { code: 'ENOENT' })
  assert.equal((await lstat(join(manager.storeRoot, retained.artifact.id))).isDirectory(), true)
})

test('advances to a newer image without reinterpreting an old Image Reference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bootstrap-image-forward-'))
  const first = await imageBootstrap(root, '1.0.0', 1)
  const initial = bootstrapManager(root, first)
  await initial.reconcileImage(first.record)
  const second = await imageBootstrap(root, '1.0.0', 2, 'new-seed')
  const upgraded = bootstrapManager(root, second)
  await upgraded.reconcileImage(second.record)
  const state = await upgraded.state()
  assert.equal(state.current, second.record.id)
  assert.equal(state.previous, first.record.id)
  await assert.rejects(upgraded.resolveRecord(first.record.id), /different image/)
})

test('rejects same-sequence Bootstrap content conflicts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bootstrap-image-conflict-'))
  const first = await imageBootstrap(root, '1.0.0', 1, 'one', 'revision-one')
  await bootstrapManager(root, first).reconcileImage(first.record)
  const conflicting = await imageBootstrap(root, '1.0.0', 1, 'two', 'revision-two')
  await assert.rejects(bootstrapManager(root, conflicting).reconcileImage(conflicting.record), /conflicts/)
})

test('replaces a rebuilt development Bootstrap without retaining a stale Image Reference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bootstrap-development-refresh-'))
  const first = await imageBootstrap(root, '1.0.0', 0, 'one', 'development-one', 'development')
  await bootstrapManager(root, first).reconcileImage(first.record)
  const rebuilt = await imageBootstrap(root, '1.0.0', 0, 'two', 'development-two', 'development')
  const manager = bootstrapManager(root, rebuilt)
  const state = await manager.reconcileImage(rebuilt.record)
  assert.equal(state.current, rebuilt.record.id)
  assert.equal(state.previous, null)
  assert.equal((await manager.current()).path, join(rebuilt.seedRoot, 'bootstrap', '1.0.0'))
})

test('preserves a higher Managed Bootstrap when the image is behind', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bootstrap-image-behind-'))
  const first = await imageBootstrap(root, '1.0.0', 1)
  const initial = bootstrapManager(root, first)
  await initial.reconcileImage(first.record)
  const managed = await storeBootstrap(initial, '3.0.0', 3, 'managed')
  await initial.promote(managed.id)

  const second = await imageBootstrap(root, '2.0.0', 2)
  const restarted = bootstrapManager(root, second)
  const state = await restarted.reconcileImage(second.record)
  assert.equal(state.current, managed.id)
  assert.equal((await restarted.current()).record.version, '3.0.0')
})

test('prefers the current image when Store and Image content match at one sequence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bootstrap-image-preferred-'))
  const image = await imageBootstrap(root, '1.0.0', 1)
  const manager = bootstrapManager(root, image)
  await manager.reconcileImage(image.record)
  const storeId = 'bootstrap-identical'
  await cp(
    join(image.seedRoot, 'bootstrap', '1.0.0'),
    join(manager.storeRoot, storeId),
    { recursive: true },
  )
  const content = {
    schema: 1,
    version: '1.0.0',
    bootstrapApi: 1,
    targetSequence: 1,
    artifact: { storage: 'store', kind: 'bootstrap', id: storeId, sha256: image.inventory.bootstrap.sha256 },
  }
  const managed = await manager.writeRecord({ ...content, id: deriveRecordId('bootstrap-record', content) })
  await manager.promote(managed.id)
  const state = await manager.reconcileImage(image.record)
  assert.equal(state.current, image.record.id)
  assert.equal(state.previous, managed.id)
})

test('rolls back when the current Bootstrap exits before readiness', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bootstrap-supervisor-'))
  const image = await imageBootstrap(root, '1.0.0', 1, 'process.send({ type: "ready", bootstrapApi: 1 }); setInterval(() => {}, 1000)')
  const slots = bootstrapManager(root, image)
  await slots.reconcileImage(image.record)
  const candidate = await storeBootstrap(slots, '2.0.0', 2, 'process.exit(2)')
  await slots.promote(candidate.id)
  const supervisor = new BootstrapSupervisor({ slots, dataRoot: root, readyTimeoutMs: 1_000 })
  const child = await supervisor.startWithRollback()
  assert.equal(child.exitCode, null)
  const state = await slots.state()
  assert.equal(state.current, image.record.id)
  assert.equal(state.previous, candidate.id)
  await supervisor.stop()
})

test('rejects an in-flight recovery request when Bootstrap exits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bootstrap-recovery-exit-'))
  const behavior = `
    process.send({ type: 'ready', bootstrapApi: 1 })
    process.on('message', () => process.exit(7))
    setInterval(() => {}, 1000)
  `
  const image = await imageBootstrap(root, '1.0.0', 1, behavior)
  const slots = bootstrapManager(root, image)
  await slots.reconcileImage(image.record)
  const supervisor = new BootstrapSupervisor({ slots, dataRoot: root, readyTimeoutMs: 1_000 })
  await supervisor.startWithRollback()
  await assert.rejects(supervisor.recoverImageBaseline(), /Bootstrap exited unexpectedly/)
  assert.equal(supervisor.requests.size, 0)
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

test('root-only recovery server requires the exact current imageBuildId', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-recovery-server-'))
  const image = await imageBootstrap(root, '1.0.0', 2)
  let recoveries = 0
  const server = createRecoveryServer({
    inventory: image.inventory,
    deployments: async () => ({ current: { recordId: 'broken' } }),
    supervisor: { recoverImageBaseline: async () => { recoveries += 1; return { current: image.record.id } } },
  })
  const socketPath = join(root, 'run', 'recovery.sock')
  await listenRecovery(server, socketPath)
  try {
    const status = await unixRequest(socketPath, 'GET', '/v1/status')
    assert.equal(status.status, 200)
    assert.equal(status.body.imageBaseline.imageBuildId, image.inventory.imageBuildId)
    assert.equal((await unixRequest(socketPath, 'POST', '/v1/recover-image-baseline', { confirm: 'wrong' })).status, 400)
    assert.equal((await unixRequest(socketPath, 'POST', '/v1/recover-image-baseline', {
      confirm: image.inventory.imageBuildId,
    })).status, 200)
    assert.equal((await unixRequest(socketPath, 'POST', '/v1/recover-image-baseline', {
      confirm: 'x'.repeat(17 * 1024),
    })).status, 400)
    assert.equal(recoveries, 1)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

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
      { version: '0.1.0-rc.8', sourcePath: '/data/platform/downloads/untrusted/dsh.tgz' },
      { version: '0.1.0-rc.8', candidate: {} },
    ]) {
      assert.equal((await unixRequest(socketPath, 'POST', '/v1/dsh/ensure', extra)).status, 400)
    }
    assert.equal((await unixRequest(socketPath, 'POST', '/v1/artifacts/import-experimental', {
      candidate: {}, sourcePath: '/data/platform/downloads/untrusted/dsh.tgz',
    })).status, 404)
    assert.deepEqual(calls, ['0.1.0-rc.8'])
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('Bootstrap archive installation rejects traversal before extraction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bootstrap-archive-'))
  const image = await imageBootstrap(root, '1.0.0', 1)
  const slots = bootstrapManager(root, image)
  await slots.reconcileImage(image.record)
  const source = join(root, 'source')
  await mkdir(join(source, 'platform', 'bootstrap'), { recursive: true })
  await writeFile(join(source, 'platform', 'bootstrap', 'index.mjs'), 'process.exit(0)')
  const valid = join(root, 'valid.tgz')
  assert.equal(spawnSync('tar', ['-czf', valid, '-C', source, 'platform']).status, 0)
  const installed = await slots.installArchive(valid, { version: '2.0.0', targetSequence: 2 })
  const resolved = await slots.resolveRecord(installed.id)
  assert.match(await readFile(join(resolved.path, 'platform', 'bootstrap', 'index.mjs'), 'utf8'), /exit/)

  const unsafe = join(root, 'unsafe.tgz')
  assert.equal(spawnSync('tar', ['-czf', unsafe, '--transform=s,^,../,', '-C', source, 'platform']).status, 0)
  await assert.rejects(slots.installArchive(unsafe, { version: '3.0.0', targetSequence: 3 }), /unsafe path/)
})
