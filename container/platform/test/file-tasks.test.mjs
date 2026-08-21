import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { FileInventory } from '../../control-plane/modules/file-manager/index.mjs'
import { FileTaskManager, fileTaskInternals } from '../../control-plane/modules/file-manager/tasks.mjs'

async function setup(prefix = 'dsh-file-tasks-') {
  const root = await mkdtemp(join(tmpdir(), prefix))
  const files = join(root, 'files')
  const tasks = join(root, 'tasks')
  await mkdir(files)
  const manager = new FileTaskManager({ root: tasks })
  await manager.initialize()
  return { root, files, tasks, manager, inventory: new FileInventory() }
}

async function finish(manager, task) {
  await manager.tasks.get(task.taskId).completion
  return manager.get(task.taskId)
}

test('runs mkdir, touch, rename, copy, move, and permanent delete tasks', async () => {
  const { files, manager, inventory } = await setup()
  assert.equal((await finish(manager, manager.start({ operation: 'mkdir', destination: join(files, 'dir') }))).status, 'success')
  assert.equal((await stat(join(files, 'dir'))).isDirectory(), true)
  assert.equal((await finish(manager, manager.start({ operation: 'touch', destination: join(files, 'empty') }))).status, 'success')
  const empty = await inventory.stat(join(files, 'empty'))
  const renamed = await finish(manager, manager.start({
    operation: 'rename', sources: [{ path: empty.path, revision: empty.revision }], destination: join(files, 'renamed'),
  }))
  assert.equal(renamed.status, 'success')
  await writeFile(join(files, 'dir', 'nested.txt'), 'nested')
  await symlink('nested.txt', join(files, 'dir', 'link'))
  await mkdir(join(files, 'copies'))
  const source = await inventory.stat(join(files, 'dir'))
  const copied = await finish(manager, manager.start({
    operation: 'copy', sources: [{ path: source.path, revision: source.revision }], destination: join(files, 'copies'), conflict: 'reject',
  }))
  assert.equal(copied.status, 'success')
  assert.equal(await readFile(join(files, 'copies', 'dir', 'nested.txt'), 'utf8'), 'nested')
  const link = await inventory.stat(join(files, 'copies', 'dir', 'link'))
  assert.equal(link.type, 'symlink')
  const movedSource = await inventory.stat(join(files, 'renamed'))
  const moved = await finish(manager, manager.start({
    operation: 'move', sources: [{ path: movedSource.path, revision: movedSource.revision }], destination: join(files, 'copies'),
  }))
  assert.equal(moved.status, 'success')
  const deleteSource = await inventory.stat(join(files, 'copies', 'dir'))
  const removed = await finish(manager, manager.start({ operation: 'delete', sources: [{ path: deleteSource.path, revision: deleteSource.revision }] }))
  assert.equal(removed.status, 'success')
  assert.equal(removed.processedBytes, removed.totalBytes)
  assert.equal(removed.processedEntries, removed.totalEntries)
  assert.equal(await stat(deleteSource.path).then(() => true, error => error.code !== 'ENOENT'), false)
  assert.equal((await readdir(join(files, 'copies'))).some(name => name.startsWith('.dsh-')), false)
})

test('releases the mutation lease before publishing a terminal task state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-terminal-lease-'))
  const files = join(root, 'files')
  const tasks = join(root, 'tasks')
  const destination = join(files, 'destination')
  await mkdir(destination, { recursive: true })
  await writeFile(join(files, 'item.txt'), 'source')
  await writeFile(join(destination, 'item.txt'), 'existing')
  let releaseReport
  const blockedReport = new Promise(resolve => { releaseReport = resolve })
  let observeFailure
  const failurePublished = new Promise(resolve => { observeFailure = resolve })
  const inventory = new FileInventory()
  const manager = new FileTaskManager({
    root: tasks,
    onState: task => { if (task.status === 'failed') observeFailure() },
    report: message => message === 'file-task.copy.failed' ? blockedReport : undefined,
  })
  await manager.initialize()
  const source = await inventory.stat(join(files, 'item.txt'))
  const rejected = manager.start({
    operation: 'copy', sources: [{ path: source.path, revision: source.revision }], destination, conflict: 'reject',
  })
  await failurePublished
  assert.equal(manager.activeMutation, undefined)
  manager.activeMutation = manager.tasks.get(rejected.taskId)
  const renamed = manager.start({
    operation: 'copy', sources: [{ path: source.path, revision: source.revision }], destination, conflict: 'rename',
  })
  releaseReport()
  assert.equal((await finish(manager, renamed)).status, 'success')
  assert.equal((await finish(manager, rejected)).status, 'failed')
  assert.equal((await readdir(destination)).length, 2)
})

