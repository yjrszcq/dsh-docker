#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
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
import { PersistentStateSnapshots } from '../../modules/updater/lib/snapshots.mjs'
import { reconcileRecoveredState } from '../../modules/updater/lib/recovery.mjs'
import { ChannelStateStore } from '../../modules/updater/lib/channel-state.mjs'
import { CompleteStateRecovery } from '../../modules/updater/lib/rollback.mjs'
import { PlatformPaths } from '../../../platform/lib/paths.mjs'
import { readDeploymentStatus } from '../../../platform/lib/deployment-status.mjs'
import { parseImageInventory } from '../../../platform/lib/deployment-contracts.mjs'
import { SettingsDocumentStore } from './settings-document.mjs'
import { UserPluginInventory } from '../../modules/user-plugin-manager/index.mjs'
import { UserPluginJournal } from '../../modules/user-plugin-manager/journal.mjs'
import { UserPluginSnapshots } from '../../modules/user-plugin-manager/snapshots.mjs'
import { UserPluginSelectionStore } from '../../modules/user-plugin-manager/state.mjs'
import { UserPluginTransactionManager } from '../../modules/user-plugin-manager/transaction.mjs'
import { TerminalSessionManager } from './terminal/sessions.mjs'
import { FileInventory, FileSearchManager } from '../../modules/file-manager/index.mjs'
import { FileTransferManager } from '../../modules/file-manager/transfers.mjs'

const dataRoot = process.env.DSH_PLATFORM_DATA ?? '/data/platform'
const runRoot = process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform'
const paths = new PlatformPaths(dataRoot, runRoot)
const seedRoot = process.env.DSH_PLATFORM_SEED ?? '/opt/dsh-platform/seed'
const imageInventory = parseImageInventory(await readFile(join(seedRoot, 'inventory.json')))
const trust = new LocalApiClient(paths.trustSocket)
const bootstrap = new LocalApiClient(paths.bootstrapSocket)
const dshHome = process.env.DSH_HOME ?? '/data/dsh'
const logs = new JsonlLogManager({
  root: paths.logsRoot,
  maxBytes: Number(process.env.DSH_LOG_MAX_BYTES ?? 104857600),
  retentionDays: Number(process.env.DSH_LOG_RETENTION_DAYS ?? 14),
  output: { stdout: process.stdout, stderr: process.stderr },
})
logs.on('error', error => { void logs.diagnostic('log-manager', 'capture.failed', { error }) })
await logs.diagnostic('platform-management', 'management.starting', {
  imageBuildId: imageInventory.imageBuildId,
  targetSequence: imageInventory.targetSequence,
})
const metadata = new MetadataClient({
  baseUrl: process.env.DSH_UPDATE_METADATA_URL,
  trust,
})
const preparer = new TargetPreparer({ untrustedRoot: paths.downloadsRoot, trust })
const activator = new PlatformActivator({ dataRoot, runRoot, stage0: trust })
const journal = new UpdateJournal(join(paths.updaterStateRoot, 'transaction.json'))
const snapshots = new PersistentStateSnapshots({
  root: paths.snapshotsRoot,
  sourceRoot: dshHome,
})
const completeRecovery = new CompleteStateRecovery({ journal, snapshots, activator })
const automaticChecks = new AutomaticCheckStateStore(join(paths.updaterStateRoot, 'automatic-check.json'))
const coordinator = new UpdateCoordinator({
  metadata,
  preparer,
  activator,
  state: new UpdateStateStore(join(paths.updaterStateRoot, 'status.json')),
  npm: new NpmRegistryClient({}),
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
const userPluginInventory = new UserPluginInventory({
  dshHome,
  selectionPath: paths.userPluginStatePath,
  systemPluginNames: async () => (await listBundledPlugins()).map(plugin => `@dsh-docker/${plugin.id}`),
})
const userPluginTransactions = new UserPluginTransactionManager({
  inventory: userPluginInventory,
  selectionStore: new UserPluginSelectionStore(paths.userPluginStatePath),
  snapshots: new UserPluginSnapshots({
    root: paths.userPluginSnapshotsRoot,
    profileRoot: join(dshHome, 'profiles', 'web'),
  }),
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
const terminalSessions = new TerminalSessionManager({
  cwd: '/workspace',
  dshHome,
  report: (message, fields) => logs.diagnostic('terminal', message, fields),
})
const fileInventory = new FileInventory()
const fileTransfers = new FileTransferManager()
let server
const fileTasks = new FileSearchManager({ onState: state => server?.emit('management-state', { fileTask: state }) })
server = createManagementServer({
  coordinator,
  logs,
  platformStatus: async () => ({
    ...await readDeploymentStatus(paths.deploymentStatusPath),
    trust: await trust.status(),
  }),
  restartDsh: () => bootstrap.request('POST', '/v1/components/dsh-runtime/restart'),
  resetRuntime: () => bootstrap.request('POST', '/v1/deployments/runtime/reset'),
  listBundledPlugins,
  configureBundledPlugin: (id, action) => bootstrap.request('POST', '/v1/system-plugins/action', { id, action }),
  recoverBundledPlugin: (id, action) => bootstrap.request('POST', '/v1/system-plugins/recovery-action', { id, action }),
  discardBundledPluginChanges: () => bootstrap.request('POST', '/v1/system-plugins/discard'),
  listUserPlugins: () => userPluginInventory.read(),
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
  terminalSessions,
  fileInventory,
  fileTransfers,
  fileTasks,
  updateAutomaticCheck: async value => {
    const state = await automaticChecks.configure(value)
    scheduler.configure(state.automaticCheck)
    return state.automaticCheck
  },
})
await listenManagement(server, paths.managementSocket)
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
      const task = coordinator.start()
      void logs.diagnostic('updater', 'update.resume.started', { taskId: task.taskId })
      void task.completion.catch(error => logs.diagnostic('updater', 'update.resume.failed', { error, taskId: task.taskId }))
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
    await terminalSessions.shutdown()
    server.close(() => {
      void logs.diagnostic('platform-management', 'management.stopped').finally(() => process.exit(0))
    })
  })
}
process.once('SIGINT', () => stop('SIGINT'))
process.once('SIGTERM', () => stop('SIGTERM'))
