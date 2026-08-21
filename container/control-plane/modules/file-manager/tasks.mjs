import { randomUUID } from 'node:crypto'
import { chmod, cp, lchown, lstat, mkdir, open, readdir, readFile, readlink, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { durableReplace } from '../../../platform/lib/atomic.mjs'
import { createArchive, extractArchive, normalizeArchiveFormat } from './archives.mjs'
import {
  FileInventory, FileManagerError, FileRevisionConflictError, FileSearchManager, FileSizeManager, UnixIdentityResolver,
  fileError, isManagedPath, normalizeAbsolutePath,
} from './index.mjs'

const OPERATIONS = new Set(['mkdir', 'touch', 'rename', 'copy', 'move', 'delete', 'attributes', 'archive', 'extract'])
const DEFAULT_PROTECTED_DELETE_ROOTS = ['/', '/data', '/data/dsh', '/data/platform', '/workspace', '/run/dsh-platform/deployment']

function now() { return new Date().toISOString() }

async function exists(path) {
  return lstat(path).then(() => true, error => error?.code === 'ENOENT' ? false : Promise.reject(error))
}

async function syncDirectory(path) {
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

function publicTask(task) {
  const { completion, persisted, executor, resolveResult, rejectResult, cancelRequested, abortController, ...value } = task
  return { ...value, cancelRequested: cancelRequested === true }
}

function cleanName(path) {
  const name = basename(path)
  if (name === '' || name === '.' || name === '..') throw new FileManagerError('destination name is invalid')
  return name
}

function renamedPath(path, index) {
  const dot = basename(path).lastIndexOf('.')
  const directory = dirname(path)
  const name = basename(path)
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  return join(directory, `${stem} (${String(index)})${extension}`)
}

async function uniqueDestination(path, conflict) {
  if (!await exists(path)) return path
  if (conflict === 'reject') throw new FileManagerError('destination already exists', 409, 'FILE_EXISTS')
  if (conflict === 'overwrite') return path
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = renamedPath(path, index)
    if (!await exists(candidate)) return candidate
  }
  throw new FileManagerError('could not choose a unique destination', 409, 'FILE_EXISTS')
}

async function copyEntry(source, staging) {
  const sourceStats = await lstat(source)
  if (sourceStats.isDirectory()) {
    await cp(source, staging, { recursive: true, dereference: false, errorOnExist: true, force: false, preserveTimestamps: true })
  } else if (sourceStats.isSymbolicLink()) {
    const target = await readlink(source)
    await import('node:fs/promises').then(fs => fs.symlink(target, staging))
  } else if (sourceStats.isFile()) {
    await cp(source, staging, { dereference: false, errorOnExist: true, force: false, preserveTimestamps: true })
  } else throw new FileManagerError('special files cannot be copied', 415, 'FILE_TYPE_UNSUPPORTED')
}

async function treeMetrics(path) {
  const value = await lstat(path)
  if (!value.isDirectory() || value.isSymbolicLink()) return { entries: 1, bytes: value.isFile() ? value.size : 0 }
  let entries = 1
  let bytes = 0
  for (const name of await readdir(path)) {
    const child = await treeMetrics(join(path, name))
    entries += child.entries
    bytes += child.bytes
  }
  return { entries, bytes }
}

function normalizeAttributes(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['user', 'group', 'mode', 'recursive'].includes(key))
    || typeof value.user !== 'string' || typeof value.group !== 'string'
    || typeof value.mode !== 'string' || !/^[0-7]{3,4}$/u.test(value.mode)
    || typeof value.recursive !== 'boolean') throw new FileManagerError('file attributes are invalid')
  return { user: value.user, group: value.group, mode: value.mode, recursive: value.recursive }
}

function assertAttributesApplied(path, details, { uid, gid, mode }, symbolicLink) {
  const ownershipMatches = details.uid === uid && details.gid === gid
  const modeMatches = symbolicLink || (details.mode & 0o7777) === mode
  if (ownershipMatches && modeMatches) return
  throw new FileManagerError(
    `filesystem did not apply Unix ownership or mode for ${path}; use a filesystem mounted with Unix metadata support`,
    403,
    'FILE_ATTRIBUTES_UNSUPPORTED',
  )
}

