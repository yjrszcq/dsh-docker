import { createServer } from 'node:http'
import { chmod, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { UpdateConflictError } from '../../modules/updater/lib/coordinator.mjs'

export const API_PREFIX = '/_dsh_platform/api/v1/'
export const CONSOLE_PREFIX = '/_dsh_platform/ui/'
const MAX_BODY_BYTES = 16 * 1024
const CONSOLE_ASSETS = new Map([
  ['', ['index.html', 'text/html; charset=utf-8']],
  ['app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['style.css', ['style.css', 'text/css; charset=utf-8']],
])
const CONSOLE_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'self'; form-action 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
})

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

async function sendConsoleAsset(request, response, pathname, consoleRoot) {
  if (pathname === CONSOLE_PREFIX.slice(0, -1)) {
    response.writeHead(308, { location: CONSOLE_PREFIX, ...CONSOLE_HEADERS })
    response.end()
    return true
  }
  if (!pathname.startsWith(CONSOLE_PREFIX)) return false
  if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
    response.writeHead(405, { allow: 'GET, HEAD', ...CONSOLE_HEADERS })
    response.end()
    return true
  }
  const asset = CONSOLE_ASSETS.get(pathname.slice(CONSOLE_PREFIX.length))
  if (asset === undefined) {
    response.writeHead(404, CONSOLE_HEADERS)
    response.end()
    return true
  }
  const body = await readFile(join(consoleRoot, asset[0]))
  response.writeHead(200, {
    ...CONSOLE_HEADERS,
    'content-type': asset[1],
    'content-length': String(body.byteLength),
  })
  response.end(request.method === 'HEAD' ? undefined : body)
  return true
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

export function createManagementServer({
  coordinator,
  logs,
  platformStatus = async () => ({}),
  consoleRoot = join(import.meta.dirname, 'public'),
}) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://management.internal')
      if (await sendConsoleAsset(request, response, url.pathname, consoleRoot)) return
      if (!url.pathname.startsWith(API_PREFIX)) return send(response, 404, { error: 'not found' })
      const route = url.pathname.slice(API_PREFIX.length)
      if (request.method === 'GET' && route === 'status') {
        send(response, 200, { ...(await coordinator.publicStatus()), ...(await platformStatus()) })
      } else if (request.method === 'POST' && route === 'check') {
        const target = await coordinator.check()
        send(response, 200, {
          targetSequence: target.value.targetSequence,
          desired: target.value.desired,
        })
      } else if (request.method === 'POST' && route === 'update') {
        const task = coordinator.startReconcile()
        void task.completion
          .then(
            () => logs.audit('update.completed', { taskId: task.taskId }),
            error => logs.audit('update.failed', { error: error.message, taskId: task.taskId }),
          )
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
