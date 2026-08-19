import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const BROWSER_CONNECTION_TARGET = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/client.js'
export const BROWSER_CONNECTION_RELATIVE_TARGET = 'node_modules/@deepseek-ai/dsh-client-connection/lib/client.js'

export function patchBrowserLoopback(target = BROWSER_CONNECTION_TARGET) {
  const before = 'isLoopback: pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),'
  const after = 'isLoopback: true,'
  const source = readFileSync(target, 'utf8')
  const matches = source.split(before).length - 1

  if (matches !== 1) {
    throw new Error(
      `Expected exactly one browser loopback classification in ${target}, found ${matches}. ` +
        'The upstream package may have changed; review this patch before building.',
    )
  }

  writeFileSync(target, source.replace(before, after))
}

export function applyPatch(dshRoot) {
  patchBrowserLoopback(resolve(dshRoot, BROWSER_CONNECTION_RELATIVE_TARGET))
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) patchBrowserLoopback()
