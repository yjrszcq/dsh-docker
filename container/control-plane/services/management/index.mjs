#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { JsonlLogManager } from '../../modules/log-manager/index.mjs'
import { createManagementServer, listenManagement } from './server.mjs'
import { LocalApiClient } from '../../modules/updater/lib/client.mjs'
import { MetadataClient, NpmRegistryClient } from '../../modules/updater/lib/metadata.mjs'
import { TargetPreparer } from '../../modules/updater/lib/preparer.mjs'
import { UpdateCoordinator } from '../../modules/updater/lib/coordinator.mjs'
import { UpdateScheduler } from '../../modules/updater/lib/scheduler.mjs'
import { UpdateStateStore } from '../../modules/updater/lib/state.mjs'
import { AutomaticCheckStateStore } from '../../modules/updater/lib/automatic-check.mjs'
import { PlatformActivator } from '../../modules/updater/lib/activator.mjs'
import { UpdateJournal } from '../../modules/updater/lib/journal.mjs'
import { SnapshotClient } from '../../modules/updater/lib/snapshot-client.mjs'
import { reconcileRecoveredState, resumeInterruptedReconcile } from '../../modules/updater/lib/recovery.mjs'
import { ChannelStateStore } from '../../modules/updater/lib/channel-state.mjs'
import { CompleteStateRecovery } from '../../modules/updater/lib/rollback.mjs'
import { PlatformPaths } from '../../../platform/lib/paths.mjs'
import { readDeploymentStatus } from '../../../platform/lib/deployment-status.mjs'
import { parseImageInventory } from '../../../platform/lib/deployment-contracts.mjs'
import { SettingsDocumentStore } from './settings-document.mjs'
import { markUserPluginRestartState, UserPluginInventory } from '../../modules/plugin-manager/user-inventory.mjs'
import { UserPluginJournal } from '../../modules/plugin-manager/user-journal.mjs'
import { UserPluginSelectionStore } from '../../modules/plugin-manager/user-state.mjs'
import { UserPluginTransactionManager } from '../../modules/plugin-manager/user-transaction.mjs'
import { UserSkillManager } from './user-skills.mjs'
import { createScopedFetch } from './scoped-fetch.mjs'
import { OutboundProxyControlClient } from './outbound-proxy-client.mjs'
import { ProviderInventory } from './provider-inventory.mjs'
import { PROXY_SCOPE_CATALOG } from '../outbound-proxy/lib/scope-catalog.mjs'

const dataRoot = process.env.DSH_PLATFORM_DATA ?? '/data/platform'
const runRoot = process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform'
const paths = new PlatformPaths(dataRoot, runRoot)
const seedRoot = process.env.DSH_PLATFORM_SEED ?? '/opt/dsh-platform/seed'
const imageInventory = parseImageInventory(await readFile(join(seedRoot, 'inventory.json')))
const trust = new LocalApiClient(paths.trustSocket)
const bootstrap = new LocalApiClient(paths.bootstrapSocket)
const snapshotApi = new LocalApiClient(paths.snapshotSocket)
const outboundProxy = new OutboundProxyControlClient(paths.proxyControlSocket)
const dshHome = process.env.DSH_HOME ?? '/data/dsh'
const logs = new JsonlLogManager({
  root: paths.logsRoot,
  maxBytes: Number(process.env.DSH_LOG_MAX_BYTES ?? 104857600),
  retentionDays: Number(process.env.DSH_LOG_RETENTION_DAYS ?? 14),
  output: { stdout: process.stdout, stderr: process.stderr },
})
const updateFetch = createScopedFetch('updates')
const providerInventory = new ProviderInventory({ cachePath: paths.proxyProviderInventoryPath })

function proxySnapshot(view) {
  return Object.freeze({
    revision: view.revision,
    configuration: Object.freeze({
      schema: view.schema,
      enabled: view.enabled,
      proxy: view.proxy,
      scopes: view.scopes,
      environment: view.environment,
      modelApi: view.modelApi,
      noProxy: view.noProxy,
      bypass: view.bypass,
    }),
  })
}

