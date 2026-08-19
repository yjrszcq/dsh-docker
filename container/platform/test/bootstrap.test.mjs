import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { canonicalJson } from '../lib/canonical-json.mjs'
import { EnvironmentRunner } from '../bootstrap/lib/lifecycle.mjs'
import { createBootstrapControl, listenBootstrapControl } from '../bootstrap/lib/control.mjs'
import { LocalApiClient } from '../../components/updater/lib/client.mjs'

function command(script, args = []) {
  return { executable: process.execPath, args: [script, ...args], timeoutSeconds: 5 }
}

const emptyLifecycle = {
  prepare: null,
  preStart: null,
  postStart: null,
  preStop: null,
  stop: null,
  postStop: null,
}

async function environment(components) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-environment-runner-'))
  await mkdir(join(root, 'artifacts'))
  const references = []
  const artifacts = []
  for (const component of components) {
    const artifactId = `component-${component.id}`
    const bytes = canonicalJson(component)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    await writeFile(join(root, 'artifacts', artifactId), bytes)
    references.push({ id: component.id, sha256 })
    artifacts.push({
      id: artifactId,
      mediaType: 'application/vnd.dsh-platform.component.v1+json',
      sha256,
      size: bytes.byteLength,
      url: `https://release.example/${artifactId}`,
    })
  }
  await writeFile(join(root, 'environment.manifest.json'), canonicalJson({
    schema: 1,
    manifestType: 'environment',
    version: 'test',
    keyringGeneration: 1,
    targetSequence: 1,
    issuedAt: '2026-08-19T00:00:00.000Z',
    artifacts,
    bootstrapApi: 1,
    components: references,
    patches: [],
    systemPlugins: [],
  }))
  return root
}

function component(id, script, type = 'oneshot', lifecycle = emptyLifecycle) {
  return {
    schema: 1,
    id,
    type,
    command: command(script),
    environment: {},
    lifecycle,
    health: null,
    logging: { stdout: true, stderr: true },
  }
}

test('runs components in manifest order and stop phases in reverse order', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-order-'))
  const log = join(temp, 'order.log')
  const append = join(temp, 'append.mjs')
  const service = join(temp, 'service.mjs')
  const check = join(temp, 'check.mjs')
  await writeFile(append, 'import { appendFileSync } from "node:fs"; appendFileSync(process.argv[2], process.argv[3] + "\\n")')
  await writeFile(service, 'import { appendFileSync } from "node:fs"; appendFileSync(process.argv[2], process.argv[3] + "\\n"); setInterval(() => {}, 1000)')
  await writeFile(check, 'import { readFileSync } from "node:fs"; process.exit(readFileSync(process.argv[2], "utf8").includes(process.argv[3]) ? 0 : 1)')
  const lifecycle = label => ({
    ...emptyLifecycle,
    prepare: command(append, [log, `${label}:prepare`]),
    preStart: command(append, [log, `${label}:preStart`]),
    postStart: command(append, [log, `${label}:postStart`]),
    preStop: command(append, [log, `${label}:preStop`]),
    postStop: command(append, [log, `${label}:postStop`]),
  })
  const first = component('first', service, 'service', lifecycle('first'))
  first.command = command(service, [log, 'first:start'])
  first.health = {
    type: 'exec',
    command: command(check, [log, 'first:start']),
    intervalSeconds: 1,
    timeoutSeconds: 5,
  }
  const second = component('second', append, 'oneshot', lifecycle('second'))
  second.command = command(append, [log, 'second:start'])
  const runner = new EnvironmentRunner({ environmentRoot: await environment([first, second]), capture: () => {} })
  await runner.start()
  await runner.stop()
  const lines = (await readFile(log, 'utf8')).trim().split('\n')
  assert.deepEqual(lines.slice(0, 8), [
    'first:prepare', 'second:prepare', 'first:preStart', 'first:start',
    'first:postStart', 'second:preStart', 'second:start', 'second:postStart',
  ])
  assert.deepEqual(lines.slice(8), ['second:preStop', 'second:postStop', 'first:preStop', 'first:postStop'])
})

test('stops already-started services when a later component fails', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-failure-'))
  const service = join(temp, 'service.mjs')
  const failure = join(temp, 'failure.mjs')
  await writeFile(service, 'setInterval(() => {}, 1000)')
  await writeFile(failure, 'process.exit(9)')
  const runner = new EnvironmentRunner({
    environmentRoot: await environment([
      component('service', service, 'service'),
      component('failure', failure),
    ]),
    capture: () => {},
  })
  await assert.rejects(runner.start(), /failure command failed/)
  assert.deepEqual(runner.status().components, [])
})

test('reports a service exit after readiness as a fatal Bootstrap condition', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-runtime-exit-'))
  const exits = join(temp, 'exits.mjs')
  await writeFile(exits, 'setTimeout(() => process.exit(7), 20)')
  const runner = new EnvironmentRunner({
    environmentRoot: await environment([component('service', exits, 'service')]),
    capture: () => {},
  })
  await runner.start()
  const error = await runner.fatal
  assert.match(error.message, /service exited unexpectedly.*code=7/)
  await runner.stop()
})

test('suspends and resumes one service while keeping other Environment components running', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-suspend-'))
  const service = join(temp, 'service.mjs')
  await writeFile(service, 'setInterval(() => {}, 1000)')
  const runner = new EnvironmentRunner({
    environmentRoot: await environment([
      component('dsh-runtime', service, 'service'),
      component('platform-management', service, 'service'),
    ]),
    capture: () => {},
  })
  await runner.start()
  await runner.suspend('dsh-runtime')
  assert.deepEqual(runner.status().components.map(value => value.id), ['platform-management'])
  assert.equal((await runner.health()).healthy, false)
  await runner.resume('dsh-runtime')
  assert.deepEqual(runner.status().components.map(value => value.id), ['dsh-runtime', 'platform-management'])
  assert.equal((await runner.health()).healthy, true)
  await runner.stop()
})

test('Bootstrap control socket exposes component suspension, resumption, and health', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bootstrap-control-'))
  const calls = []
  const runner = {
    status: () => ({ components: [] }),
    reload: async () => ({}),
    health: async () => ({ healthy: true, components: [] }),
    suspend: async id => { calls.push(['suspend', id]); return {} },
    resume: async id => { calls.push(['resume', id]); return {} },
  }
  const server = createBootstrapControl(runner)
  const socket = join(root, 'run', 'bootstrap.sock')
  await listenBootstrapControl(server, socket)
  const client = new LocalApiClient(socket)
  try {
    assert.equal((await client.request('GET', '/v1/health')).healthy, true)
    await client.request('POST', '/v1/components/dsh-runtime/suspend')
    await client.request('POST', '/v1/components/dsh-runtime/resume')
    assert.deepEqual(calls, [['suspend', 'dsh-runtime'], ['resume', 'dsh-runtime']])
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
