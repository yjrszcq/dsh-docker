import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import { createGatewayServer, closeGatewayServer, INTERNAL_HOST, INTERNAL_PORT } from './proxy.mjs'

export const EXTERNAL_HOST = '0.0.0.0'
export const EXTERNAL_PORT = 3080

export function createDshEnvironment(environment, config) {
  const childEnvironment = { ...environment, DSH_DEFAULT_WORKSPACE: config.workspace }
  delete childEnvironment.DSH_PROXY_PASSWORD
  delete childEnvironment.DSH_PROXY_USERNAME
  delete childEnvironment.DSH_PROXY_POLYFILL
  delete childEnvironment.DSH_TRUSTED_HOST
  delete childEnvironment.DSH_TRUSTED_HOSTS
  if (config.telemetryDisabled) childEnvironment.DSH_TELEMETRY_DISABLED = '1'
  else delete childEnvironment.DSH_TELEMETRY_DISABLED
  return childEnvironment
}

export function probeDsh({ host = INTERNAL_HOST, port = INTERNAL_PORT } = {}) {
  return new Promise((resolve) => {
    const request = httpRequest({ hostname: host, port, path: '/', method: 'GET' }, response => {
      response.resume()
      resolve((response.statusCode ?? 500) < 500)
    })
    request.setTimeout(1_000, () => request.destroy())
    request.once('error', () => resolve(false))
    request.end()
  })
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds)
    timer.unref?.()
  })
}

export async function waitForDshReady(child, {
  probe = probeDsh,
  intervalMs = 100,
  timeoutMs = 30_000,
} = {}) {
  let terminated
  const childTerminated = new Promise((resolve) => {
    child.once('error', error => resolve(error))
    child.once('exit', (code, signal) => {
      resolve(new Error(`DSH exited before readiness (code=${String(code)}, signal=${String(signal)})`))
    })
  }).then(error => {
    terminated = error
  })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ready = await Promise.race([childTerminated.then(() => false), probe()])
    if (terminated !== undefined) throw terminated
    if (ready) return
    await Promise.race([childTerminated, delay(intervalMs)])
    if (terminated !== undefined) throw terminated
  }
  throw new Error('timed out waiting for DSH readiness')
}

export async function terminateDsh(child, { graceMs = 5_000 } = {}) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit').then(() => true)
  if (!child.kill('SIGTERM')) return
  const graceful = await Promise.race([exited, delay(graceMs).then(() => false)])
  if (!graceful && child.exitCode === null && child.signalCode === null) {
    const forcedExit = once(child, 'exit')
    if (!child.kill('SIGKILL')) return
    await forcedExit
  }
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

export async function runGateway(config, {
  environment = process.env,
  signalSource = process,
  spawnImpl = spawn,
  gatewayFactory = createGatewayServer,
  readiness = waitForDshReady,
  externalHost = EXTERNAL_HOST,
  externalPort = EXTERNAL_PORT,
} = {}) {
  const child = spawnImpl('dsh', ['web', '--host', INTERNAL_HOST, '--port', String(INTERNAL_PORT)], {
    env: createDshEnvironment(environment, config),
    stdio: 'inherit',
  })
  const childExited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  let signalReceived = false
  let resolveSignal
  const receivedSignal = new Promise(resolve => { resolveSignal = resolve })
  const onSignal = () => {
    signalReceived = true
    resolveSignal()
  }
  signalSource.once('SIGINT', onSignal)
  signalSource.once('SIGTERM', onSignal)
  let server

  const closeServer = async () => {
    if (server?.listening) await closeGatewayServer(server)
  }
  try {
    const ready = await Promise.race([
      readiness(child).then(() => true),
      receivedSignal.then(() => false),
    ])
    if (!ready) {
      await terminateDsh(child)
      return 0
    }
    server = gatewayFactory({
      password: config.password,
      username: config.username,
      polyfill: config.polyfill,
      trustedHosts: config.trustedHosts,
    })
    const listening = listen(server, externalPort, externalHost)
    const started = await Promise.race([
      listening.then(() => true),
      receivedSignal.then(() => false),
    ])
    if (!started) {
      await terminateDsh(child)
      await listening.catch(() => {})
      await closeServer()
      return 0
    }

    const serverFailed = new Promise(resolve => server.once('error', resolve))
    const outcome = await Promise.race([
      receivedSignal.then(() => ({ type: 'signal' })),
      childExited.then(result => ({ type: 'child', ...result })),
      serverFailed.then(error => ({ type: 'server', error })),
    ])
    if (outcome.type === 'signal') {
      await closeServer()
      await terminateDsh(child)
      return 0
    }
    if (outcome.type === 'child') {
      await closeServer()
      return outcome.code === null || outcome.code === 0 ? 1 : outcome.code
    }
    await closeServer().catch(() => {})
    await terminateDsh(child)
    return 1
  } catch (error) {
    await closeServer().catch(() => {})
    await terminateDsh(child)
    if (signalReceived) return 0
    throw error
  } finally {
    signalSource.off('SIGINT', onSignal)
    signalSource.off('SIGTERM', onSignal)
  }
}
