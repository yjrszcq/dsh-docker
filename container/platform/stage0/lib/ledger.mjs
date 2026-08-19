import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { TrustError } from '../../lib/validation.mjs'
import { validateKeyringTransition, verifyRecoveryKeyring } from './keyring.mjs'
import { parseReleaseTarget, validateTargetTransition, verifyReleaseTarget } from './target.mjs'

async function readOptional(path) {
  try {
    return await readFile(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

async function atomicWrite(path, bytes) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
  await rename(temporary, path)
}

function signedRecord(document, signature) {
  return Buffer.from(`${JSON.stringify({ document: document.toString('base64'), signature })}\n`)
}

function parseSignedRecord(bytes, label) {
  let value
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new TrustError(`${label} record must contain valid JSON`)
  }
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || typeof value.document !== 'string'
    || value.signature === null
    || typeof value.signature !== 'object'
    || Array.isArray(value.signature)
    || Object.keys(value).sort().join(',') !== 'document,signature'
  ) {
    throw new TrustError(`${label} record is invalid`)
  }
  const document = Buffer.from(value.document, 'base64')
  if (document.toString('base64') !== value.document) {
    throw new TrustError(`${label} record document must be canonical base64`)
  }
  return { document, signature: value.signature }
}

export class TrustLedger {
  constructor(root, recoveryPublicKey) {
    this.root = root
    this.recoveryPublicKey = recoveryPublicKey
  }

  keyringPath(name) {
    return join(this.root, 'keyring', name)
  }

  targetPath(name) {
    return join(this.root, 'target', name)
  }

  async currentKeyring() {
    const recordBytes = await readOptional(this.keyringPath('current.record.json'))
    if (recordBytes === undefined) return undefined
    return this.parseKeyringRecord(recordBytes)
  }

  parseKeyringRecord(recordBytes) {
    const { document, signature } = parseSignedRecord(recordBytes, 'keyring')
    return {
      bytes: document,
      signature,
      value: verifyRecoveryKeyring(document, signature, this.recoveryPublicKey),
    }
  }

  async keyringGeneration(generation) {
    const recordBytes = await readOptional(this.keyringPath(join('generations', `${String(generation)}.record.json`)))
    if (recordBytes === undefined) throw new TrustError(`trusted keyring generation ${String(generation)} is missing`)
    const record = this.parseKeyringRecord(recordBytes)
    if (record.value.generation !== generation) throw new TrustError('keyring generation record is inconsistent')
    return record
  }

  async acceptKeyring(bytes, signature) {
    const next = verifyRecoveryKeyring(bytes, signature, this.recoveryPublicKey)
    const current = await this.currentKeyring()
    if (current !== undefined) {
      if (next.generation === current.value.generation) {
        if (!current.bytes.equals(bytes)) {
          throw new TrustError('keyring generation cannot identify different content')
        }
        return current.value
      }
      validateKeyringTransition(current.value, next)
    }
    const record = signedRecord(bytes, signature)
    await atomicWrite(this.keyringPath(join('generations', `${String(next.generation)}.record.json`)), record)
    await atomicWrite(this.keyringPath('current.record.json'), record)
    return next
  }

  async currentTarget(keyring = undefined) {
    const recordBytes = await readOptional(this.targetPath('current.record.json'))
    if (recordBytes === undefined) return undefined
    const { document, signature } = parseSignedRecord(recordBytes, 'release target')
    const parsed = parseReleaseTarget(document)
    const trustedKeyring = keyring?.generation === parsed.keyringGeneration
      ? keyring
      : (await this.keyringGeneration(parsed.keyringGeneration)).value
    return { bytes: document, signature, value: verifyReleaseTarget(document, signature, trustedKeyring) }
  }

  async acceptTarget(bytes, signature) {
    const keyring = (await this.currentKeyring())?.value
    if (keyring === undefined) throw new TrustError('a keyring must be accepted before a release target')
    const next = verifyReleaseTarget(bytes, signature, keyring)
    const current = await this.currentTarget(keyring)
    if (current !== undefined) validateTargetTransition(current.bytes, current.value, bytes, next)
    if (current?.bytes.equals(bytes)) return current.value
    await atomicWrite(this.targetPath('current.record.json'), signedRecord(bytes, signature))
    return next
  }
}
