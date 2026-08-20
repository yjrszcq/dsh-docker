import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { canonicalJson } from '../lib/canonical-json.mjs'
import { BootstrapRuntime } from '../bootstrap/lib/runtime.mjs'
import { EnvironmentRunner, loadControlPlane } from '../bootstrap/lib/lifecycle.mjs'
import { createBootstrapControl, listenBootstrapControl } from '../bootstrap/lib/control.mjs'
import { LocalApiClient } from '../../control-plane/modules/updater/lib/client.mjs'

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

test('suspends, resumes, and restarts one service while keeping other Environment components running', async () => {
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
  const managementPid = runner.status().components.find(value => value.id === 'platform-management').pid
  const firstDshPid = runner.status().components.find(value => value.id === 'dsh-runtime').pid
  await runner.restart('dsh-runtime')
  assert.notEqual(runner.status().components.find(value => value.id === 'dsh-runtime').pid, firstDshPid)
  assert.equal(runner.status().components.find(value => value.id === 'platform-management').pid, managementPid)
  assert.equal((await runner.health()).healthy, true)
  await runner.stop()
})

test('retries a service restart after its first start attempt fails', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-restart-retry-'))
  const service = join(temp, 'service.mjs')
  await writeFile(service, 'setInterval(() => {}, 1000)')
  const runner = new EnvironmentRunner({
    environmentRoot: await environment([component('dsh-runtime', service, 'service')]),
    capture: () => {},
  })
  await runner.start()
  const startComponent = runner.startComponentUnlocked.bind(runner)
  let failStart = true
  runner.startComponentUnlocked = async (...args) => {
    if (failStart) {
      failStart = false
      throw new Error('restart failed')
    }
    return startComponent(...args)
  }
  await assert.rejects(runner.restart('dsh-runtime'), /restart failed/)
  assert.deepEqual(runner.status().components, [])
  await runner.restart('dsh-runtime')
  assert.deepEqual(runner.status().components.map(value => value.id), ['dsh-runtime'])
  await runner.stop()
})

