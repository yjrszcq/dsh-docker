#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EnvironmentRunner, loadControlPlane } from './lib/lifecycle.mjs'
import { BootstrapRuntime } from './lib/runtime.mjs'
import { createBootstrapControl, listenBootstrapControl } from './lib/control.mjs'
import { JsonlLogManager } from '../../control-plane/modules/log-manager/index.mjs'
import { PlatformPaths } from '../lib/paths.mjs'
import { parseImageInventory, recordsFromImageInventory } from '../lib/deployment-contracts.mjs'
import { DeploymentManager, DeploymentResolutionError } from './lib/deployments.mjs'
import { LocalApiClient } from '../../control-plane/modules/updater/lib/client.mjs'
import {
  linkSystemPluginScope,
  listManagedSystemPlugins,
  materializeSystemPluginSelection,
  pruneSystemPluginSelectionViews,
  SystemPluginSelectionStore,
} from '../../control-plane/modules/system-plugin-manager/index.mjs'
import { replaceSystemPluginView } from '../lib/paths.mjs'
import { verifyRuntimePatches } from '../../control-plane/modules/patch-manager/index.mjs'

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
let previousPlan
let planningError = null
try {
  imagePlan = await deployments.prepareImage(imageRecords.deployment)
  await deployments.publishStatus({ plan: imagePlan, currentId: imagePlan.target })
} catch (error) {
  planningError = error
  if (error instanceof DeploymentResolutionError) {
    try {
      previousPlan = await deployments.preparePreviousRecovery()
      await deployments.publishStatus({ currentId: previousPlan.target, operation: 'recovering' })
    } catch (recoveryError) {
      planningError = new AggregateError([error, recoveryError], 'Deployment resolution and previous recovery failed')
    }
  }
  if (previousPlan === undefined) await deployments.publishStatus({
    recoveryMode: {
      reason: error instanceof Error ? error.message : 'Deployment resolution failed',
      failedRecordId: null,
    },
  })
}
await linkSystemPluginScope({
  dshHome: process.env.DSH_HOME ?? '/data/dsh',
  viewRoot: join(paths.viewsRoot, 'system-plugins'),
})
const systemPluginSelections = new SystemPluginSelectionStore(join(paths.deploymentStateRoot, 'system-plugins.json'))
const applySystemPluginSelection = async () => {
  const selected = await deployments.selected()
  if (selected === null) return []
  const materialized = await materializeSystemPluginSelection({
    environmentRoot: selected.paths.environment,
    sourceRoot: selected.paths['system-plugins'],
    outputRoot: paths.systemPluginViewsRoot,
    selectionStore: systemPluginSelections,
  })
  await replaceSystemPluginView(paths, materialized.path)
  await pruneSystemPluginSelectionViews({ outputRoot: paths.systemPluginViewsRoot, keepPath: materialized.path })
  return materialized.plugins
}
const logs = new JsonlLogManager({
  root: paths.logsRoot,
  maxBytes: Number(process.env.DSH_LOG_MAX_BYTES ?? 104857600),
  retentionDays: Number(process.env.DSH_LOG_RETENTION_DAYS ?? 14),
  output: { stdout: process.stdout, stderr: process.stderr },
})
logs.on('error', error => console.error(error))
const capture = (child, source, declaration) => logs.capture(
  child,
  source,
  declaration,
  { acceptForwarded: source === 'platform-management' },
)
const controlPlane = new EnvironmentRunner({
  environmentRoot: join(import.meta.dirname, '..', '..', 'control-plane'),
  loader: loadControlPlane,
  capture,
})
const environment = new EnvironmentRunner({
  environmentRoot: join(paths.viewsRoot, 'environment'),
  capture,
})
const runtime = new BootstrapRuntime({
  controlPlane,
  environment,
  validateDeployment: async () => {
    await verifyRuntimePatches({
      runtimeRoot: join(paths.viewsRoot, 'runtime'),
      environmentRoot: join(paths.viewsRoot, 'environment'),
    })
    await applySystemPluginSelection()
  },
})
const systemPlugins = {
  list: async () => {
    const resolved = await deployments.selected()
    if (resolved === null) return []
    return listManagedSystemPlugins({
      environmentRoot: resolved.paths.environment,
      sourceRoot: resolved.paths['system-plugins'],
      selectionStore: systemPluginSelections,
    })
  },
  mutate: (pluginId, action, recovery = false) => deployments.exclusive(async () => {
    const resolved = await deployments.selected()
    if (resolved === null) throw new Error('no Deployment is selected')
    const before = await systemPlugins.list()
    const pluginIds = before.map(plugin => plugin.id)
    const previousSelection = await systemPluginSelections.read(pluginIds)
    try {
      await systemPluginSelections[recovery ? 'recover' : 'configure'](pluginIds, pluginId, action)
      await applySystemPluginSelection()
      return systemPlugins.list()
    } catch (error) {
      try {
        await systemPluginSelections.write(pluginIds, previousSelection)
        await applySystemPluginSelection()
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'System Plugin operation and rollback failed')
      }
      throw error
    }
  }),
}
systemPlugins.configure = (pluginId, action) => systemPlugins.mutate(pluginId, action)
systemPlugins.recover = (pluginId, action) => systemPlugins.mutate(pluginId, action, true)
const server = createBootstrapControl(runtime, { deployments, trust, systemPlugins })
await listenBootstrapControl(server, paths.bootstrapSocket)
let imageCandidateHealthy = true
try {
  await runtime.start({
    allowRecovery: true,
    onEnvironmentFailure: async () => {
      imageCandidateHealthy = false
      if (previousPlan !== undefined) return false
      if (planningError !== null) return false
      if (imagePlan?.fallback !== null && imagePlan?.fallback !== undefined) {
        return deployments.rejectImage(imagePlan)
      }
      try {
        previousPlan = await deployments.preparePreviousRecovery(imagePlan?.target)
        return true
      } catch {
        return false
      }
    },
  })
} catch (error) {
  server.close()
  throw error
}
if (runtime.recoveryMode === null) {
  if (imageCandidateHealthy && imagePlan !== undefined) await deployments.acceptImage(imagePlan)
  else if (previousPlan !== undefined) {
    try {
      await deployments.acceptPreviousRecovery(previousPlan, tokens => trust.activate(tokens))
      planningError = null
    } catch (error) {
      await runtime.suspend('dsh-runtime').catch(() => {})
      runtime.enterRecovery(error)
    }
  }
}
const recoveryReason = runtime.recoveryMode ?? (previousPlan === undefined && planningError instanceof Error
  ? planningError.message
  : null)
const recoveryMode = recoveryReason === null ? null : {
  reason: recoveryReason,
  failedRecordId: imagePlan?.target ?? null,
}
await deployments.publishStatus({ plan: imagePlan, recoveryMode })
await logs.append('bootstrap', 'platform', 'platform ready', { recoveryMode: recoveryMode !== null })
process.send?.({ type: 'ready', bootstrapApi: 1 })
process.on('message', message => {
  if (message?.type !== 'recover-image-baseline' || typeof message.requestId !== 'string') return
  void deployments.recoverImageBaseline(imageRecords.deployment, {
    healthCheck: () => runtime.reload(),
    activateReceipts: tokens => trust.activate(tokens),
  }).then(
    slots => process.send?.({ type: 'recovery-result', requestId: message.requestId, slots }),
    error => process.send?.({
      type: 'recovery-result', requestId: message.requestId,
      error: error instanceof Error ? error.message : 'image baseline recovery failed',
    }),
  )
})

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
