#!/usr/bin/env node

import { open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { compareSemanticVersions, validateSupportedTarget } from '../lib/supported-target.mjs'

const repositoryRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)))

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o644)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`)
    await handle.sync()
    await handle.close()
    await rename(temporary, path)
    const directory = await open(dirname(path), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } catch (error) {
    await handle.close().catch(() => {})
    await rm(temporary, { force: true })
    throw error
  }
}

export async function bumpEnvironmentVersion(newVersion, {
  definitionPath = resolve(repositoryRoot, 'container/environment/definition.json'),
  targetPath = resolve(repositoryRoot, 'release/supported-target.json'),
} = {}) {
  const definitionBytes = await readFile(definitionPath)
  const targetBytes = await readFile(targetPath)
  const target = validateSupportedTarget(targetBytes, definitionBytes)
  const definition = JSON.parse(definitionBytes)
  const comparison = compareSemanticVersions(
    newVersion,
    definition.version,
    'new Environment version',
    'current Environment version',
  )
  if (comparison < 0) throw new Error('new Environment version would roll back the current version')
  if (comparison === 0) return Object.freeze({ changed: false, version: definition.version })

  await writeJsonAtomic(definitionPath, { ...definition, version: newVersion })
  await writeJsonAtomic(targetPath, { ...target, environment: newVersion })
  return Object.freeze({ changed: true, previousVersion: definition.version, version: newVersion })
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [newVersion, extra] = process.argv.slice(2)
  if (newVersion === undefined || extra !== undefined) {
    console.error('usage: bump-environment.mjs <new-environment-version>')
    process.exit(64)
  }
  process.stdout.write(`${JSON.stringify(await bumpEnvironmentVersion(newVersion))}\n`)
}
