import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const DIRECTORY_PICKER_TARGET = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-directory-picker-browse/lib/index.js'

export function patchDirectoryPicker(target = DIRECTORY_PICKER_TARGET) {
  const before = 'const target = resolve(path ?? home);'
  const after = 'const target = resolve(path ?? process.env.DSH_DEFAULT_WORKSPACE ?? home);'
  const source = readFileSync(target, 'utf8')
  const matches = source.split(before).length - 1

  if (matches !== 1) {
    throw new Error(
      `Expected exactly one directory picker default path in ${target}, found ${matches}. ` +
        'The upstream package may have changed; review this patch before building.',
    )
  }

  writeFileSync(target, source.replace(before, after))
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) patchDirectoryPicker()