test('changes file ownership and permissions recursively without following symbolic links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-attributes-'))
  const files = join(root, 'files')
  const tasks = join(root, 'tasks')
  const tree = join(files, 'tree')
  const nested = join(tree, 'nested')
  const target = join(root, 'outside.txt')
  await mkdir(nested, { recursive: true })
  await writeFile(join(nested, 'inside.txt'), 'inside')
  await writeFile(target, 'outside')
  await chmod(target, 0o640)
  await symlink(target, join(tree, 'outside-link'))
  const identity = {
    resolve: async () => ({ user: 'current', group: 'current' }),
    userId: async value => value === 'current' ? process.getuid() : Promise.reject(new Error('unknown user')),
    groupId: async value => value === 'current' ? process.getgid() : Promise.reject(new Error('unknown group')),
  }
  const inventory = new FileInventory({ identity })
  const reports = []
  const manager = new FileTaskManager({ root: tasks, inventory, identity, report: (message, fields) => reports.push({ message, fields }) })
  await manager.initialize()
  const source = await inventory.stat(tree)
  const started = manager.start({
    operation: 'attributes',
    sources: [{ path: tree, revision: source.revision }],
    attributes: { user: 'current', group: 'current', mode: '0750', recursive: true },
  })
  const result = await manager.completion(started.taskId)
  assert.equal(result.status, 'success')
  assert.equal(result.errorCode, null)
  assert.equal(result.processedEntries, 4)
  assert.equal((await stat(tree)).mode & 0o7777, 0o750)
  assert.equal((await stat(nested)).mode & 0o7777, 0o750)
  assert.equal((await stat(join(nested, 'inside.txt'))).mode & 0o7777, 0o750)
  assert.equal((await stat(target)).mode & 0o7777, 0o640)
  assert.equal(reports.at(-1).message, 'file-task.attributes.completed')
})

test('rejects filesystems that silently ignore Unix ownership or mode changes', () => {
  const attributes = { uid: 0, gid: 0, mode: 0o600 }
  assert.doesNotThrow(() => fileTaskInternals.assertAttributesApplied('/supported', { uid: 0, gid: 0, mode: 0o100600 }, attributes, false))
  assert.throws(
    () => fileTaskInternals.assertAttributesApplied('/unsupported', { uid: 1000, gid: 1000, mode: 0o100755 }, attributes, false),
    error => error.code === 'FILE_ATTRIBUTES_UNSUPPORTED' && error.statusCode === 403,
  )
})

test('reports attribute failures instead of a false completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-attributes-failed-log-'))
  const path = join(root, 'item')
  await writeFile(path, 'value')
  const identity = {
    resolve: async () => ({ user: 'current', group: 'current' }),
    userId: async () => { throw Object.assign(new Error('ownership is unsupported'), { code: 'FILE_ATTRIBUTES_UNSUPPORTED' }) },
    groupId: async () => process.getgid(),
  }
  const inventory = new FileInventory({ identity })
  const reports = []
  const manager = new FileTaskManager({ root: join(root, 'tasks'), inventory, identity, report: message => reports.push(message) })
  await manager.initialize()
  const source = await inventory.stat(path)
  const started = manager.start({
    operation: 'attributes', sources: [{ path, revision: source.revision }],
    attributes: { user: 'current', group: 'current', mode: '0600', recursive: false },
  })
  const result = await manager.completion(started.taskId)
  assert.equal(result.status, 'failed')
  assert.equal(result.errorCode, 'FILE_ATTRIBUTES_UNSUPPORTED')
  assert.deepEqual(reports, ['file-task.attributes.failed'])
})

