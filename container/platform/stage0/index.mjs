#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TrustLedger } from './lib/ledger.mjs'
import { VerifiedObjectStore } from './lib/artifacts.mjs'
import { BootstrapSlots } from './lib/slots.mjs'
import { BootstrapSupervisor } from './lib/supervisor.mjs'
import { createTrustServer, listenUnix } from './lib/trust-server.mjs'
import { provisionPlatformSeed } from './lib/seed.mjs'

const dataRoot = process.env.DSH_PLATFORM_DATA ?? '/data'
const seedRoot = process.env.DSH_PLATFORM_SEED ?? '/opt/dsh-platform/seed'
const bootstrapVersion = (await readFile(join(seedRoot, 'bootstrap', 'VERSION'), 'utf8')).trim()
const recoveryPublicKey = (await readFile(join(seedRoot, 'trust', 'recovery-root.spki.base64'), 'utf8')).trim()
const ledger = new TrustLedger(join(dataRoot, 'trust'), recoveryPublicKey)
const objects = new VerifiedObjectStore({
  root: join(dataRoot, 'trust'),
  untrustedRoot: join(dataRoot, 'downloads', 'untrusted'),
  ledger,
})
const slots = new BootstrapSlots(join(dataRoot, 'bootstrap'))
await slots.provisionSeed(join(seedRoot, 'bootstrap', bootstrapVersion), bootstrapVersion)
await provisionPlatformSeed(seedRoot, dataRoot)
const seedKeyring = await readFile(join(seedRoot, 'trust', 'keyring.json'))
const seedSignature = JSON.parse(await readFile(join(seedRoot, 'trust', 'keyring.sig.json'), 'utf8'))
await ledger.acceptKeyring(seedKeyring, seedSignature)
const supervisor = new BootstrapSupervisor({
  slots,
  dataRoot,
  uid: process.getuid?.() === 0 ? 1000 : undefined,
  gid: process.getgid?.() === 0 ? 1000 : undefined,
  entrypoint: 'platform/bootstrap/index.mjs',
})
const trustServer = createTrustServer({
  ledger,
  objects,
  stageBootstrap: async (receipt, version) => {
    const packageObject = await objects.bootstrapPackage(receipt, version)
    await slots.installArchive(packageObject.path, version)
    await slots.promote(version)
    setImmediate(() => { void supervisor.restart().catch(error => console.error(error)) })
  },
})
await listenUnix(trustServer, join(dataRoot, 'run', 'stage0-trust.sock'), {
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
