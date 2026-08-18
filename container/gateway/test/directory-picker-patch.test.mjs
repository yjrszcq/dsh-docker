import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { patchDirectoryPicker } from '../../patch-directory-picker.mjs'

test('directory picker patch changes exactly one default without touching explicit paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-directory-patch-'))
  const target = join(directory, 'index.js')
  try {
    await writeFile(target, 'before;const target = resolve(path ?? home);after;')
    patchDirectoryPicker(target)
    assert.equal(
      await readFile(target, 'utf8'),
      'before;const target = resolve(path ?? process.env.DSH_DEFAULT_WORKSPACE ?? home);after;',
    )
    assert.throws(() => patchDirectoryPicker(target), /found 0/)

    await writeFile(target, 'const target = resolve(path ?? home);const target = resolve(path ?? home);')
    assert.throws(() => patchDirectoryPicker(target), /found 2/)
  } finally {
    await rm(directory, { recursive: true })
  }
})
