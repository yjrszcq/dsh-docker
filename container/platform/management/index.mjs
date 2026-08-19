#!/usr/bin/env node

import { join } from 'node:path'
import { JsonlLogManager } from '../logging/manager.mjs'
import { createManagementServer, listenManagement } from './server.mjs'
import { LocalApiClient } from '../updater/lib/client.mjs'
import { MetadataClient } from '../updater/lib/metadata.mjs'
import { TargetPreparer } from '../updater/lib/preparer.mjs'
import { UpdateCoordinator } from '../updater/lib/coordinator.mjs'
import { UpdateScheduler } from '../updater/lib/scheduler.mjs'
import { UpdateStateStore } from '../updater/lib/state.mjs'
import { PlatformActivator } from '../updater/lib/activator.mjs'

const dataRoot = process.env.DSH_PLATFORM_DATA ?? '/data'
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
const activator = new PlatformActivator({ dataRoot })
const coordinator = new UpdateCoordinator({
  metadata,
  preparer,
  activator,
  state: new UpdateStateStore(join(dataRoot, 'state', 'update.json')),
})
const server = createManagementServer({
  coordinator,
  logs,
  platformStatus: async () => ({ trust: await trust.status() }),
  rollback: () => activator.rollback(),
})
await listenManagement(server, join(dataRoot, 'run', 'management.sock'))
const scheduler = new UpdateScheduler({
  check: () => coordinator.check(),
  intervalSeconds: Number(process.env.DSH_UPDATE_CHECK_INTERVAL_SECONDS ?? 21600),
})
scheduler.start()

const stop = () => {
  scheduler.stop()
  server.close(() => process.exit(0))
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
