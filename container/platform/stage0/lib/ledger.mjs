import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { durableCreate, durableReplace } from '../../lib/atomic.mjs'
import { compareDshVersions } from '../../lib/supported-target.mjs'
import { TrustError } from '../../lib/validation.mjs'
import { validateKeyringTransition, verifyRecoveryKeyring } from './keyring.mjs'
import { parseReleaseTarget, validateTargetTransition, verifyReleaseTarget } from './target.mjs'
import { parseRegistryCandidate, verifyRegistryCandidate } from './experimental.mjs'
import { parseOfficialDshCandidate, verifyOfficialDshCandidate } from './official-dsh.mjs'

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

function parseExperimentalRecord(bytes) {
  let record
  try { record = JSON.parse(bytes.toString('utf8')) } catch { throw new TrustError('Experimental record must contain valid JSON') }
  if (
    record === null || typeof record !== 'object' || Array.isArray(record)
    || Object.keys(record).sort().join(',') !== 'candidate,objectSha256,size'
    || typeof record.objectSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.objectSha256)
    || !Number.isSafeInteger(record.size) || record.size < 0
  ) throw new TrustError('Experimental record is invalid')
  return { candidate: parseRegistryCandidate(record.candidate), objectSha256: record.objectSha256, size: record.size }
}

function parseOfficialDshRecord(bytes) {
  let record
  try { record = JSON.parse(bytes.toString('utf8')) } catch { throw new TrustError('official DSH record must contain valid JSON') }
  if (
    record === null || typeof record !== 'object' || Array.isArray(record)
    || Object.keys(record).sort().join(',') !== 'candidate,objectSha256,size'
    || typeof record.objectSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.objectSha256)
    || !Number.isSafeInteger(record.size) || record.size < 0
  ) throw new TrustError('official DSH record is invalid')
  return { candidate: parseOfficialDshCandidate(record.candidate), objectSha256: record.objectSha256, size: record.size }
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

  officialDshPath(name) {
    return join(this.root, 'official-dsh', name)
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

  async currentExperimental(stable = undefined) {
    const recordBytes = await readOptional(this.experimentalPath('current.record.json'))
    if (recordBytes === undefined) return undefined
    const record = parseExperimentalRecord(recordBytes)
    const currentStable = stable ?? (await this.currentTarget())?.value
    if (currentStable === undefined) throw new TrustError('Experimental candidate requires an accepted Stable target')
    return Object.freeze({ ...record, value: verifyRegistryCandidate(record.candidate, currentStable) })
  }

  acceptExperimental(candidate, objectSha256, size) {
    return this.exclusive(() => this.acceptExperimentalUnlocked(candidate, objectSha256, size))
  }

  async acceptExperimentalUnlocked(candidate, objectSha256, size) {
    if (typeof objectSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(objectSha256)) {
      throw new TrustError('Experimental object SHA-256 is invalid')
    }
    if (!Number.isSafeInteger(size) || size < 0) throw new TrustError('Experimental object size is invalid')
    const stable = (await this.currentTarget())?.value
    if (stable === undefined) throw new TrustError('Stable target must be accepted before an Experimental candidate')
    const next = verifyRegistryCandidate(candidate, stable)
    const previousBytes = await readOptional(this.experimentalPath('current.record.json'))
    if (previousBytes !== undefined) {
      const previous = parseExperimentalRecord(previousBytes)
      const compared = compareDshVersions(next.version, previous.candidate.version)
      if (compared < 0) throw new TrustError('Experimental DSH version cannot decrease', 'TRUST_ROLLBACK')
      if (compared === 0) {
        if (
          next.dist.integrity !== previous.candidate.dist.integrity
          || objectSha256 !== previous.objectSha256
          || size !== previous.size
        ) throw new TrustError('Experimental DSH version cannot identify different content')
        return Object.freeze({ ...previous, value: next })
      }
    }
    const record = { candidate, objectSha256, size }
    await durableReplace(this.experimentalPath('current.record.json'), `${JSON.stringify(record)}\n`)
    return Object.freeze({ candidate: next, objectSha256, size, value: next })
  }

  async currentOfficialDsh(target = undefined) {
    const recordBytes = await readOptional(this.officialDshPath('current.record.json'))
    if (recordBytes === undefined) return undefined
    const record = parseOfficialDshRecord(recordBytes)
    const currentTarget = target ?? (await this.currentTarget())?.value
    if (currentTarget === undefined || currentTarget.experimentalPolicy === null) {
      throw new TrustError('official DSH requires an accepted registry policy')
    }
    return Object.freeze({
      ...record,
      value: verifyOfficialDshCandidate(
        record.candidate,
        record.candidate.version,
        currentTarget.experimentalPolicy,
      ),
    })
  }

  acceptOfficialDsh(candidate, objectSha256, size) {
    return this.exclusive(() => this.acceptOfficialDshUnlocked(candidate, objectSha256, size))
  }

  async acceptOfficialDshUnlocked(candidate, objectSha256, size) {
    if (typeof objectSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(objectSha256)) {
      throw new TrustError('official DSH object SHA-256 is invalid')
    }
    if (!Number.isSafeInteger(size) || size < 0) throw new TrustError('official DSH object size is invalid')
    const target = (await this.currentTarget())?.value
    if (target === undefined || target.experimentalPolicy === null) {
      throw new TrustError('official DSH requires an accepted registry policy')
    }
    const candidateDocument = parseOfficialDshCandidate({
      schema: candidate.schema,
      name: candidate.name,
      version: candidate.version,
      dist: candidate.dist,
    })
    const next = verifyOfficialDshCandidate(candidateDocument, candidateDocument.version, target.experimentalPolicy)
    if (compareDshVersions(next.version, target.desired.dsh.version) < 0) {
      throw new TrustError('official DSH version is older than the current supported target', 'TRUST_ROLLBACK')
    }
    if (next.version === target.desired.dsh.version && next.dist.integrity !== target.desired.dsh.integrity) {
      throw new TrustError('official DSH does not match the supported target integrity', 'TRUST_ARTIFACT_MISMATCH')
    }
    const previousBytes = await readOptional(this.officialDshPath('current.record.json'))
    if (previousBytes !== undefined) {
      const previous = parseOfficialDshRecord(previousBytes)
      const compared = compareDshVersions(next.version, previous.candidate.version)
      if (compared < 0) throw new TrustError('official DSH version cannot decrease', 'TRUST_ROLLBACK')
      if (
        compared === 0
        && (
          next.dist.integrity !== previous.candidate.dist.integrity
          || objectSha256 !== previous.objectSha256
          || size !== previous.size
        )
      ) throw new TrustError('official DSH version cannot identify different content')
    }
    const record = { candidate: candidateDocument, objectSha256, size }
    await durableReplace(this.officialDshPath('current.record.json'), `${JSON.stringify(record)}\n`)
    return Object.freeze({ candidate: next, objectSha256, size, value: next })
  }
}
