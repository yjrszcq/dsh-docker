import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, readlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  PlatformPaths,
  preparePersistentLayout,
  rejectLegacyLayout,
  resetRuntimeLayout,
} from '../lib/paths.mjs'

test('creates state, store, cache, and logs without persistent runtime views', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-layout-'))
  const paths = new PlatformPaths(join(root, 'platform'), join(root, 'run'))
  await preparePersistentLayout(paths)
  for (const path of [
    paths.trustStateRoot, paths.bootstrapStateRoot, paths.deploymentStateRoot, paths.updaterStateRoot,
    paths.managementStateRoot,
    paths.objectsRoot, paths.bootstrapStoreRoot, paths.environmentsRoot, paths.pristineRoot,
    paths.runtimesRoot, paths.systemPluginsRoot, paths.snapshotsRoot, paths.userPluginSnapshotsRoot,
    paths.downloadsRoot, paths.logsRoot,
  ]) assert.equal((await lstat(path)).isDirectory(), true)
  await assert.rejects(lstat(paths.runRoot), { code: 'ENOENT' })
})

test('rejects legacy platform volumes without changing DSH user data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-legacy-layout-'))
  const dataRoot = join(root, 'platform')
  const dshRoot = join(root, 'dsh')
  const paths = new PlatformPaths(dataRoot, join(root, 'run'))
  await mkdir(join(dataRoot, 'runtime'), { recursive: true })
  await mkdir(dshRoot)
  await writeFile(join(dshRoot, 'sentinel'), 'user-data')
  await assert.rejects(rejectLegacyLayout(paths), error => (
    /clear only .*platform/.test(error.message) && /Do not delete \/data\/dsh/.test(error.message)
  ))
  assert.equal(await readFile(join(dshRoot, 'sentinel'), 'utf8'), 'user-data')
})

test('rebuilds only the ephemeral run directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-run-layout-'))
  const paths = new PlatformPaths(join(root, 'platform'), join(root, 'run'))
  await preparePersistentLayout(paths)
  await mkdir(paths.runRoot)
  await writeFile(join(paths.runRoot, 'stale.sock'), 'stale')
  await writeFile(join(paths.updaterStateRoot, 'sentinel'), 'persistent')
  await resetRuntimeLayout(paths)
  await assert.rejects(lstat(join(paths.runRoot, 'stale.sock')), { code: 'ENOENT' })
  assert.equal((await lstat(paths.viewsRoot)).isDirectory(), true)
  assert.equal((await lstat(paths.deploymentViewsRoot)).isDirectory(), true)
  assert.equal(await readlink(join(paths.viewsRoot, 'runtime')), join('..', 'deployment', 'runtime'))
  assert.equal(await readlink(join(paths.viewsRoot, 'environment')), join('..', 'deployment', 'environment'))
  assert.equal(await readlink(join(paths.viewsRoot, 'system-plugins')), join('..', 'system-plugin-views', 'current'))
  assert.equal((await lstat(paths.systemPluginViewsRoot)).isDirectory(), true)
  assert.equal(
    await readlink(join(paths.systemPluginViewsRoot, 'current')),
    join('..', 'deployment', 'system-plugins'),
  )
  assert.equal(await readFile(join(paths.updaterStateRoot, 'sentinel'), 'utf8'), 'persistent')
})
