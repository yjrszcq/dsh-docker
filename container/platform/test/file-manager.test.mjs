import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createManagedPathMatcher, fileManagerLocations, FileInventory, FileManagerError,
  FileRevisionConflictError, FileSearchManager, FileSizeManager, isManagedPath, normalizeAbsolutePath,
} from '../../control-plane/modules/file-manager/index.mjs'

test('normalizes absolute paths and rejects unsafe path representations', () => {
  assert.equal(normalizeAbsolutePath('/workspace/a/../b'), '/workspace/b')
  assert.throws(() => normalizeAbsolutePath('workspace'), /absolute/)
  assert.throws(() => normalizeAbsolutePath('/workspace/a\nb'), /control/)
  assert.throws(() => normalizeAbsolutePath(`/${'a'.repeat(4097)}`), /too long/)
})

test('identifies only exact platform-managed roots and descendants', () => {
  assert.equal(isManagedPath('/data/platform/state'), true)
  assert.equal(isManagedPath('/data/platform/state/updater/status.json'), true)
  assert.equal(isManagedPath('/data/platform/stateful'), false)
  assert.equal(isManagedPath('/data/dsh'), false)
  const custom = createManagedPathMatcher('/srv/platform')
  assert.equal(custom('/srv/platform/store/objects'), true)
  assert.equal(custom('/data/platform/store/objects'), false)
})

test('derives the default directory and unique shortcuts from existing environment paths', () => {
  assert.deepEqual(fileManagerLocations({
    defaultWorkspace: '/work/current', dshHome: '/srv/dsh', platformData: '/srv/platform',
  }), {
    defaultPath: '/work/current', shortcuts: ['/work/current', '/srv/dsh', '/srv/platform', '/'],
  })
  assert.deepEqual(fileManagerLocations({ defaultWorkspace: '/data/dsh' }).shortcuts, ['/data/dsh', '/data/platform', '/'])
  assert.throws(() => fileManagerLocations({ defaultWorkspace: 'relative' }), /absolute/)
})

test('lists directories with stable metadata, directory-first sorting, and revision cursors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-list-'))
  await mkdir(join(root, 'folder'))
  await writeFile(join(root, 'z.txt'), 'z')
  await writeFile(join(root, '.hidden'), 'hidden')
  await symlink('missing', join(root, 'dangling'))
  const inventory = new FileInventory()
  const first = await inventory.list(root, { limit: 2 })
  assert.equal(first.entries[0].name, 'folder')
  assert.equal(first.entries.some(entry => entry.name === '.hidden'), true)
  assert.equal(first.total, 4)
  assert.equal(typeof first.nextCursor, 'string')
  const second = await inventory.list(root, { limit: 2, cursor: first.nextCursor })
  assert.equal(second.entries.length, 2)
  const dangling = [...first.entries, ...second.entries].find(entry => entry.name === 'dangling')
  assert.deepEqual([dangling.type, dangling.targetExists], ['symlink', false])
  await writeFile(join(root, 'new.txt'), 'new')
  await assert.rejects(inventory.list(root, { cursor: first.nextCursor }), FileRevisionConflictError)
})

test('reads only bounded UTF-8 regular files and detects binary content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-content-'))
  const text = join(root, '中文.txt')
  await writeFile(text, 'hello\r\n世界\r\n')
  const inventory = new FileInventory()
  const result = await inventory.content(text)
  assert.equal(result.content, 'hello\r\n世界\r\n')
  assert.equal(result.newline, 'crlf')
  assert.match(result.revision, /^sha256:[a-f0-9]{64}$/)
  await writeFile(join(root, 'binary'), Buffer.from([1, 0, 2]))
  await assert.rejects(inventory.content(join(root, 'binary')), error => error.statusCode === 415)
  await assert.rejects(inventory.content(root), error => error.statusCode === 415)
})

test('reports container user and group and calculates directory size without following links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-size-'))
  await mkdir(join(root, 'nested'))
  await writeFile(join(root, 'one.txt'), '1234')
  await writeFile(join(root, 'nested', 'two.txt'), '567890')
  await symlink('one.txt', join(root, 'link'))
  const identity = { resolve: async () => ({ user: 'node', group: 'node' }) }
  const inventory = new FileInventory({ identity })
  const listing = await inventory.list(root)
  assert.equal(listing.entries.every(entry => entry.user === 'node' && entry.group === 'node'), true)
  const size = new FileSizeManager({ inventory })
  const directory = await inventory.stat(root)
  const task = size.start({ path: root, revision: directory.revision })
  await size.tasks.get(task.taskId).completion
  const result = size.get(task.taskId)
  assert.equal(result.status, 'success')
  assert.equal(result.bytes, 10)
  assert.equal(result.entries, 4)
  const stale = size.start({ path: root, revision: listing.revision })
  await size.tasks.get(stale.taskId).completion
  assert.equal(size.get(stale.taskId).status, 'failed')
})

test('bounded search does not follow symlinked directories and can be cancelled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-search-'))
  await mkdir(join(root, 'nested'))
  await writeFile(join(root, 'nested', 'Needle.txt'), 'found')
  await symlink(root, join(root, 'nested', 'loop'))
  const states = []
  const manager = new FileSearchManager({ onState: state => states.push(state) })
  const task = manager.start({ path: root, query: 'needle' })
  await manager.tasks.get(task.taskId).completion
  const result = manager.get(task.taskId)
  assert.equal(result.status, 'success')
  assert.deepEqual(result.results.map(entry => entry.name), ['Needle.txt'])
  assert.equal(result.scanned, 3)
  assert.equal(states.at(-1).status, 'success')

  const cancelled = manager.start({ path: root, query: 'x' })
  manager.cancel(cancelled.taskId)
  await manager.tasks.get(cancelled.taskId).completion
  assert.equal(manager.get(cancelled.taskId).status, 'cancelled')
})

test('rejects invalid list, search, and task parameters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-invalid-'))
  const inventory = new FileInventory()
  await assert.rejects(inventory.list(root, { limit: 1001 }), FileManagerError)
  await assert.rejects(inventory.list(root, { sort: 'owner' }), /sort/)
  const manager = new FileSearchManager()
  assert.throws(() => manager.start({ path: root, query: '' }), /query/)
  assert.throws(() => manager.get('missing'), error => error.statusCode === 404)
})
