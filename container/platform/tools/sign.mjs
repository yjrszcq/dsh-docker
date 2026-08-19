#!/usr/bin/env node

import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { canonicalJson } from '../lib/canonical-json.mjs'

function usage() {
  console.error('usage: sign.mjs canonicalize <input> <output> | key-id <public-key-pem> | sign <private-key-pem> <document> <signature-output>')
  process.exitCode = 64
}

const [command, ...args] = process.argv.slice(2)
if (command === 'canonicalize' && args.length === 2) {
  await writeFile(args[1], canonicalJson(JSON.parse(await readFile(args[0], 'utf8'))), { flag: 'wx' })
} else if (command === 'key-id' && args.length === 1) {
  const key = createPublicKey(await readFile(args[0]))
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('public key must be Ed25519')
  const der = key.export({ format: 'der', type: 'spki' })
  process.stdout.write(`${createHash('sha256').update(der).digest('hex')}\n`)
} else if (command === 'sign' && args.length === 3) {
  const privateKey = createPrivateKey(await readFile(args[0]))
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('private key must be Ed25519')
  const publicKey = createPublicKey(privateKey)
  const der = publicKey.export({ format: 'der', type: 'spki' })
  const document = await readFile(args[1])
  const signature = {
    schema: 1,
    algorithm: 'Ed25519',
    keyId: createHash('sha256').update(der).digest('hex'),
    signature: sign(null, document, privateKey).toString('base64'),
  }
  await writeFile(args[2], canonicalJson(signature), { flag: 'wx', mode: 0o600 })
} else usage()