test('validates attribute requests and resumes an interrupted idempotent change', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-attributes-recovery-'))
  const files = join(root, 'files')
  const tasks = join(root, 'tasks')
  await mkdir(files)
  await mkdir(tasks)
  const path = join(files, 'item')
  await writeFile(path, 'value')
  const identity = {
    resolve: async () => ({ user: 'current', group: 'current' }),
    userId: async () => process.getuid(),
    groupId: async () => process.getgid(),
  }
  const inventory = new FileInventory({ identity })
  const source = await inventory.stat(path)
  const manager = new FileTaskManager({ root: tasks, inventory, identity })
  assert.throws(() => manager.start({
    operation: 'attributes', sources: [{ path, revision: source.revision }],
    attributes: { user: 'current', group: 'current', mode: '888', recursive: false },
  }), /attributes/)
  const task = {
    schema: 1, taskId: '55555555-5555-4555-8555-555555555555', operation: 'attributes', status: 'running', phase: 'mutating',
    sources: [{ path, revision: source.revision }], destination: null, destinationRevision: null, conflict: 'reject', managed: false,
    attributes: { user: 'current', group: 'current', mode: '0600', recursive: false },
    processedBytes: 0, totalBytes: 5, processedEntries: 0, totalEntries: 1,
    published: [], staging: [], hidden: [], currentPath: path, currentSource: null, currentDestination: null,
    error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), cancelRequested: false,
  }
  await writeFile(join(tasks, `${task.taskId}.json`), JSON.stringify(task))
  const recovered = new FileTaskManager({ root: tasks, inventory, identity })
  await recovered.initialize()
  assert.equal(recovered.get(task.taskId).status, 'success')
  assert.equal((await stat(path)).mode & 0o7777, 0o600)
})

test('rejects stale revisions, protected roots, and recursive copies while queueing concurrent mutations', async () => {
  const { files, manager, inventory } = await setup()
  const sourcePath = join(files, 'source')
  await writeFile(sourcePath, 'one')
  const source = await inventory.stat(sourcePath)
  await writeFile(sourcePath, 'two')
  const stale = manager.start({ operation: 'delete', sources: [{ path: sourcePath, revision: source.revision }] })
  assert.equal((await finish(manager, stale)).status, 'failed')
  assert.throws(() => manager.start({ operation: 'delete', sources: [{ path: '/', revision: 'x' }] }), error => error.statusCode === 403)
  await mkdir(join(files, 'tree'))
  const tree = await inventory.stat(join(files, 'tree'))
  const recursive = manager.start({ operation: 'copy', sources: [{ path: tree.path, revision: tree.revision }], destination: tree.path })
  assert.equal((await finish(manager, recursive)).status, 'failed')
  const first = manager.start({ operation: 'touch', destination: join(files, 'first') })
  const second = manager.start({ operation: 'touch', destination: join(files, 'second') })
  assert.equal(second.status, 'queued')
  assert.equal(second.queuePosition, 1)
  await finish(manager, first)
  assert.equal((await finish(manager, second)).status, 'success')
})

test('runs queued mutations in FIFO order and cancels queued work without touching files', async () => {
  const { files, manager } = await setup('dsh-file-queue-')
  const first = manager.start({ operation: 'touch', destination: join(files, 'first') })
  const second = manager.start({ operation: 'touch', destination: join(files, 'second') })
  const third = manager.start({ operation: 'touch', destination: join(files, 'third') })
  assert.deepEqual([second.queuePosition, third.queuePosition], [1, 2])
  assert.equal(manager.cancel(second.taskId).status, 'cancelled')
  assert.equal(manager.get(third.taskId).queuePosition, 1)
  assert.equal((await finish(manager, first)).status, 'success')
  assert.equal((await finish(manager, second)).status, 'cancelled')
  assert.equal((await finish(manager, third)).status, 'success')
  assert.equal(await stat(join(files, 'second')).then(() => true, error => error.code !== 'ENOENT'), false)
})

