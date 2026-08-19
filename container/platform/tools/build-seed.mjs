#!/usr/bin/env node

import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildRuntime } from '../runtime/builder.mjs'

const [installedArg, outputArg, version = 'seed'] = process.argv.slice(2)
if (installedArg === undefined || outputArg === undefined) {
  console.error('usage: build-seed.mjs <installed-dsh-root> <output> [version]')
  process.exit(64)
}
const installed = resolve(installedArg)
const output = resolve(outputArg)
const platformRoot = resolve(new URL('..', import.meta.url).pathname)
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

const bootstrapVersion = '1.0.0'
await cp(platformRoot, join(output, 'bootstrap', bootstrapVersion), {
  recursive: true,
  filter: source => !source.includes('/test/') && !source.includes('/seed/'),
})
await writeFile(join(output, 'bootstrap', 'VERSION'), `${bootstrapVersion}\n`)

const environmentVersion = '2026.08.19.1-seed'
const environmentOutput = join(output, 'environment', environmentVersion)
const packaged = spawnSync(process.execPath, [
  join(platformRoot, 'tools', 'package-environment.mjs'),
  join(platformRoot, 'environment', 'definition.json'),
  environmentOutput,
], { encoding: 'utf8' })
if (packaged.status !== 0) throw new Error(packaged.stderr || 'Environment packaging failed')
await writeFile(join(output, 'environment', 'VERSION'), `${environmentVersion}\n`)

await cp(installed, join(output, 'pristine', version), { recursive: true })
await buildRuntime({
  pristineRoot: installed,
  versionsRoot: join(output, 'runtime'),
  runtimeId: version,
  patchPaths: [
    resolve(platformRoot, '../patches/directory-picker.mjs'),
    resolve(platformRoot, '../patches/browser-loopback.mjs'),
  ],
})
await writeFile(join(output, 'runtime', 'VERSION'), `${version}\n`)

const pluginRoot = join(output, 'system-plugins', environmentVersion)
await mkdir(join(pluginRoot, 'packages', 'update-ui'), { recursive: true })
await cp(join(platformRoot, 'update-ui', 'package'), join(pluginRoot, 'packages', 'update-ui'), { recursive: true })
await cp(join(platformRoot, 'update-ui', 'package', 'cordis.patch.json'), join(pluginRoot, 'cordis.patch.yml'))

await cp(join(platformRoot, 'seed', 'trust'), join(output, 'trust'), { recursive: true })
