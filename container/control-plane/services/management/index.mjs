#!/usr/bin/env node

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

const dataRoot = process.env.DSH_PLATFORM_DATA ?? '/data/platform'
const trust = new LocalApiClient(join(dataRoot, 'run', 'stage0-trust.sock'))
const logs = new JsonlLogManager({
  root: join(dataRoot, 'logs'),
  maxBytes: Number(process.env.DSH_LOG_MAX_BYTES ?? 104857600),
  retentionDays: Number(process.env.DSH_LOG_RETENTION_DAYS ?? 14),
})
logs.on('error', error => console.error(error))
const metadata = new MetadataClient({
  baseUrl: process.env.DSH_UPDATE_METADATA_URL,
  trust,
})
const preparer = new TargetPreparer({ untrustedRoot: join(dataRoot, 'downloads', 'untrusted'), trust })
const activator = new PlatformActivator({ dataRoot, stage0: trust })
const journal = new UpdateJournal(join(dataRoot, 'state', 'update-transaction.json'))
const snapshots = new PersistentStateSnapshots({
  root: join(dataRoot, 'snapshots'),
  sourceRoot: process.env.DSH_HOME ?? '/data/dsh',
})
const completeRecovery = new CompleteStateRecovery({ journal, snapshots, activator })
const coordinator = new UpdateCoordinator({
  metadata,
  preparer,
  activator,
  state: new UpdateStateStore(join(dataRoot, 'state', 'update.json')),
  npm: new NpmRegistryClient({}),
  journal,
  snapshots,
  probationSeconds: Number(process.env.DSH_EXPERIMENTAL_PROBATION_SECONDS ?? 120),
  channelState: new ChannelStateStore(join(dataRoot, 'state', 'channel.json')),
  completeRecovery,
})
const server = createManagementServer({
  coordinator,
  logs,
  platformStatus: async () => ({ trust: await trust.status() }),
})
await listenManagement(server, join(dataRoot, 'run', 'management.sock'))
const scheduler = new UpdateScheduler({
  check: () => coordinator.check(),
  intervalSeconds: Number(process.env.DSH_UPDATE_CHECK_INTERVAL_SECONDS ?? 21600),
})
scheduler.start()
const { transaction, persisted } = await reconcileRecoveredState({ journal, state: coordinator.state })
const journalOwnsState = transaction !== undefined && persisted.taskId === transaction.transactionId
if (!journalOwnsState && !['idle', 'success', 'failed'].includes(persisted.status)) {
  setImmediate(() => {
    try { coordinator.start().completion.catch(() => {}) } catch (error) { console.error(error) }
  })
}

const stop = () => {
  scheduler.stop()
  server.close(() => process.exit(0))
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