test('persists queued work before the active task releases its lease', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-queue-persisted-'))
  const files = join(root, 'files')
  const tasks = join(root, 'tasks')
  await mkdir(files)
  let releaseReport
  const blocked = new Promise(resolve => { releaseReport = resolve })
  const manager = new FileTaskManager({ root: tasks, report: message => message === 'file-task.touch.completed' ? blocked : undefined })
  await manager.initialize()
  const first = manager.start({ operation: 'touch', destination: join(files, 'first') })
  const second = manager.start({ operation: 'touch', destination: join(files, 'second') })
  await manager.tasks.get(second.taskId).persisted
  const journal = JSON.parse(await readFile(join(tasks, `${second.taskId}.json`), 'utf8'))
  assert.equal(journal.status, 'queued')
  assert.equal(journal.queuePosition, 1)
  releaseReport()
  assert.equal((await finish(manager, first)).status, 'success')
  assert.equal((await finish(manager, second)).status, 'success')
})

test('reports real transfer progress and cancels a queued transfer', async () => {
  const { files, manager } = await setup('dsh-file-transfer-progress-')
  const transfer = manager.startTransfer({ operation: 'upload', path: join(files, 'upload.bin'), totalBytes: 10 }, async ({ progress }) => {
    progress({ processedBytes: 4, totalBytes: 10 })
    progress({ processedBytes: 10, totalBytes: 10 })
    return { size: 10 }
  })
  assert.deepEqual(await transfer.result, { size: 10 })
  await manager.completion(transfer.task.taskId)
  assert.deepEqual(
    [manager.get(transfer.task.taskId).status, manager.get(transfer.task.taskId).processedBytes],
    ['success', 10],
  )

  let release
  const blocked = new Promise(resolve => { release = resolve })
  const active = manager.startTransfer({ operation: 'download', path: join(files, 'active') }, () => blocked)
  const queued = manager.startTransfer({ operation: 'download', path: join(files, 'queued') }, async () => undefined)
  const rejection = assert.rejects(queued.result, error => error.code === 'FILE_TASK_CANCELLED')
  assert.equal(manager.cancel(queued.task.taskId).status, 'cancelled')
  await rejection
  release()
  await active.result
})

test('marks persisted transfers interrupted because HTTP streams cannot resume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-transfer-recovery-'))
  const tasks = join(root, 'tasks')
  await mkdir(tasks)
  for (const [index, status] of ['running', 'queued'].entries()) {
    const taskId = `${String(index + 8).repeat(8)}-${String(index + 8).repeat(4)}-4${String(index + 8).repeat(3)}-8${String(index + 8).repeat(3)}-${String(index + 8).repeat(12)}`
    await writeFile(join(tasks, `${taskId}.json`), JSON.stringify({
      schema: 1, taskId, operation: index === 0 ? 'upload' : 'download', status,
      phase: status === 'queued' ? 'queued' : 'transferring', path: join(root, 'value'),
      managed: false, staging: [], hidden: [], published: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }))
  }
  const recovered = new FileTaskManager({ root: tasks })
  await recovered.initialize()
  assert.equal(recovered.list().filter(task => ['upload', 'download'].includes(task.operation)).every(task => task.status === 'interrupted'), true)
})

