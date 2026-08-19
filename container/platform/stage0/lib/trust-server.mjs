import { createServer } from 'node:http'
import { chmod, chown, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

const MAX_BODY = 64 * 1024

async function jsonBody(request) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.byteLength
    if (bytes > MAX_BODY) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(value)}\n`)
}

export function createTrustServer({ ledger, objects, stageBootstrap }) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://stage0.internal')
      if (request.method === 'GET' && url.pathname === '/v1/status') {
        const keyring = await ledger.currentKeyring()
        const target = await ledger.currentTarget()
        send(response, 200, {
          keyringGeneration: keyring?.value.generation ?? null,
          targetSequence: target?.value.targetSequence ?? null,
        })
        return
      }
      if (request.method !== 'POST') {
        send(response, 404, { error: 'not found' })
        return
      }
      const body = await jsonBody(request)
      if (url.pathname === '/v1/keyring') {
        const value = await ledger.acceptKeyring(Buffer.from(body.document, 'base64'), body.signature)
        await objects.reconcileRevocations(value)
        send(response, 200, { generation: value.generation })
      } else if (url.pathname === '/v1/target') {
        const value = await ledger.acceptTarget(Buffer.from(body.document, 'base64'), body.signature)
        await objects.reconcileRevocations((await ledger.currentKeyring()).value)
        send(response, 200, { targetSequence: value.targetSequence })
      } else if (url.pathname === '/v1/artifacts/import') {
        const receipt = body.parentReceipt === null || body.parentReceipt === undefined
          ? await objects.importFromTarget(body.artifactId, body.sourcePath)
          : await objects.importFromManifest(body.parentReceipt, body.artifactId, body.sourcePath)
        send(response, 200, receipt)
      } else if (url.pathname === '/v1/manifests/accept') {
        send(response, 200, await objects.acceptManifest(body.receipt, body.signatureReceipt))
      } else if (url.pathname === '/v1/activate') {
        send(response, 200, { receipts: await objects.activate(body.receipts) })
      } else if (url.pathname === '/v1/bootstrap/stage' && stageBootstrap !== undefined) {
        await stageBootstrap(body.receipt, body.version)
        send(response, 202, { status: 'switching', version: body.version })
      } else {
        send(response, 404, { error: 'not found' })
      }
    } catch (error) {
      send(response, 400, { error: error instanceof Error ? error.message : 'invalid request' })
    }
  })
}

export async function listenUnix(server, socketPath, { mode = 0o600, uid, gid } = {}) {
  await mkdir(dirname(socketPath), { recursive: true })
  await rm(socketPath, { force: true })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  if (uid !== undefined || gid !== undefined) await chown(socketPath, uid ?? -1, gid ?? -1)
  await chmod(socketPath, mode)
}
