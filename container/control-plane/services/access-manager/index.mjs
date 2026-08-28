#!/usr/bin/env node

import { createServer } from 'node:http'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { PlatformPaths } from '../../../platform/lib/paths.mjs'

const paths = new PlatformPaths(
  process.env.DSH_PLATFORM_DATA ?? '/data/platform',
  process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform',
)

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(value)}\n`)
}

function createAccessServer(surface) {
  return createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://access.internal').pathname
    if (request.method === 'GET' && pathname === '/v1/status') {
      return send(response, 200, { componentReady: true, surface })
    }
    send(response, 404, { error: 'not found' })
  })
}

async function listen(server, path) {
  await mkdir(dirname(path), { recursive: true })
  await rm(path, { force: true })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, resolve)
  })
  await chmod(path, 0o600)
}

const access = createAccessServer('access')
const recovery = createAccessServer('recovery')
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