test('recovers committed deletes and marks uncommitted tasks interrupted', async () => {
  const { files, tasks } = await setup()
  const hidden = join(files, '.dsh-delete-task.tmp')
  await writeFile(hidden, 'remove')
  const runningDelete = {
    schema: 1, taskId: '11111111-1111-4111-8111-111111111111', operation: 'delete', status: 'running', phase: 'source-hidden',
    sources: [], destination: null, managed: false, hidden: [hidden], staging: [], published: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  const staging = join(files, '.dsh-file-task.tmp')
  await writeFile(staging, 'partial')
  const runningCopy = {
    ...runningDelete, taskId: '22222222-2222-4222-8222-222222222222', operation: 'copy', phase: 'mutating', hidden: [], staging: [staging],
  }
  await writeFile(join(tasks, `${runningDelete.taskId}.json`), JSON.stringify(runningDelete))
  await writeFile(join(tasks, `${runningCopy.taskId}.json`), JSON.stringify(runningCopy))
  const recovered = new FileTaskManager({ root: tasks })
  await recovered.initialize()
  assert.equal(recovered.get(runningDelete.taskId).status, 'success')
  assert.equal(recovered.get(runningCopy.taskId).status, 'interrupted')
  assert.equal(await stat(hidden).then(() => true, error => error.code !== 'ENOENT'), false)
  assert.equal(await stat(staging).then(() => true, error => error.code !== 'ENOENT'), false)
})

test('move recovery cleans only the source bound to the committed destination', async () => {
  const { files, tasks } = await setup('dsh-file-move-recovery-')
  const committedSource = join(files, 'committed-source')
  const untouchedSource = join(files, 'untouched-source')
  const destination = join(files, 'destination')
  await writeFile(committedSource, 'old duplicate')
  await writeFile(untouchedSource, 'must remain')
  await writeFile(destination, 'committed')
  const task = {
    schema: 1, taskId: '33333333-3333-4333-8333-333333333333', operation: 'move', status: 'running', phase: 'destination-committed',
    sources: [{ path: committedSource, revision: 'old' }, { path: untouchedSource, revision: 'untouched' }],
    destination: files, currentSource: committedSource, currentDestination: destination,
    managed: false, hidden: [], staging: [], published: [destination], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  await writeFile(join(tasks, `${task.taskId}.json`), JSON.stringify(task))
  const recovered = new FileTaskManager({ root: tasks })
  await recovered.initialize()
  assert.equal(recovered.get(task.taskId).status, 'success')
  assert.equal(await stat(committedSource).then(() => true, error => error.code !== 'ENOENT'), false)
  assert.equal(await readFile(untouchedSource, 'utf8'), 'must remain')
})

test('move recovery recognizes an atomic rename completed before its journal commit', async () => {
  const { files, tasks } = await setup('dsh-file-rename-recovery-')
  const source = join(files, 'source')
  const destination = join(files, 'destination')
  await writeFile(destination, 'moved')
  const task = {
    schema: 1, taskId: '44444444-4444-4444-8444-444444444444', operation: 'move', status: 'running', phase: 'move-prepared',
    sources: [{ path: source, revision: 'old' }], destination: files,
    currentSource: source, currentDestination: destination, managed: false, hidden: [], staging: [], published: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  await writeFile(join(tasks, `${task.taskId}.json`), JSON.stringify(task))
  const recovered = new FileTaskManager({ root: tasks })
  await recovered.initialize()
  assert.equal(recovered.get(task.taskId).status, 'success')
  assert.deepEqual(recovered.get(task.taskId).published, [destination])
})

test('managed mutations expose a lease and reject active platform work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-managed-tasks-'))
  const manager = new FileTaskManager({ root: join(root, 'tasks'), platformBusy: () => true })
  await manager.initialize()
  assert.equal(manager.wouldManage({ operation: 'touch', destination: '/data/platform/state/test' }), true)
  assert.throws(() => manager.start({ operation: 'touch', destination: '/data/platform/state/test' }), error => error.statusCode === 409)

  const custom = new FileTaskManager({ root: join(root, 'custom-tasks'), protectedRoots: ['/custom/workspace'] })
  assert.throws(() => custom.start({
    operation: 'delete', sources: [{ path: '/custom/workspace', revision: 'sha256:unused' }],
  }), error => error.statusCode === 403)
})

