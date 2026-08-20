#!/usr/bin/env node

import { lstat, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPECTED = Object.freeze({
  '@xterm/addon-fit': '0.11.0',
  '@xterm/xterm': '6.0.0',
  ws: '8.21.3',
})

async function requireFile(root, path) {
  const value = await lstat(join(root, path))
  if (!value.isFile()) throw new Error(`Management dependency asset ${path} is not a file`)
}

export async function verifyManagementDependencies(rootArg) {
  const root = resolve(rootArg)
  for (const [name, expectedVersion] of Object.entries(EXPECTED)) {
    const packageRoot = join(root, 'node_modules', ...name.split('/'))
    const metadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    if (metadata.name !== name || metadata.version !== expectedVersion) {
      throw new Error(`Management dependency ${name} must be exactly ${expectedVersion}`)
    }
    await requireFile(packageRoot, 'LICENSE')
  }
  for (const path of [
    'node_modules/ws/index.js',
    'node_modules/@xterm/xterm/lib/xterm.mjs',
    'node_modules/@xterm/xterm/css/xterm.css',
    'node_modules/@xterm/addon-fit/lib/addon-fit.mjs',
  ]) await requireFile(root, path)
  const entries = await readdir(join(root, 'node_modules'), { recursive: true, withFileTypes: true })
  const native = entries.find(entry => entry.isFile() && entry.name.endsWith('.node'))
  if (native !== undefined) throw new Error('Management dependencies must not contain native .node modules')
  return Object.freeze({ packages: EXPECTED, nativeModules: 0 })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2]
  if (root === undefined) {
    console.error('usage: verify-management-dependencies.mjs <management-root>')
    process.exit(64)
  }
  process.stdout.write(`${JSON.stringify(await verifyManagementDependencies(root))}\n`)
}
