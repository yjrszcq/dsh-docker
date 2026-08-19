#!/usr/bin/env node

import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { canonicalJson } from '../lib/canonical-json.mjs'
import { parseKeyring, validateKeyringTransition } from '../stage0/lib/keyring.mjs'

const [recoveryPrivateArg, currentPublicArg, nextPublicArg, generationArg, outputArg, previousArg, ...revoked] = process.argv.slice(2)
if ([recoveryPrivateArg, currentPublicArg, nextPublicArg, generationArg, outputArg].some(value => value === undefined)) {
  console.error('usage: keyring.mjs <recovery-private.pem> <current-public.pem> <next-public.pem> <generation> <output-dir> [previous-keyring.json|-] [revoked-key-id...]')
  process.exit(64)
}

function releaseKey(pem) {
  const der = createPublicKey(pem).export({ format: 'der', type: 'spki' })
  return {
    algorithm: 'Ed25519',
    keyId: createHash('sha256').update(der).digest('hex'),
    publicKey: der.toString('base64'),
  }
}

const recoveryPrivate = createPrivateKey(await readFile(resolve(recoveryPrivateArg)))
if (recoveryPrivate.asymmetricKeyType !== 'ed25519') throw new Error('Recovery private key must be Ed25519')
const ring = {
  schema: 1,
  generation: Number(generationArg),
  current: releaseKey(await readFile(resolve(currentPublicArg))),
  next: releaseKey(await readFile(resolve(nextPublicArg))),
  revokedKeyIds: [...new Set(revoked)].sort(),
  issuedAt: new Date().toISOString(),
}
const bytes = canonicalJson(ring)
const parsed = parseKeyring(bytes)
if (previousArg !== undefined && previousArg !== '-') {
  validateKeyringTransition(parseKeyring(await readFile(resolve(previousArg))), parsed)
}
const recoveryDer = createPublicKey(recoveryPrivate).export({ format: 'der', type: 'spki' })
const signature = canonicalJson({
  schema: 1,
  algorithm: 'Ed25519',
  keyId: createHash('sha256').update(recoveryDer).digest('hex'),
  signature: sign(null, bytes, recoveryPrivate).toString('base64'),
})
const output = resolve(outputArg)
await mkdir(output, { recursive: true })
await writeFile(join(output, 'recovery-root.spki.base64'), `${recoveryDer.toString('base64')}\n`, { flag: 'wx' })
await writeFile(join(output, 'keyring.json'), bytes, { flag: 'wx' })
await writeFile(join(output, 'keyring.sig.json'), signature, { flag: 'wx' })
