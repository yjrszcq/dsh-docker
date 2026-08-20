#!/usr/bin/env node

import { loadConfig } from './lib/config.mjs'
import { UsageError } from './lib/errors.mjs'
import { runGateway } from './lib/lifecycle.mjs'
import { JsonlLogManager } from '../../modules/log-manager/index.mjs'
import { PlatformPaths } from '../../../platform/lib/paths.mjs'

const paths = new PlatformPaths(
  process.env.DSH_PLATFORM_DATA ?? '/data/platform',
  process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform',
)
const logs = new JsonlLogManager({
  root: paths.logsRoot,
  maxBytes: Number(process.env.DSH_LOG_MAX_BYTES ?? 104857600),
  retentionDays: Number(process.env.DSH_LOG_RETENTION_DAYS ?? 14),
  output: { stdout: process.stdout, stderr: process.stderr },
})
logs.on('error', error => { void logs.diagnostic('log-manager', 'capture.failed', { error }) })
const report = (message, fields) => logs.diagnostic('gateway', message, fields)

try {
  const config = await loadConfig()
  process.exitCode = await runGateway(config, { report })
} catch (error) {
  if (error instanceof UsageError) {
    await logs.diagnostic('gateway', 'gateway.configuration.failed', { error, level: 'warning' })
    process.exitCode = error.exitCode
  } else {
    await logs.diagnostic('gateway', 'gateway.process.failed', { error })
    process.exitCode = 1
  }
}
