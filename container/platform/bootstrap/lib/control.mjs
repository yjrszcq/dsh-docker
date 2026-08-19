import { createServer } from 'node:http'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

async function jsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > 256 * 1024) throw new Error('Bootstrap request body is too large')
    chunks.push(chunk)
  }
  return size === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(value)}\n`)
}

export function createBootstrapControl(runner, { deployments, trust } = {}) {
  return createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://bootstrap.internal').pathname
      if (request.method === 'GET' && pathname === '/v1/status') send(response, 200, {
        ...runner.status(),
        bootstrapVersion: process.env.DSH_BOOTSTRAP_VERSION ?? '1.0.0',
      })
      else if (request.method === 'POST' && pathname === '/v1/reload') send(response, 200, await runner.reload())
      else if (request.method === 'GET' && pathname === '/v1/health') send(response, 200, await runner.health())
      else if (request.method === 'GET' && pathname === '/v1/deployments/current' && deployments !== undefined) {
        const state = await deployments.state()
        send(response, 200, { record: state.current === null ? null : await deployments.record(state.current) })
      } else if (request.method === 'POST' && pathname === '/v1/deployments/activate' && deployments !== undefined && trust !== undefined) {
        const body = await jsonBody(request)
        const slots = await deployments.activateManaged(body.record, {
          healthCheck: () => runner.reload(),
          activateReceipts: tokens => trust.activate(tokens),
        })
        send(response, 200, { slots })
      } else if (request.method === 'POST' && pathname === '/v1/deployments/rollback' && deployments !== undefined && trust !== undefined) {
        const body = await jsonBody(request)
        const state = await deployments.state()
        if (state.previous === null) throw new Error('no previous Deployment exists')
        if (body.recordId !== undefined && body.recordId !== state.previous) throw new Error('requested Deployment is not previous')
        const record = await deployments.record(state.previous)
        const slots = await deployments.activateManaged(record, {
          healthCheck: () => runner.reload(),
          activateReceipts: tokens => trust.activate(tokens),
        })
        send(response, 200, { slots })
      } else if (request.method === 'POST' && pathname === '/v1/deployments/candidate' && deployments !== undefined) {
        const body = await jsonBody(request)
        const record = await deployments.stageCandidate(body.record, () => runner.reload())
        send(response, 200, { recordId: record.id })
      } else if (request.method === 'POST' && pathname === '/v1/deployments/candidate/commit' && deployments !== undefined && trust !== undefined) {
        const body = await jsonBody(request)
        const slots = await deployments.commitCandidate(body.recordId, tokens => trust.activate(tokens))
        send(response, 200, { slots })
      } else if (request.method === 'POST' && pathname === '/v1/deployments/candidate/cancel' && deployments !== undefined) {
        send(response, 200, await deployments.cancelCandidate())
      }
      else {
        const operation = /^\/v1\/components\/([a-z0-9][a-z0-9._-]{0,127})\/(suspend|resume)$/.exec(pathname)
        if (request.method === 'POST' && operation !== null) {
          send(response, 200, await runner[operation[2]](operation[1]))
        } else send(response, 404, { error: 'not found' })
      }
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
