#!/usr/bin/env node

import { join } from 'node:path'
import { PlatformActivator } from '../../modules/updater/lib/activator.mjs'
import { UpdateJournal } from '../../modules/updater/lib/journal.mjs'
import { recoverInterruptedUpdate } from '../../modules/updater/lib/recovery.mjs'
import { PersistentStateSnapshots } from '../../modules/updater/lib/snapshots.mjs'
import { PlatformPaths } from '../../../platform/lib/paths.mjs'

const dataRoot = process.env.DSH_PLATFORM_DATA ?? '/data/platform'
const runRoot = process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform'
const paths = new PlatformPaths(dataRoot, runRoot)
await recoverInterruptedUpdate({
  journal: new UpdateJournal(join(paths.updaterStateRoot, 'transaction.json')),
  snapshots: new PersistentStateSnapshots({
    root: paths.snapshotsRoot,
    sourceRoot: process.env.DSH_HOME ?? '/data/dsh',
  }),
  activator: new PlatformActivator({ dataRoot, runRoot }),
  resume: false,
})
