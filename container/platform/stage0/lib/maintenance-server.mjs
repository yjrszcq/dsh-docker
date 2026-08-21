import { createServer } from 'node:http'
import { chmod, chown, mkdir, open, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AtomicFileEditor } from '../../../control-plane/modules/file-manager/editor.mjs'
import { createManagedPathMatcher, fileError, FileInventory, fileManagerLocations } from '../../../control-plane/modules/file-manager/index.mjs'
import { FileTaskManager } from '../../../control-plane/modules/file-manager/tasks.mjs'
import { FileTransferManager } from '../../../control-plane/modules/file-manager/transfers.mjs'
import { TerminalSessionManager } from '../../../control-plane/services/management/terminal/sessions.mjs'

const API_PREFIX = '/_dsh_platform/api/v1/'
const MAX_BODY_BYTES = 16 * 1024
const MAX_TEXT_BODY_BYTES = 2 * 1024 * 1024 + 8192
const TERMINAL_SESSION_ROUTE = /^terminal\/sessions\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/
const TERMINAL_STREAM_ROUTE = /^terminal\/sessions\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/stream$/
const FILE_TASK_ROUTE = /^files\/tasks\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/

async function jsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > maxBytes) {
      const error = new Error('request body is too large')
      error.statusCode = 413
      throw error
    }
    chunks.push(chunk)
  }
  return size === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(response, status, value) {
  if (response.headersSent) return response.destroy()
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(value)}\n`)
}

async function acquireLease(path) {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`)
    await handle.sync()
    await handle.close()
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const conflict = new Error('a privileged file operation is already running')
      conflict.statusCode = 409
      throw conflict
    }
    throw error
  }
}

