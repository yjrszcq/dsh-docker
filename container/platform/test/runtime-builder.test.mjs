import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, readlink, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { buildRuntime, RuntimeSlots, verifyNpmIntegrity } from '../../control-plane/modules/patch-manager/index.mjs'

const containerRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

async function pristine() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pristine-'))
  await mkdir(join(root, 'lib'), { recursive: true })
  await writeFile(join(root, 'lib', 'bin.js'), '#!/usr/bin/env node\n')
  const picker = join(root, 'node_modules/@deepseek-ai/dsh-host-directory-picker-browse/lib')
  const connection = join(root, 'node_modules/@deepseek-ai/dsh-client-connection/lib')
  await mkdir(picker, { recursive: true })
  await mkdir(connection, { recursive: true })
  await writeFile(join(picker, 'index.js'), 'const target = resolve(path ?? home);\n')
  await writeFile(join(connection, 'client.js'), 'isLoopback: pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),\n')
  await mkdir(join(root, 'node_modules/.bin'), { recursive: true })
  await symlink('../tool/bin.js', join(root, 'node_modules/.bin/tool'))
  return root
}

test('rebuilds each Runtime from unchanged Pristine with the complete ordered Patch set', async () => {
  const source = await pristine()
  const originalPicker = await readFile(join(source, 'node_modules/@deepseek-ai/dsh-host-directory-picker-browse/lib/index.js'))
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-'))
  const patches = [
    join(containerRoot, 'environment/resources/patches/directory-picker.mjs'),
    join(containerRoot, 'environment/resources/patches/browser-loopback.mjs'),
  ]
  const first = await buildRuntime({ pristineRoot: source, versionsRoot: join(root, 'versions'), runtimeId: 'one', patchPaths: patches })
  const second = await buildRuntime({ pristineRoot: source, versionsRoot: join(root, 'versions'), runtimeId: 'two', patchPaths: patches })
  assert.deepEqual(await readFile(join(source, 'node_modules/@deepseek-ai/dsh-host-directory-picker-browse/lib/index.js')), originalPicker)
  for (const runtime of [first, second]) {
    assert.match(await readFile(join(runtime, 'package/node_modules/@deepseek-ai/dsh-host-directory-picker-browse/lib/index.js'), 'utf8'), /DSH_DEFAULT_WORKSPACE/)
    assert.match(await readFile(join(runtime, 'package/node_modules/@deepseek-ai/dsh-client-connection/lib/client.js'), 'utf8'), /isLoopback: true/)
    assert.equal(await readlink(join(runtime, 'package/node_modules/.bin/tool')), '../tool/bin.js')
  }
})

test('rejects a Patch mismatch without publishing a partial Runtime', async () => {
  const source = await pristine()
  await writeFile(join(source, 'node_modules/@deepseek-ai/dsh-client-connection/lib/client.js'), 'changed upstream\n')
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-failure-'))
  await assert.rejects(buildRuntime({
    pristineRoot: source,
    versionsRoot: join(root, 'versions'),
    runtimeId: 'broken',
    patchPaths: [join(containerRoot, 'environment/resources/patches/browser-loopback.mjs')],
  }), /found 0/)
  await assert.rejects(readFile(join(root, 'versions/broken/package/lib/bin.js')), { code: 'ENOENT' })
})

test('checks npm SHA-512 integrity and tracks Runtime current/previous slots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-slots-'))
  const tarball = join(root, 'dsh.tgz')
  const bytes = Buffer.from('tarball fixture')
  await writeFile(tarball, bytes)
  await verifyNpmIntegrity(tarball, `sha512-${createHash('sha512').update(bytes).digest('base64')}`)
  await assert.rejects(verifyNpmIntegrity(tarball, `sha512-${Buffer.alloc(64).toString('base64')}`), { code: 'TRUST_ARTIFACT_MISMATCH' })
  await mkdir(join(root, 'runtime/versions/one'), { recursive: true })
  await mkdir(join(root, 'runtime/versions/two'), { recursive: true })
  const slots = new RuntimeSlots(join(root, 'runtime'))
  await slots.promote('one')
  await slots.promote('two')
  assert.deepEqual(await slots.state(), { current: 'two', previous: 'one' })
  await slots.rollback()
  assert.deepEqual(await slots.state(), { current: 'one', previous: 'two' })
})

test('prunes only Runtime versions outside current and previous slots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-prune-'))
  const slots = new RuntimeSlots(root)
  for (const version of ['one', 'two', 'old']) await mkdir(join(root, 'versions', version), { recursive: true })
  await slots.promote('one')
  await slots.promote('two')
  assert.deepEqual(await slots.prune(), ['old'])
  assert.deepEqual((await readdir(join(root, 'versions'))).sort(), ['one', 'two'])
})
