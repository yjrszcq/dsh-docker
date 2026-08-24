import { createServer } from 'node:http'
import { chmod, chown, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

const ROUTE = /^\/v1\/(dsh|user-plugin)\/(create|inspect|restore|remove)$/
const MAX_BODY_BYTES = 4096

async function jsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('snapshot request body is too large')
    chunks.push(chunk)
  }
  return size === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function publicSnapshot(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value
  const { archive: _archive, path: _path, ...snapshot } = value
  return snapshot
}

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(value)}\n`)
}

export function createSnapshotServer({ dshSnapshots, userPluginSnapshots, report = async () => {} }) {
  return createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST') return send(response, 404, { error: 'not found' })
      const match = ROUTE.exec(new URL(request.url ?? '/', 'http://snapshot.internal').pathname)
      if (match === null) return send(response, 404, { error: 'not found' })
      const [, scope, operation] = match
      const body = await jsonBody(request)
      let progress = null
      const onProgress = value => { progress = value }
      let result
      if (scope === 'dsh') {
        if (operation === 'create') result = await dshSnapshots.create({ ...body, onProgress })
        else if (operation === 'inspect') result = await dshSnapshots.inspect(body.id)
        else if (operation === 'restore') result = await dshSnapshots.restore(body.id, { onProgress })
        else result = await dshSnapshots.remove(body.id)
      } else {
        if (operation === 'create') result = await userPluginSnapshots.create(body.id)
        else if (operation === 'inspect') result = await userPluginSnapshots.inspect(body.id)
        else if (operation === 'restore') result = await userPluginSnapshots.restore(body.id)
        else result = await userPluginSnapshots.remove(body.id)
      }
      send(response, 200, { result: publicSnapshot(result), progress })
    })().catch(async error => {
      await report('snapshot.request.failed', {
        error,
        method: request.method ?? null,
        pathname: request.url ?? null,
      })
      send(response, 500, { error: error.message })
    })
  })
}

export async function listenSnapshots(server, socketPath) {
  await mkdir(dirname(socketPath), { recursive: true })
  await rm(socketPath, { force: true })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  if (process.getuid?.() === 0) await chown(socketPath, 0, 1000)
  await chmod(socketPath, process.getuid?.() === 0 ? 0o660 : 0o600)
}
