import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

async function fixture(environment = '2.3.4') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bump-environment-'))
  const definitionPath = join(root, 'container/environment/definition.json')
  const targetPath = join(root, 'release/supported-target.json')
  const scriptPath = join(root, 'scripts/bump-environment.sh')
  await mkdir(join(root, 'container/environment'), { recursive: true })
  await mkdir(join(root, 'container/platform'), { recursive: true })
  await mkdir(join(root, 'release'), { recursive: true })
  await mkdir(join(root, 'scripts'), { recursive: true })
  await symlink(new URL('../lib', import.meta.url).pathname, join(root, 'container/platform/lib'))
  await symlink(new URL('../tools', import.meta.url).pathname, join(root, 'container/platform/tools'))
  await writeFile(scriptPath, await readFile(new URL('../../../scripts/bump-environment.sh', import.meta.url)))
  await chmod(scriptPath, 0o755)
  await writeFile(definitionPath, `${JSON.stringify({ version: environment, bootstrapApi: 1 }, null, 2)}\n`)
  await writeFile(targetPath, `${JSON.stringify({
    schema: 1,
    latestSupportedDsh: '9.8.7-rc.6',
    environment,
  }, null, 2)}\n`)
  return { definitionPath, root, scriptPath, targetPath }
}

function run(paths, version) {
  return spawnSync(paths.scriptPath, [version], { cwd: paths.root, encoding: 'utf8' })
}

test('bumps both authoritative Environment versions and is idempotent', async () => {
  const paths = await fixture()
  let result = run(paths, '2.4.0')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { changed: true, previousVersion: '2.3.4', version: '2.4.0' })
  assert.equal(JSON.parse(await readFile(paths.definitionPath, 'utf8')).version, '2.4.0')
  const target = JSON.parse(await readFile(paths.targetPath, 'utf8'))
  assert.equal(target.environment, '2.4.0')
  assert.equal(target.latestSupportedDsh, '9.8.7-rc.6')
  result = run(paths, '2.4.0')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { changed: false, version: '2.4.0' })
})

test('rejects invalid, rollback, and mismatched Environment versions without writing', async () => {
  const paths = await fixture()
  let result = run(paths, 'not-a-version')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /semantic version/)
  result = run(paths, '2.3.3')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /roll back/)
  assert.equal(JSON.parse(await readFile(paths.definitionPath, 'utf8')).version, '2.3.4')
  assert.equal(JSON.parse(await readFile(paths.targetPath, 'utf8')).environment, '2.3.4')

  await writeFile(paths.targetPath, `${JSON.stringify({
    schema: 1,
    latestSupportedDsh: '9.8.7-rc.6',
    environment: '2.3.3',
  }, null, 2)}\n`)
  result = run(paths, '2.4.0')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /does not match/)
})
