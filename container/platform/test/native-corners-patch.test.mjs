import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { applyPatch, verifyPatch, NATIVE_CORNERS_RELATIVE_TARGET } from '../../environment/resources/patches/native-corners.mjs'

const BEFORE = 'var corner_shape_css_default = "@supports (corner-shape:superellipse(1.5)){:root{--dsw-corner-shape:superellipse(1.5)}*,:before,:after{corner-shape:var(--dsw-corner-shape)}}";'

async function fixture(source = BEFORE) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-corners-'))
  const target = join(root, NATIVE_CORNERS_RELATIVE_TARGET)
  await mkdir(join(root, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib'), { recursive: true })
  await writeFile(target, source + '\n')
  return { root, target }
}

test('removes the image-injected global superellipse rule exactly once', async () => {
  const { root, target } = await fixture()
  applyPatch(root)
  verifyPatch(root)
  assert.equal(await readFile(target, 'utf8'), 'var corner_shape_css_default = "";\n')
  assert.throws(() => applyPatch(root), /found 0/)
})

test('fails closed when the upstream theme anchor changes', async () => {
  const { root } = await fixture('var corner_shape_css_default = "changed";')
  assert.throws(() => applyPatch(root), /found 0/)
})

test('allows upstream packages without the optional theme module', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-corners-absent-'))
  assert.doesNotThrow(() => applyPatch(root))
  assert.doesNotThrow(() => verifyPatch(root))
})
