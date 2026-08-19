import { createServer } from 'node:http'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { UpdateConflictError } from '../../components/updater/lib/coordinator.mjs'

export const API_PREFIX = '/_dsh_platform/api/v1/'
const MAX_BODY_BYTES = 16 * 1024

async function jsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(value)}\n`)
}

function event(response, type, value) {
  response.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`)
}

function logOptions(url) {
  const sources = url.searchParams.getAll('source')
  const since = url.searchParams.get('since') ?? undefined
  const limitValue = url.searchParams.get('limit')
  return {
    sources: sources.length === 0 ? undefined : sources,
    since,
    limit: limitValue === null ? 200 : Number(limitValue),
  }
}

export function createManagementServer({ coordinator, logs, platformStatus = async () => ({}) }) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://management.internal')
      if (!url.pathname.startsWith(API_PREFIX)) return send(response, 404, { error: 'not found' })
      const route = url.pathname.slice(API_PREFIX.length)
      if (request.method === 'GET' && route === 'status') {
        send(response, 200, { ...(await platformStatus()), ...(await coordinator.publicStatus()) })
      } else if (request.method === 'POST' && route === 'check') {
        const target = await coordinator.check()
        send(response, 200, {
          targetSequence: target.value.targetSequence,
          desired: target.value.desired,
        })
      } else if (request.method === 'POST' && route === 'update') {
        const task = coordinator.startReconcile()
        void task.completion
          .catch(error => logs.audit('update.failed', { error: error.message, taskId: task.taskId }))
          .catch(() => {})
        await logs.audit('update.started', { taskId: task.taskId })
        send(response, 202, { taskId: task.taskId })
      } else if (request.method === 'PUT' && route === 'channel') {
        const body = await jsonBody(request)
        send(response, 200, await coordinator.setChannel(body.channel))
      } else if (request.method === 'POST' && route === 'holds/retry') {
        const body = await jsonBody(request)
        send(response, 200, await coordinator.retryHold(body.id))
      } else if (request.method === 'GET' && route === 'rollback-plan') {
        send(response, 200, { plan: await coordinator.rollbackPlan() })
      } else if (request.method === 'POST' && ['rollback', 'return-stable'].includes(route)) {
        const body = await jsonBody(request)
        const task = coordinator.startCompleteRollback(body.planId, {
          requireConfirmation: route === 'return-stable',
          confirmDataLoss: body.confirmDataLoss,
        })
        void task.completion
          .then(() => logs.audit(`${route}.completed`, { taskId: task.taskId }))
          .catch(error => logs.audit(`${route}.failed`, { error: error.message, taskId: task.taskId }))
          .catch(() => {})
        send(response, 202, { taskId: task.taskId })
      } else if (request.method === 'GET' && route === 'events') {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        event(response, 'state', await coordinator.state.read())
        const listener = value => event(response, 'state', value)
        coordinator.on('state', listener)
        response.once('close', () => coordinator.off('state', listener))
      } else if (request.method === 'GET' && route === 'logs') {
        send(response, 200, { entries: await logs.query(logOptions(url)) })
      } else if (request.method === 'GET' && route === 'logs/stream') {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        for (const entry of await logs.query(logOptions(url))) event(response, 'log', entry)
        const listener = value => event(response, 'log', value)
        logs.on('entry', listener)
        response.once('close', () => logs.off('entry', listener))
      } else send(response, 404, { error: 'not found' })
    } catch (error) {
      send(response, error instanceof UpdateConflictError ? 409 : 400, {
        error: error instanceof Error ? error.message : 'management request failed',
      })
    }
  })
}

export async function listenManagement(server, socketPath) {
  await mkdir(dirname(socketPath), { recursive: true })
  await rm(socketPath, { force: true })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  await chmod(socketPath, 0o600)
}
