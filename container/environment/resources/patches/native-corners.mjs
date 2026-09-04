import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const NATIVE_CORNERS_RELATIVE_TARGET = 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'

const BEFORE = 'var corner_shape_css_default = "@supports (corner-shape:superellipse(1.5)){:root{--dsw-corner-shape:superellipse(1.5)}*,:before,:after{corner-shape:var(--dsw-corner-shape)}}";'
const AFTER = 'var corner_shape_css_default = "";'

export function patchNativeCorners(target) {
  const source = readFileSync(target, 'utf8')
  const matches = source.split(BEFORE).length - 1
  if (matches !== 1) throw new Error(`Expected exactly one DSH global corner theme in ${target}, found ${matches}. The upstream package may have changed; review this patch before building.`)
  writeFileSync(target, source.replace(BEFORE, AFTER))
}

export function applyPatch(dshRoot) {
  patchNativeCorners(resolve(dshRoot, NATIVE_CORNERS_RELATIVE_TARGET))
}

export function verifyPatch(dshRoot) {
  const target = resolve(dshRoot, NATIVE_CORNERS_RELATIVE_TARGET)
  const source = readFileSync(target, 'utf8')
  if (source.split(AFTER).length - 1 !== 1 || source.includes(BEFORE)) throw new Error(`Native corners Patch verification failed for ${target}`)
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) patchNativeCorners(process.argv[2])
