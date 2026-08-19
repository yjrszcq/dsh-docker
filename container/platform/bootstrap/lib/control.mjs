import { createServer } from 'node:http'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(value)}\n`)
}

export function createBootstrapControl(runner) {
  return createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://bootstrap.internal').pathname
      if (request.method === 'GET' && pathname === '/v1/status') send(response, 200, {
        ...runner.status(),
        bootstrapVersion: process.env.DSH_BOOTSTRAP_VERSION ?? '1.0.0',
      })
      else if (request.method === 'POST' && pathname === '/v1/reload') send(response, 200, await runner.reload())
      else send(response, 404, { error: 'not found' })
    } catch (error) {
      send(response, 500, { error: error instanceof Error ? error.message : 'Bootstrap operation failed' })
    }
  })
}

export async function listenBootstrapControl(server, socketPath) {
  await mkdir(dirname(socketPath), { recursive: true })
  await rm(socketPath, { force: true })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  await chmod(socketPath, 0o600)
}
