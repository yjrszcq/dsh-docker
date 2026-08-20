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
} from '../lib/paths.mjs'
import { parseImageInventory, recordsFromImageInventory } from '../lib/deployment-contracts.mjs'
import { readDeploymentStatus } from '../lib/deployment-status.mjs'
import { createRecoveryServer, listenRecovery } from './lib/recovery-server.mjs'
import { JsonlLogManager } from '../../control-plane/modules/log-manager/index.mjs'

const dataRoot = process.env.DSH_PLATFORM_DATA ?? '/data/platform'
const runRoot = process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform'
const paths = new PlatformPaths(dataRoot, runRoot)
const seedRoot = process.env.DSH_PLATFORM_SEED ?? '/opt/dsh-platform/seed'
const inventory = parseImageInventory(await readFile(join(seedRoot, 'inventory.json')))
const imageRecords = recordsFromImageInventory(inventory)
const recoveryPublicKey = (await readFile(join(seedRoot, 'trust', 'recovery-root.spki.base64'), 'utf8')).trim()
await preparePersistentLayout(paths)
const logs = new JsonlLogManager({
  root: paths.logsRoot,
  maxBytes: Number(process.env.DSH_LOG_MAX_BYTES ?? 104857600),
  retentionDays: Number(process.env.DSH_LOG_RETENTION_DAYS ?? 14),
  output: { stdout: process.stdout, stderr: process.stderr },
  fileMode: process.getuid?.() === 0 ? 0o640 : 0o600,
  fileGid: process.getgid?.() === 0 ? 1000 : undefined,
})
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
const ledger = new TrustLedger(paths.trustStateRoot, recoveryPublicKey)
const objects = new VerifiedObjectStore({
  objectRoot: paths.objectsRoot,
  receiptRoot: join(paths.trustStateRoot, 'receipts'),
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
