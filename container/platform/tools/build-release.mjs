#!/usr/bin/env node

import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { canonicalJson } from '../lib/canonical-json.mjs'
import { parseStable } from '../lib/contracts.mjs'

const [configArg, privateKeyArg, outputArg] = process.argv.slice(2)
if (configArg === undefined || privateKeyArg === undefined || outputArg === undefined) {
  console.error('usage: build-release.mjs <release-config.json> <current-release-private.pem> <output-dir>')
  process.exit(64)
}
const config = JSON.parse(await readFile(resolve(configArg), 'utf8'))
const privateKey = createPrivateKey(await readFile(resolve(privateKeyArg)))
if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Release private key must be Ed25519')
const publicDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
const keyId = createHash('sha256').update(publicDer).digest('hex')
if (keyId !== config.currentKeyId) throw new Error('Release private key is not the configured current key')
const artifacts = []
for (const artifact of config.artifacts) {
  const bytes = await readFile(resolve(artifact.path))
  artifacts.push({
    id: artifact.id,
    mediaType: artifact.mediaType,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.byteLength,
    url: new URL(basename(artifact.path), config.artifactBaseUrl).href,
  })
}
const stable = canonicalJson({
  schema: 1,
  updateApi: 1,
  keyringGeneration: config.keyringGeneration,
  targetSequence: config.targetSequence,
  issuedAt: new Date().toISOString(),
  artifacts,
  desired: config.desired,
})
parseStable(stable)
const signature = canonicalJson({
  schema: 1,
  algorithm: 'Ed25519',
  keyId,
  signature: sign(null, stable, privateKey).toString('base64'),
})
const output = resolve(outputArg)
await mkdir(output, { recursive: true })
await writeFile(join(output, 'stable.json'), stable, { flag: 'wx' })
await writeFile(join(output, 'stable.sig.json'), signature, { flag: 'wx' })
