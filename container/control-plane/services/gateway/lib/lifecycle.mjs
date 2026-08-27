import { createGatewayServer, closeGatewayServer } from './proxy.mjs'
import {
  createPlatformAccessControlServer,
  listenPlatformAccessControl,
  PlatformAccess,
} from './platform-access.mjs'
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
  maintenanceSocketPath = process.env.DSH_PLATFORM_MAINTENANCE_SOCKET ?? '/run/dsh-platform/maintenance.sock',
  gatewayAccessSocketPath = process.env.DSH_PLATFORM_GATEWAY_ACCESS_SOCKET ?? '/run/dsh-platform/gateway-access.sock',
  platformAccess = new PlatformAccess({ password: config.platformPassword }),
  managementClient,
  platformStatusPollMs = 250,
  platformStatusCacheMs = 10_000,
  now = () => Date.now(),
  accessServerFactory = createPlatformAccessControlServer,
  listenAccessServer = listenPlatformAccessControl,
  report = async () => {},
} = {}) {
  const record = (message, fields = {}) => Promise.resolve().then(() => report(message, fields)).catch(() => {})
  const management = managementClient ?? new LocalApiClient(managementSocketPath)
  let lastPlatformStatus
  let lastPlatformStatusAt = 0
  const refreshPlatformStatus = async () => {
    const status = await management.request('GET', '/_dsh_platform/api/v1/status')
    lastPlatformStatus = status
    lastPlatformStatusAt = now()
    return status
  }
  const platformStatus = async () => {
    try {
      return await refreshPlatformStatus()
    } catch (error) {
      if (lastPlatformStatus !== undefined && now() - lastPlatformStatusAt <= platformStatusCacheMs) {
        return lastPlatformStatus
      }
      throw error
    }
  }
  const accessServer = accessServerFactory(platformAccess, { report: record })
  const server = gatewayFactory({
    password: config.password,
    username: config.username,
    polyfill: config.polyfill,
    trustedHosts: config.trustedHosts,
    managementSocketPath,
    maintenanceSocketPath,
    platformAccess,
    platformStatus,
    report: record,
  })
  const platformStatusTimer = setInterval(() => {
    void refreshPlatformStatus().catch(() => {})
  }, platformStatusPollMs)
  platformStatusTimer.unref?.()
  void refreshPlatformStatus().catch(() => {})
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
    await listenAccessServer(accessServer, gatewayAccessSocketPath)
    await record('gateway.ready', { externalHost, externalPort })
    const serverFailed = new Promise((_, reject) => server.once('error', reject))
    const accessServerFailed = new Promise((_, reject) => accessServer.once('error', reject))
    const signal = await Promise.race([receivedSignal, serverFailed, accessServerFailed])
    await record('gateway.stopping', { signal })
    await closeGatewayServer(server)
    await new Promise(resolve => accessServer.close(resolve))
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
    if (accessServer.listening) await new Promise(resolve => accessServer.close(resolve))
    throw error
  } finally {
    clearInterval(platformStatusTimer)
    signalSource.off('SIGINT', onSigint)
    signalSource.off('SIGTERM', onSigterm)
  }
}