export class FileTaskManager {
  constructor({
    root, inventory = new FileInventory(), isManaged = isManagedPath,
    protectedRoots = DEFAULT_PROTECTED_DELETE_ROOTS,
    onState = () => {}, platformBusy = () => false, report = async () => {}, identity,
  } = {}) {
    if (typeof root !== 'string') throw new Error('file task root is required')
    this.root = root
    this.inventory = inventory
    this.isManaged = isManaged
    this.protectedRoots = new Set(protectedRoots.map(normalizeAbsolutePath))
    this.onState = onState
    this.platformBusy = platformBusy
    this.report = report
    this.identity = identity ?? inventory.identity ?? new UnixIdentityResolver()
    this.tasks = new Map()
    this.activeMutation = undefined
    this.queue = []
    this.queueTail = Promise.resolve()
    this.search = new FileSearchManager({ inventory, onState: state => onState(state) })
    this.sizes = new FileSizeManager({ inventory, onState: state => onState(state) })
  }

  get hasManagedMutation() { return this.queue.some(task => ['queued', 'running'].includes(task.status) && task.managed === true) }

  wouldManage(input) {
    if (['search', 'size'].includes(input?.operation)) return false
    const sourceManaged = Array.isArray(input?.sources) && input.sources.some(source => typeof source?.path === 'string' && this.isManaged(source.path))
    return sourceManaged || (typeof input?.destination === 'string' && this.isManaged(input.destination))
  }

  async initialize() {
    await mkdir(this.root, { recursive: true })
    const files = (await readdir(this.root)).filter(name => name.endsWith('.json')).sort()
    for (const name of files) {
      try {
        const task = JSON.parse(await readFile(join(this.root, name), 'utf8'))
        if (task.schema !== 1 || typeof task.taskId !== 'string') continue
        this.tasks.set(task.taskId, task)
        if (task.status === 'running') await this.#recover(task)
        else if (task.status === 'queued' && ['upload', 'download'].includes(task.operation)) {
          task.status = 'running'
          await this.#recover(task)
        } else if (task.status === 'queued') this.#schedule(task)
      } catch (error) {
        this.onState({ operation: 'recovery', status: 'failed', error: error instanceof Error ? error.message : String(error) })
      }
    }
    await this.#prune()
  }

  start(input) {
    if (input?.operation === 'search') return this.search.start(input)
    if (input?.operation === 'size') return this.sizes.start(input)
    if (input === null || typeof input !== 'object' || !OPERATIONS.has(input.operation)) throw new FileManagerError('file task operation is invalid')
    const sources = Array.isArray(input.sources) ? input.sources.map(source => ({ path: normalizeAbsolutePath(source.path), revision: source.revision })) : []
    const destination = input.destination === undefined ? null : normalizeAbsolutePath(input.destination)
    const conflict = input.conflict ?? 'reject'
    if (!['reject', 'overwrite', 'rename'].includes(conflict)) throw new FileManagerError('file task conflict mode is invalid')
    if (['copy', 'move', 'delete', 'rename', 'archive', 'extract'].includes(input.operation) && sources.length === 0) throw new FileManagerError('file task sources are required')
    if (input.operation === 'extract' && sources.length !== 1) throw new FileManagerError('archive extraction requires one source')
    if (input.operation === 'attributes' && sources.length !== 1) throw new FileManagerError('attribute changes require one source')
    if (['mkdir', 'touch', 'copy', 'move', 'rename', 'archive', 'extract'].includes(input.operation) && destination === null) throw new FileManagerError('file task destination is required')
    if (input.operation === 'delete' && sources.some(source => this.protectedRoots.has(source.path))) throw new FileManagerError('protected root cannot be deleted', 403, 'PROTECTED_ROOT')
    const managed = sources.some(source => this.isManaged(source.path)) || (destination !== null && this.isManaged(destination))
    if (managed && this.platformBusy()) throw new FileManagerError('a platform operation is already running', 409, 'FILE_TASK_CONFLICT')
    const task = {
      schema: 1, taskId: randomUUID(), operation: input.operation,
      status: this.queue.length === 0 ? 'running' : 'queued', phase: this.queue.length === 0 ? 'validating' : 'queued',
      sources, destination, destinationRevision: input.destinationRevision ?? null, conflict, managed,
      attributes: input.operation === 'attributes' ? normalizeAttributes(input.attributes) : null,
      archiveFormat: ['archive', 'extract'].includes(input.operation) ? normalizeArchiveFormat(input.archiveFormat) : null,
      processedBytes: 0, totalBytes: 0, processedEntries: 0, totalEntries: 0, currentPath: null,
      published: [], staging: [], hidden: [], currentSource: null, currentDestination: null,
      error: null, errorCode: null, queuePosition: null, createdAt: now(), updatedAt: now(), cancelRequested: false,
    }
    this.tasks.set(task.taskId, task)
    this.#schedule(task)
    return publicTask(task)
  }

