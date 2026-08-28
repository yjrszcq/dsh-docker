import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { runGateway } from '../lib/lifecycle.mjs'

class FakeServer extends EventEmitter {
  listening = false

  listen(port, host) {
    this.listening = true
    this.bound = { port, host }
    queueMicrotask(() => this.emit('listening'))
  }

  close(callback) {
    this.listening = false
    queueMicrotask(() => callback())
  }

  closeAllConnections() {}
}

const config = Object.freeze({
  polyfill: true,
  trustedHosts: Object.freeze({ wildcard: false, authorities: Object.freeze([]) }),
})

test('gateway owns only its listener and binds browser authentication to Access Manager', async () => {
  const signalSource = new EventEmitter()
  const server = new FakeServer()
  let options
  const reports = []
  const running = runGateway(config, {
    externalHost: '127.0.0.1',
    externalPort: 8080,
    managementSocketPath: '/run/platform.sock',
    maintenanceSocketPath: '/run/maintenance.sock',
    accessClient: { request: async () => ({ state: 'recovery-required' }) },
    signalSource,
    report: (message, fields) => { reports.push({ message, fields }) },
    gatewayFactory: value => { options = value; return server },
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(server.bound, { host: '127.0.0.1', port: 8080 })
  assert.equal(options.managementSocketPath, '/run/platform.sock')
  assert.equal(options.maintenanceSocketPath, '/run/maintenance.sock')
  assert.equal(typeof options.browserAuthentication.handle, 'function')
  assert.equal(typeof options.platformStatus, 'function')
  signalSource.emit('SIGTERM')
  assert.equal(await running, 0)
  assert.equal(server.listening, false)
  assert.deepEqual(reports.map(entry => entry.message), [
    'gateway.starting', 'gateway.ready', 'gateway.stopping', 'gateway.stopped',
  ])
  assert.equal(reports[2].fields.signal, 'SIGTERM')
})

test('gateway propagates listener failures without creating a DSH process', async () => {
  const server = new FakeServer()
  const reports = []
  server.listen = () => queueMicrotask(() => server.emit('error', new Error('bind failed')))
  await assert.rejects(runGateway(config, {
    gatewayFactory: () => server,
    accessClient: { request: async () => ({ state: 'recovery-required' }) },
    signalSource: new EventEmitter(),
    report: (message, fields) => { reports.push({ message, fields }) },
  }), /bind failed/)
  assert.equal(reports.some(entry => entry.message === 'gateway.fatal'
    && entry.fields.error.message === 'bind failed'), true)
})

test('gateway can expose an isolated Management listener from the same process', async () => {
  const signalSource = new EventEmitter()
  const servers = []
  const running = runGateway(config, {
    externalHost: '127.0.0.1',
    externalPort: 8080,
    managementPort: 8081,
    managementHost: '127.0.0.1',
    gatewayFactory: options => {
      const server = new FakeServer()
      server.options = options
      servers.push(server)
      return server
    },
    accessClient: { request: async () => ({ state: 'recovery-required' }) },
    signalSource,
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(servers.length, 2)
  assert.deepEqual(servers[0].bound, { host: '127.0.0.1', port: 8080 })
  assert.deepEqual(servers[1].bound, { host: '127.0.0.1', port: 8081 })
  assert.equal(servers[0].options.surface, 'compat')
  assert.equal(servers[1].options.surface, 'management')
  signalSource.emit('SIGTERM')
  assert.equal(await running, 0)
  assert.equal(servers.every(server => server.listening === false), true)
})

test('gateway retains a recent platform status while Management is handed off', async () => {
  const signalSource = new EventEmitter()
  const server = new FakeServer()
  const expected = { update: { status: 'building-candidate' } }
  let requests = 0
  let options
  const running = runGateway(config, {
    gatewayFactory: value => { options = value; return server },
    accessClient: { request: async () => ({ state: 'recovery-required' }) },
    signalSource,
    managementClient: {
      request: async () => {
        requests += 1
        if (requests === 1) return expected
        throw Object.assign(new Error('Management is switching'), { code: 'ECONNREFUSED' })
      },
    },
    platformStatusPollMs: 5,
  })
  try {
    await new Promise(resolve => setTimeout(resolve, 15))
    assert.deepEqual(await options.platformStatus(), expected)
    assert.equal(requests >= 2, true)
  } finally {
    signalSource.emit('SIGTERM')
    assert.equal(await running, 0)
  }
})
