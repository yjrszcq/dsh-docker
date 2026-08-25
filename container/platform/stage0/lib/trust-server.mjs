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

export function createTrustServer({ ledger, objects, stageBootstrap, collectBootstrap, report = async () => {} }) {
  const record = (message, fields) => Promise.resolve().then(() => report(message, fields)).catch(() => {})
  return createServer(async (request, response) => {
    let pathname = 'invalid-url'
    try {
      const url = new URL(request.url ?? '/', 'http://stage0.internal')
      pathname = url.pathname
      if (request.method === 'GET' && url.pathname === '/v1/status') {
        const keyring = await ledger.currentKeyring()
        const target = await ledger.currentTarget()
        send(response, 200, {
          keyringGeneration: keyring?.value.generation ?? null,
          targetSequence: target?.value.targetSequence ?? null,
          officialDshVersion: (await ledger.currentOfficialDsh().catch(() => undefined))?.value.version ?? null,
        })
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/receipts/active') {
        send(response, 200, { receipts: await objects.activeReceipts() })
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
        await record('keyring.accepted', { generation: value.generation })
        send(response, 200, { generation: value.generation })
      } else if (url.pathname === '/v1/target') {
        const value = await ledger.acceptTarget(Buffer.from(body.document, 'base64'), body.signature)
        await objects.reconcileRevocations((await ledger.currentKeyring()).value)
        await record('target.accepted', { targetSequence: value.targetSequence })
        send(response, 200, { targetSequence: value.targetSequence })
      } else if (url.pathname === '/v1/artifacts/import') {
        const receipt = body.parentReceipt === null || body.parentReceipt === undefined
          ? await objects.importFromTarget(body.artifactId, body.sourcePath)
          : await objects.importFromManifest(body.parentReceipt, body.artifactId, body.sourcePath)
        await record('artifact.imported', { artifactId: body.artifactId, objectSha256: receipt.objectSha256 })
        send(response, 200, receipt)
      } else if (url.pathname === '/v1/dsh/ensure') {
        if (
          body === null || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).length !== 3
          || !Object.hasOwn(body, 'version')
          || !Object.hasOwn(body, 'metadataPath')
          || !Object.hasOwn(body, 'tarballPath')
        ) {
          throw new Error('official DSH import requires fixed untrusted sources')
        }
        const receipt = await objects.ensureOfficialDsh(body.version, body.metadataPath, body.tarballPath)
        await record('official-dsh.imported', { dshVersion: body.version, objectSha256: receipt.objectSha256 })
        send(response, 200, receipt)
      } else if (url.pathname === '/v1/manifests/accept') {
        const receipt = await objects.acceptManifest(body.receipt, body.signatureReceipt)
        await record('manifest.accepted', { objectSha256: receipt.objectSha256 })
        send(response, 200, receipt)
      } else if (url.pathname === '/v1/activate') {
        const receipts = await objects.activate(body.receipts)
        await record('receipts.activated', { receiptCount: receipts.length })
        send(response, 200, { receipts })
      } else if (url.pathname === '/v1/objects/collect') {
        const removed = await objects.collectGarbage()
        await record('objects.collected', { removedCount: removed.length })
        send(response, 200, { removed })
      } else if (url.pathname === '/v1/bootstrap/stage' && stageBootstrap !== undefined) {
        await stageBootstrap(body.receipt, body.version)
        send(response, 202, { status: 'switching', version: body.version })
      } else if (url.pathname === '/v1/bootstrap/collect' && collectBootstrap !== undefined) {
        send(response, 200, await collectBootstrap())
      } else {
        send(response, 404, { error: 'not found' })
      }
    } catch (error) {
      await record('trust.request.failed', { error, method: request.method ?? null, pathname })
      send(response, 400, {
        error: error instanceof Error ? error.message : 'invalid request',
        ...(typeof error?.code === 'string' ? { code: error.code } : {}),
      })
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
