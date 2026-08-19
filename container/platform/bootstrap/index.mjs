#!/usr/bin/env node

import { join } from 'node:path'
import { EnvironmentRunner } from './lib/lifecycle.mjs'
import { createBootstrapControl, listenBootstrapControl } from './lib/control.mjs'

const dataRoot = process.env.DSH_PLATFORM_DATA ?? '/data'
const runner = new EnvironmentRunner({ environmentRoot: join(dataRoot, 'environments', 'current') })
await runner.start()
const server = createBootstrapControl(runner)
await listenBootstrapControl(server, join(dataRoot, 'run', 'bootstrap.sock'))
process.send?.({ type: 'ready', bootstrapApi: 1 })

let resolveSignal
const signal = new Promise(resolve => { resolveSignal = resolve })
const onSignal = () => resolveSignal({ type: 'signal' })
process.once('SIGINT', onSignal)
process.once('SIGTERM', onSignal)
const outcome = await Promise.race([
  signal,
  runner.fatal.then(error => ({ type: 'fatal', error })),
])
server.close()
await runner.stop().catch(error => console.error(error))
if (outcome.type === 'fatal') throw outcome.error
