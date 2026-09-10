#!/usr/bin/env node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { verifyDshCompatibility } from '../lib/dsh-compatibility.mjs'

const [packageRootArg, expectedVersion] = process.argv.slice(2)
if (packageRootArg === undefined || expectedVersion === undefined) {
  console.error('usage: verify-dsh-compatibility.mjs <installed-dsh-package-root> <expected-version>')
  process.exit(64)
}

const home = await mkdtemp(join(tmpdir(), 'dsh-compatibility-'))
try {
  const result = await verifyDshCompatibility({
    packageRoot: resolve(packageRootArg),
    expectedVersion,
    home,
  })
  console.log(JSON.stringify(result))
} finally {
  await rm(home, { recursive: true, force: true })
}
