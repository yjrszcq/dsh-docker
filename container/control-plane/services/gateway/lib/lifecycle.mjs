import { createGatewayServer, closeGatewayServer } from './proxy.mjs'
import { LocalApiClient } from '../../../modules/updater/lib/client.mjs'

export const EXTERNAL_HOST = '0.0.0.0'
export const EXTERNAL_PORT = 3080

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
  signalSource = process,
  gatewayFactory = createGatewayServer,
  externalHost = EXTERNAL_HOST,
  externalPort = EXTERNAL_PORT,
  managementSocketPath = process.env.DSH_PLATFORM_MANAGEMENT_SOCKET ?? '/run/dsh-platform/management.sock',
  report = async () => {},
} = {}) {
  const record = (message, fields = {}) => Promise.resolve().then(() => report(message, fields)).catch(() => {})
  const management = new LocalApiClient(managementSocketPath)
  const server = gatewayFactory({
    password: config.password,
    username: config.username,
    polyfill: config.polyfill,
    trustedHosts: config.trustedHosts,
    managementSocketPath,
    platformStatus: () => management.request('GET', '/_dsh_platform/api/v1/status'),
    report: record,
  })
  let resolveSignal
  const receivedSignal = new Promise(resolve => { resolveSignal = resolve })
  const onSignal = signal => resolveSignal(signal)
  const onSigint = () => onSignal('SIGINT')
  const onSigterm = () => onSignal('SIGTERM')
  signalSource.once('SIGINT', onSigint)
  signalSource.once('SIGTERM', onSigterm)
  try {
    await record('gateway.starting', { externalHost, externalPort })
    await listen(server, externalPort, externalHost)
    await record('gateway.ready', { externalHost, externalPort })
    const serverFailed = new Promise((_, reject) => server.once('error', reject))
    const signal = await Promise.race([receivedSignal, serverFailed])
    await record('gateway.stopping', { signal })
    await closeGatewayServer(server)
    await record('gateway.stopped')
    return 0
  } catch (error) {
    await record('gateway.fatal', { error })
    if (server.listening) {
      try {
        await closeGatewayServer(server)
      } catch (closeError) {
        await record('gateway.stop.failed', { error: closeError, cause: error instanceof Error ? error.message : String(error) })
      }
    }
    throw error
  } finally {
    signalSource.off('SIGINT', onSigint)
    signalSource.off('SIGTERM', onSigterm)
  }
}
