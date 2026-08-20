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
import { PlatformActivator } from '../../modules/updater/lib/activator.mjs'
import { UpdateJournal } from '../../modules/updater/lib/journal.mjs'
import { PersistentStateSnapshots } from '../../modules/updater/lib/snapshots.mjs'
import { reconcileRecoveredState } from '../../modules/updater/lib/recovery.mjs'
import { ChannelStateStore } from '../../modules/updater/lib/channel-state.mjs'
import { CompleteStateRecovery } from '../../modules/updater/lib/rollback.mjs'
import { PlatformPaths } from '../../../platform/lib/paths.mjs'
import { readDeploymentStatus } from '../../../platform/lib/deployment-status.mjs'
import { parseImageInventory } from '../../../platform/lib/deployment-contracts.mjs'

const dataRoot = process.env.DSH_PLATFORM_DATA ?? '/data/platform'
const runRoot = process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform'
const paths = new PlatformPaths(dataRoot, runRoot)
const seedRoot = process.env.DSH_PLATFORM_SEED ?? '/opt/dsh-platform/seed'
const imageInventory = parseImageInventory(await readFile(join(seedRoot, 'inventory.json')))
const trust = new LocalApiClient(paths.trustSocket)
const bootstrap = new LocalApiClient(paths.bootstrapSocket)
const logs = new JsonlLogManager({
  root: paths.logsRoot,
  maxBytes: Number(process.env.DSH_LOG_MAX_BYTES ?? 104857600),
  retentionDays: Number(process.env.DSH_LOG_RETENTION_DAYS ?? 14),
  output: { stdout: process.stdout, stderr: process.stderr },
})
logs.on('error', error => console.error(error))
const metadata = new MetadataClient({
  baseUrl: process.env.DSH_UPDATE_METADATA_URL,
  trust,
})
const preparer = new TargetPreparer({ untrustedRoot: paths.downloadsRoot, trust })
const activator = new PlatformActivator({ dataRoot, runRoot, stage0: trust })
const journal = new UpdateJournal(join(paths.updaterStateRoot, 'transaction.json'))
const snapshots = new PersistentStateSnapshots({
  root: paths.snapshotsRoot,
  sourceRoot: process.env.DSH_HOME ?? '/data/dsh',
})
const completeRecovery = new CompleteStateRecovery({ journal, snapshots, activator })
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
  allowUnavailableMetadata: imageInventory.authority === 'development',
})
const server = createManagementServer({
  coordinator,
  logs,
  platformStatus: async () => ({
    ...await readDeploymentStatus(paths.deploymentStatusPath),
    trust: await trust.status(),
  }),
  restartDsh: () => bootstrap.request('POST', '/v1/components/dsh-runtime/restart'),
})
await listenManagement(server, paths.managementSocket)
const scheduler = new UpdateScheduler({
  check: () => coordinator.check(),
  intervalSeconds: Number(process.env.DSH_UPDATE_CHECK_INTERVAL_SECONDS ?? 21600),
})
scheduler.start()
const { transaction, persisted } = await reconcileRecoveredState({ journal, state: coordinator.state })
const journalOwnsState = transaction !== undefined && persisted.taskId === transaction.transactionId
const resumeUpdate = !journalOwnsState && !['idle', 'success', 'failed'].includes(persisted.status)
if (resumeUpdate) {
  setImmediate(() => {
    try { coordinator.start().completion.catch(() => {}) } catch (error) { console.error(error) }
  })
} else {
  setImmediate(() => { coordinator.check().catch(() => {}) })
}

const stop = () => {
  scheduler.stop()
  server.close(() => process.exit(0))
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
