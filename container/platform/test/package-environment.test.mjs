import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { parseComponentManifest, parseEnvironmentManifest } from '../lib/contracts.mjs'

const platformRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const definition = join(platformRoot, 'environment', 'definition.json')
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
  assert.deepEqual(manifest.components.map(component => component.id), ['gateway', 'dsh-runtime'])
  assert.deepEqual(manifest.patches.map(patch => patch.id), ['directory-picker', 'browser-loopback'])
  assert.deepEqual(await readdir(join(first, 'artifacts')), await readdir(join(second, 'artifacts')))
})

test('checked-in Component manifests satisfy the public contract', async () => {
  for (const name of ['gateway.json', 'dsh-runtime.json']) {
    const bytes = await readFile(join(platformRoot, 'environment', 'components', name))
    assert.doesNotThrow(() => parseComponentManifest(bytes))
  }
})

test('packager rejects source escapes and duplicate Artifact IDs without publishing output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-environment-invalid-'))
  const original = JSON.parse(await readFile(definition, 'utf8'))
  original.components[0].source = '../../../../README.md'
  original.components[1].artifactId = original.components[0].artifactId
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