export async function createMaintenanceServer({
  paths,
  dshHome = '/data/dsh',
  defaultWorkspace = '/workspace',
  platformBusy = async () => false,
  authorize = async () => false,
  report = async () => {},
  fileReport = report,
  terminalReport = report,
  audit = async () => {},
} = {}) {
  if (process.getuid?.() !== 0) throw new Error('Maintenance Broker must run as root')
  const isManaged = createManagedPathMatcher(paths.dataRoot)
  const inventory = new FileInventory({ isManaged })
  const transfers = new FileTransferManager({ isManaged })
  const editor = new AtomicFileEditor({ isManaged })
  const locations = Object.freeze({
    ...fileManagerLocations({ platformData: paths.dataRoot, dshHome, defaultWorkspace }),
    privileged: true,
  })
  const terminal = new TerminalSessionManager({
    cwd: defaultWorkspace,
    dshHome,
    report: (message, fields) => terminalReport(message, fields),
  })
  let server
  const tasks = new FileTaskManager({
    root: paths.fileTasksRoot,
    inventory,
    isManaged,
    protectedRoots: ['/', '/data', '/data/dsh', '/data/platform', '/workspace', paths.dataRoot, dshHome, defaultWorkspace, paths.deploymentView],
    platformBusy: () => false,
    onState: state => server?.emit('maintenance-state', state),
    report: (message, fields) => fileReport(message, fields),
  })
  await rm(paths.maintenanceLeasePath, { force: true })
  await tasks.initialize()

  const startTask = async body => {
    const managed = tasks.wouldManage(body)
    if (managed && await platformBusy()) {
      const error = new Error('a platform operation is already running')
      error.statusCode = 409
      throw error
    }
    if (managed) await acquireLease(paths.maintenanceLeasePath)
    try {
      const task = tasks.start(body)
      if (managed) {
        const internal = tasks.tasks.get(task.taskId)
        void internal.completion.finally(() => rm(paths.maintenanceLeasePath, { force: true }))
      }
      void tasks.completion(task.taskId).then(async result => {
        const outcome = result.status === 'success' ? 'completed' : result.status
        await audit(`files.${result.operation}.${outcome}`, {
          taskId: result.taskId,
          path: result.path ?? result.destination ?? result.sources?.[0]?.path ?? null,
          processedEntries: result.processedEntries ?? result.entries ?? null,
          processedBytes: result.processedBytes ?? result.bytes ?? null,
          ...(result.error === null || result.error === undefined ? {} : { error: result.error }),
          managed: result.managed ?? false,
          privileged: true,
        })
      }).catch(error => report('maintenance.file-task.audit.failed', { error, taskId: task.taskId }))
      return task
    } catch (error) {
      if (managed) await rm(paths.maintenanceLeasePath, { force: true })
      throw error
    }
  }

  const managedWrite = async (path, operation) => {
    const managed = isManaged(path)
    if (!managed) return operation()
    if (await platformBusy()) {
      const error = new Error('a platform operation is already running')
      error.statusCode = 409
      throw error
    }
    await acquireLease(paths.maintenanceLeasePath)
    try { return await operation() } finally { await rm(paths.maintenanceLeasePath, { force: true }) }
  }

  server = createServer((request, response) => {
    void (async () => {
      if (!await authorize(request)) return send(response, 401, { error: 'maintenance authentication required' })
      const url = new URL(request.url ?? '/', 'http://maintenance.internal')
      if (!url.pathname.startsWith(API_PREFIX)) return send(response, 404, { error: 'not found' })
      const route = url.pathname.slice(API_PREFIX.length)
      if (request.method === 'POST' && route === 'terminal/sessions') {
        const result = terminal.create(await jsonBody(request))
        await audit('terminal.root-session.created', { sessionId: result.sessionId })
        send(response, 201, { ...result, privileged: true })
      } else if (request.method === 'GET' && TERMINAL_SESSION_ROUTE.test(route)) {
        send(response, 200, { ...terminal.status(TERMINAL_SESSION_ROUTE.exec(route)[1]), privileged: true })
      } else if (request.method === 'DELETE' && TERMINAL_SESSION_ROUTE.test(route)) {
        send(response, 200, terminal.close(TERMINAL_SESSION_ROUTE.exec(route)[1]))
      } else if (request.method === 'GET' && route === 'files/config') {
        send(response, 200, locations)
      } else if (request.method === 'GET' && route === 'files/list') {
        const result = await inventory.list(url.searchParams.get('path'), {
          cursor: url.searchParams.get('cursor'), limit: url.searchParams.get('limit'),
          sort: url.searchParams.get('sort') ?? 'name', order: url.searchParams.get('order') ?? 'asc',
        })
        send(response, 200, result)
      } else if (request.method === 'GET' && route === 'files/stat') {
        send(response, 200, await inventory.stat(url.searchParams.get('path')))
      } else if (request.method === 'GET' && route === 'files/content') {
        send(response, 200, await inventory.content(url.searchParams.get('path')))
      } else if (request.method === 'PUT' && route === 'files/content') {
        const body = await jsonBody(request, MAX_TEXT_BODY_BYTES)
        const result = await managedWrite(body.path, () => editor.write(body.path, body.content, body.revision, { create: body.create === true }))
        await audit('files.content.saved', { path: result.path, size: result.size, managed: result.managed, privileged: true })
        send(response, body.create === true ? 201 : 200, result)
      } else if (request.method === 'GET' && route === 'files/download') {
        const download = await transfers.openDownload(url.searchParams.get('path'), {
          revision: url.searchParams.get('revision') ?? undefined,
          range: typeof request.headers.range === 'string' ? request.headers.range : undefined,
        })
        await transfers.sendDownload(response, download)
      } else if (request.method === 'POST' && route === 'files/upload') {
        const length = request.headers['content-length']
        const contentLength = length === undefined ? undefined : Number(length)
        const path = url.searchParams.get('path')
        const result = await managedWrite(path, () => transfers.upload(request, path, {
          conflict: url.searchParams.get('conflict') ?? 'reject', contentLength,
        }))
        await audit('files.upload.completed', { path: result.path, size: result.size, privileged: true })
        send(response, 201, result)
      } else if (request.method === 'POST' && route === 'files/tasks') {
        const body = await jsonBody(request)
        try {
          const task = await startTask(body)
          await audit(`files.${task.operation}.started`, { taskId: task.taskId, path: task.destination, managed: task.managed, privileged: true })
          send(response, 202, task)
        } catch (error) {
          const operation = ['mkdir', 'touch'].includes(body?.operation) ? body.operation : 'task'
          await audit(`files.${operation}.rejected`, { error, path: body?.destination ?? null, privileged: true })
          throw error
        }
      } else if (request.method === 'GET' && route === 'files/tasks') {
        send(response, 200, { tasks: tasks.list() })
      } else if (request.method === 'GET' && FILE_TASK_ROUTE.test(route)) {
        send(response, 200, tasks.get(FILE_TASK_ROUTE.exec(route)[1], {
          cursor: url.searchParams.get('cursor'), limit: url.searchParams.get('limit'),
        }))
      } else if (request.method === 'DELETE' && FILE_TASK_ROUTE.test(route)) {
        send(response, 202, tasks.cancel(FILE_TASK_ROUTE.exec(route)[1]))
      } else send(response, 404, { error: 'not found' })
    })().catch(async error => {
      const failure = Number.isInteger(error?.statusCode)
        ? error
        : fileError(error, 'maintenance request failed')
      await report('maintenance.request.failed', {
        error: failure, method: request.method ?? null, pathname: request.url ?? null,
        level: failure.statusCode === 409 ? 'warning' : 'error',
      })
      send(response, failure.statusCode, { error: failure.message })
    })
  })
  server.on('upgrade', (request, socket, head) => {
    void (async () => {
      if (!await authorize(request)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
        return
      }
      const pathname = new URL(request.url ?? '/', 'http://maintenance.internal').pathname
      const match = pathname.startsWith(API_PREFIX) ? TERMINAL_STREAM_ROUTE.exec(pathname.slice(API_PREFIX.length)) : null
      if (match === null) throw new Error('not found')
      terminal.upgrade(request, socket, head, match[1])
    })().catch(error => {
      void report('maintenance.terminal-upgrade.failed', { error })
      if (!socket.destroyed) socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
    })
  })
  return Object.freeze({ server, terminal, tasks, locations })
}

export async function listenMaintenance(server, socketPath) {
  await mkdir(dirname(socketPath), { recursive: true })
  await rm(socketPath, { force: true })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  await chown(socketPath, 0, 1000)
  await chmod(socketPath, 0o660)
}
