#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PlatformActivator } from '../../modules/updater/lib/activator.mjs'
import { UpdateJournal } from '../../modules/updater/lib/journal.mjs'
import { recoverInterruptedUpdate } from '../../modules/updater/lib/recovery.mjs'
import { PersistentStateSnapshots } from '../../modules/updater/lib/snapshots.mjs'
import { PlatformPaths } from '../../../platform/lib/paths.mjs'

export async function recoverPlatformUpdateBeforeDshStart({
  dataRoot = process.env.DSH_PLATFORM_DATA ?? '/data/platform',
  runRoot = process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform',
  dshHome = process.env.DSH_HOME ?? '/data/dsh',
} = {}) {
  const paths = new PlatformPaths(dataRoot, runRoot)
  return recoverInterruptedUpdate({
    journal: new UpdateJournal(join(paths.updaterStateRoot, 'transaction.json')),
    snapshots: new PersistentStateSnapshots({ root: paths.snapshotsRoot, sourceRoot: dshHome }),
    activator: new PlatformActivator({ dataRoot, runRoot }),
    resume: false,
  })
}

if (process.argv[1] !== undefined
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await recoverPlatformUpdateBeforeDshStart()
}