const proxyConfiguration = async () => Object.freeze({
  ...await outboundProxy.configuration(),
  scopeCatalog: PROXY_SCOPE_CATALOG,
})
logs.on('error', error => { void logs.diagnostic('log-manager', 'capture.failed', { error }) })
await logs.diagnostic('platform-management', 'management.starting', {
  imageBuildId: imageInventory.imageBuildId,
  targetSequence: imageInventory.targetSequence,
})
const metadata = new MetadataClient({
  baseUrl: process.env.DSH_UPDATE_METADATA_URL,
  trust,
  fetchImpl: updateFetch,
  retryRequestTimeoutMs: 15_000,
})
const preparer = new TargetPreparer({ untrustedRoot: paths.downloadsRoot, trust, fetchImpl: updateFetch })
const activator = new PlatformActivator({ dataRoot, runRoot, stage0: trust })
const journal = new UpdateJournal(join(paths.updaterStateRoot, 'transaction.json'))
const snapshots = new SnapshotClient(snapshotApi, 'dsh')
const completeRecovery = new CompleteStateRecovery({ journal, snapshots, activator })
const automaticChecks = new AutomaticCheckStateStore(join(paths.updaterStateRoot, 'automatic-check.json'))
const coordinator = new UpdateCoordinator({
  metadata,
  preparer,
  activator,
  state: new UpdateStateStore(join(paths.updaterStateRoot, 'status.json')),
  npm: new NpmRegistryClient({ fetchImpl: updateFetch, retryRequestTimeoutMs: 15_000 }),
  journal,
  snapshots,
  probationSeconds: Number(process.env.DSH_EXPERIMENTAL_PROBATION_SECONDS ?? 120),
  channelState: new ChannelStateStore(join(paths.updaterStateRoot, 'channel.json')),
  completeRecovery,
  automaticChecks,
  allowUnavailableMetadata: imageInventory.authority === 'development',
  report: (message, fields) => logs.diagnostic('updater', message, fields),
})
const settingsDocument = new SettingsDocumentStore(dshHome)
const listBundledPlugins = async () => (await bootstrap.request('GET', '/v1/system-plugins')).plugins
const listSystemSkills = async () => (await bootstrap.request('GET', '/v1/system-skills')).skills
const userSkills = new UserSkillManager({
  dshHome,
  agentsHome: process.env.DSH_AGENTS_HOME ?? '/home/node/.agents',
})
const userPluginInventory = new UserPluginInventory({
  dshHome,
  selectionPath: paths.userPluginStatePath,
  systemPluginNames: async () => (await listBundledPlugins()).map(plugin => `@dsh-docker/${plugin.id}`),
})
const userPluginTransactions = new UserPluginTransactionManager({
  inventory: userPluginInventory,
  selectionStore: new UserPluginSelectionStore(paths.userPluginStatePath),
  snapshots: new SnapshotClient(snapshotApi, 'user-plugin'),
  journal: new UserPluginJournal(paths.userPluginJournalPath),
  pauseDsh: () => bootstrap.request('POST', '/v1/components/dsh-runtime/pause'),
  restartDsh: () => bootstrap.request('POST', '/v1/components/dsh-runtime/restart'),
  report: (message, fields) => logs.diagnostic('user-plugin-manager', message, fields),
})
const initialUserPluginTransaction = await userPluginTransactions.recoverBeforeDshStart()
if (initialUserPluginTransaction !== undefined) {
  await logs.diagnostic('user-plugin-manager', 'user-plugin.startup-state.reconciled', {
    taskId: initialUserPluginTransaction.taskId,
    phase: initialUserPluginTransaction.phase,
    recoveryResult: initialUserPluginTransaction.recoveryResult,
  })
}
let loadedUserPluginInventory
const markUserPluginsLoaded = async () => {
  loadedUserPluginInventory = await userPluginInventory.read()
  return loadedUserPluginInventory
}
const listUserPlugins = async () => markUserPluginRestartState(
  await userPluginInventory.read(),
  loadedUserPluginInventory,
)
const waitForBootstrapStartup = async () => {
  for (;;) {
    try {
      const status = await bootstrap.status()
      if (status.startupComplete === true) return status
    } catch (error) {
      await logs.diagnostic('user-plugin-manager', 'bootstrap.startup-status.retrying', {
        error,
        level: 'warning',
      })
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
const scheduler = new UpdateScheduler({
  check: () => coordinator.check('automatic'),
  onError: error => logs.diagnostic('updater', 'update.automatic-check.failed', { error }),
})
let server
server = createManagementServer({
  coordinator,
  logs,
  platformStatus: async () => ({
    ...await readDeploymentStatus(paths.deploymentStatusPath),
    trust: await trust.status(),
    dshLifecycle: (await bootstrap.status()).dshLifecycle,
  }),
  startDsh: () => bootstrap.request('POST', '/v1/components/dsh-runtime/resume'),
  stopDsh: () => bootstrap.request('POST', '/v1/components/dsh-runtime/pause'),
  restartDsh: () => bootstrap.request('POST', '/v1/components/dsh-runtime/restart'),
  resetRuntime: () => bootstrap.request('POST', '/v1/deployments/runtime/reset'),
  listBundledPlugins,
  configureBundledPlugin: (id, action) => bootstrap.request('POST', '/v1/system-plugins/action', { id, action }),
  recoverBundledPlugin: (id, action) => bootstrap.request('POST', '/v1/system-plugins/recovery-action', { id, action }),
  discardBundledPluginChanges: () => bootstrap.request('POST', '/v1/system-plugins/discard'),
  listSystemSkills,
  configureSystemSkill: (skillId, action) => bootstrap.request('POST', '/v1/system-skills/action', { skillId, action }),
  listUserSkills: () => userSkills.list(),
  validateUserSkillAction: value => userSkills.validate(value),
  configureUserSkill: value => userSkills.configure(value),
  listUserPlugins,
  markUserPluginsLoaded,
  validateUserPluginActions: value => userPluginTransactions.validate(value),
  applyUserPluginActions: value => userPluginTransactions.apply(value),
  initialUserPluginTransaction,
  recoverUserPluginTransaction: initialUserPluginTransaction?.phase === 'restarting' ? async () => {
    const status = await waitForBootstrapStartup()
    try {
      const health = await bootstrap.request('GET', '/v1/health')
      const dsh = health.components?.find(component => component.id === 'dsh-runtime')
      return userPluginTransactions.completeDshStartup({
        healthy: status.recoveryMode === null && dsh?.healthy === true,
        error: status.recoveryMode,
      })
    } catch (error) {
      return userPluginTransactions.completeDshStartup({
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  } : undefined,
  settingsDocument,
  privilegedMutationActive: () => existsSync(paths.maintenanceLeasePath),
  updateAutomaticCheck: async value => {
    const state = await automaticChecks.configure(value)
    scheduler.configure(state.automaticCheck)
    return state.automaticCheck
  },
  getProxyConfiguration: proxyConfiguration,
  updateProxyConfiguration: async value => Object.freeze({
    ...await outboundProxy.updateConfiguration(value),
    scopeCatalog: PROXY_SCOPE_CATALOG,
  }),
  listProxyProviders: async () => {
    const configuration = await outboundProxy.configuration()
    return providerInventory.list(proxySnapshot(configuration))
  },
  startProxyTest: value => outboundProxy.startTest(value),
  getProxyTest: taskId => outboundProxy.test(taskId),
  cancelProxyTest: taskId => outboundProxy.cancelTest(taskId),
})
await listenManagement(server, paths.managementSocket)
void waitForBootstrapStartup()
  .then(markUserPluginsLoaded)
  .catch(error => logs.diagnostic('user-plugin-manager', 'user-plugin.loaded-state.capture.failed', { error }))
scheduler.configure((await automaticChecks.read()).automaticCheck)
let recovered
try {
  recovered = await reconcileRecoveredState({ journal, state: coordinator.state })
} catch (error) {
  await logs.diagnostic('updater', 'update.recovery-state.failed', { error })
  throw error
}
const { transaction, persisted } = recovered
const journalOwnsState = transaction !== undefined && persisted.taskId === transaction.transactionId
const resumeUpdate = !journalOwnsState && !['idle', 'success', 'failed'].includes(persisted.status)
if (resumeUpdate) {
  setImmediate(() => {
    try {
      resumeInterruptedReconcile({
        coordinator,
        persisted,
        report: (message, fields) => logs.diagnostic('updater', message, fields),
        audit: (message, fields) => logs.diagnostic('audit', message, { stream: 'audit', ...fields }),
      })
    } catch (error) {
      void logs.diagnostic('updater', 'update.resume.failed', { error })
    }
  })
}
await logs.diagnostic('platform-management', 'management.ready', { resumedUpdate: resumeUpdate })

let stopping = false
const stop = signal => {
  if (stopping) return
  stopping = true
  scheduler.stop()
  void logs.diagnostic('platform-management', 'management.stopping', { signal }).then(async () => {
    await updateFetch.close().catch(error => logs.diagnostic('platform-management', 'proxy.dispatcher.close.failed', { error }))
    server.close(() => {
      void logs.diagnostic('platform-management', 'management.stopped').finally(() => process.exit(0))
    })
  })
}
process.once('SIGINT', () => stop('SIGINT'))
process.once('SIGTERM', () => stop('SIGTERM'))