  startTransfer({ operation, path, totalBytes = null, managed = false }, executor) {
    if (!['upload', 'download'].includes(operation) || typeof executor !== 'function') {
      throw new FileManagerError('file transfer task is invalid')
    }
    const normalizedPath = normalizeAbsolutePath(path)
    if (managed && this.platformBusy()) throw new FileManagerError('a platform operation is already running', 409, 'FILE_TASK_CONFLICT')
    let resolveResult
    let rejectResult
    const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
    const task = {
      schema: 1, taskId: randomUUID(), operation,
      status: this.queue.length === 0 ? 'running' : 'queued', phase: this.queue.length === 0 ? 'transferring' : 'queued',
      path: normalizedPath, sources: [], destination: operation === 'upload' ? normalizedPath : null,
      destinationRevision: null, conflict: null, managed, attributes: null, archiveFormat: null,
      processedBytes: 0, totalBytes, processedEntries: 0, totalEntries: 1, currentPath: normalizedPath,
      published: [], staging: [], hidden: [], currentSource: null, currentDestination: null,
      error: null, errorCode: null, queuePosition: null, createdAt: now(), updatedAt: now(), cancelRequested: false,
      executor, resolveResult, rejectResult,
    }
    this.tasks.set(task.taskId, task)
    this.#schedule(task)
    return { task: publicTask(task), result }
  }

  list() {
    return [...this.search.list(), ...this.sizes.list(), ...[...this.tasks.values()].map(publicTask)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100)
  }

  get(taskId, options = {}) {
    if (this.tasks.has(taskId)) return publicTask(this.tasks.get(taskId))
    try { return this.search.get(taskId, options) } catch (error) {
      if (error?.statusCode !== 404) throw error
      return this.sizes.get(taskId)
    }
  }

  completion(taskId) {
    const task = this.tasks.get(taskId) ?? this.search.tasks.get(taskId) ?? this.sizes.tasks.get(taskId)
    if (task === undefined) throw new FileManagerError('file task was not found', 404, 'FILE_TASK_NOT_FOUND')
    return Promise.resolve(task.completion).then(() => this.get(taskId))
  }

