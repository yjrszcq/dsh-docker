#!/usr/bin/env node

import { open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { validateSupportedTarget, advanceSupportedDsh } from '../lib/supported-target.mjs'

const args = process.argv.slice(2)
const [command, targetArg, definitionArg, upstreamVersion] = args
const expectedArguments = command === 'validate' ? 3 : command === 'advance' ? 4 : -1
if (args.length !== expectedArguments) {
  console.error('usage: supported-target.mjs <validate|advance> <supported-target.json> <environment-definition.json> [upstream-version]')
  process.exit(64)
}

const targetPath = resolve(targetArg)
const definitionPath = resolve(definitionArg)
const target = validateSupportedTarget(await readFile(targetPath), await readFile(definitionPath))
if (command === 'validate') {
  process.stdout.write(`${JSON.stringify({ changed: false, target })}\n`)
  process.exit(0)
}

const advanced = advanceSupportedDsh(target, upstreamVersion)
if (advanced.changed) {
  const temporary = `${targetPath}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o644)
  try {
    await handle.writeFile(`${JSON.stringify(advanced.target, null, 2)}\n`)
    await handle.sync()
    await handle.close()
    await rename(temporary, targetPath)
    const directory = await open(dirname(targetPath), 'r')
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
process.stdout.write(`${JSON.stringify(advanced)}\n`)