test('creates and extracts zip, 7z, and tar.gz archives through file tasks', async () => {
  for (const [format, extension] of [['zip', 'zip'], ['7z', '7z'], ['tar.gz', 'tar.gz']]) {
    const { files, manager, inventory } = await setup(`dsh-file-archive-${format.replace('.', '-')}-`)
    const sourcePath = join(files, 'source')
    await mkdir(sourcePath)
    await writeFile(join(sourcePath, 'nested.txt'), `content-${format}`)
    const source = await inventory.stat(sourcePath)
    const archivePath = join(files, `bundle.${extension}`)
    const archived = await finish(manager, manager.start({
      operation: 'archive', archiveFormat: format,
      sources: [{ path: source.path, revision: source.revision }], destination: archivePath,
    }))
    assert.equal(archived.status, 'success')
    assert.equal((await stat(archivePath)).isFile(), true)
    const extractRoot = join(files, 'extracted')
    await mkdir(extractRoot)
    const archive = await inventory.stat(archivePath)
    const extracted = await finish(manager, manager.start({
      operation: 'extract', archiveFormat: format,
      sources: [{ path: archive.path, revision: archive.revision }], destination: extractRoot,
    }))
    assert.equal(extracted.status, 'success')
    assert.equal(await readFile(join(extractRoot, 'source', 'nested.txt'), 'utf8'), `content-${format}`)
  }
})

test('rejects invalid archive formats and escaping extracted links', async () => {
  const { files, manager, inventory } = await setup('dsh-file-archive-unsafe-')
  const sourcePath = join(files, 'source')
  await mkdir(sourcePath)
  await symlink('../../outside', join(sourcePath, 'escape'))
  const source = await inventory.stat(sourcePath)
  assert.throws(() => manager.start({
    operation: 'archive', archiveFormat: 'rar', sources: [{ path: source.path, revision: source.revision }],
    destination: join(files, 'bad.rar'),
  }), /format/)
  const archivePath = join(files, 'unsafe.tar.gz')
  assert.equal((await finish(manager, manager.start({
    operation: 'archive', archiveFormat: 'tar.gz', sources: [{ path: source.path, revision: source.revision }], destination: archivePath,
  }))).status, 'success')
  const archive = await inventory.stat(archivePath)
  const destination = join(files, 'destination')
  await mkdir(destination)
  const extracted = await finish(manager, manager.start({
    operation: 'extract', archiveFormat: 'tar.gz', sources: [{ path: archive.path, revision: archive.revision }], destination,
  }))
  assert.equal(extracted.status, 'failed')
  assert.equal(extracted.errorCode, 'ARCHIVE_UNSAFE')
})

test('recovers committed archives and resumes staged extraction publication', async () => {
  const { files, tasks } = await setup('dsh-file-archive-recovery-')
  const archivePath = join(files, 'published.zip')
  await writeFile(archivePath, 'published')
  const archiveTask = {
    schema: 1, taskId: '66666666-6666-4666-8666-666666666666', operation: 'archive', status: 'running', phase: 'destination-committed',
    sources: [], destination: archivePath, managed: false, hidden: [], staging: [], published: [archivePath],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  const destination = join(files, 'destination')
  const staging = join(destination, '.dsh-extract-recovery.tmp')
  await mkdir(staging, { recursive: true })
  await writeFile(join(staging, 'remaining.txt'), 'remaining')
  const extractTask = {
    schema: 1, taskId: '77777777-7777-4777-8777-777777777777', operation: 'extract', status: 'running', phase: 'publishing',
    sources: [], destination, conflict: 'reject', managed: false, hidden: [], staging: [staging], published: [],
    processedBytes: 0, totalBytes: 9, processedEntries: 0, totalEntries: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), cancelRequested: false,
  }
  await writeFile(join(tasks, `${archiveTask.taskId}.json`), JSON.stringify(archiveTask))
  await writeFile(join(tasks, `${extractTask.taskId}.json`), JSON.stringify(extractTask))
  const recovered = new FileTaskManager({ root: tasks })
  await recovered.initialize()
  assert.equal(recovered.get(archiveTask.taskId).status, 'success')
  assert.equal(recovered.get(extractTask.taskId).status, 'success')
  assert.equal(await readFile(join(destination, 'remaining.txt'), 'utf8'), 'remaining')
})
