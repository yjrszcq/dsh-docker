#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson } from '../lib/canonical-json.mjs'
import { parseBootstrapManifest, parseEnvironmentManifest, parseOfficialDshPolicy } from '../lib/contracts.mjs'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function releaseManifest(document) {
  const normalized = structuredClone(document)
  delete normalized.issuedAt
  delete normalized.keyringGeneration
  delete normalized.targetSequence
  for (const artifact of normalized.artifacts) delete artifact.url
  return normalized
}

export async function createEnvironmentRelease({ bootstrapManifestPath, environmentManifestPath, officialDshPolicyPath }) {
  const bootstrapBytes = await readFile(resolve(bootstrapManifestPath))
  const environmentBytes = await readFile(resolve(environmentManifestPath))
  const policy = parseOfficialDshPolicy(JSON.parse(await readFile(resolve(officialDshPolicyPath), 'utf8')))
  const bootstrap = parseBootstrapManifest(bootstrapBytes)
  const environment = parseEnvironmentManifest(environmentBytes)
  const bootstrapDocument = JSON.parse(bootstrapBytes)
  const environmentDocument = JSON.parse(environmentBytes)

  return Object.freeze({
    schema: 1,
    version: environment.version,
    bootstrapVersion: bootstrap.version,
    bootstrapContentSha256: sha256(canonicalJson(releaseManifest(bootstrapDocument))),
    environmentContentSha256: sha256(canonicalJson(releaseManifest(environmentDocument))),
    officialDshPolicySha256: sha256(canonicalJson(policy)),
  })
}

const invoked = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
  const [bootstrapManifestPath, environmentManifestPath, officialDshPolicyPath, outputPath] = process.argv.slice(2)
  if ([bootstrapManifestPath, environmentManifestPath, officialDshPolicyPath, outputPath].includes(undefined)) {
    console.error('usage: environment-release.mjs <bootstrap.manifest.json> <environment.manifest.json> <official-dsh-policy.json> <output.json>')
    process.exit(64)
  }
  const release = await createEnvironmentRelease({ bootstrapManifestPath, environmentManifestPath, officialDshPolicyPath })
  await writeFile(resolve(outputPath), canonicalJson(release), { flag: 'wx' })
}
