import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { provisionPlatformSeed } from '../stage0/lib/seed.mjs'
import { TrustLedger } from '../stage0/lib/ledger.mjs'

test('checked-in development seed is Recovery-signed and contains no private key', async () => {
  const trust = new URL('../seed/trust/', import.meta.url)
  const publicKey = (await readFile(new URL('recovery-root.spki.base64', trust), 'utf8')).trim()
  const keyring = await readFile(new URL('keyring.json', trust))
  const signature = JSON.parse(await readFile(new URL('keyring.sig.json', trust), 'utf8'))
  const root = await mkdtemp(join(tmpdir(), 'dsh-seed-trust-'))
  const accepted = await new TrustLedger(root, publicKey).acceptKeyring(keyring, signature)
  assert.equal(accepted.generation, 1)
  for (const name of ['recovery-root.spki.base64', 'keyring.json', 'keyring.sig.json', 'DEVELOPMENT_FIXTURE']) {
    assert.doesNotMatch(await readFile(new URL(name, trust), 'utf8'), /PRIVATE KEY/)
  }
})

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
