import { createServer } from 'node:http'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

async function body(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > 16 * 1024) throw new Error('recovery request body is too large')
    chunks.push(chunk)
  }
  return size === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(value)}\n`)
}

export function createRecoveryServer({ inventory, deployments, supervisor }) {
  return createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/v1/status') {
        send(response, 200, {
          imageBaseline: {
            imageBuildId: inventory.imageBuildId,
            targetSequence: inventory.targetSequence,
            dsh: inventory.deployment.dshVersion,
            environment: inventory.deployment.environmentVersion,
          },
          deployment: await deployments().catch(() => null),
        })
      } else if (request.method === 'POST' && request.url === '/v1/recover-image-baseline') {
        const value = await body(request)
        if (value.confirm !== inventory.imageBuildId) throw new Error('image baseline recovery confirmation is invalid')
        send(response, 200, { status: 'recovered', slots: await supervisor.recoverImageBaseline() })
      } else send(response, 404, { error: 'not found' })
    } catch (error) {
      send(response, 400, { error: error instanceof Error ? error.message : 'recovery failed' })
    }
  })
}

export async function listenRecovery(server, socketPath) {
  await mkdir(dirname(socketPath), { recursive: true })
  await rm(socketPath, { force: true })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  await chmod(socketPath, 0o600)
}
