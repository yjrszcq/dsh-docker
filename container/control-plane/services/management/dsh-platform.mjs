#!/usr/bin/env node

import { runCli } from './cli.mjs'

try {
  process.exitCode = await runCli()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'dsh-platform failed')
  process.exitCode = 1
}
