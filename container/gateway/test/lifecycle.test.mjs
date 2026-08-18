import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  createDshEnvironment,
  runGateway,
  terminateDsh,
  waitForDshReady,
} from '../lib/lifecycle.mjs'

class FakeChild extends EventEmitter {
  exitCode = null
  signalCode = null
  kills = []
  exitOnTerminate = true

  kill(signal) {
    this.kills.push(signal)
    if (this.exitOnTerminate || signal === 'SIGKILL') {
      this.signalCode = signal
      queueMicrotask(() => this.emit('exit', null, signal))
    }
    return true
  }
}

class FakeServer extends EventEmitter {
  listening = false

  listen(_port, _host) {
    this.listening = true
    queueMicrotask(() => this.emit('listening'))
  }

  close(callback) {
    this.listening = false
    queueMicrotask(() => callback())
  }

  closeAllConnections() {}
}

const config = Object.freeze({
  password: '',
  username: '',
  polyfill: true,
  telemetryDisabled: true,
  trustedHosts: Object.freeze({ wildcard: false, authorities: Object.freeze([]) }),
  workspace: '/workspace',
})

test('DSH environment preserves values while normalizing gateway-only settings', () => {
  const disabled = createDshEnvironment({
    KEEP: 'yes',
    DSH_PROXY_USERNAME: 'do not forward',
    DSH_PROXY_PASSWORD: 'do not forward',
    DSH_TELEMETRY_DISABLED: 'true',
    DSH_TRUSTED_HOSTS: '*',
  }, config)
  assert.deepEqual(disabled, {
    KEEP: 'yes',
    DSH_DEFAULT_WORKSPACE: '/workspace',
    DSH_TELEMETRY_DISABLED: '1',
  })
  assert.equal(disabled.DSH_PROXY_USERNAME, undefined)
  assert.equal(disabled.DSH_PROXY_PASSWORD, undefined)
  assert.equal(disabled.DSH_TRUSTED_HOSTS, undefined)
  const enabled = createDshEnvironment({ DSH_TELEMETRY_DISABLED: 'true' }, {
    ...config,
    telemetryDisabled: false,
  })
  assert.equal(enabled.DSH_TELEMETRY_DISABLED, undefined)
})

test('readiness polling succeeds and detects an early child exit', async () => {
  const child = new FakeChild()
  let attempts = 0
  await waitForDshReady(child, {
    intervalMs: 0,
    timeoutMs: 100,
    probe: async () => ++attempts === 2,
  })
  assert.equal(attempts, 2)

  const exiting = new FakeChild()
  const waiting = waitForDshReady(exiting, {
    intervalMs: 10,
    timeoutMs: 100,
    probe: async () => false,
  })
  queueMicrotask(() => exiting.emit('exit', 2, null))
  await assert.rejects(waiting, /exited before readiness/)
})

test('termination escalates when DSH ignores SIGTERM', async () => {
  const child = new FakeChild()
  child.exitOnTerminate = false
  await terminateDsh(child, { graceMs: 1 })
  assert.deepEqual(child.kills, ['SIGTERM', 'SIGKILL'])
})

test('gateway owns DSH arguments, environment, and graceful signal shutdown', async () => {
  const child = new FakeChild()
  const signalSource = new EventEmitter()
  let invocation
  let gatewayOptions
  const running = runGateway({ ...config, password: 'secret', username: 'account' }, {
    environment: { KEEP: 'yes' },
    externalPort: 0,
    gatewayFactory: (options) => {
      gatewayOptions = options
      return new FakeServer()
    },
    readiness: async () => {},
    signalSource,
    spawnImpl: (command, arguments_, options) => {
      invocation = { command, arguments_, options }
      return child
    },
  })
  await new Promise(resolve => setImmediate(resolve))
  signalSource.emit('SIGTERM')
  assert.equal(await running, 0)
  assert.equal(invocation.command, '/usr/local/bin/dsh')
  assert.deepEqual(invocation.arguments_, ['web', '--host', '127.0.0.1', '--port', '3079'])
  assert.equal(invocation.options.env.KEEP, 'yes')
  assert.equal(invocation.options.env.DSH_TELEMETRY_DISABLED, '1')
  assert.equal(gatewayOptions.password, 'secret')
  assert.equal(gatewayOptions.username, 'account')
  assert.deepEqual(child.kills, ['SIGTERM'])
})

test('a signal during readiness terminates DSH without starting a server', async () => {
  const child = new FakeChild()
  const signalSource = new EventEmitter()
  let serverCreated = false
  const running = runGateway(config, {
    gatewayFactory: () => {
      serverCreated = true
      return new FakeServer()
    },
    readiness: async () => await new Promise(() => {}),
    signalSource,
    spawnImpl: () => child,
  })
  await new Promise(resolve => setImmediate(resolve))
  signalSource.emit('SIGTERM')
  assert.equal(await running, 0)
  assert.equal(serverCreated, false)
  assert.deepEqual(child.kills, ['SIGTERM'])
})

test('an unexpected successful DSH exit still fails the gateway', async () => {
  const child = new FakeChild()
  const running = runGateway(config, {
    externalPort: 0,
    gatewayFactory: () => new FakeServer(),
    readiness: async () => {},
    signalSource: new EventEmitter(),
    spawnImpl: () => child,
  })
  await new Promise(resolve => setImmediate(resolve))
  child.exitCode = 0
  child.emit('exit', 0, null)
  assert.equal(await running, 1)
})
