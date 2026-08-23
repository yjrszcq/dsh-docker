import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { bumpEnvironmentVersion } from '../tools/bump-environment.mjs'

async function fixture(environment = '1.0.3') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bump-environment-'))
  const definitionPath = join(root, 'definition.json')
  const targetPath = join(root, 'supported-target.json')
  await writeFile(definitionPath, `${JSON.stringify({ version: environment, bootstrapApi: 1 }, null, 2)}\n`)
  await writeFile(targetPath, `${JSON.stringify({
    schema: 1,
    latestSupportedDsh: '0.1.1-rc.2',
    environment,
  }, null, 2)}\n`)
  return { definitionPath, targetPath }
}

test('bumps both authoritative Environment versions and is idempotent', async () => {
  const paths = await fixture()
  const result = await bumpEnvironmentVersion('1.0.4', paths)
  assert.deepEqual(result, { changed: true, previousVersion: '1.0.3', version: '1.0.4' })
  assert.equal(JSON.parse(await readFile(paths.definitionPath, 'utf8')).version, '1.0.4')
  const target = JSON.parse(await readFile(paths.targetPath, 'utf8'))
  assert.equal(target.environment, '1.0.4')
  assert.equal(target.latestSupportedDsh, '0.1.1-rc.2')
  assert.deepEqual(await bumpEnvironmentVersion('1.0.4', paths), { changed: false, version: '1.0.4' })
})

test('rejects invalid, rollback, and mismatched Environment versions without writing', async () => {
  const paths = await fixture()
  await assert.rejects(() => bumpEnvironmentVersion('not-a-version', paths), /semantic version/)
  await assert.rejects(() => bumpEnvironmentVersion('1.0.2', paths), /roll back/)
  assert.equal(JSON.parse(await readFile(paths.definitionPath, 'utf8')).version, '1.0.3')
  assert.equal(JSON.parse(await readFile(paths.targetPath, 'utf8')).environment, '1.0.3')

  await writeFile(paths.targetPath, `${JSON.stringify({
    schema: 1,
    latestSupportedDsh: '0.1.1-rc.2',
    environment: '1.0.2',
  }, null, 2)}\n`)
  await assert.rejects(() => bumpEnvironmentVersion('1.0.4', paths), /does not match/)
})