  cancel(taskId) {
    const task = this.tasks.get(taskId)
    if (task === undefined) {
      try { return this.search.cancel(taskId) } catch (error) {
        if (error?.statusCode !== 404) throw error
        return this.sizes.cancel(taskId)
      }
    }
    if (!['queued', 'running'].includes(task.status)) throw new FileManagerError('file task is already complete', 409, 'FILE_TASK_COMPLETE')
    if (task.status === 'queued') {
      task.cancelRequested = true
      task.status = 'cancelled'
      task.phase = 'cancelled'
      task.updatedAt = now()
      this.queue = this.queue.filter(value => value !== task)
      void Promise.resolve(task.persisted).then(() => this.#terminal(task, 'cancelled', 'cancelled'))
      task.rejectResult?.(Object.assign(new Error('file transfer cancelled'), { code: 'FILE_TASK_CANCELLED' }))
      this.#publishQueue()
      return publicTask(task)
    }
    if (['destination-committed', 'source-hidden', 'cleaning'].includes(task.phase)) throw new FileManagerError('file task passed its cancellation boundary', 409, 'FILE_TASK_COMMITTED')
    task.cancelRequested = true
    task.abortController?.abort()
    this.#publish(task)
    return publicTask(task)
  }

  #schedule(task) {
    this.queue.push(task)
    this.#publishQueue()
    const previous = this.queueTail
    task.persisted = this.#persist(task)
    task.completion = Promise.all([previous.catch(() => {}), task.persisted]).then(async () => {
      if (task.cancelRequested || task.status === 'cancelled') return
      task.status = 'running'
      task.phase = 'validating'
      task.queuePosition = 0
      this.activeMutation = task
      await this.#phase(task, task.executor === undefined ? 'validating' : 'transferring')
      if (task.executor === undefined) await this.#run(task).catch(() => {})
      else await this.#runTransfer(task)
    }).finally(() => {
      if (this.activeMutation === task) this.activeMutation = undefined
      this.queue = this.queue.filter(value => value !== task)
      this.#publishQueue()
    })
    this.queueTail = task.completion
  }

