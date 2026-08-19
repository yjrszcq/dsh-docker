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

const dataRoot = process.env.DSH_PLATFORM_DATA ?? '/data/platform'
const runRoot = process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform'
const paths = new PlatformPaths(dataRoot, runRoot)
const seedRoot = process.env.DSH_PLATFORM_SEED ?? '/opt/dsh-platform/seed'
const inventory = parseImageInventory(await readFile(join(seedRoot, 'inventory.json')))
const imageRecords = recordsFromImageInventory(inventory)
const recoveryPublicKey = (await readFile(join(seedRoot, 'trust', 'recovery-root.spki.base64'), 'utf8')).trim()
await preparePersistentLayout(paths)
await resetRuntimeLayout(paths)
const ledger = new TrustLedger(paths.trustStateRoot, recoveryPublicKey)
const objects = new VerifiedObjectStore({
  objectRoot: paths.objectsRoot,
  receiptRoot: join(paths.trustStateRoot, 'receipts'),
  untrustedRoot: paths.downloadsRoot,
  ledger,
})
await provisionPlatformSeed(seedRoot, paths)
const slots = new BootstrapManager({
  stateRoot: paths.bootstrapStateRoot,
  storeRoot: paths.bootstrapStoreRoot,
  seedRoot,
  inventory,
})
await slots.reconcileImage(imageRecords.bootstrap)
const currentBootstrap = await slots.current()
await replaceRuntimeView(paths, 'bootstrap', currentBootstrap.path)
const seedKeyring = await readFile(join(seedRoot, 'trust', 'keyring.json'))
const seedSignature = JSON.parse(await readFile(join(seedRoot, 'trust', 'keyring.sig.json'), 'utf8'))
await ledger.acceptKeyring(seedKeyring, seedSignature)
const supervisor = new BootstrapSupervisor({
  slots,
  dataRoot,
  runRoot,
  paths,
  uid: process.getuid?.() === 0 ? 1000 : undefined,
  gid: process.getgid?.() === 0 ? 1000 : undefined,
  entrypoint: 'platform/bootstrap/index.mjs',
  seedRoot,
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
    setImmediate(() => { void supervisor.restart().catch(error => console.error(error)) })
  },
})
await listenUnix(trustServer, paths.trustSocket, {
  mode: process.getuid?.() === 0 ? 0o660 : 0o600,
  uid: process.getuid?.() === 0 ? 0 : undefined,
  gid: process.getgid?.() === 0 ? 1000 : undefined,
})
await supervisor.startWithRollback()
let resolveSignal
const signal = new Promise(resolve => { resolveSignal = resolve })
const onSignal = () => resolveSignal({ type: 'signal' })
process.once('SIGINT', onSignal)
process.once('SIGTERM', onSignal)
const outcome = await Promise.race([
  signal,
  supervisor.fatal.then(error => ({ type: 'exit', error })),
])
trustServer.close()
await supervisor.stop()
if (outcome.type === 'exit') {
  throw outcome.error
}
