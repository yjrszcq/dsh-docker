import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { parseComponentManifest, parseEnvironmentManifest } from '../lib/contracts.mjs'

const platformRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const containerRoot = dirname(platformRoot)
const definition = join(containerRoot, 'environment', 'definition.json')
const tool = join(platformRoot, 'tools', 'package-environment.mjs')

async function build() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-environment-package-'))
  const output = join(root, 'output')
  const result = spawnSync(process.execPath, [tool, definition, output], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return output
}

test('packages the initial Environment deterministically from real resources', async () => {
  const first = await build()
  const second = await build()
  const firstManifest = await readFile(join(first, 'environment.manifest.json'))
  const secondManifest = await readFile(join(second, 'environment.manifest.json'))
  assert.deepEqual(firstManifest, secondManifest)
  const manifest = parseEnvironmentManifest(firstManifest)
  assert.deepEqual(manifest.components.map(component => component.id), ['dsh-runtime'])
  assert.deepEqual(manifest.patches.map(patch => patch.id), ['directory-picker', 'browser-loopback'])
  assert.deepEqual(manifest.systemPlugins.map(plugin => plugin.id), ['update-ui'])
  for (const reference of [...manifest.components, ...manifest.patches, ...manifest.systemPlugins]) {
    assert.deepEqual(Object.keys(reference).sort(), ['id', 'sha256'])
  }
  assert.deepEqual(await readdir(join(first, 'artifacts')), await readdir(join(second, 'artifacts')))
})

test('can emit flat Artifact URLs for GitHub Release assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-environment-flat-'))
  const output = join(root, 'output')
  const result = spawnSync(process.execPath, [
    tool, definition, output, '1', '1', 'https://release.example/platform-1/', 'flat',
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const manifest = parseEnvironmentManifest(await readFile(join(output, 'environment.manifest.json')))
  assert.equal(manifest.artifacts.every(artifact => artifact.url.startsWith('https://release.example/platform-1/')), true)
  assert.equal(manifest.artifacts.every(artifact => !artifact.url.includes('/artifacts/')), true)
})

test('checked-in Component manifests satisfy the public contract', async () => {
  for (const path of [
    join(containerRoot, 'control-plane', 'services', 'gateway', 'component.json'),
    join(containerRoot, 'environment', 'dsh-runtime', 'component.json'),
    join(containerRoot, 'control-plane', 'services', 'management', 'component.json'),
    join(containerRoot, 'control-plane', 'modules', 'updater', 'recovery.component.json'),
  ]) {
    const bytes = await readFile(path)
    const component = parseComponentManifest(bytes)
    assert.equal(Object.hasOwn(component, 'version'), false)
  }
})

test('packager rejects source escapes and duplicate Artifact IDs without publishing output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-environment-invalid-'))
  const original = JSON.parse(await readFile(definition, 'utf8'))
  original.components[0].source = '../../../../README.md'
  original.components.push({ ...original.components[0] })
  const invalid = join(dirname(definition), `invalid-${process.pid}.json`)
  const output = join(root, 'output')
  try {
    await writeFile(invalid, JSON.stringify(original))
    const result = spawnSync(process.execPath, [tool, invalid, output], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    await assert.rejects(readdir(output), { code: 'ENOENT' })
  } finally {
    await import('node:fs/promises').then(({ rm }) => rm(invalid, { force: true }))
  }
})
