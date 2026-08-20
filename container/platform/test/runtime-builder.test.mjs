import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, readlink, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  buildRuntime,
  RuntimeSlots,
  verifyNpmIntegrity,
  verifyRuntimePatches,
} from '../../control-plane/modules/patch-manager/index.mjs'

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

async function environment(root, patches) {
  const environmentRoot = join(root, 'environment')
  await mkdir(join(environmentRoot, 'artifacts'), { recursive: true })
  const artifacts = []
  const references = []
  for (const [index, path] of patches.entries()) {
    const bytes = await readFile(path)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const id = `patch-${String(index + 1)}`
    await cp(path, join(environmentRoot, 'artifacts', id))
    artifacts.push({
      id,
      mediaType: 'text/javascript',
      sha256,
      size: bytes.byteLength,
      url: `https://example.invalid/${id}`,
    })
    references.push({ id, sha256 })
  }
  await writeFile(join(environmentRoot, 'environment.manifest.json'), JSON.stringify({
    schema: 1,
    manifestType: 'environment',
    version: '2026.08.20.1',
    keyringGeneration: 1,
    targetSequence: 1,
    issuedAt: '2026-08-20T00:00:00.000Z',
    artifacts,
    bootstrapApi: 1,
    components: [],
    patches: references,
    systemPlugins: [],
  }))
  return environmentRoot
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

test('verifies mandatory Patch Artifacts and their applied Runtime effects before startup', async () => {
  const source = await pristine()
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-verification-'))
  const patches = [
    join(containerRoot, 'environment/resources/patches/directory-picker.mjs'),
    join(containerRoot, 'environment/resources/patches/browser-loopback.mjs'),
  ]
  const runtimeRoot = await buildRuntime({
    pristineRoot: source,
    versionsRoot: join(root, 'versions'),
    runtimeId: 'verified',
    patchPaths: patches,
  })
  const environmentRoot = await environment(root, patches)
  assert.deepEqual(await verifyRuntimePatches({ runtimeRoot, environmentRoot }), ['patch-1', 'patch-2'])

  await writeFile(
    join(runtimeRoot, 'package/node_modules/@deepseek-ai/dsh-client-connection/lib/client.js'),
    'isLoopback: false,\n',
  )
  await assert.rejects(verifyRuntimePatches({ runtimeRoot, environmentRoot }), /Patch verification failed/)
  await writeFile(join(environmentRoot, 'artifacts', 'patch-2'), 'modified artifact\n')
  await assert.rejects(verifyRuntimePatches({ runtimeRoot, environmentRoot }), /differs from the Environment Manifest/)
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
  const imageSeed = await mkdtemp(join(tmpdir(), 'dsh-runtime-image-seed-'))
  await writeFile(join(imageSeed, 'sentinel'), 'keep')
  await symlink(imageSeed, join(root, 'versions/image-old'), 'dir')
  await slots.promote('one')
  await slots.promote('two')
  assert.deepEqual(await slots.prune(), ['image-old', 'old'])
  assert.deepEqual((await readdir(join(root, 'versions'))).sort(), ['one', 'two'])
  assert.equal(await readFile(join(imageSeed, 'sentinel'), 'utf8'), 'keep')
})
