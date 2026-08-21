import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { UpdateConflictError } from '../../modules/updater/lib/coordinator.mjs'
import { MAX_SETTINGS_DOCUMENT_BYTES, SettingsDocumentConflictError } from './settings-document.mjs'

export const API_PREFIX = '/_dsh_platform/api/v1/'
export const CONSOLE_PREFIX = '/_dsh_platform/ui/'
const MAX_BODY_BYTES = 16 * 1024
const TERMINAL_SESSION_ROUTE = /^terminal\/sessions\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/
const TERMINAL_STREAM_ROUTE = /^terminal\/sessions\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/stream$/
const FILE_TASK_ROUTE = /^files\/tasks\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/
const CONSOLE_ASSETS = new Map([
  ['', ['public', 'index.html', 'text/html; charset=utf-8']],
  ['app.js', ['public', 'app.js', 'text/javascript; charset=utf-8']],
  ['style.css', ['public', 'style.css', 'text/css; charset=utf-8']],
  ['vendor/xterm.mjs', ['dependencies', '@xterm/xterm/lib/xterm.mjs', 'text/javascript; charset=utf-8']],
  ['vendor/xterm.css', ['dependencies', '@xterm/xterm/css/xterm.css', 'text/css; charset=utf-8']],
  ['vendor/addon-fit.mjs', ['dependencies', '@xterm/addon-fit/lib/addon-fit.mjs', 'text/javascript; charset=utf-8']],
])
const CONSOLE_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'self'; form-action 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
})

