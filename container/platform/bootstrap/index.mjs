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

await new Promise(resolve => {
  const stop = async () => {
    server.close()
    await runner.stop().catch(error => console.error(error))
    resolve()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
})
