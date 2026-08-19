import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PersistentStateSnapshots } from '../../control-plane/modules/updater/lib/snapshots.mjs'

async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-snapshots-'))
  const sourceRoot = join(root, 'home')
  await mkdir(join(sourceRoot, 'nested'), { recursive: true })
  return {
    root,
    sourceRoot,
    snapshots: new PersistentStateSnapshots({ root: join(root, 'snapshots'), sourceRoot, ...options }),
  }
}

const state = {
  id: 'before-rc8',
  runtimeId: '0.1.0-rc.7-1',
  environmentVersion: '2026.08.20.1',
  dshVersion: '0.1.0-rc.7',
}

test('snapshots and restores complete DSH_HOME contents and permissions', async () => {
  const { sourceRoot, snapshots } = await fixture({ now: () => new Date('2026-08-19T00:00:00.000Z') })
  await writeFile(join(sourceRoot, '.config'), 'before')
  await writeFile(join(sourceRoot, 'nested', 'database'), 'rows')
  await chmod(join(sourceRoot, 'nested', 'database'), 0o640)
  await symlink('nested/database', join(sourceRoot, 'database-link'))
  const snapshot = await snapshots.create(state)
  assert.equal(snapshot.createdAt, '2026-08-19T00:00:00.000Z')

  await writeFile(join(sourceRoot, '.config'), 'after')
  await writeFile(join(sourceRoot, 'new-data'), 'remove me')
  await snapshots.restore(state.id)
  assert.equal(await readFile(join(sourceRoot, '.config'), 'utf8'), 'before')
  assert.equal(await readFile(join(sourceRoot, 'nested', 'database'), 'utf8'), 'rows')
  assert.equal((await lstat(join(sourceRoot, 'nested', 'database'))).mode & 0o777, 0o640)
  assert.equal(await readlink(join(sourceRoot, 'database-link')), 'nested/database')
  await assert.rejects(readFile(join(sourceRoot, 'new-data')), { code: 'ENOENT' })
  assert.equal((await snapshots.list())[0].id, state.id)
})

test('verifies a snapshot before clearing current DSH_HOME', async () => {
  const { sourceRoot, snapshots } = await fixture()
  await writeFile(join(sourceRoot, 'database'), 'before')
  const snapshot = await snapshots.create(state)
  await writeFile(join(snapshot.path, 'data.tar.gz'), 'corrupt')
  await writeFile(join(sourceRoot, 'database'), 'current')
  await assert.rejects(snapshots.restore(state.id), { code: 'TRUST_ARTIFACT_MISMATCH' })
  assert.equal(await readFile(join(sourceRoot, 'database'), 'utf8'), 'current')
})

test('does not publish a partial snapshot when archive creation fails', async () => {
  const { snapshots } = await fixture({ runImpl: async () => { throw new Error('no space left') } })
  await assert.rejects(snapshots.create(state), /no space/)
  assert.deepEqual(await snapshots.list(), [])
})
