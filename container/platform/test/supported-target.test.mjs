import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  advanceSupportedDsh,
  compareDshVersions,
  parseSupportedTarget,
  validateSupportedTarget,
} from '../lib/supported-target.mjs'

const target = {
  schema: 1,
  latestSupportedDsh: '0.1.0-rc.7',
  environment: '2026.08.20.1-dev',
}
const bytes = value => Buffer.from(`${JSON.stringify(value)}\n`)

test('parses the exact Supported Target contract and matching Environment', () => {
  assert.deepEqual(parseSupportedTarget(bytes(target)), target)
  assert.equal(validateSupportedTarget(bytes(target), bytes({ version: target.environment })).environment, target.environment)
  assert.throws(() => parseSupportedTarget(bytes({ ...target, extra: true })), /exactly/)
  assert.throws(() => validateSupportedTarget(bytes(target), bytes({ version: 'different' })), /does not match/)
})

test('compares release and prerelease DSH semantic versions without downgrade ambiguity', () => {
  assert.equal(compareDshVersions('0.1.0-rc.21', '0.1.0-rc.7'), 1)
  assert.equal(compareDshVersions('0.1.0', '0.1.0-rc.21'), 1)
  assert.equal(compareDshVersions('0.1.0-rc.7', '0.1.0-rc.7+rebuilt'), 0)
  assert.equal(compareDshVersions('0.1.0-2', '0.1.0-beta'), -1)
  assert.equal(compareDshVersions('999999999999999999999.0.0', '999999999999999999998.0.0'), 1)
  assert.throws(() => compareDshVersions('0.1.0-rc.07', '0.1.0-rc.7'), /numeric prerelease/)
})

test('advances only DSH and rejects an upstream rollback', () => {
  const advanced = advanceSupportedDsh(target, '0.1.0-rc.8')
  assert.equal(advanced.changed, true)
  assert.deepEqual(advanced.target, { ...target, latestSupportedDsh: '0.1.0-rc.8' })
  assert.equal(advanceSupportedDsh(target, target.latestSupportedDsh).changed, false)
  assert.throws(() => advanceSupportedDsh(target, '0.1.0-rc.6'), /roll back/)
})

test('CLI validates and atomically updates the candidate target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supported-target-'))
  const targetPath = join(root, 'supported-target.json')
  const definitionPath = join(root, 'definition.json')
  await writeFile(targetPath, bytes(target))
  await writeFile(definitionPath, bytes({ version: target.environment }))
  const tool = new URL('../tools/supported-target.mjs', import.meta.url).pathname

  const result = spawnSync(process.execPath, [tool, 'advance', targetPath, definitionPath, '0.1.0-rc.8'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).changed, true)
  assert.equal(JSON.parse(await readFile(targetPath, 'utf8')).latestSupportedDsh, '0.1.0-rc.8')

  const rollback = spawnSync(process.execPath, [tool, 'advance', targetPath, definitionPath, '0.1.0-rc.7'], { encoding: 'utf8' })
  assert.notEqual(rollback.status, 0)
  assert.equal(JSON.parse(await readFile(targetPath, 'utf8')).latestSupportedDsh, '0.1.0-rc.8')

  const extraArgument = spawnSync(process.execPath, [tool, 'validate', targetPath, definitionPath, 'ignored'], { encoding: 'utf8' })
  assert.equal(extraArgument.status, 64)
})
