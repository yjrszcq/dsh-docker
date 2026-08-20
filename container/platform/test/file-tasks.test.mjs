import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { FileInventory } from '../../control-plane/modules/file-manager/index.mjs'
import { FileTaskManager } from '../../control-plane/modules/file-manager/tasks.mjs'

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
  assert.equal(await stat(deleteSource.path).then(() => true, error => error.code !== 'ENOENT'), false)
  assert.equal((await readdir(join(files, 'copies'))).some(name => name.startsWith('.dsh-')), false)
})

test('rejects stale revisions, protected roots, recursive copies, and concurrent mutations', async () => {
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
  assert.throws(() => manager.start({ operation: 'touch', destination: join(files, 'second') }), error => error.statusCode === 409)
  await finish(manager, first)
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

test('managed mutations expose a lease and reject active platform work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-managed-tasks-'))
  const manager = new FileTaskManager({ root: join(root, 'tasks'), platformBusy: () => true })
  await manager.initialize()
  assert.equal(manager.wouldManage({ operation: 'touch', destination: '/data/platform/state/test' }), true)
  assert.throws(() => manager.start({ operation: 'touch', destination: '/data/platform/state/test' }), error => error.statusCode === 409)
})
