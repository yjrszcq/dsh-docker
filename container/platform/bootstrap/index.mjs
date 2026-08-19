#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EnvironmentRunner, loadControlPlane } from './lib/lifecycle.mjs'
import { BootstrapRuntime } from './lib/runtime.mjs'
import { createBootstrapControl, listenBootstrapControl } from './lib/control.mjs'
import { JsonlLogManager } from '../../control-plane/modules/log-manager/index.mjs'
import { PlatformPaths } from '../lib/paths.mjs'
import { parseImageInventory, recordsFromImageInventory } from '../lib/deployment-contracts.mjs'
import { DeploymentManager } from './lib/deployments.mjs'
import { LocalApiClient } from '../../control-plane/modules/updater/lib/client.mjs'

const dataRoot = process.env.DSH_PLATFORM_DATA ?? '/data/platform'
const runRoot = process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform'
const paths = new PlatformPaths(dataRoot, runRoot)
const seedRoot = process.env.DSH_PLATFORM_SEED ?? '/opt/dsh-platform/seed'
const inventory = parseImageInventory(await readFile(join(seedRoot, 'inventory.json')))
const imageRecords = recordsFromImageInventory(inventory)
const deployments = new DeploymentManager({ paths, seedRoot, inventory })
const trust = new LocalApiClient(paths.trustSocket)
await deployments.recoverActivation(trust)
let imagePlan
let planningError = null
try {
  imagePlan = await deployments.prepareImage(imageRecords.deployment)
  await deployments.publishStatus({ plan: imagePlan, currentId: imagePlan.target })
} catch (error) {
  planningError = error
  await deployments.publishStatus({
    recoveryMode: {
      reason: error instanceof Error ? error.message : 'Deployment resolution failed',
      failedRecordId: null,
    },
  })
}
const logs = new JsonlLogManager({
  root: paths.logsRoot,
  maxBytes: Number(process.env.DSH_LOG_MAX_BYTES ?? 104857600),
  retentionDays: Number(process.env.DSH_LOG_RETENTION_DAYS ?? 14),
})
logs.on('error', error => console.error(error))
const capture = (child, source, declaration) => logs.capture(child, source, declaration)
const controlPlane = new EnvironmentRunner({
  environmentRoot: join(import.meta.dirname, '..', '..', 'control-plane'),
  loader: loadControlPlane,
  capture,
})
const environment = new EnvironmentRunner({
  environmentRoot: join(paths.viewsRoot, 'environment'),
  capture,
})
const runtime = new BootstrapRuntime({ controlPlane, environment })
let imageCandidateHealthy = true
await runtime.start({
  allowRecovery: true,
  onEnvironmentFailure: async () => {
    imageCandidateHealthy = false
    return imagePlan === undefined ? false : deployments.rejectImage(imagePlan)
  },
})
if (imageCandidateHealthy && imagePlan !== undefined) await deployments.acceptImage(imagePlan)
const recoveryReason = planningError instanceof Error ? planningError.message : runtime.recoveryMode
const recoveryMode = recoveryReason === null ? null : {
  reason: recoveryReason,
  failedRecordId: imagePlan?.target ?? null,
}
await deployments.publishStatus({ plan: imagePlan, recoveryMode })
const server = createBootstrapControl(runtime, { deployments, trust })
await listenBootstrapControl(server, paths.bootstrapSocket)
process.send?.({ type: 'ready', bootstrapApi: 1 })

let resolveSignal
const signal = new Promise(resolve => { resolveSignal = resolve })
const onSignal = () => resolveSignal({ type: 'signal' })
process.once('SIGINT', onSignal)
process.once('SIGTERM', onSignal)
const outcome = await Promise.race([
  signal,
  runtime.fatal.then(error => ({ type: 'fatal', error })),
])
server.close()
await runtime.stop().catch(error => console.error(error))
if (outcome.type === 'fatal') throw outcome.error
