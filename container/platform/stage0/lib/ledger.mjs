import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { durableCreate, durableReplace } from '../../lib/atomic.mjs'
import { parseExperimental } from '../../lib/contracts.mjs'
import { TrustError } from '../../lib/validation.mjs'
import { validateKeyringTransition, verifyRecoveryKeyring } from './keyring.mjs'
import { parseReleaseTarget, validateTargetTransition, verifyReleaseTarget } from './target.mjs'
import { validateExperimentalTransition, verifyExperimentalTarget } from './experimental.mjs'

async function readOptional(path) {
  try {
    return await readFile(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
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
    this.queue = Promise.resolve()
  }

  exclusive(operation) {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  keyringPath(name) {
    return join(this.root, 'keyring', name)
  }

  targetPath(name) {
    return join(this.root, 'target', name)
  }

  experimentalPath(name) {
    return join(this.root, 'experimental', name)
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

  acceptKeyring(bytes, signature) {
    return this.exclusive(() => this.acceptKeyringUnlocked(bytes, signature))
  }

  async acceptKeyringUnlocked(bytes, signature) {
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
    const generationPath = this.keyringPath(join('generations', `${String(next.generation)}.record.json`))
    const existingGeneration = await readOptional(generationPath)
    if (existingGeneration === undefined) {
      await durableCreate(generationPath, record)
    } else if (!this.parseKeyringRecord(existingGeneration).bytes.equals(bytes)) {
      throw new TrustError('keyring generation history conflicts with the proposed content')
    }
    await durableReplace(this.keyringPath('current.record.json'), record)
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

  acceptTarget(bytes, signature) {
    return this.exclusive(() => this.acceptTargetUnlocked(bytes, signature))
  }

  async acceptTargetUnlocked(bytes, signature) {
    const keyring = (await this.currentKeyring())?.value
    if (keyring === undefined) throw new TrustError('a keyring must be accepted before a release target')
    const next = verifyReleaseTarget(bytes, signature, keyring)
    const current = await this.currentTarget(keyring)
    if (current !== undefined) validateTargetTransition(current.bytes, current.value, bytes, next)
    if (current?.bytes.equals(bytes)) return current.value
    await durableReplace(this.targetPath('current.record.json'), signedRecord(bytes, signature))
    return next
  }

  async currentExperimental(keyring = undefined, stable = undefined) {
    const recordBytes = await readOptional(this.experimentalPath('current.record.json'))
    if (recordBytes === undefined) return undefined
    const { document, signature } = parseSignedRecord(recordBytes, 'experimental target')
    const currentStable = stable ?? (await this.currentTarget())?.value
    if (currentStable === undefined) throw new TrustError('experimental target requires an accepted stable target')
    const parsed = parseExperimental(document)
    const trustedKeyring = keyring?.generation === parsed.keyringGeneration
      ? keyring
      : (await this.keyringGeneration(parsed.keyringGeneration)).value
    return {
      bytes: document,
      signature,
      value: verifyExperimentalTarget(document, signature, trustedKeyring, currentStable),
    }
  }

  acceptExperimental(bytes, signature) {
    return this.exclusive(() => this.acceptExperimentalUnlocked(bytes, signature))
  }

  async acceptExperimentalUnlocked(bytes, signature) {
    const keyring = (await this.currentKeyring())?.value
    const stable = (await this.currentTarget(keyring))?.value
    if (keyring === undefined || stable === undefined) {
      throw new TrustError('keyring and stable target must be accepted before an experimental target')
    }
    const next = verifyExperimentalTarget(bytes, signature, keyring, stable)
    const current = await this.currentExperimental(keyring, stable)
    if (current !== undefined) validateExperimentalTransition(current.bytes, current.value, bytes, next)
    if (current?.bytes.equals(bytes)) return current.value
    await durableReplace(this.experimentalPath('current.record.json'), signedRecord(bytes, signature))
    return next
  }
}
