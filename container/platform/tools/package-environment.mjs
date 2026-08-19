#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { canonicalJson } from '../lib/canonical-json.mjs'
import { parseComponentManifest, parseEnvironmentManifest } from '../lib/contracts.mjs'

const [definitionArg, outputArg, generationArg = '1', sequenceArg = '1', baseUrlArg = 'https://github.com/yjrszcq/dsh-docker/releases/download/env-dev'] = process.argv.slice(2)
if (definitionArg === undefined || outputArg === undefined) {
  console.error('usage: package-environment.mjs <definition.json> <output-directory> [keyring-generation] [target-sequence] [artifact-base-url]')
  process.exit(64)
}

const definitionPath = resolve(definitionArg)
const definitionRoot = dirname(definitionPath)
const output = resolve(outputArg)
const definition = JSON.parse(await readFile(definitionPath, 'utf8'))
const generation = Number(generationArg)
const sequence = Number(sequenceArg)
const baseUrl = new URL(baseUrlArg.endsWith('/') ? baseUrlArg : `${baseUrlArg}/`)

if (definition.bootstrapApi !== 1) throw new Error('definition bootstrapApi must be 1')
if (!Array.isArray(definition.components) || !Array.isArray(definition.patches) || !Array.isArray(definition.systemPlugins)) {
  throw new Error('definition resource lists must be arrays')
}

await mkdir(join(output, 'artifacts'), { recursive: true })
const groups = ['components', 'patches', 'systemPlugins']
const artifacts = []
const references = {}
for (const group of groups) {
  references[group] = []
  for (const item of definition[group]) {
    const source = resolve(definitionRoot, item.source)
    const bytes = await readFile(source)
    if (group === 'components') {
      const component = parseComponentManifest(bytes)
      if (component.id !== item.id || component.version !== item.version) {
        throw new Error(`component ${item.id} metadata differs from its manifest`)
      }
    }
    const name = `${item.artifactId}-${basename(source)}`
    const destination = join(output, 'artifacts', name)
    await cp(source, destination, { errorOnExist: true, force: false })
    artifacts.push({
      id: item.artifactId,
      mediaType: item.mediaType,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength,
      url: new URL(`artifacts/${name}`, baseUrl).href,
    })
    references[group].push({ id: item.id, version: item.version, artifactId: item.artifactId })
  }
}

const manifest = {
  schema: 1,
  manifestType: 'environment',
  version: definition.version,
  keyringGeneration: generation,
  targetSequence: sequence,
  issuedAt: process.env.SOURCE_DATE_EPOCH === undefined
    ? '2026-08-19T00:00:00.000Z'
    : new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString(),
  artifacts,
  bootstrapApi: 1,
  components: references.components,
  patches: references.patches,
  systemPlugins: references.systemPlugins,
}
const manifestBytes = canonicalJson(manifest)
parseEnvironmentManifest(manifestBytes)
await writeFile(join(output, 'environment.manifest.json'), manifestBytes, { flag: 'wx' })
