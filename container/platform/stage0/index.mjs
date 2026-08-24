#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
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
import { prepareUserSkillRoots } from '../../control-plane/services/management/user-skills.mjs'
import { PersistentStateSnapshots } from '../../control-plane/modules/updater/lib/snapshots.mjs'
import { UserPluginSnapshots } from '../../control-plane/modules/plugin-manager/user-snapshots.mjs'
import { createSnapshotServer, listenSnapshots } from './lib/snapshot-server.mjs'

const dataRoot = process.env.DSH_PLATFORM_DATA ?? '/data/platform'
const runRoot = process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform'
const paths = new PlatformPaths(dataRoot, runRoot)
const seedRoot = process.env.DSH_PLATFORM_SEED ?? '/opt/dsh-platform/seed'
const dshHome = process.env.DSH_HOME ?? '/data/dsh'
const agentsHome = process.env.DSH_AGENTS_HOME ?? '/home/node/.agents'
const inventory = parseImageInventory(await readFile(join(seedRoot, 'inventory.json')))
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
  entrypoint: 'platform/bootstrap/index.mjs',
  seedRoot,
  report: (message, fields) => logs.diagnostic('stage0', message, fields),
})
const trustServer = createTrustServer({
  ledger,
  objects,
  stageBootstrap: async (receipt, version) => {
    const packageObject = await objects.bootstrapPackage(receipt, version)
    const record = await slots.installArchive(packageObject.path, {
      version,
      targetSequence: packageObject.receipt.targetSequence,
    })
    await slots.promote(record.id)
    setImmediate(() => {
      void supervisor.restart().catch(error => logs.diagnostic('stage0', 'bootstrap.activation.failed', {
        error,
        bootstrapVersion: version,
      }))
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
const gatewayAccess = new LocalApiClient(paths.gatewayAccessSocket)
const gatewayPassword = createPasswordAccess(process.env.DSH_PROXY_PASSWORD ?? '', {
  username: process.env.DSH_PROXY_USERNAME ?? '',
})
const maintenance = await createMaintenanceServer({
  paths,
  dshHome,
  defaultWorkspace: process.env.DSH_DEFAULT_WORKSPACE ?? '/workspace',
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
try {
  await supervisor.stop()
} catch (error) {
  await logs.diagnostic('stage0', 'stage0.stop.failed', { error })
  throw error
}
await logs.diagnostic('stage0', 'stage0.stopped')
if (outcome.type === 'exit') {
  throw outcome.error
}
