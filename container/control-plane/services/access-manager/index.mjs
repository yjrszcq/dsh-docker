#!/usr/bin/env node

import { chmod, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { PlatformPaths } from '../../../platform/lib/paths.mjs'
import { AccessStateStore } from './lib/store.mjs'
import { AccessService, createAccessHttpServer } from './lib/server.mjs'

const paths = new PlatformPaths(
  process.env.DSH_PLATFORM_DATA ?? '/data/platform',
  process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform',
)

async function listen(server, path) {
  await mkdir(dirname(path), { recursive: true })
  await rm(path, { force: true })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, resolve)
  })
  await chmod(path, 0o600)
}

const classificationToken = process.env.DSH_ACCESS_CLASSIFICATION_TOKEN
delete process.env.DSH_ACCESS_CLASSIFICATION_TOKEN
if (typeof classificationToken !== 'string' || classificationToken.length < 32) {
  throw new Error('Access classification token is unavailable')
}
const store = new AccessStateStore({ root: paths.accessStateRoot })
await store.prepare()
const service = new AccessService({
  store,
  classificationToken,
  report: (message, fields) => {
    process.send?.({ type: 'diagnostic', message, fields })
  },
})
await service.reconcileRuntimePolicy()
const access = createAccessHttpServer({ service })
const recovery = createAccessHttpServer({ service, surface: 'recovery' })
await listen(access, paths.accessSocket)
await listen(recovery, paths.accessRecoverySocket)
process.send?.({ type: 'ready', componentReady: true })

let resolveSignal
const signal = new Promise(resolve => { resolveSignal = resolve })
process.once('SIGINT', () => resolveSignal())
process.once('SIGTERM', () => resolveSignal())
await signal
await Promise.all([
  new Promise(resolve => access.close(resolve)),
  new Promise(resolve => recovery.close(resolve)),
])
