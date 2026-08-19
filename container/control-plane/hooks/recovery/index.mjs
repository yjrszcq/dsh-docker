#!/usr/bin/env node

import { join } from 'node:path'
import { PlatformActivator } from '../../modules/updater/lib/activator.mjs'
import { UpdateJournal } from '../../modules/updater/lib/journal.mjs'
import { recoverInterruptedUpdate } from '../../modules/updater/lib/recovery.mjs'
import { PersistentStateSnapshots } from '../../modules/updater/lib/snapshots.mjs'

const dataRoot = process.env.DSH_PLATFORM_DATA ?? '/data'
await recoverInterruptedUpdate({
  journal: new UpdateJournal(join(dataRoot, 'state', 'update-transaction.json')),
  snapshots: new PersistentStateSnapshots({
    root: join(dataRoot, 'snapshots'),
    sourceRoot: process.env.DSH_HOME ?? '/home/node/.dsh',
  }),
  activator: new PlatformActivator({ dataRoot }),
  resume: false,
})