test('Bootstrap control socket exposes component suspension, resumption, restart, and health', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bootstrap-control-'))
  const calls = []
  const runner = {
    status: () => ({ components: [] }),
    reload: async () => ({}),
    health: async () => ({ healthy: true, components: [] }),
    suspend: async id => { calls.push(['suspend', id]); return {} },
    resume: async id => { calls.push(['resume', id]); return {} },
    restart: async id => { calls.push(['restart', id]); return {} },
  }
  const deployments = {
    exclusive: operation => operation(),
    setOperation: async operation => { calls.push(['operation', operation]) },
  }
  const systemPlugins = {
    list: async () => [{ id: 'platform-management', installed: true }],
    reinstall: async id => {
      calls.push(['reinstall', id])
      return [{ id, installed: true }]
    },
  }
  const server = createBootstrapControl(runner, { deployments, systemPlugins })
  const socket = join(root, 'run', 'bootstrap.sock')
  await listenBootstrapControl(server, socket)
  const client = new LocalApiClient(socket)
  try {
    assert.equal((await client.request('GET', '/v1/health')).healthy, true)
    assert.deepEqual((await client.request('GET', '/v1/system-plugins')).plugins, [{
      id: 'platform-management', installed: true,
    }])
    assert.deepEqual((await client.request('POST', '/v1/system-plugins/reinstall', {
      id: 'platform-management',
    })).plugins, [{ id: 'platform-management', installed: true }])
    await client.request('POST', '/v1/components/dsh-runtime/suspend')
    await client.request('POST', '/v1/components/dsh-runtime/resume')
    await client.request('POST', '/v1/components/dsh-runtime/restart')
    assert.deepEqual(calls, [
      ['reinstall', 'platform-management'],
      ['suspend', 'dsh-runtime'],
      ['resume', 'dsh-runtime'],
      ['operation', 'restarting'],
      ['restart', 'dsh-runtime'],
      ['operation', null],
    ])
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('loads the checked-in Control Plane independently from an Environment manifest', async () => {
  const controlPlane = await loadControlPlane(join(
    dirname(dirname(fileURLToPath(import.meta.url))),
    '..',
    'control-plane',
  ))
  assert.equal(controlPlane.manifest.version, null)
  assert.deepEqual(controlPlane.components.map(component => component.id), [
    'platform-recovery', 'platform-management', 'gateway',
  ])
})

test('keeps the Control Plane running while Environment operations replace DSH', async () => {
  const calls = []
  const runner = (name, status) => ({
    fatal: new Promise(() => {}),
    start: async () => { calls.push(`${name}:start`) },
    stop: async () => { calls.push(`${name}:stop`) },
    reload: async () => { calls.push(`${name}:reload`); return status },
    suspend: async id => { calls.push(`${name}:suspend:${id}`); return status },
    resume: async id => { calls.push(`${name}:resume:${id}`); return status },
    restart: async id => { calls.push(`${name}:restart:${id}`); return status },
    health: async () => ({ healthy: true, components: status.components }),
    status: () => status,
  })
  const controlPlane = runner('control', {
    environmentVersion: null,
    components: [{ id: 'gateway' }],
  })
  const environmentRunner = runner('environment', {
    environmentVersion: '2026.08.20.1',
    components: [{ id: 'dsh-runtime' }],
  })
  const runtime = new BootstrapRuntime({ controlPlane, environment: environmentRunner })

  await runtime.start()
  await runtime.suspend('dsh-runtime')
  await runtime.resume('dsh-runtime')
  await runtime.restart('dsh-runtime')
  await runtime.reload()
  assert.equal((await runtime.health()).healthy, true)
  assert.deepEqual(runtime.status().controlPlane, [{ id: 'gateway' }])
  await runtime.stop()

  assert.deepEqual(calls, [
    'control:start',
    'environment:start',
    'environment:suspend:dsh-runtime',
    'environment:resume:dsh-runtime',
    'environment:restart:dsh-runtime',
    'environment:reload',
    'environment:stop',
    'control:stop',
  ])
})

test('validates mandatory Patches before every operation that starts DSH', async () => {
  const calls = []
  const service = name => ({
    fatal: new Promise(() => {}),
    start: async () => { calls.push(`${name}:start`) },
    stop: async () => { calls.push(`${name}:stop`) },
    reload: async () => { calls.push(`${name}:reload`) },
    suspend: async id => { calls.push(`${name}:suspend:${id}`) },
    resume: async id => { calls.push(`${name}:resume:${id}`) },
    restart: async id => { calls.push(`${name}:restart:${id}`) },
    health: async () => ({ healthy: true, components: [] }),
    status: () => ({ components: [] }),
  })
  let validations = 0
  const runtime = new BootstrapRuntime({
    controlPlane: service('control'),
    environment: service('environment'),
    validateDeployment: async () => {
      validations += 1
      calls.push('validate')
      if (validations === 1) throw new Error('Patch verification failed')
    },
  })
  await runtime.start({ onEnvironmentFailure: async () => true })
  await runtime.reload()
  await runtime.resume('dsh-runtime')
  await runtime.restart('dsh-runtime')
  await runtime.resume('gateway')
  assert.deepEqual(calls, [
    'control:start',
    'validate',
    'validate',
    'environment:start',
    'validate',
    'environment:reload',
    'validate',
    'environment:resume:dsh-runtime',
    'validate',
    'environment:restart:dsh-runtime',
    'environment:resume:gateway',
  ])
})

test('retries a previous Deployment without restarting the Control Plane', async () => {
  const calls = []
  let environmentStarts = 0
  const controlPlane = {
    fatal: new Promise(() => {}),
    start: async () => { calls.push('control:start') },
    stop: async () => { calls.push('control:stop') },
    status: () => ({ components: [] }),
  }
  const environmentRunner = {
    fatal: new Promise(() => {}),
    start: async () => {
      environmentStarts += 1
      calls.push(`environment:start:${String(environmentStarts)}`)
      if (environmentStarts === 1) throw new Error('candidate failed')
    },
    stop: async () => { calls.push('environment:stop') },
    status: () => ({ environmentVersion: 'test', components: [] }),
  }
  const runtime = new BootstrapRuntime({ controlPlane, environment: environmentRunner })
  await runtime.start({
    onEnvironmentFailure: async error => {
      assert.match(error.message, /candidate failed/)
      calls.push('deployment:restore')
      return true
    },
  })
  assert.deepEqual(calls, [
    'control:start',
    'environment:start:1',
    'deployment:restore',
    'environment:start:2',
  ])
})

test('keeps the Control Plane alive in recovery mode when no Deployment starts', async () => {
  const calls = []
  const controlPlane = {
    fatal: new Promise(() => {}),
    start: async () => { calls.push('control:start') },
    stop: async () => { calls.push('control:stop') },
    status: () => ({ components: [{ id: 'gateway' }] }),
  }
  const environmentRunner = {
    fatal: new Promise(() => {}),
    start: async () => { throw new Error('Runtime missing') },
    stop: async () => {},
    status: () => ({ environmentVersion: null, components: [] }),
  }
  const runtime = new BootstrapRuntime({ controlPlane, environment: environmentRunner })
  await runtime.start({ allowRecovery: true, onEnvironmentFailure: async () => false })
  assert.equal(runtime.status().recoveryMode, 'Runtime missing')
  assert.deepEqual(runtime.status().controlPlane, [{ id: 'gateway' }])
  assert.deepEqual(calls, ['control:start'])
})

test('enters recovery mode when a failed candidate fallback cannot resolve', async () => {
  const calls = []
  const controlPlane = {
    fatal: new Promise(() => {}),
    start: async () => { calls.push('control:start') },
    stop: async () => { calls.push('control:stop') },
    status: () => ({ components: [{ id: 'gateway' }] }),
  }
  const environmentRunner = {
    fatal: new Promise(() => {}),
    start: async () => { throw new Error('candidate unhealthy') },
    stop: async () => {},
    status: () => ({ environmentVersion: null, components: [] }),
  }
  const runtime = new BootstrapRuntime({ controlPlane, environment: environmentRunner })
  await runtime.start({
    allowRecovery: true,
    onEnvironmentFailure: async () => { throw new Error('previous image is unavailable') },
  })
  assert.equal(runtime.status().recoveryMode, 'Deployment failed and its fallback could not be resolved')
  assert.deepEqual(calls, ['control:start'])
})
