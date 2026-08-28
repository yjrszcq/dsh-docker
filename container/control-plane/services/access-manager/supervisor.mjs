#!/usr/bin/env node

import { LocalApiClient } from '../../modules/updater/lib/client.mjs'
import { PlatformPaths } from '../../../platform/lib/paths.mjs'

const paths = new PlatformPaths(
  process.env.DSH_PLATFORM_DATA ?? '/data/platform',
  process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform',
)
const launch = new LocalApiClient(paths.accessLaunchSocket)

if (process.argv[2] === 'health') {
  const status = await launch.request('GET', '/v1/status')
  process.exit(status.componentReady === true ? 0 : 1)
}

const token = process.env.DSH_ACCESS_LAUNCH_TOKEN
delete process.env.DSH_ACCESS_LAUNCH_TOKEN
if (typeof token !== 'string' || token.length < 32) throw new Error('Access Manager launch token is unavailable')
await launch.request('POST', '/v1/start', { token })

let stopping = false
let resolveStop
const stopped = new Promise(resolve => { resolveStop = resolve })
const stop = () => {
  if (stopping) return
  stopping = true
  void launch.request('POST', '/v1/stop', { token }).catch(() => {}).finally(resolveStop)
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)

const poll = setInterval(() => {
  void launch.request('GET', '/v1/status').then(status => {
    if (!stopping && status.running !== true) {
      clearInterval(poll)
      process.exitCode = 1
      resolveStop()
    }
  }, () => {
    if (!stopping) {
      clearInterval(poll)
      process.exitCode = 1
      resolveStop()
    }
  })
}, 500)
await stopped
clearInterval(poll)
