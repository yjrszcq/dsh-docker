#!/usr/bin/env node

import { join } from 'node:path'
import { EnvironmentRunner, loadControlPlane } from './lib/lifecycle.mjs'
import { BootstrapRuntime } from './lib/runtime.mjs'
import { createBootstrapControl, listenBootstrapControl } from './lib/control.mjs'
import { JsonlLogManager } from '../../control-plane/modules/log-manager/index.mjs'

const dataRoot = process.env.DSH_PLATFORM_DATA ?? '/data'
const logs = new JsonlLogManager({
  root: join(dataRoot, 'logs'),
  maxBytes: Number(process.env.DSH_LOG_MAX_BYTES ?? 104857600),
  retentionDays: Number(process.env.DSH_LOG_RETENTION_DAYS ?? 14),
})
logs.on('error', error => console.error(error))
const capture = (child, source, declaration) => logs.capture(child, source, declaration)
const controlPlane = new EnvironmentRunner({
  environmentRoot: join(import.meta.dirname, '..', '..', 'control-plane'),
  loader: loadControlPlane,
  capture,
})
const environment = new EnvironmentRunner({
  environmentRoot: join(dataRoot, 'environments', 'current'),
  capture,
})
const runtime = new BootstrapRuntime({ controlPlane, environment })
await runtime.start()
const server = createBootstrapControl(runtime)
await listenBootstrapControl(server, join(dataRoot, 'run', 'bootstrap.sock'))
process.send?.({ type: 'ready', bootstrapApi: 1 })

let resolveSignal
const signal = new Promise(resolve => { resolveSignal = resolve })
const onSignal = () => resolveSignal({ type: 'signal' })
process.once('SIGINT', onSignal)
process.once('SIGTERM', onSignal)
const outcome = await Promise.race([
  signal,
  runtime.fatal.then(error => ({ type: 'fatal', error })),
])
server.close()
await runtime.stop().catch(error => console.error(error))
if (outcome.type === 'fatal') throw outcome.error
