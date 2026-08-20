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
  password: '',
  platformPassword: '',
  username: '',
  polyfill: true,
  trustedHosts: Object.freeze({ wildcard: false, authorities: Object.freeze([]) }),
})

test('gateway owns only its listener and forwards management socket configuration', async () => {
  const signalSource = new EventEmitter()
  const server = new FakeServer()
  const accessServer = new FakeServer()
  let options
  const reports = []
  const running = runGateway(config, {
    externalHost: '127.0.0.1',
    externalPort: 8080,
    managementSocketPath: '/run/platform.sock',
    gatewayAccessSocketPath: '/run/access.sock',
    accessServerFactory: () => accessServer,
    listenAccessServer: async (value, path) => {
      value.listening = true
      value.bound = path
    },
    signalSource,
    report: (message, fields) => { reports.push({ message, fields }) },
    gatewayFactory: value => { options = value; return server },
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(server.bound, { host: '127.0.0.1', port: 8080 })
  assert.equal(options.managementSocketPath, '/run/platform.sock')
  assert.equal(accessServer.bound, '/run/access.sock')
  assert.equal(typeof options.platformStatus, 'function')
  signalSource.emit('SIGTERM')
  assert.equal(await running, 0)
  assert.equal(server.listening, false)
  assert.equal(accessServer.listening, false)
  assert.deepEqual(reports.map(entry => entry.message), [
    'gateway.starting', 'gateway.ready', 'gateway.stopping', 'gateway.stopped',
  ])
  assert.equal(reports[2].fields.signal, 'SIGTERM')
})

test('gateway propagates listener failures without creating a DSH process', async () => {
  const server = new FakeServer()
  const accessServer = new FakeServer()
  const reports = []
  server.listen = () => queueMicrotask(() => server.emit('error', new Error('bind failed')))
  await assert.rejects(runGateway(config, {
    gatewayFactory: () => server,
    accessServerFactory: () => accessServer,
    listenAccessServer: async () => {},
    signalSource: new EventEmitter(),
    report: (message, fields) => { reports.push({ message, fields }) },
  }), /bind failed/)
  assert.equal(reports.some(entry => entry.message === 'gateway.fatal'
    && entry.fields.error.message === 'bind failed'), true)
})