async function jsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > maxBytes) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(response, status, value) {
  if (response.headersSent) return response.destroy()
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(value)}\n`)
}

async function sendConsoleAsset(request, response, pathname, consoleRoots) {
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
  const body = await readFile(join(consoleRoots[asset[0]], asset[1]))
  response.writeHead(200, {
    ...CONSOLE_HEADERS,
    'content-type': asset[2],
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
  restartDsh = async () => { throw new Error('DSH restart is not configured') },
  resetRuntime = async () => { throw new Error('Runtime reset is not configured') },
  listBundledPlugins = async () => [],
  configureBundledPlugin = async () => { throw new Error('System Plugin management is not configured') },
  recoverBundledPlugin = async () => { throw new Error('System Plugin recovery is not configured') },
  discardBundledPluginChanges = async () => { throw new Error('System Plugin draft management is not configured') },
  listUserPlugins = async () => { throw new Error('User Plugin inventory is not configured') },
  markUserPluginsLoaded = async () => {},
  validateUserPluginActions = async () => { throw new Error('User Plugin recovery is not configured') },
  applyUserPluginActions = async () => { throw new Error('User Plugin recovery is not configured') },
  recoverUserPluginTransaction,
  initialUserPluginTransaction,
  settingsDocument,
  updateAutomaticCheck = async () => { throw new Error('automatic checks are not configured') },
  terminalSessions = {
    create: () => { throw new Error('terminal sessions are not configured') },
    status: () => { throw new Error('terminal sessions are not configured') },
    close: () => { throw new Error('terminal sessions are not configured') },
    upgrade: (_request, socket) => socket.destroy(),
  },
  fileInventory,
  fileTransfers,
  fileTasks,
  fileEditor,
  fileLocations = Object.freeze({ defaultPath: '/workspace', shortcuts: Object.freeze(['/workspace', '/data/dsh', '/data/platform', '/']) }),
  privilegedMutationActive = () => false,
  consoleRoot = join(import.meta.dirname, 'public'),
  consoleDependencyRoot = join(import.meta.dirname, 'node_modules'),
}) {
  let restartTask
  let runtimeResetTask
  let pluginTask
  let userPluginTask
  let restartState = Object.freeze({ status: 'idle', taskId: null, error: null, updatedAt: null })
  let runtimeResetState = Object.freeze({ status: 'idle', taskId: null, error: null, updatedAt: null })
  let pluginState = Object.freeze({ status: 'idle', taskId: null, pluginId: null, action: null, error: null, restartRequired: false, updatedAt: null })
  let userPluginState = Object.freeze(initialUserPluginTransaction === undefined
    ? { status: 'idle', taskId: null, phase: null, error: null, updatedAt: null }
    : {
        status: initialUserPluginTransaction.phase === 'completed' ? 'success'
          : initialUserPluginTransaction.phase === 'failed' ? 'failed' : 'running',
        taskId: initialUserPluginTransaction.taskId,
        phase: initialUserPluginTransaction.phase,
        error: initialUserPluginTransaction.error,
        updatedAt: initialUserPluginTransaction.updatedAt,
      })
  const userPluginTasks = new Map()
  if (userPluginState.taskId !== null) userPluginTasks.set(userPluginState.taskId, userPluginState)
  let server
  const audit = (message, fields = {}) => logs.diagnostic('audit', message, { stream: 'audit', ...fields })
  const recordAudit = (message, fields = {}) => Promise.resolve().then(() => audit(message, fields)).catch(() => {})
  const refreshLoadedUserPlugins = () => Promise.resolve()
    .then(() => markUserPluginsLoaded())
    .catch(error => recordAudit('user-plugin.loaded-state.capture.failed', { error }))

  const publishRestart = value => {
    restartState = Object.freeze({ ...restartState, ...value, updatedAt: new Date().toISOString() })
    server.emit('management-state', restartState)
  }

  const publishRuntimeReset = value => {
    runtimeResetState = Object.freeze({ ...runtimeResetState, ...value, updatedAt: new Date().toISOString() })
    server.emit('management-state', runtimeResetState)
  }

  const publishPlugin = value => {
    pluginState = Object.freeze({ ...pluginState, ...value, updatedAt: new Date().toISOString() })
    server.emit('management-state', pluginState)
  }

  const publishUserPlugin = value => {
    userPluginState = Object.freeze({ ...userPluginState, ...value, updatedAt: new Date().toISOString() })
    if (userPluginState.taskId !== null) {
      userPluginTasks.set(userPluginState.taskId, userPluginState)
      while (userPluginTasks.size > 32) userPluginTasks.delete(userPluginTasks.keys().next().value)
    }
    server.emit('management-state', userPluginState)
  }

  const requireRuntimeIdle = () => {
    if (restartTask !== undefined) throw new UpdateConflictError('DSH is already restarting')
    if (runtimeResetTask !== undefined) throw new UpdateConflictError('the DSH Runtime is already resetting')
    if (pluginTask !== undefined) throw new UpdateConflictError('a System Plugin operation is already running')
    if (userPluginTask !== undefined) throw new UpdateConflictError('a User Plugin operation is already running')
    if (fileTasks?.hasManagedMutation === true) throw new UpdateConflictError('a managed file operation is already running')
    if (privilegedMutationActive()) throw new UpdateConflictError('a privileged file operation is already running')
  }

  const startUserPluginAction = async body => {
    if (body === null || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).sort().join(',') !== 'actions,profile,revision'
      || body.profile !== 'web') throw new Error('User Plugin request is invalid')
    requireRuntimeIdle()
    if (coordinator.hasActiveTask?.() === true) throw new UpdateConflictError('an update task is already running')
    const validated = await validateUserPluginActions({ revision: body.revision, actions: body.actions })
    requireRuntimeIdle()
    if (coordinator.hasActiveTask?.() === true) throw new UpdateConflictError('an update task is already running')
    const taskId = randomUUID()
    publishUserPlugin({ status: 'running', taskId, phase: 'validated', error: null })
    userPluginTask = Promise.resolve()
      .then(() => recordAudit('user-plugin.apply.started', { taskId, actions: validated.actions }))
      .then(() => applyUserPluginActions({
        taskId,
        revision: validated.revision,
        actions: validated.actions,
        onProgress: state => publishUserPlugin({ phase: state.phase }),
      }))
      .then(
        async () => {
          await refreshLoadedUserPlugins()
          await recordAudit('user-plugin.apply.completed', { taskId })
          publishUserPlugin({ status: 'success', taskId, phase: 'completed', error: null })
          publishPlugin({ restartRequired: false })
        },
        async error => {
          const journal = error?.journal
          await recordAudit('user-plugin.apply.failed', { error, taskId })
          publishUserPlugin({
            status: 'failed', taskId, phase: journal?.phase ?? userPluginState.phase,
            error: error instanceof Error ? error.message : 'User Plugin operation failed',
          })
        },
      )
      .finally(() => { userPluginTask = undefined })
    userPluginTask.catch(() => {})
    return { taskId }
  }

  const startPluginAction = (pluginId, action, { recovery = false, toggleOnly = false } = {}) => {
    if (typeof pluginId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(pluginId)) {
      throw new Error('System Plugin ID is invalid')
    }
    if (!['install', 'uninstall', 'enable', 'disable'].includes(action)) throw new Error('System Plugin action is invalid')
    if (toggleOnly && !['enable', 'disable'].includes(action)) throw new Error('Only System Plugin enable and disable actions are allowed')
    if (recovery && pluginId !== 'platform-management') throw new Error('System Plugin is not a console recovery target')
    requireRuntimeIdle()
    if (coordinator.hasActiveTask?.() === true) throw new UpdateConflictError('an update task is already running')
    const taskId = randomUUID()
    publishPlugin({ status: 'running', taskId, pluginId, action, error: null })
    pluginTask = Promise.resolve()
      .then(() => recordAudit(`system-plugin.${recovery ? 'recovery.' : ''}${action}.started`, { taskId, pluginId }))
      .then(() => recovery ? recoverBundledPlugin(pluginId, action) : configureBundledPlugin(pluginId, action))
      .then(
        async () => {
          await recordAudit(`system-plugin.${recovery ? 'recovery.' : ''}${action}.completed`, { taskId, pluginId })
          publishPlugin({ status: 'success', taskId, pluginId, action, error: null, restartRequired: true })
        },
        async error => {
          const message = error instanceof Error ? error.message : 'System Plugin operation failed'
          await recordAudit(`system-plugin.${recovery ? 'recovery.' : ''}${action}.failed`, { error, taskId, pluginId })
          publishPlugin({ status: 'failed', taskId, pluginId, action, error: message })
        },
      )
      .finally(() => { pluginTask = undefined })
    pluginTask.catch(() => {})
    return { taskId }
  }

  const startRestart = () => {
    requireRuntimeIdle()
    if (coordinator.hasActiveTask?.() === true) throw new UpdateConflictError('an update task is already running')
    const taskId = randomUUID()
    publishRestart({ status: 'restarting', taskId, error: null })
    restartTask = Promise.resolve()
      .then(() => recordAudit('dsh.restart.started', { taskId }))
      .then(() => restartDsh())
      .then(
        async () => {
          await refreshLoadedUserPlugins()
          await recordAudit('dsh.restart.completed', { taskId })
          publishRestart({ status: 'success', taskId, error: null })
          publishPlugin({ restartRequired: false })
        },
        async error => {
          const message = error instanceof Error ? error.message : 'DSH restart failed'
          await recordAudit('dsh.restart.failed', { error, taskId })
          publishRestart({ status: 'failed', taskId, error: message })
        },
      )
      .finally(() => { restartTask = undefined })
    restartTask.catch(() => {})
    return { taskId }
  }

  const startRuntimeReset = () => {
    requireRuntimeIdle()
    if (coordinator.hasActiveTask?.() === true) throw new UpdateConflictError('an update task is already running')
    const taskId = randomUUID()
    publishRuntimeReset({ status: 'resetting', taskId, error: null })
    runtimeResetTask = Promise.resolve()
      .then(() => recordAudit('runtime.reset.started', { taskId }))
      .then(() => resetRuntime())
      .then(
        async () => {
          await refreshLoadedUserPlugins()
          await recordAudit('runtime.reset.completed', { taskId })
          publishRuntimeReset({ status: 'success', taskId, error: null })
          publishPlugin({ restartRequired: false })
        },
        async error => {
          const message = error instanceof Error ? error.message : 'Runtime reset failed'
          await recordAudit('runtime.reset.failed', { error, taskId })
          publishRuntimeReset({ status: 'failed', taskId, error: message })
        },
      )
      .finally(() => { runtimeResetTask = undefined })
    runtimeResetTask.catch(() => {})
    return { taskId }
  }

  server = createServer(async (request, response) => {
    let pathname = 'invalid-url'
    try {
      const url = new URL(request.url ?? '/', 'http://management.internal')
      pathname = url.pathname
      if (await sendConsoleAsset(request, response, url.pathname, {
        public: consoleRoot,
        dependencies: consoleDependencyRoot,
      })) return
      if (!url.pathname.startsWith(API_PREFIX)) return send(response, 404, { error: 'not found' })
      const route = url.pathname.slice(API_PREFIX.length)
      if (request.method === 'GET' && route === 'status') {
        send(response, 200, {
          ...(await coordinator.publicStatus()),
          ...(await platformStatus()),
          dshRestart: restartState,
          runtimeReset: runtimeResetState,
          systemPluginOperation: pluginState,
          userPluginOperation: userPluginState,
        })
      } else if (request.method === 'GET' && route === 'bundled-plugins') {
        send(response, 200, { plugins: await listBundledPlugins() })
      } else if (request.method === 'GET' && route === 'user-plugins') {
        send(response, 200, await listUserPlugins())
      } else if (request.method === 'POST' && route === 'user-plugins/apply') {
        send(response, 202, await startUserPluginAction(await jsonBody(request)))
      } else if (request.method === 'GET' && /^user-plugins\/task\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(route)) {
        const taskId = route.slice('user-plugins/task/'.length)
        const task = userPluginTasks.get(taskId)
        if (task === undefined) {
          const error = new Error('User Plugin task was not found')
          error.statusCode = 404
          throw error
        }
        send(response, 200, task)
      } else if (request.method === 'POST' && route === 'terminal/sessions') {
        send(response, 201, terminalSessions.create(await jsonBody(request)))
      } else if (request.method === 'GET' && TERMINAL_SESSION_ROUTE.test(route)) {
        send(response, 200, terminalSessions.status(TERMINAL_SESSION_ROUTE.exec(route)[1]))
      } else if (request.method === 'DELETE' && TERMINAL_SESSION_ROUTE.test(route)) {
        send(response, 200, terminalSessions.close(TERMINAL_SESSION_ROUTE.exec(route)[1]))
      } else if (request.method === 'GET' && route === 'settings-document') {
        if (settingsDocument === undefined) throw new Error('settings document editing is not configured')
        send(response, 200, await settingsDocument.read())
      } else if (request.method === 'PUT' && route === 'settings-document') {
        if (settingsDocument === undefined) throw new Error('settings document editing is not configured')
        const body = await jsonBody(request, MAX_SETTINGS_DOCUMENT_BYTES * 6 + 4096)
        if (body === null || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some(key => !['content', 'revision'].includes(key))) {
          throw new Error('settings document request is invalid')
        }
        const saved = await settingsDocument.write(body.content, body.revision)
        await audit('settings-document.saved', { revision: saved.revision })
        send(response, 200, saved)
      } else if (request.method === 'GET' && route === 'files/config') {
        send(response, 200, fileLocations)
      } else if (request.method === 'GET' && route === 'files/list') {
        if (fileInventory === undefined) throw new Error('file management is not configured')
        const result = await fileInventory.list(url.searchParams.get('path'), {
          cursor: url.searchParams.get('cursor'), limit: url.searchParams.get('limit'),
          sort: url.searchParams.get('sort') ?? 'name', order: url.searchParams.get('order') ?? 'asc',
        })
        await recordAudit('files.list.completed', { path: result.path, entries: result.entries.length })
        send(response, 200, result)
      } else if (request.method === 'GET' && route === 'files/stat') {
        if (fileInventory === undefined) throw new Error('file management is not configured')
        const result = await fileInventory.stat(url.searchParams.get('path'))
        await recordAudit('files.stat.completed', { path: result.path, type: result.type })
        send(response, 200, result)
      } else if (request.method === 'GET' && route === 'files/content') {
        if (fileInventory === undefined) throw new Error('file management is not configured')
        const result = await fileInventory.content(url.searchParams.get('path'))
        await recordAudit('files.content.completed', { path: result.path, size: result.size })
        send(response, 200, result)
      } else if (request.method === 'PUT' && route === 'files/content') {
        if (fileEditor === undefined) throw new Error('file editing is not configured')
        const body = await jsonBody(request, 2 * 1024 * 1024 + 8192)
        if (body === null || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some(key => !['path', 'content', 'revision', 'create'].includes(key))) throw new Error('file content request is invalid')
        const saved = await fileEditor.write(body.path, body.content, body.revision, { create: body.create === true })
        await recordAudit('files.content.saved', { path: saved.path, size: saved.size, managed: saved.managed })
        send(response, body.create === true ? 201 : 200, saved)
      } else if (request.method === 'GET' && route === 'files/download') {
        if (fileTransfers === undefined) throw new Error('file transfers are not configured')
        const download = await fileTransfers.openDownload(url.searchParams.get('path'), {
          revision: url.searchParams.get('revision') ?? undefined,
          range: typeof request.headers.range === 'string' ? request.headers.range : undefined,
        })
        await recordAudit('files.download.started', { path: download.path, revision: download.revision })
        await fileTransfers.sendDownload(response, download)
        await recordAudit('files.download.completed', { path: download.path, revision: download.revision })
      } else if (request.method === 'POST' && route === 'files/upload') {
        if (fileTransfers === undefined) throw new Error('file transfers are not configured')
        const lengthHeader = request.headers['content-length']
        const contentLength = lengthHeader === undefined ? undefined : Number(lengthHeader)
        if (contentLength !== undefined && (!Number.isSafeInteger(contentLength) || contentLength < 0)) throw new Error('Content-Length is invalid')
        const path = url.searchParams.get('path')
        await recordAudit('files.upload.started', { path })
        const result = await fileTransfers.upload(request, path, {
          conflict: url.searchParams.get('conflict') ?? 'reject', contentLength,
        })
        await recordAudit('files.upload.completed', { path: result.path, size: result.size })
        send(response, 201, result)
      } else if (request.method === 'POST' && route === 'files/tasks') {
        if (fileTasks === undefined) throw new Error('file tasks are not configured')
        const body = await jsonBody(request)
        if (fileTasks.wouldManage?.(body) === true) requireRuntimeIdle()
        const task = fileTasks.start(body)
        await recordAudit(`files.${task.operation}.started`, { path: task.path, taskId: task.taskId, managed: task.managed })
        send(response, 202, task)
      } else if (request.method === 'GET' && route === 'files/tasks') {
        if (fileTasks === undefined) throw new Error('file tasks are not configured')
        send(response, 200, { tasks: fileTasks.list() })
      } else if (request.method === 'GET' && FILE_TASK_ROUTE.test(route)) {
        if (fileTasks === undefined) throw new Error('file tasks are not configured')
        const taskId = FILE_TASK_ROUTE.exec(route)[1]
        send(response, 200, fileTasks.get(taskId, { cursor: url.searchParams.get('cursor'), limit: url.searchParams.get('limit') }))
      } else if (request.method === 'DELETE' && FILE_TASK_ROUTE.test(route)) {
        if (fileTasks === undefined) throw new Error('file tasks are not configured')
        const task = fileTasks.cancel(FILE_TASK_ROUTE.exec(route)[1])
        await recordAudit('files.task.cancel-requested', { operation: task.operation, taskId: task.taskId })
        send(response, 202, task)
      } else if (request.method === 'POST' && route === 'check') {
        const body = await jsonBody(request)
        const source = body.source ?? 'manual'
        if (!['manual', 'page-open', 'channel-change'].includes(source)) throw new Error('update check source is invalid')
        const target = await coordinator.check(source)
        send(response, 200, target.unavailable === true
          ? { available: false, upstream: target.upstream }
          : {
              available: target.updateAvailable ?? true,
              targetSequence: target.value.targetSequence,
              desired: target.value.desired,
            })
      } else if (request.method === 'POST' && route === 'update') {
        requireRuntimeIdle()
        const task = coordinator.startReconcile()
        void task.completion
          .then(
            async () => {
              await refreshLoadedUserPlugins()
              await audit('update.completed', { taskId: task.taskId })
            },
            error => audit('update.failed', { error, taskId: task.taskId }),
          )
          .catch(() => {})
        await audit('update.started', { taskId: task.taskId })
        send(response, 202, { taskId: task.taskId })
      } else if (request.method === 'POST' && route === 'restart-dsh') {
        const task = startRestart()
        send(response, 202, task)
      } else if (request.method === 'POST' && route === 'runtime/reset') {
        const task = startRuntimeReset()
        send(response, 202, task)
      } else if (request.method === 'POST' && route === 'bundled-plugins/action') {
        const body = await jsonBody(request)
        send(response, 202, startPluginAction(body.id, body.action))
      } else if (request.method === 'POST' && route === 'bundled-plugins/toggle') {
        const body = await jsonBody(request)
        send(response, 202, startPluginAction(body.id, body.action, { toggleOnly: true }))
      } else if (request.method === 'POST' && route === 'bundled-plugins/recovery-action') {
        const body = await jsonBody(request)
        send(response, 202, startPluginAction(body.id, body.action, { recovery: true }))
      } else if (request.method === 'POST' && route === 'bundled-plugins/discard') {
        requireRuntimeIdle()
        if (coordinator.hasActiveTask?.() === true) throw new UpdateConflictError('an update task is already running')
        const result = await discardBundledPluginChanges()
        publishPlugin({ restartRequired: false })
        await audit('system-plugin.changes.discarded')
        send(response, 200, result)
      } else if (request.method === 'PUT' && route === 'channel') {
        const body = await jsonBody(request)
        const value = await coordinator.setChannel(body.channel)
        await audit('update.channel.changed', { updateChannel: value.updateChannel })
        server.emit('management-state', value)
        send(response, 200, value)
      } else if (request.method === 'PUT' && route === 'automatic-check') {
        const value = await updateAutomaticCheck(await jsonBody(request))
        await audit('update.automatic-check.configured', {
          enabled: value.enabled,
          intervalSeconds: value.intervalSeconds,
          notificationsEnabled: value.notificationsEnabled,
        })
        server.emit('management-state', value)
        send(response, 200, value)
      } else if (request.method === 'POST' && route === 'holds/retry') {
        const body = await jsonBody(request)
        const result = await coordinator.retryHold(body.id)
        await audit('update.hold.retried', { holdId: body.id })
        send(response, 200, result)
      } else if (request.method === 'GET' && route === 'rollback-plan') {
        send(response, 200, { plan: await coordinator.rollbackPlan() })
      } else if (request.method === 'POST' && ['rollback', 'return-stable'].includes(route)) {
        requireRuntimeIdle()
        const body = await jsonBody(request)
        const task = coordinator.startCompleteRollback(body.planId, {
          requireConfirmation: route === 'return-stable',
          confirmDataLoss: body.confirmDataLoss,
        })
        void task.completion
          .then(async () => {
            await refreshLoadedUserPlugins()
            await audit(`${route}.completed`, { taskId: task.taskId })
          })
          .catch(error => audit(`${route}.failed`, { error, taskId: task.taskId }))
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
        server.on('management-state', listener)
        response.once('close', () => {
          coordinator.off('state', listener)
          server.off('management-state', listener)
        })
      } else if (request.method === 'GET' && route === 'logs') {
        send(response, 200, { entries: await logs.query(logOptions(url)) })
      } else if (request.method === 'GET' && route === 'logs/stream') {
        const options = logOptions(url)
        const selectedSources = options.sources === undefined ? undefined : new Set(options.sources)
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        for (const entry of await logs.query(options)) event(response, 'log', entry)
        const listener = value => {
          if (selectedSources === undefined || selectedSources.has(value.source)) event(response, 'log', value)
        }
        logs.on('entry', listener)
        response.once('close', () => logs.off('entry', listener))
      } else send(response, 404, { error: 'not found' })
    } catch (error) {
      const conflict = error instanceof UpdateConflictError || error instanceof SettingsDocumentConflictError
        || error?.code === 'REVISION_CONFLICT' || error?.statusCode === 409
      await logs.diagnostic('platform-management', 'management.request.failed', {
        error,
        level: conflict ? 'warning' : 'error',
        method: request.method ?? null,
        pathname,
      })
      send(response, conflict ? 409 : (error?.statusCode ?? 400), {
        error: error instanceof Error ? error.message : 'management request failed',
      })
    }
  })
  server.on('upgrade', (request, socket, head) => {
    let pathname = 'invalid-url'
    try {
      pathname = new URL(request.url ?? '/', 'http://management.internal').pathname
      if (!pathname.startsWith(API_PREFIX)) throw new Error('not found')
      const match = TERMINAL_STREAM_ROUTE.exec(pathname.slice(API_PREFIX.length))
      if (match === null) throw new Error('not found')
      terminalSessions.upgrade(request, socket, head, match[1])
    } catch (error) {
      void logs.diagnostic('platform-management', 'management.terminal-upgrade.failed', {
        error,
        level: error?.statusCode === 404 ? 'warning' : 'error',
        pathname,
      })
      if (!socket.destroyed) socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
    }
  })
  if (recoverUserPluginTransaction !== undefined) server.once('listening', () => {
    userPluginTask = Promise.resolve()
      .then(() => recoverUserPluginTransaction())
      .then(async state => {
        if (state === undefined) return
        publishUserPlugin({
          status: state.phase === 'completed' ? 'success' : 'failed',
          taskId: state.taskId,
          phase: state.phase,
          error: state.error,
        })
        await audit('user-plugin.recovery.completed', {
          taskId: state.taskId,
          phase: state.phase,
          recoveryResult: state.recoveryResult,
        })
      }, async error => {
        publishUserPlugin({ status: 'failed', phase: 'recovery', error: error instanceof Error ? error.message : String(error) })
        await audit('user-plugin.recovery.failed', { error })
      })
      .finally(() => { userPluginTask = undefined })
    userPluginTask.catch(() => {})
  })
  return server
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
