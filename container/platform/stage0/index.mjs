#!/usr/bin/env node

import { chmod, chown, mkdir, readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { TrustLedger } from './lib/ledger.mjs'
import { VerifiedObjectStore } from './lib/artifacts.mjs'
import { BootstrapManager } from './lib/slots.mjs'
import { BootstrapSupervisor } from './lib/supervisor.mjs'
import { createTrustServer, listenUnix } from './lib/trust-server.mjs'
import { provisionPlatformSeed } from './lib/seed.mjs'
import {
  PlatformPaths,
  preparePersistentLayout,
  replaceRuntimeView,
  resetRuntimeLayout,
  trustStateRootForAuthority,
} from '../lib/paths.mjs'
import { parseImageInventory, recordsFromImageInventory } from '../lib/deployment-contracts.mjs'
import { readDeploymentStatus } from '../lib/deployment-status.mjs'
import { createRecoveryServer, listenRecovery } from './lib/recovery-server.mjs'
import { JsonlLogManager } from '../../control-plane/modules/log-manager/index.mjs'
import { LocalApiClient } from '../../control-plane/modules/updater/lib/client.mjs'
import { createMaintenanceServer, listenMaintenance } from './lib/maintenance-server.mjs'
import { createPasswordAccess } from '../../control-plane/services/gateway/lib/auth.mjs'
import { prepareUserSkillRoots, UserSkillManager } from '../../control-plane/services/management/user-skills.mjs'
import { PersistentStateSnapshots } from '../../control-plane/modules/updater/lib/snapshots.mjs'
import { UserPluginSnapshots } from '../../control-plane/modules/plugin-manager/user-snapshots.mjs'
import { createSnapshotServer, listenSnapshots } from './lib/snapshot-server.mjs'
import { createUserSkillServer, listenUserSkills } from './lib/user-skill-server.mjs'
import { prepareUserWritableRoots } from './lib/user-roots.mjs'
import {
  ProxyLaunchBroker,
  createProxyLaunchServer,
  listenProxyLaunch,
} from './lib/proxy-launch-server.mjs'
import {
  AccessLaunchBroker,
  createAccessLaunchServer,
  listenAccessLaunch,
} from './lib/access-launch-server.mjs'
import {
  clearOutboundProxyEnvironment,
  outboundProxyEnvironment,
  outboundProxyScopeEnabled,
  parseOutboundProxyEnvironment,
} from '../lib/outbound-proxy.mjs'

const dataRoot = process.env.DSH_PLATFORM_DATA ?? '/data/platform'
const runRoot = process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform'
const paths = new PlatformPaths(dataRoot, runRoot)
const seedRoot = process.env.DSH_PLATFORM_SEED ?? '/opt/dsh-platform/seed'
const dshHome = process.env.DSH_HOME ?? '/data/dsh'
const defaultWorkspace = process.env.DSH_DEFAULT_WORKSPACE ?? '/workspace'
const agentsHome = process.env.DSH_AGENTS_HOME ?? '/home/node/.agents'
const inventory = parseImageInventory(await readFile(join(seedRoot, 'inventory.json')))
const proxyUid = 991
const proxyGid = 991
const accessUid = 992
const accessGid = 992
const platformGid = 1000
const imageRecords = recordsFromImageInventory(inventory)
const recoveryPublicKey = (await readFile(join(seedRoot, 'trust', 'recovery-root.spki.base64'), 'utf8')).trim()
const trustStateRoot = trustStateRootForAuthority(paths, inventory.authority)
await preparePersistentLayout(paths)
const logs = new JsonlLogManager({
  root: paths.logsRoot,
  maxBytes: Number(process.env.DSH_LOG_MAX_BYTES ?? 104857600),
  retentionDays: Number(process.env.DSH_LOG_RETENTION_DAYS ?? 14),
  output: { stdout: process.stdout, stderr: process.stderr },
  fileMode: 0o660,
  fileGid: process.getgid?.() === 0 ? 1000 : undefined,
})
await logs.prepare()
logs.on('error', error => { void logs.diagnostic('log-manager', 'capture.failed', { error }) })
const startup = async (phase, operation) => {
  try {
    return await operation()
  } catch (error) {
    await logs.diagnostic('stage0', 'stage0.startup.failed', { error, phase })
    throw error
  }
}
await logs.diagnostic('stage0', 'stage0.starting', {
  imageBuildId: inventory.imageBuildId,
  targetSequence: inventory.targetSequence,
})
await startup('runtime-layout', () => resetRuntimeLayout(paths))
await startup('user-writable-roots', () => prepareUserWritableRoots({
  dshHome,
  defaultWorkspace,
  uid: process.getuid?.() === 0 ? 1000 : undefined,
  gid: process.getgid?.() === 0 ? 1000 : undefined,
}))
await startup('user-skill-roots', () => prepareUserSkillRoots({
  dshHome,
  agentsHome,
  uid: process.getuid?.() === 0 ? 1000 : undefined,
  gid: process.getgid?.() === 0 ? 1000 : undefined,
}))
const ledger = new TrustLedger(trustStateRoot, recoveryPublicKey)
const objects = new VerifiedObjectStore({
  objectRoot: paths.objectsRoot,
  receiptRoot: join(trustStateRoot, 'receipts'),
  untrustedRoot: paths.downloadsRoot,
  ledger,
})
await startup('seed-provision', () => provisionPlatformSeed(seedRoot, paths))
const slots = new BootstrapManager({
  stateRoot: paths.bootstrapStateRoot,
  storeRoot: paths.bootstrapStoreRoot,
  seedRoot,
  inventory,
})
await startup('bootstrap-reconcile', () => slots.reconcileImage(imageRecords.bootstrap))
const currentBootstrap = await startup('bootstrap-resolve', () => slots.current())
await startup('bootstrap-view', () => replaceRuntimeView(paths, 'bootstrap', currentBootstrap.path))
await startup('proxy-state-root', async () => {
  await mkdir(paths.proxyStateRoot, { recursive: true })
  if (process.getuid?.() === 0) await chown(paths.proxyStateRoot, proxyUid, proxyGid)
  await chmod(paths.proxyStateRoot, process.getuid?.() === 0 ? 0o700 : 0o700)
})
await startup('access-state-root', async () => {
  await mkdir(paths.accessStateRoot, { recursive: true })
  if (process.getuid?.() === 0) await chown(paths.accessStateRoot, accessUid, accessGid)
  await chmod(paths.accessStateRoot, 0o700)
})
await startup('access-run-root', async () => {
  await mkdir(paths.accessRunRoot, { recursive: true })
  if (process.getuid?.() === 0) await chown(paths.accessRunRoot, accessUid, platformGid)
  await chmod(paths.accessRunRoot, process.getuid?.() === 0 ? 0o710 : 0o700)
})
const accessLaunchToken = randomBytes(32).toString('base64url')
const accessBroker = new AccessLaunchBroker({
  token: accessLaunchToken,
  dataRoot,
  runRoot,
  script: join(paths.viewsRoot, 'bootstrap', 'control-plane', 'services', 'access-manager', 'index.mjs'),
  accessSocket: paths.accessSocket,
  recoverySocket: paths.accessRecoverySocket,
  uid: accessUid,
  gid: accessGid,
  platformGid,
  capture: (child, source, declaration) => logs.capture(child, source, declaration),
  report: (message, fields) => logs.diagnostic('access-manager', message, fields),
})
const accessLaunchServer = createAccessLaunchServer({
  broker: accessBroker,
  token: accessLaunchToken,
  report: (message, fields) => logs.diagnostic('stage0', message, fields),
})
await startup('access-launch-api', () => listenAccessLaunch(accessLaunchServer, paths.accessLaunchSocket, platformGid))
await logs.diagnostic('stage0', 'access-launch-api.ready')
const proxyLaunchToken = randomBytes(32).toString('base64url')
const proxyBroker = new ProxyLaunchBroker({
  token: proxyLaunchToken,
  dataRoot,
  runRoot,
  script: join(paths.viewsRoot, 'bootstrap', 'control-plane', 'services', 'outbound-proxy', 'index.mjs'),
  controlSocket: paths.proxyControlSocket,
  uid: proxyUid,
  gid: proxyGid,
  platformGid,
  capture: (child, source, declaration) => logs.capture(child, source, declaration),
  report: (message, fields) => logs.diagnostic('outbound-proxy', message, fields),
})
const proxyLaunchServer = createProxyLaunchServer({
  broker: proxyBroker,
  token: proxyLaunchToken,
  report: (message, fields) => logs.diagnostic('stage0', message, fields),
})
await startup('proxy-launch-api', () => listenProxyLaunch(proxyLaunchServer, paths.proxyLaunchSocket, platformGid))
await logs.diagnostic('stage0', 'proxy-launch-api.ready')
const seedKeyring = await readFile(join(seedRoot, 'trust', 'keyring.json'))
const seedSignature = JSON.parse(await readFile(join(seedRoot, 'trust', 'keyring.sig.json'), 'utf8'))
await startup('keyring', () => ledger.acceptKeyring(seedKeyring, seedSignature))
const supervisor = new BootstrapSupervisor({
  slots,
  dataRoot,
  runRoot,
  paths,
  uid: process.getuid?.() === 0 ? 1000 : undefined,
  gid: process.getgid?.() === 0 ? 1000 : undefined,
  user: process.getuid?.() === 0 ? 'node' : undefined,
  home: process.getuid?.() === 0 ? '/home/node' : undefined,
  proxyLaunchToken,
  accessLaunchToken,
  legacyAuthenticationConfigured: Boolean(
    process.env.DSH_PROXY_USERNAME || process.env.DSH_PROXY_PASSWORD || process.env.DSH_PLATFORM_PASSWORD,
  ),
  entrypoint: 'platform/bootstrap/index.mjs',
  seedRoot,
  report: (message, fields) => logs.diagnostic('stage0', message, fields),
})
const trustServer = createTrustServer({
  ledger,
  objects,
  stageBootstrap: async (receipt, version) => {
    const packageObject = await objects.bootstrapPackage(receipt, version)
    const staged = await slots.stageArchive(packageObject.path, {
      version,
      targetSequence: packageObject.receipt.targetSequence,
    })
    await logs.diagnostic('stage0', 'bootstrap.staged', {
      bootstrapVersion: version,
      recordId: staged.record.id,
      targetSequence: staged.record.targetSequence,
      recordChanged: staged.recordChanged,
      restartRequired: staged.restartRequired,
    })
    if (staged.restartRequired) setImmediate(() => {
      void supervisor.restart().catch(error => logs.diagnostic('stage0', 'bootstrap.activation.failed', {
        error,
        bootstrapVersion: version,
      }))
    })
    return Object.freeze({
      recordId: staged.record.id,
      targetSequence: staged.record.targetSequence,
      recordChanged: staged.recordChanged,
      restartRequired: staged.restartRequired,
    })
  },
  collectBootstrap: () => slots.collectGarbage(),
  report: (message, fields) => logs.diagnostic('stage0-trust', message, fields),
})
await startup('trust-api', () => listenUnix(trustServer, paths.trustSocket, {
  mode: process.getuid?.() === 0 ? 0o660 : 0o600,
  uid: process.getuid?.() === 0 ? 0 : undefined,
  gid: process.getgid?.() === 0 ? 1000 : undefined,
}))
await logs.diagnostic('stage0', 'trust-api.ready')
const management = new LocalApiClient(paths.managementSocket)
const outboundProxy = new LocalApiClient(paths.proxyControlSocket)
const gatewayAccess = new LocalApiClient(paths.gatewayAccessSocket)
const gatewayPassword = createPasswordAccess(process.env.DSH_PROXY_PASSWORD ?? '', {
  username: process.env.DSH_PROXY_USERNAME ?? '',
})
const maintenance = await createMaintenanceServer({
  paths,
  dshHome,
  defaultWorkspace,
  terminalEnvironment: async () => {
    try {
      const result = await outboundProxy.request('GET', '/v1/environment?scope=managementTerminal')
      return clearOutboundProxyEnvironment(parseOutboundProxyEnvironment(result.environment, 'managementTerminal'))
    } catch (error) {
      await logs.diagnostic('stage0', 'outbound-proxy.terminal-environment.fallback', {
        error,
        level: 'warning',
      })
      try {
        const state = JSON.parse(await readFile(paths.proxyRoutingStatePath, 'utf8'))
        return outboundProxyEnvironment('managementTerminal', {
          enabled: outboundProxyScopeEnabled(state, 'managementTerminal'),
        })
      } catch {
        return outboundProxyEnvironment('managementTerminal')
      }
    }
  },
  authorize: async request => {
    if (gatewayPassword.enabled) return gatewayPassword.isAuthenticated(request)
    try {
      return (await gatewayAccess.request('POST', '/v1/sessions/validate', {
        cookie: request.headers.cookie ?? null,
      })).authenticated === true
    } catch { return false }
  },
  platformBusy: async () => {
    try {
      const status = await management.request('GET', '/_dsh_platform/api/v1/status')
      return !['idle', 'success', 'failed'].includes(status.update?.status)
        || ['starting', 'stopping', 'restarting', 'recovering'].includes(status.dshLifecycle?.state)
        || status.runtimeReset?.status === 'resetting'
        || status.systemPluginOperation?.status === 'running'
        || status.userPluginOperation?.status === 'running'
    } catch { return true }
  },
  report: (message, fields) => logs.diagnostic('maintenance', message, fields),
  fileReport: (message, fields) => logs.diagnostic('file-manager', message, fields),
  terminalReport: (message, fields) => logs.diagnostic('terminal', message, fields),
  audit: (message, fields) => logs.diagnostic('audit', message, { stream: 'audit', ...fields }),
})
await startup('maintenance-api', () => listenMaintenance(maintenance.server, paths.maintenanceSocket))
await logs.diagnostic('stage0', 'maintenance-api.ready', { privileged: true })
const snapshotServer = createSnapshotServer({
  dshSnapshots: new PersistentStateSnapshots({ root: paths.snapshotsRoot, sourceRoot: dshHome }),
  userPluginSnapshots: new UserPluginSnapshots({
    root: paths.userPluginSnapshotsRoot,
    profileRoot: join(dshHome, 'profiles', 'web'),
  }),
  report: (message, fields) => logs.diagnostic('snapshot-manager', message, fields),
})
await startup('snapshot-api', () => listenSnapshots(snapshotServer, paths.snapshotSocket))
await logs.diagnostic('stage0', 'snapshot-api.ready', { privileged: true })
const userSkillServer = createUserSkillServer({
  manager: new UserSkillManager({ dshHome, agentsHome }),
  report: (message, fields) => logs.diagnostic('user-skill-manager', message, fields),
})
await startup('user-skill-api', () => listenUserSkills(userSkillServer, paths.userSkillSocket))
await logs.diagnostic('stage0', 'user-skill-api.ready', { privileged: true })
await startup('bootstrap', () => supervisor.startWithRollback())
const recoveryServer = createRecoveryServer({
  inventory,
  deployments: () => readDeploymentStatus(paths.deploymentStatusPath),
  supervisor,
  report: (message, fields) => logs.diagnostic('stage0-recovery', message, fields),
})
await startup('recovery-api', () => listenRecovery(recoveryServer, paths.recoverySocket))
await logs.diagnostic('stage0', 'stage0.ready', {
  bootstrapRecordId: (await slots.state()).current,
  recoveryApi: true,
  trustApi: true,
})
let resolveSignal
const signal = new Promise(resolve => { resolveSignal = resolve })
const onSignal = value => resolveSignal({ type: 'signal', signal: value })
process.once('SIGINT', () => onSignal('SIGINT'))
process.once('SIGTERM', () => onSignal('SIGTERM'))
const outcome = await Promise.race([
  signal,
  supervisor.fatal.then(error => ({ type: 'exit', error })),
])
if (outcome.type === 'exit') await logs.diagnostic('stage0', 'stage0.fatal', { error: outcome.error })
else await logs.diagnostic('stage0', 'stage0.stopping', { signal: outcome.signal })
trustServer.close()
recoveryServer.close()
await maintenance.terminal.shutdown()
await new Promise(resolve => maintenance.server.close(resolve))
await new Promise(resolve => snapshotServer.close(resolve))
await new Promise(resolve => userSkillServer.close(resolve))
try {
  await supervisor.stop()
} catch (error) {
  await logs.diagnostic('stage0', 'stage0.stop.failed', { error })
  throw error
}
await proxyBroker.stop()
await new Promise(resolve => proxyLaunchServer.close(resolve))
await accessBroker.stop()
await new Promise(resolve => accessLaunchServer.close(resolve))
await logs.diagnostic('stage0', 'stage0.stopped')
if (outcome.type === 'exit') {
  throw outcome.error
}
