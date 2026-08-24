import assert from 'node:assert/strict'
import { lstat, mkdtemp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { prepareUserWritableRoot, prepareUserWritableRoots } from '../stage0/lib/user-roots.mjs'

test('prepares custom DSH and workspace mount roots for the supervised user', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-user-roots-'))
  const dshHome = join(root, 'custom-dsh')
  const workspace = join(root, 'custom-workspace')
  const uid = process.getuid?.()
  const gid = process.getgid?.()
  assert.deepEqual(await prepareUserWritableRoots({ dshHome, defaultWorkspace: workspace, uid, gid }), [dshHome, workspace])
  for (const path of [dshHome, workspace]) {
    const metadata = await lstat(path)
    assert.equal(metadata.isDirectory(), true)
    if (uid !== undefined) assert.equal(metadata.uid, uid)
    if (gid !== undefined) assert.equal(metadata.gid, gid)
  }
})

test('deduplicates shared roots and rejects relative, root, and symbolic-link targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-user-root-validation-'))
  assert.deepEqual(await prepareUserWritableRoots({ dshHome: root, defaultWorkspace: root }), [root])
  await assert.rejects(prepareUserWritableRoot('relative'), /absolute path/)
  await assert.rejects(prepareUserWritableRoot('/'), /filesystem root/)
  const target = join(root, 'target')
  const link = join(root, 'link')
  await prepareUserWritableRoot(target)
  await symlink(target, link)
  await assert.rejects(prepareUserWritableRoot(link), /must be a directory/)
})
