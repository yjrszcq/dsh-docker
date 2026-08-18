#!/usr/bin/env node

import { loadConfig } from './lib/config.mjs'
import { UsageError } from './lib/errors.mjs'
import { runGateway } from './lib/lifecycle.mjs'

try {
  const config = await loadConfig()
  process.exitCode = await runGateway(config)
} catch (error) {
  if (error instanceof UsageError) {
    console.error(error.message)
    process.exitCode = error.exitCode
  } else {
    console.error(error instanceof Error ? error.message : 'gateway failed')
    process.exitCode = 1
  }
}
