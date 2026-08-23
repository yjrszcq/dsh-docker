import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { bumpEnvironmentVersion } from '../tools/bump-environment.mjs'

async function fixture(environment = '2.3.4') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bump-environment-'))
  const definitionPath = join(root, 'definition.json')
  const targetPath = join(root, 'supported-target.json')
  await writeFile(definitionPath, `${JSON.stringify({ version: environment, bootstrapApi: 1 }, null, 2)}\n`)
  await writeFile(targetPath, `${JSON.stringify({
    schema: 1,
    latestSupportedDsh: '9.8.7-rc.6',
    environment,
  }, null, 2)}\n`)
  return { definitionPath, targetPath }
}

test('bumps both authoritative Environment versions and is idempotent', async () => {
  const paths = await fixture()
  const result = await bumpEnvironmentVersion('2.4.0', paths)
  assert.deepEqual(result, { changed: true, previousVersion: '2.3.4', version: '2.4.0' })
  assert.equal(JSON.parse(await readFile(paths.definitionPath, 'utf8')).version, '2.4.0')
  const target = JSON.parse(await readFile(paths.targetPath, 'utf8'))
  assert.equal(target.environment, '2.4.0')
  assert.equal(target.latestSupportedDsh, '9.8.7-rc.6')
  assert.deepEqual(await bumpEnvironmentVersion('2.4.0', paths), { changed: false, version: '2.4.0' })
})

test('rejects invalid, rollback, and mismatched Environment versions without writing', async () => {
  const paths = await fixture()
  await assert.rejects(() => bumpEnvironmentVersion('not-a-version', paths), /semantic version/)
  await assert.rejects(() => bumpEnvironmentVersion('2.3.3', paths), /roll back/)
  assert.equal(JSON.parse(await readFile(paths.definitionPath, 'utf8')).version, '2.3.4')
  assert.equal(JSON.parse(await readFile(paths.targetPath, 'utf8')).environment, '2.3.4')

  await writeFile(paths.targetPath, `${JSON.stringify({
    schema: 1,
    latestSupportedDsh: '9.8.7-rc.6',
    environment: '2.3.3',
  }, null, 2)}\n`)
  await assert.rejects(() => bumpEnvironmentVersion('2.4.0', paths), /does not match/)
})
