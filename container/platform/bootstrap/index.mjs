#!/usr/bin/env node

import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { EnvironmentRunner, loadControlPlane } from './lib/lifecycle.mjs'
import { BootstrapRuntime } from './lib/runtime.mjs'
import { createBootstrapControl, listenBootstrapControl } from './lib/control.mjs'
import { createDshLifecycleServer, DshLifecycleBroker, listenDshLifecycle } from './lib/dsh-lifecycle.mjs'
import { JsonlLogManager } from '../../control-plane/modules/log-manager/index.mjs'
import { PlatformPaths } from '../lib/paths.mjs'
import { parseImageInventory, recordsFromImageInventory } from '../lib/deployment-contracts.mjs'
import { DeploymentManager, DeploymentResolutionError } from './lib/deployments.mjs'
import { LocalApiClient } from '../../control-plane/modules/updater/lib/client.mjs'
import {
  discardSystemPluginSelection,
  linkSystemPluginScope,
  listManagedSystemPlugins,
  materializeSystemPluginSelection,
  pruneSystemPluginSelectionViews,
  SystemPluginSelectionStore,
} from '../../control-plane/modules/plugin-manager/system.mjs'
import { replaceSystemPluginView } from '../lib/paths.mjs'
import { verifyRuntimePatches } from '../../control-plane/modules/patch-manager/index.mjs'
import { SystemSkillManager } from '../../control-plane/modules/skill-manager/index.mjs'

