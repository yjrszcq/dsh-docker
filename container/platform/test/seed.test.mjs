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
import { verifyRuntimePatches } from '../../control-plane/modules/patch-manager/index.mjs'
import { writeDshEntrypointFixture } from './fixtures/dsh-package.mjs'

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

test('registers immutable image seed trees once and preserves later current links', async () => {
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
  const first = await provisionPlatformSeed(seed, data)
  assert.equal(first.seededLinks.length, 4)
  for (const [entry, source] of [
    ['store/environments/versions/env-one', 'environment/env-one'],
    ['store/runtimes/versions/runtime-one', 'runtime/runtime-one'],
    ['store/pristine/runtime-one', 'pristine/runtime-one'],
    ['store/system-plugins/versions/env-one', 'system-plugins/env-one'],
  ]) {
    assert.equal((await lstat(join(data, entry))).isSymbolicLink(), true)
    assert.equal(await readlink(join(data, entry)), join(seed, source))
  }
  assert.equal(await readlink(join(data, 'store/environments', 'current')), 'versions/env-one')
  assert.equal(await readlink(join(data, 'store/pristine/runtime-one/node_modules/.bin/tool')), '../package/bin.js')
  assert.equal((await lstat(join(data, 'store/snapshots'))).isDirectory(), true)
  await writeFile(join(data, 'state/updater', 'sentinel'), 'keep')
  const repeated = await provisionPlatformSeed(seed, data)
  assert.deepEqual(repeated.seededLinks, [])
  assert.equal(await readFile(join(data, 'state/updater', 'sentinel'), 'utf8'), 'keep')
})

test('preserves an existing materialized version instead of replacing it with an image seed link', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-platform-materialized-'))
  const seed = join(root, 'seed')
  const data = join(root, 'data')
  for (const [group, version] of [['environment', 'env-one'], ['runtime', 'runtime-one']]) {
    await mkdir(join(seed, group, version), { recursive: true })
    await writeFile(join(seed, group, 'VERSION'), `${version}\n`)
  }
  await mkdir(join(seed, 'pristine/runtime-one'), { recursive: true })
  await mkdir(join(seed, 'system-plugins/env-one'), { recursive: true })
  await mkdir(join(data, 'store/runtimes/versions/runtime-one'), { recursive: true })
  await writeFile(join(data, 'store/runtimes/versions/runtime-one/sentinel'), 'materialized')

  await provisionPlatformSeed(seed, data)

  assert.equal((await lstat(join(data, 'store/runtimes/versions/runtime-one'))).isDirectory(), true)
  assert.equal(await readFile(join(data, 'store/runtimes/versions/runtime-one/sentinel'), 'utf8'), 'materialized')
})

test('repairs broken image entries and current slots after an image replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-platform-replaced-image-'))
  const seed = join(root, 'seed')
  const data = join(root, 'data')
  for (const [group, version] of [['environment', 'env-one'], ['runtime', 'runtime-one']]) {
    await mkdir(join(seed, group, version), { recursive: true })
    await writeFile(join(seed, group, 'VERSION'), `${version}\n`)
  }
  await mkdir(join(seed, 'pristine/runtime-one'), { recursive: true })
  await mkdir(join(seed, 'system-plugins/env-one'), { recursive: true })
  await mkdir(join(data, 'store/runtimes/versions'), { recursive: true })
  await symlink('/missing-old-image/runtime-old', join(data, 'store/runtimes/versions/runtime-old'))
  await symlink('versions/runtime-old', join(data, 'store/runtimes/current'))

  await provisionPlatformSeed(seed, data)

  assert.equal(await readlink(join(data, 'store/runtimes/versions/runtime-one')), join(seed, 'runtime/runtime-one'))
  assert.equal(await readlink(join(data, 'store/runtimes/current')), 'versions/runtime-one')
  assert.equal((await lstat(join(data, 'store/runtimes/current'))).isSymbolicLink(), true)
})

test('rejects seed IDs that could escape their image roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-platform-invalid-seed-'))
  const seed = join(root, 'seed')
  await mkdir(join(seed, 'environment'), { recursive: true })
  await mkdir(join(seed, 'runtime'), { recursive: true })
  await writeFile(join(seed, 'environment/VERSION'), '../escape\n')
  await writeFile(join(seed, 'runtime/VERSION'), 'runtime-one\n')
  await assert.rejects(provisionPlatformSeed(seed, join(root, 'data')), /Environment seed ID is invalid/)
})

test('builds a self-contained Bootstrap seed and preserves npm bin links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-build-seed-'))
  const installed = join(root, 'installed')
  const output = join(root, 'output')
  await writeDshEntrypointFixture(installed)
  await writeFile(join(installed, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.fixture' }))
  const picker = join(installed, 'node_modules/@deepseek-ai/dsh-host-directory-picker-browse/lib')
  const connection = join(installed, 'node_modules/@deepseek-ai/dsh-client-connection/lib')
  await mkdir(picker, { recursive: true })
  await mkdir(connection, { recursive: true })
  await writeFile(join(picker, 'index.js'), 'const target = resolve(path ?? home);\n')
  await writeFile(join(connection, 'client.js'), 'isLoopback: pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),\n')
  await mkdir(join(installed, 'node_modules/.bin'), { recursive: true })
  await symlink('../tool/bin.js', join(installed, 'node_modules/.bin/tool'))

  await execute(process.execPath, [fileURLToPath(new URL('../tools/build-seed.mjs', import.meta.url)), installed, output])
  const contracts = await import(pathToFileURL(join(output, 'bootstrap/1.0.0/platform/lib/contracts.mjs')).href)
  const { parseImageInventory } = await import('../lib/deployment-contracts.mjs')
  assert.equal(typeof contracts.parseStable, 'function')
  const inventory = parseImageInventory(await readFile(join(output, 'inventory.json')))
  assert.equal(inventory.authority, 'development')
  assert.equal(inventory.targetSequence, 0)
  assert.equal(inventory.bootstrap.version, '1.0.0')
  assert.equal(inventory.deployment.dshVersion, '0.1.0-rc.fixture')
  assert.equal((await lstat(join(output, 'bootstrap/1.0.0/control-plane/services/management/node_modules/ws/index.js'))).isFile(), true)
  assert.equal((await lstat(join(output, 'bootstrap/1.0.0/control-plane/services/management/node_modules/@xterm/xterm/css/xterm.css'))).isFile(), true)
  assert.equal((await lstat(join(output, 'bootstrap/1.0.0/control-plane/services/proxy/index.mjs'))).isFile(), true)
  assert.equal((await lstat(join(output, 'bootstrap/1.0.0/control-plane/skills/dsh-docker-operations/SKILL.md'))).isFile(), true)
  assert.equal(await readlink(join(output, 'pristine/0.1.0-rc.fixture/node_modules/.bin/tool')), '../tool/bin.js')
  assert.equal(await readlink(join(output, 'runtime/0.1.0-rc.fixture/package/node_modules/.bin/tool')), '../tool/bin.js')
  assert.deepEqual(await verifyRuntimePatches({
    runtimeRoot: join(output, 'runtimes', inventory.deployment.runtime.id),
    environmentRoot: join(output, 'environments', inventory.deployment.environment.id),
  }), ['directory-picker', 'browser-loopback', 'managed-lifecycle'])
})
