import { randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, open, readdir, readFile, readlink, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { durableReplace } from '../../../platform/lib/atomic.mjs'
import {
  FileInventory, FileManagerError, FileRevisionConflictError, FileSearchManager,
  fileError, isManagedPath, normalizeAbsolutePath,
} from './index.mjs'

const OPERATIONS = new Set(['mkdir', 'touch', 'rename', 'copy', 'move', 'delete'])
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
  const { completion, cancelRequested, ...value } = task
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

export class FileTaskManager {
  constructor({
    root, inventory = new FileInventory(), isManaged = isManagedPath,
    protectedRoots = DEFAULT_PROTECTED_DELETE_ROOTS,
    onState = () => {}, platformBusy = () => false, report = async () => {},
  } = {}) {
    if (typeof root !== 'string') throw new Error('file task root is required')
    this.root = root
    this.inventory = inventory
    this.isManaged = isManaged
    this.protectedRoots = new Set(protectedRoots.map(normalizeAbsolutePath))
    this.onState = onState
    this.platformBusy = platformBusy
    this.report = report
    this.tasks = new Map()
    this.activeMutation = undefined
    this.search = new FileSearchManager({ inventory, onState: state => onState(state) })
  }

  get hasManagedMutation() { return this.activeMutation?.managed === true }

  wouldManage(input) {
    if (input?.operation === 'search') return false
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
      } catch (error) {
        this.onState({ operation: 'recovery', status: 'failed', error: error instanceof Error ? error.message : String(error) })
      }
    }
    await this.#prune()
  }

  start(input) {
    if (input?.operation === 'search') return this.search.start(input)
    if (input === null || typeof input !== 'object' || !OPERATIONS.has(input.operation)) throw new FileManagerError('file task operation is invalid')
    if (this.activeMutation !== undefined) throw new FileManagerError('a file operation is already running', 409, 'FILE_TASK_CONFLICT')
    const sources = Array.isArray(input.sources) ? input.sources.map(source => ({ path: normalizeAbsolutePath(source.path), revision: source.revision })) : []
    const destination = input.destination === undefined ? null : normalizeAbsolutePath(input.destination)
    const conflict = input.conflict ?? 'reject'
    if (!['reject', 'overwrite', 'rename'].includes(conflict)) throw new FileManagerError('file task conflict mode is invalid')
    if (['copy', 'move', 'delete', 'rename'].includes(input.operation) && sources.length === 0) throw new FileManagerError('file task sources are required')
    if (['mkdir', 'touch', 'copy', 'move', 'rename'].includes(input.operation) && destination === null) throw new FileManagerError('file task destination is required')
    if (input.operation === 'delete' && sources.some(source => this.protectedRoots.has(source.path))) throw new FileManagerError('protected root cannot be deleted', 403, 'PROTECTED_ROOT')
    const managed = sources.some(source => this.isManaged(source.path)) || (destination !== null && this.isManaged(destination))
    if (managed && this.platformBusy()) throw new FileManagerError('a platform operation is already running', 409, 'FILE_TASK_CONFLICT')
    const task = {
      schema: 1, taskId: randomUUID(), operation: input.operation, status: 'running', phase: 'validating',
      sources, destination, destinationRevision: input.destinationRevision ?? null, conflict, managed,
      processedBytes: 0, totalBytes: 0, processedEntries: 0, totalEntries: 0, currentPath: null,
      published: [], staging: [], hidden: [], currentSource: null, currentDestination: null,
      error: null, createdAt: now(), updatedAt: now(), cancelRequested: false,
    }
    this.tasks.set(task.taskId, task)
    this.activeMutation = task
    task.completion = this.#run(task).catch(() => {}).finally(() => { if (this.activeMutation === task) this.activeMutation = undefined })
    return publicTask(task)
  }

  list() {
    return [...this.search.list(), ...[...this.tasks.values()].map(publicTask)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100)
  }

  get(taskId, options = {}) {
    if (this.tasks.has(taskId)) return publicTask(this.tasks.get(taskId))
    return this.search.get(taskId, options)
  }

  cancel(taskId) {
    const task = this.tasks.get(taskId)
    if (task === undefined) return this.search.cancel(taskId)
    if (task.status !== 'running') throw new FileManagerError('file task is already complete', 409, 'FILE_TASK_COMPLETE')
    if (['destination-committed', 'source-hidden', 'cleaning'].includes(task.phase)) throw new FileManagerError('file task passed its cancellation boundary', 409, 'FILE_TASK_COMMITTED')
    task.cancelRequested = true
    this.#publish(task)
    return publicTask(task)
  }

  async #validate(task) {
    for (const source of task.sources) {
      const item = await this.inventory.stat(source.path)
      if (source.revision !== item.revision) throw new FileRevisionConflictError(`source changed: ${source.path}`)
      const metrics = await treeMetrics(source.path)
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
      task.status = 'success'
      await this.#phase(task, 'completed')
      await this.report(`file-task.${task.operation}.completed`, publicTask(task))
    } catch (error) {
      task.status = task.cancelRequested ? 'cancelled' : 'failed'
      task.error = error instanceof Error ? error.message : String(error)
      await this.#cleanupStaging(task)
      await this.#phase(task, task.status)
      await this.report(`file-task.${task.operation}.${task.status}`, { ...publicTask(task), error })
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

  async #cleanupStaging(task) {
    for (const path of task.staging) await rm(path, { recursive: true, force: true }).catch(() => {})
    task.staging = []
  }

  async #recover(task) {
    if (task.operation === 'delete' || task.phase === 'source-hidden' || task.phase === 'cleaning') {
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

  async #persist(task) {
    await mkdir(this.root, { recursive: true })
    const value = publicTask(task)
    await durableReplace(join(this.root, `${task.taskId}.json`), Buffer.from(`${JSON.stringify(value)}\n`))
  }

  #publish(task) { this.onState(publicTask(task)) }

  async #prune() {
    const completed = [...this.tasks.values()].filter(task => task.status !== 'running').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    for (const task of completed.slice(100)) {
      this.tasks.delete(task.taskId)
      await rm(join(this.root, `${task.taskId}.json`), { force: true })
    }
  }
}

export const fileTaskInternals = Object.freeze({ protectedDeleteRoots: DEFAULT_PROTECTED_DELETE_ROOTS, uniqueDestination, treeMetrics })
