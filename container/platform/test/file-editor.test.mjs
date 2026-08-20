import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AtomicFileEditor } from '../../control-plane/modules/file-manager/editor.mjs'
import { FileInventory } from '../../control-plane/modules/file-manager/index.mjs'

test('atomically replaces text with optimistic revision and preserves mode', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-editor-'))
  const path = join(root, 'file.txt')
  await writeFile(path, 'before')
  await chmod(path, 0o640)
  const inventory = new FileInventory()
  const before = await inventory.content(path)
  const saved = await new AtomicFileEditor().write(path, 'after\n', before.revision)
  assert.equal(await readFile(path, 'utf8'), 'after\n')
  assert.equal((await stat(path)).mode & 0o777, 0o640)
  assert.notEqual(saved.revision, before.revision)
  await assert.rejects(new AtomicFileEditor().write(path, 'stale', before.revision), error => error.statusCode === 409)
  assert.equal(await readFile(path, 'utf8'), 'after\n')
  assert.equal((await readdir(root)).some(name => name.startsWith('.dsh-edit-')), false)
})

test('creates a new text file without overwriting a concurrent target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-create-'))
  const path = join(root, 'new.txt')
  const editor = new AtomicFileEditor()
  const created = await editor.write(path, 'new', null, { create: true })
  assert.equal(created.size, 3)
  await assert.rejects(editor.write(path, 'replace', null, { create: true }), error => error.statusCode === 409)
  assert.equal(await readFile(path, 'utf8'), 'new')
})

test('rejects binary, oversized, missing, and non-file edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-editor-invalid-'))
  const editor = new AtomicFileEditor()
  await assert.rejects(editor.write(join(root, 'nul'), 'a\0b', null, { create: true }), error => error.statusCode === 415)
  await assert.rejects(editor.write(join(root, 'large'), 'x'.repeat(2 * 1024 * 1024 + 1), null, { create: true }), error => error.statusCode === 413)
  await assert.rejects(editor.write(join(root, 'missing'), 'x', 'sha256:missing'), error => error.statusCode === 404)
  await assert.rejects(editor.write(root, 'x', 'sha256:missing'), error => error.statusCode === 415)
})
