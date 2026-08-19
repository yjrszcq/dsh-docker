import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { provisionPlatformSeed } from '../stage0/lib/seed.mjs'

test('seeds empty platform slots once and preserves later current links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-platform-seed-'))
  const seed = join(root, 'seed')
  const data = join(root, 'data')
  for (const [group, version] of [['environment', 'env-one'], ['runtime', 'runtime-one']]) {
    await mkdir(join(seed, group, version), { recursive: true })
    await writeFile(join(seed, group, 'VERSION'), `${version}\n`)
  }
  await mkdir(join(seed, 'pristine', 'runtime-one'), { recursive: true })
  await mkdir(join(seed, 'system-plugins', 'env-one'), { recursive: true })
  await provisionPlatformSeed(seed, data)
  assert.equal(await readlink(join(data, 'environments', 'current')), 'versions/env-one')
  await writeFile(join(data, 'state', 'sentinel'), 'keep')
  await provisionPlatformSeed(seed, data)
  assert.equal(await readFile(join(data, 'state', 'sentinel'), 'utf8'), 'keep')
})
