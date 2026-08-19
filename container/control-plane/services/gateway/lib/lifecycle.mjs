import { createGatewayServer, closeGatewayServer } from './proxy.mjs'

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
} = {}) {
  const server = gatewayFactory({
    password: config.password,
    username: config.username,
    polyfill: config.polyfill,
    trustedHosts: config.trustedHosts,
    managementSocketPath,
  })
  let resolveSignal
  const receivedSignal = new Promise(resolve => { resolveSignal = resolve })
  const onSignal = () => resolveSignal()
  signalSource.once('SIGINT', onSignal)
  signalSource.once('SIGTERM', onSignal)
  try {
    await listen(server, externalPort, externalHost)
    const serverFailed = new Promise((_, reject) => server.once('error', reject))
    await Promise.race([receivedSignal, serverFailed])
    await closeGatewayServer(server)
    return 0
  } catch (error) {
    if (server.listening) await closeGatewayServer(server).catch(() => {})
    throw error
  } finally {
    signalSource.off('SIGINT', onSignal)
    signalSource.off('SIGTERM', onSignal)
  }
}