  async #runTransfer(task) {
    const controller = new AbortController()
    task.abortController = controller
    const controls = {
      signal: controller.signal,
      progress: ({ processedBytes, totalBytes, currentPath } = {}) => {
        if (Number.isSafeInteger(processedBytes) && processedBytes >= 0) task.processedBytes = processedBytes
        if (Number.isSafeInteger(totalBytes) && totalBytes >= 0) task.totalBytes = totalBytes
        if (typeof currentPath === 'string') task.currentPath = currentPath
        task.updatedAt = now()
        this.#publish(task)
      },
    }
    try {
      const result = await task.executor(controls)
      task.processedEntries = 1
      if (task.totalBytes !== null) task.processedBytes = task.totalBytes
      await this.#terminal(task, 'success', 'completed')
      await this.report(`file-task.${task.operation}.completed`, publicTask(task))
      task.resolveResult(result)
    } catch (error) {
      const status = task.cancelRequested ? 'cancelled' : 'failed'
      task.error = error instanceof Error ? error.message : String(error)
      task.errorCode = typeof error?.code === 'string' ? error.code : null
      await this.#terminal(task, status, status)
      await this.report(`file-task.${task.operation}.${status}`, { ...publicTask(task), error })
      task.rejectResult(error)
    } finally {
      task.abortController = undefined
      await this.#prune()
    }
  }

  #publishQueue() {
    let position = 0
    for (const task of this.queue) {
      if (task.status === 'queued') position += 1
      task.queuePosition = task.status === 'queued' ? position : 0
      this.#publish(task)
    }
  }

  async #validate(task) {
    for (const source of task.sources) {
      const item = await this.inventory.stat(source.path)
      if (source.revision !== item.revision) throw new FileRevisionConflictError(`source changed: ${source.path}`)
      if (task.operation === 'attributes' && !['file', 'directory'].includes(item.type)) {
        throw new FileManagerError('attributes can be changed only for files and directories', 415, 'FILE_TYPE_UNSUPPORTED')
      }
      const metrics = task.operation === 'attributes' && task.attributes.recursive === false
        ? { entries: 1, bytes: item.type === 'file' ? item.size : 0 }
        : await treeMetrics(source.path)
      task.totalEntries += metrics.entries
      task.totalBytes += metrics.bytes
    }
    if (task.destinationRevision !== null) {
      const destinationRoot = task.operation === 'rename' || task.operation === 'mkdir' || task.operation === 'touch'
        ? dirname(task.destination) : task.destination
      const listed = await this.inventory.list(destinationRoot, { limit: 1 })
      if (listed.revision !== task.destinationRevision) throw new FileRevisionConflictError('destination directory changed')
    }
  }

  async #run(task) {
    try {
      await this.#validate(task)
      await this.#phase(task, 'mutating')
      if (task.operation === 'mkdir') await mkdir(task.destination)
      else if (task.operation === 'touch') {
        const handle = await open(task.destination, 'wx', 0o644)
        await handle.sync(); await handle.close(); await syncDirectory(dirname(task.destination))
      } else if (task.operation === 'rename') await this.#rename(task)
      else if (task.operation === 'copy') await this.#copy(task, false)
      else if (task.operation === 'move') await this.#copy(task, true)
      else if (task.operation === 'delete') await this.#delete(task)
      else if (task.operation === 'attributes') await this.#attributes(task)
      else if (task.operation === 'archive') await this.#archive(task)
      else if (task.operation === 'extract') await this.#extract(task)
      await this.#terminal(task, 'success', 'completed')
      await this.report(`file-task.${task.operation}.completed`, publicTask(task))
    } catch (error) {
      const status = task.cancelRequested ? 'cancelled' : 'failed'
      task.error = error instanceof Error ? error.message : String(error)
      task.errorCode = typeof error?.code === 'string' ? error.code : null
      await this.#cleanupStaging(task)
      await this.#terminal(task, status, status)
      await this.report(`file-task.${task.operation}.${status}`, { ...publicTask(task), error })
      throw error
    } finally {
      await this.#prune()
    }
  }

  async #rename(task) {
    if (task.sources.length !== 1) throw new FileManagerError('rename requires one source')
    const source = task.sources[0].path
    if (dirname(source) !== dirname(task.destination)) throw new FileManagerError('rename destination must use the same directory')
    const destination = await uniqueDestination(task.destination, task.conflict)
    task.currentSource = source
    task.currentDestination = destination
    await this.#phase(task, 'move-prepared')
    if (task.conflict === 'overwrite' && await exists(destination)) await rm(destination, { recursive: true })
    await rename(source, destination)
    task.published.push(destination)
    await this.#phase(task, 'destination-committed')
    await syncDirectory(dirname(destination))
    task.currentSource = null
    task.currentDestination = null
    await this.#phase(task, 'mutating')
  }

  async #copy(task, move) {
    for (const source of task.sources) {
      if (task.cancelRequested) throw new Error('file task cancelled')
      const destination = await uniqueDestination(join(task.destination, cleanName(source.path)), task.conflict)
      if (source.path === destination || destination.startsWith(`${source.path}/`)) throw new FileManagerError('directory cannot be copied into itself')
      if (move) {
        task.currentSource = source.path
        task.currentDestination = destination
        await this.#phase(task, 'move-prepared')
        try {
          if (task.conflict === 'overwrite' && await exists(destination)) await rm(destination, { recursive: true })
          await rename(source.path, destination)
          task.published.push(destination)
          await this.#phase(task, 'destination-committed')
          task.processedEntries += 1
          task.currentSource = null
          task.currentDestination = null
          await this.#phase(task, 'mutating')
          continue
        } catch (error) {
          if (error?.code !== 'EXDEV') throw error
        }
      }
      const staging = join(dirname(destination), `.dsh-file-task-${task.taskId}-${randomUUID()}.tmp`)
      task.staging.push(staging)
      task.currentPath = source.path
      task.currentSource = source.path
      task.currentDestination = destination
      await this.#persist(task)
      await copyEntry(source.path, staging)
      if (task.cancelRequested) throw new Error('file task cancelled')
      if (task.conflict === 'overwrite' && await exists(destination)) await rm(destination, { recursive: true })
      await rename(staging, destination)
      task.staging = task.staging.filter(path => path !== staging)
      task.published.push(destination)
      await this.#phase(task, move ? 'destination-committed' : 'mutating')
      if (move) await rm(source.path, { recursive: true })
      task.processedEntries += 1
      task.processedBytes = Math.min(task.totalBytes, task.processedBytes + (await treeMetrics(destination)).bytes)
      task.currentSource = null
      task.currentDestination = null
      await this.#phase(task, 'mutating')
    }
  }

  async #delete(task) {
    for (const source of task.sources) {
      if (task.cancelRequested) throw new Error('file task cancelled')
      const hidden = join(dirname(source.path), `.dsh-delete-${task.taskId}-${randomUUID()}.tmp`)
      await rename(source.path, hidden)
      task.hidden.push(hidden)
      await this.#phase(task, 'source-hidden')
      await rm(hidden, { recursive: true })
      task.hidden = task.hidden.filter(path => path !== hidden)
      task.processedEntries += 1
      await this.#phase(task, 'cleaning')
    }
  }

  async #attributes(task) {
    const [uid, gid] = await Promise.all([
      this.identity.userId(task.attributes.user),
      this.identity.groupId(task.attributes.group),
    ])
    const mode = Number.parseInt(task.attributes.mode, 8)
    const pending = [task.sources[0].path]
    task.resolvedAttributes = { uid, gid, mode }
    while (pending.length > 0) {
      if (task.cancelRequested) throw new Error('file task cancelled')
      const path = pending.pop()
      const details = await lstat(path)
      if (task.attributes.recursive && details.isDirectory() && !details.isSymbolicLink()) {
        for (const name of await readdir(path)) pending.push(join(path, name))
      }
      await lchown(path, uid, gid)
      if (!details.isSymbolicLink()) await chmod(path, mode)
      assertAttributesApplied(path, await lstat(path), { uid, gid, mode }, details.isSymbolicLink())
      task.currentPath = path
      task.processedEntries += 1
      if (details.isFile()) task.processedBytes += details.size
      if (task.processedEntries % 100 === 0) await this.#phase(task, 'mutating')
    }
    task.currentPath = null
  }

  async #archive(task) {
    const output = await uniqueDestination(task.destination, task.conflict)
    const sourceRoot = join(dirname(output), `.dsh-archive-input-${task.taskId}`)
    const staging = join(dirname(output), `.dsh-archive-${task.taskId}.tmp`)
    task.staging.push(sourceRoot, staging)
    await mkdir(sourceRoot)
    const names = new Set()
    for (const source of task.sources) {
      const name = cleanName(source.path)
      if (names.has(name)) throw new FileManagerError('archive source names must be unique', 409, 'FILE_EXISTS')
      names.add(name)
      task.currentPath = source.path
      await copyEntry(source.path, join(sourceRoot, name))
      task.processedEntries += 1
      await this.#phase(task, 'staging')
    }
    if (task.cancelRequested) throw new Error('file task cancelled')
    const controller = new AbortController()
    task.abortController = controller
    try {
      await createArchive({ format: task.archiveFormat, sourceRoot, output: staging, signal: controller.signal })
    } finally {
      task.abortController = undefined
    }
    if (task.cancelRequested) throw new Error('file task cancelled')
    if (task.conflict === 'overwrite' && await exists(output)) await rm(output, { recursive: true })
    await rename(staging, output)
    task.staging = task.staging.filter(path => path !== staging)
    task.published.push(output)
    task.processedBytes = task.totalBytes
    await rm(sourceRoot, { recursive: true, force: true })
    task.staging = task.staging.filter(path => path !== sourceRoot)
    task.currentPath = null
    await this.#phase(task, 'destination-committed')
  }

  async #extract(task) {
    const archive = task.sources[0].path
    const staging = join(task.destination, `.dsh-extract-${task.taskId}.tmp`)
    task.staging.push(staging)
    task.currentPath = archive
    await this.#persist(task)
    const controller = new AbortController()
    task.abortController = controller
    let metrics
    try {
      metrics = await extractArchive({ format: task.archiveFormat, archive, output: staging, signal: controller.signal })
    } finally {
      task.abortController = undefined
    }
    task.totalEntries = metrics.entries
    task.totalBytes = metrics.bytes
    await this.#publishExtraction(task, staging)
  }

  async #publishExtraction(task, staging) {
    const plan = []
    for (const name of await readdir(staging)) {
      plan.push({ source: join(staging, name), destination: await uniqueDestination(join(task.destination, name), task.conflict) })
    }
    for (const { source, destination } of plan) {
      if (task.cancelRequested) throw new Error('file task cancelled')
      if (task.conflict === 'overwrite' && await exists(destination)) await rm(destination, { recursive: true })
      await rename(source, destination)
      task.published.push(destination)
      const item = await treeMetrics(destination)
      task.processedEntries += item.entries
      task.processedBytes += item.bytes
      await this.#phase(task, 'publishing')
    }
    await rm(staging, { recursive: true, force: true })
    task.staging = task.staging.filter(path => path !== staging)
    task.currentPath = null
  }

  async #cleanupStaging(task) {
    for (const path of task.staging) await rm(path, { recursive: true, force: true }).catch(() => {})
    task.staging = []
  }

  async #recover(task) {
    if (task.operation === 'attributes') {
      try {
        task.cancelRequested = false
        task.processedEntries = 0
        task.processedBytes = 0
        await this.#phase(task, 'mutating')
        await this.#attributes(task)
        task.status = 'success'
        await this.#phase(task, 'completed')
        await this.report('file-task.attributes.recovered', publicTask(task))
      } catch (error) {
        task.status = 'failed'
        task.error = error instanceof Error ? error.message : String(error)
        task.errorCode = typeof error?.code === 'string' ? error.code : null
        await this.#phase(task, 'failed')
        await this.report('file-task.attributes.recovery-failed', { ...publicTask(task), error })
      }
    } else if (task.operation === 'archive' && task.phase === 'destination-committed') {
      task.status = 'success'
      await this.#phase(task, 'completed')
    } else if (task.operation === 'extract' && task.phase === 'publishing' && task.staging?.length === 1 && await exists(task.staging[0])) {
      try {
        task.cancelRequested = false
        await this.#publishExtraction(task, task.staging[0])
        task.status = 'success'
        await this.#phase(task, 'completed')
        await this.report('file-task.extract.recovered', publicTask(task))
      } catch (error) {
        task.status = 'failed'
        task.error = error instanceof Error ? error.message : String(error)
        task.errorCode = typeof error?.code === 'string' ? error.code : null
        await this.#phase(task, 'failed')
        await this.report('file-task.extract.recovery-failed', { ...publicTask(task), error })
      }
    } else if (task.operation === 'delete' || task.phase === 'source-hidden' || task.phase === 'cleaning') {
      for (const path of task.hidden ?? []) await rm(path, { recursive: true, force: true })
      task.hidden = []
      task.status = 'success'
      await this.#phase(task, 'completed')
    } else if (['move', 'rename'].includes(task.operation) && task.phase === 'destination-committed') {
      if (task.currentSource !== null && await exists(task.currentSource)) await rm(task.currentSource, { recursive: true })
      task.status = 'success'
      await this.#phase(task, 'completed')
    } else if (['move', 'rename'].includes(task.operation) && task.phase === 'move-prepared'
      && task.currentSource !== null && task.currentDestination !== null
      && !await exists(task.currentSource) && await exists(task.currentDestination)) {
      task.published ??= []
      if (!task.published.includes(task.currentDestination)) task.published.push(task.currentDestination)
      task.status = 'success'
      await this.#phase(task, 'completed')
    } else {
      await this.#cleanupStaging(task)
      task.status = 'interrupted'
      task.error = 'file operation was interrupted before a recoverable commit'
      await this.#phase(task, 'interrupted')
    }
  }

  async #phase(task, phase) {
    task.phase = phase
    task.updatedAt = now()
    await this.#persist(task)
    this.#publish(task)
  }

  async #terminal(task, status, phase) {
    task.status = status
    task.phase = phase
    task.updatedAt = now()
    await this.#persist(task)
    if (this.activeMutation === task) this.activeMutation = undefined
    this.#publish(task)
  }

  async #persist(task) {
    await mkdir(this.root, { recursive: true })
    const value = publicTask(task)
    await durableReplace(join(this.root, `${task.taskId}.json`), Buffer.from(`${JSON.stringify(value)}\n`))
  }

  #publish(task) { this.onState(publicTask(task)) }

  async #prune() {
    const completed = [...this.tasks.values()].filter(task => !['queued', 'running'].includes(task.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    for (const task of completed.slice(100)) {
      this.tasks.delete(task.taskId)
      await rm(join(this.root, `${task.taskId}.json`), { force: true })
    }
  }
}

export const fileTaskInternals = Object.freeze({ protectedDeleteRoots: DEFAULT_PROTECTED_DELETE_ROOTS, uniqueDestination, treeMetrics, normalizeAttributes, assertAttributesApplied })
