#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildRuntime } from '../../control-plane/modules/patch-manager/index.mjs'

const [installedArg, outputArg, version = 'seed'] = process.argv.slice(2)
if (installedArg === undefined || outputArg === undefined) {
  console.error('usage: build-seed.mjs <installed-dsh-root> <output> [version]')
  process.exit(64)
}
const installed = resolve(installedArg)
const output = resolve(outputArg)
const platformRoot = resolve(new URL('..', import.meta.url).pathname)
const containerRoot = resolve(platformRoot, '..')
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

const bootstrapVersion = '1.0.0'
const bootstrapRoot = join(output, 'bootstrap', bootstrapVersion)
for (const directory of ['bootstrap', 'lib']) {
  await cp(join(platformRoot, directory), join(bootstrapRoot, 'platform', directory), { recursive: true })
}
for (const directory of ['log-manager', 'patch-manager', 'system-plugin-manager', 'updater']) {
  await cp(
    join(containerRoot, 'control-plane', 'modules', directory),
    join(bootstrapRoot, 'control-plane', 'modules', directory),
    { recursive: true },
  )
}
for (const directory of ['management', 'gateway']) {
  await cp(
    join(containerRoot, 'control-plane', 'services', directory),
    join(bootstrapRoot, 'control-plane', 'services', directory),
    { recursive: true },
  )
}
await cp(join(containerRoot, 'control-plane', 'definition.json'), join(bootstrapRoot, 'control-plane', 'definition.json'))
await writeFile(join(output, 'bootstrap', 'VERSION'), `${bootstrapVersion}\n`)

const environmentDefinition = join(containerRoot, 'environment', 'definition.json')
const environmentVersion = JSON.parse(await readFile(environmentDefinition, 'utf8')).version
const environmentOutput = join(output, 'environment', environmentVersion)
const packaged = spawnSync(process.execPath, [
  join(platformRoot, 'tools', 'package-environment.mjs'),
  environmentDefinition,
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
    resolve(containerRoot, 'patches/directory-picker.mjs'),
    resolve(containerRoot, 'patches/browser-loopback.mjs'),
  ],
})
await writeFile(join(output, 'runtime', 'VERSION'), `${version}\n`)

const pluginRoot = join(output, 'system-plugins', environmentVersion)
await mkdir(join(pluginRoot, 'packages', 'update-ui'), { recursive: true })
await cp(join(containerRoot, 'system-plugins', 'update-ui', 'package'), join(pluginRoot, 'packages', 'update-ui'), { recursive: true })
await cp(join(containerRoot, 'system-plugins', 'update-ui', 'package', 'cordis.patch.json'), join(pluginRoot, 'cordis.patch.yml'))

await cp(join(platformRoot, 'seed', 'trust'), join(output, 'trust'), { recursive: true })
