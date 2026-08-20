import { createServer } from 'node:http'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { PlatformGarbageCollector } from './gc.mjs'

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

export function createBootstrapControl(runner, { deployments, trust, systemPlugins } = {}) {
  return createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://bootstrap.internal').pathname
      if (request.method === 'GET' && pathname === '/v1/status') send(response, 200, {
        ...runner.status(),
        bootstrapVersion: process.env.DSH_BOOTSTRAP_VERSION ?? '1.0.0',
      })
      else if (request.method === 'POST' && pathname === '/v1/reload') send(response, 200, await runner.reload())
      else if (request.method === 'GET' && pathname === '/v1/health') send(response, 200, await runner.health())
      else if (request.method === 'GET' && pathname === '/v1/system-plugins' && systemPlugins !== undefined) {
        send(response, 200, { plugins: await systemPlugins.list() })
      } else if (request.method === 'POST' && pathname === '/v1/system-plugins/action' && systemPlugins !== undefined) {
        const body = await jsonBody(request)
        send(response, 200, { plugins: await systemPlugins.configure(body.id, body.action) })
      }
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
        const slots = await deployments.rollback({
          healthCheck: () => runner.reload(),
          activateReceipts: tokens => trust.activate(tokens),
        })
        send(response, 200, { slots })
      } else if (request.method === 'GET' && pathname === '/v1/deployments/rollback-plan' && deployments !== undefined) {
        const state = await deployments.state()
        send(response, 200, {
          current: state.current === null ? null : await deployments.record(state.current),
          previous: state.previous === null ? null : await deployments.record(state.previous),
        })
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
      } else if (request.method === 'POST' && pathname === '/v1/platform/gc' && deployments !== undefined) {
        send(response, 200, await new PlatformGarbageCollector({ paths: deployments.paths, deployments }).collect())
      }
      else {
        const operation = /^\/v1\/components\/([a-z0-9][a-z0-9._-]{0,127})\/(suspend|resume|restart)$/.exec(pathname)
        if (request.method === 'POST' && operation !== null) {
          const [componentId, action] = operation.slice(1)
          if (componentId === 'dsh-runtime' && action === 'restart' && deployments !== undefined) {
            const status = await deployments.exclusive(async () => {
              await deployments.setOperation('restarting')
              try {
                const value = await runner.restart(componentId)
                await deployments.setOperation(null)
                return value
              } catch (error) {
                await deployments.setOperation('restart-failed').catch(() => {})
                throw error
              }
            })
            send(response, 200, status)
          } else send(response, 200, await runner[action](componentId))
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