const dataRoot = process.env.DSH_PLATFORM_DATA ?? '/data/platform'
const runRoot = process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform'
const paths = new PlatformPaths(dataRoot, runRoot)
const logs = new JsonlLogManager({
  root: paths.logsRoot,
  maxBytes: Number(process.env.DSH_LOG_MAX_BYTES ?? 104857600),
  retentionDays: Number(process.env.DSH_LOG_RETENTION_DAYS ?? 14),
  output: { stdout: process.stdout, stderr: process.stderr },
})
logs.on('error', error => { void logs.diagnostic('log-manager', 'capture.failed', { error }) })
const seedRoot = process.env.DSH_PLATFORM_SEED ?? '/opt/dsh-platform/seed'
const inventory = parseImageInventory(await readFile(join(seedRoot, 'inventory.json')))
const imageRecords = recordsFromImageInventory(inventory)
await logs.diagnostic('bootstrap', 'bootstrap.starting', {
  bootstrapVersion: process.env.DSH_BOOTSTRAP_VERSION ?? null,
  imageBuildId: inventory.imageBuildId,
  targetSequence: inventory.targetSequence,
})
const deployments = new DeploymentManager({ paths, seedRoot, inventory })
const trust = new LocalApiClient(paths.trustSocket)
try {
  await deployments.recoverActivation(trust)
} catch (error) {
  await logs.diagnostic('bootstrap', 'deployment.activation-recovery.failed', { error })
  throw error
}
let imagePlan
let previousPlan
let planningError = null
try {
  imagePlan = await deployments.prepareImage(imageRecords.deployment)
  await deployments.publishStatus({ plan: imagePlan, currentId: imagePlan.target })
} catch (error) {
  planningError = error
  await logs.diagnostic('bootstrap', 'deployment.image-plan.failed', { error })
  if (error instanceof DeploymentResolutionError) {
    try {
      previousPlan = await deployments.preparePreviousRecovery()
      await deployments.publishStatus({ currentId: previousPlan.target, operation: 'recovering' })
    } catch (recoveryError) {
      planningError = new AggregateError([error, recoveryError], 'Deployment resolution and previous recovery failed')
      await logs.diagnostic('bootstrap', 'deployment.previous-plan.failed', { error: planningError })
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
const systemSkillManager = new SystemSkillManager({
  sourceRoot: join(import.meta.dirname, '..', '..', 'control-plane', 'skills'),
  viewRoot: paths.systemSkillsView,
  statePath: paths.systemSkillStatePath,
})
await systemSkillManager.initialize()
const systemSkills = {
  list: () => systemSkillManager.list(),
  configure: (skillId, action) => deployments.exclusive(() => systemSkillManager.configure(skillId, action)),
}
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
  await logs.diagnostic('bootstrap', 'system-plugin.view.applied', {
    pluginCount: materialized.plugins.length,
  })
  return materialized.plugins
}
const prepareSystemPluginSelection = async () => {
  const previous = await realpath(join(paths.systemPluginViewsRoot, 'current'))
  const selected = await deployments.selected()
  if (selected === null) throw new Error('no Deployment is selected')
  const materialized = await materializeSystemPluginSelection({
    environmentRoot: selected.paths.environment,
    sourceRoot: selected.paths['system-plugins'],
    outputRoot: paths.systemPluginViewsRoot,
    selectionStore: systemPluginSelections,
  })
  await logs.diagnostic('bootstrap', 'system-plugin.view.prepared', {
    pluginCount: materialized.plugins.length,
  })
  return Object.freeze({
    activate: async () => {
      await replaceSystemPluginView(paths, materialized.path)
      await logs.diagnostic('bootstrap', 'system-plugin.view.activated')
    },
    commit: async () => {
      await pruneSystemPluginSelectionViews({
        outputRoot: paths.systemPluginViewsRoot,
        keepPath: materialized.path,
      })
      await logs.diagnostic('bootstrap', 'system-plugin.view.committed')
    },
    rollback: async () => {
      await replaceSystemPluginView(paths, previous)
      await pruneSystemPluginSelectionViews({ outputRoot: paths.systemPluginViewsRoot, keepPath: previous })
      await logs.diagnostic('bootstrap', 'system-plugin.view.rolled-back', { level: 'warning' })
    },
  })
}
const capture = (child, source, declaration) => logs.capture(
  child,
  source,
  declaration,
  { acceptForwarded: ['gateway', 'platform-management'].includes(source) },
)
const reportLifecycle = (message, fields) => logs.diagnostic(fields.componentId ?? 'bootstrap', message, fields)
let runtime
const dshLifecycleBroker = new DshLifecycleBroker({
  report: reportLifecycle,
  shouldTerminate: async () => {
    const lifecycle = runtime?.status().dshLifecycle
    return ['stopping', 'restarting'].includes(lifecycle?.state)
      || environment?.stopping === true
      || await deployments.activation() !== undefined
  },
})
const controlPlane = new EnvironmentRunner({
  environmentRoot: join(import.meta.dirname, '..', '..', 'control-plane'),
  loader: loadControlPlane,
  capture,
  report: reportLifecycle,
})
const environment = new EnvironmentRunner({
  environmentRoot: join(paths.viewsRoot, 'environment'),
  capture,
  prepareService: component => dshLifecycleBroker.prepareLaunch(component.id),
  report: reportLifecycle,
})
runtime = new BootstrapRuntime({
  controlPlane,
  environment,
  validateDeployment: async () => {
    await verifyRuntimePatches({
      runtimeRoot: join(paths.viewsRoot, 'runtime'),
      environmentRoot: join(paths.viewsRoot, 'environment'),
    })
  },
  prepareDeployment: applySystemPluginSelection,
  ownsDshLifecycle: async () => await deployments.activation() !== undefined,
  onDshRecovered: async () => {
    await deployments.publishStatus({ recoveryMode: null })
    await logs.diagnostic('bootstrap', 'dsh.recovery-mode.cleared')
  },
  report: reportLifecycle,
  onEnvironmentFatal: async error => {
    const state = await deployments.state().catch(() => ({ current: null }))
    const reason = error instanceof Error ? error.message : String(error)
    await deployments.publishStatus({
      recoveryMode: { reason, failedRecordId: state.current },
    })
    await logs.diagnostic('bootstrap', 'environment.recovery-mode.entered', { error, failedRecordId: state.current })
  },
})
const systemPlugins = {
  list: async () => {
    const resolved = await deployments.selected()
    if (resolved === null) return []
    const activeRoot = await realpath(join(paths.systemPluginViewsRoot, 'current')).catch(error => (
      error?.code === 'ENOENT' ? undefined : Promise.reject(error)
    ))
    return listManagedSystemPlugins({
      environmentRoot: resolved.paths.environment,
      sourceRoot: resolved.paths['system-plugins'],
      selectionStore: systemPluginSelections,
      activeRoot,
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
      return systemPlugins.list()
    } catch (error) {
      try {
        await systemPluginSelections.write(pluginIds, previousSelection)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'System Plugin operation and rollback failed')
      }
      throw error
    }
  }),
  discard: () => deployments.exclusive(async () => {
    const resolved = await deployments.selected()
    if (resolved === null) throw new Error('no Deployment is selected')
    const activeRoot = await realpath(join(paths.systemPluginViewsRoot, 'current'))
    return discardSystemPluginSelection({
      environmentRoot: resolved.paths.environment,
      sourceRoot: resolved.paths['system-plugins'],
      selectionStore: systemPluginSelections,
      activeRoot,
    })
  }),
  prepare: prepareSystemPluginSelection,
}
systemPlugins.configure = (pluginId, action) => systemPlugins.mutate(pluginId, action)
systemPlugins.recover = (pluginId, action) => systemPlugins.mutate(pluginId, action, true)
const server = createBootstrapControl(runtime, { deployments, trust, systemPlugins, systemSkills })
const dshLifecycleServer = createDshLifecycleServer(dshLifecycleBroker)
await listenBootstrapControl(server, paths.bootstrapSocket)
await listenDshLifecycle(dshLifecycleServer, paths.dshLifecycleSocket)
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
      } catch (error) {
        await logs.diagnostic('bootstrap', 'deployment.previous-plan.failed', { error })
        return false
      }
    },
  })
} catch (error) {
  await logs.diagnostic('bootstrap', 'bootstrap.start.failed', { error })
  server.close()
  dshLifecycleServer.close()
  throw error
}
if (runtime.recoveryMode === null) {
  if (imageCandidateHealthy && imagePlan !== undefined) await deployments.acceptImage(imagePlan)
  else if (previousPlan !== undefined) {
    try {
      await deployments.acceptPreviousRecovery(previousPlan, tokens => trust.activate(tokens))
      planningError = null
    } catch (error) {
      await runtime.suspend('dsh-runtime').catch(suspendError => logs.diagnostic('bootstrap', 'dsh-runtime.suspend.failed', {
        error: suspendError,
        cause: error instanceof Error ? error.message : String(error),
      }))
      await logs.diagnostic('bootstrap', 'deployment.previous-activation.failed', { error })
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
runtime.markStartupComplete()
await logs.diagnostic('bootstrap', 'platform.ready', { recoveryMode: recoveryMode !== null })
process.send?.({ type: 'ready', bootstrapApi: 1 })
process.on('message', message => {
  if (message?.type !== 'recover-image-baseline' || typeof message.requestId !== 'string') return
  void deployments.recoverImageBaseline(imageRecords.deployment, {
    healthCheck: () => runtime.reload(),
    activateReceipts: tokens => trust.activate(tokens),
  }).then(
    async slots => {
      await logs.diagnostic('bootstrap', 'image-baseline.recovery.completed', { requestId: message.requestId })
      process.send?.({ type: 'recovery-result', requestId: message.requestId, slots })
    },
    async error => {
      await logs.diagnostic('bootstrap', 'image-baseline.recovery.failed', { error, requestId: message.requestId })
      process.send?.({
        type: 'recovery-result', requestId: message.requestId,
        error: error instanceof Error ? error.message : 'image baseline recovery failed',
      })
    },
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
if (outcome.type === 'fatal') await logs.diagnostic('bootstrap', 'bootstrap.fatal', { error: outcome.error })
else await logs.diagnostic('bootstrap', 'bootstrap.stopping')
dshLifecycleBroker.beginShutdown()
server.close()
dshLifecycleServer.close()
await runtime.stop().catch(error => logs.diagnostic('bootstrap', 'bootstrap.stop.failed', { error }))
await logs.diagnostic('bootstrap', 'bootstrap.stopped')
if (outcome.type === 'fatal') throw outcome.error
