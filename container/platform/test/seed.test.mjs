import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { lstat, mkdtemp, mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import { provisionPlatformSeed } from '../stage0/lib/seed.mjs'
import { TrustLedger } from '../stage0/lib/ledger.mjs'

const execute = promisify(execFile)

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
  await mkdir(join(seed, 'pristine', 'runtime-one', 'node_modules/.bin'), { recursive: true })
  await symlink('../package/bin.js', join(seed, 'pristine', 'runtime-one', 'node_modules/.bin/tool'))
  await mkdir(join(seed, 'system-plugins', 'env-one'), { recursive: true })
  await provisionPlatformSeed(seed, data)
  assert.equal(await readlink(join(data, 'environments', 'current')), 'versions/env-one')
  assert.equal(await readlink(join(data, 'dsh/pristine/runtime-one/node_modules/.bin/tool')), '../package/bin.js')
  assert.equal((await lstat(join(data, 'snapshots'))).isDirectory(), true)
  await writeFile(join(data, 'state', 'sentinel'), 'keep')
  await provisionPlatformSeed(seed, data)
  assert.equal(await readFile(join(data, 'state', 'sentinel'), 'utf8'), 'keep')
})

test('builds a self-contained Bootstrap seed and preserves npm bin links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-build-seed-'))
  const installed = join(root, 'installed')
  const output = join(root, 'output')
  await mkdir(join(installed, 'lib'), { recursive: true })
  await writeFile(join(installed, 'lib/bin.js'), '#!/usr/bin/env node\n')
  const picker = join(installed, 'node_modules/@deepseek-ai/dsh-host-directory-picker-browse/lib')
  const connection = join(installed, 'node_modules/@deepseek-ai/dsh-client-connection/lib')
  await mkdir(picker, { recursive: true })
  await mkdir(connection, { recursive: true })
  await writeFile(join(picker, 'index.js'), 'const target = resolve(path ?? home);\n')
  await writeFile(join(connection, 'client.js'), 'isLoopback: pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),\n')
  await mkdir(join(installed, 'node_modules/.bin'), { recursive: true })
  await symlink('../tool/bin.js', join(installed, 'node_modules/.bin/tool'))

  await execute(process.execPath, [fileURLToPath(new URL('../tools/build-seed.mjs', import.meta.url)), installed, output, 'fixture'])
  const contracts = await import(pathToFileURL(join(output, 'bootstrap/1.0.0/platform/lib/contracts.mjs')).href)
  assert.equal(typeof contracts.parseStable, 'function')
  assert.equal(await readlink(join(output, 'pristine/fixture/node_modules/.bin/tool')), '../tool/bin.js')
  assert.equal(await readlink(join(output, 'runtime/fixture/package/node_modules/.bin/tool')), '../tool/bin.js')
})
