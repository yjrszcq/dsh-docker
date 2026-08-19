import { constants } from 'node:fs'
import { link, mkdir, open, readdir, readFile, rm } from 'node:fs/promises'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import { durableReplace } from '../../lib/atomic.mjs'
import { exactKeys, isoTimestamp, parseJsonDocument, plainObject, positiveSafeInteger, TrustError } from '../../lib/validation.mjs'
import { compareDshVersions } from '../../lib/supported-target.mjs'
import { verifyRegistryCandidate } from './experimental.mjs'
import {
  fetchOfficialDshCandidate,
  fetchOfficialDshTarball,
  OFFICIAL_DSH_TARBALL_LIMIT,
} from './official-dsh.mjs'
import { verifyDetached } from './signature.mjs'

export const MANIFEST_MEDIA_TYPE = 'application/vnd.dsh-platform.manifest.v1+json'
export const SIGNATURE_MEDIA_TYPE = 'application/vnd.dsh-platform.signature.v1+json'

function nonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TrustError(`${label} must be a non-negative safe integer`)
  }
  return value
}

export function parseArtifactDescriptor(value, label = 'artifact') {
  const object = plainObject(value, label)
  exactKeys(object, ['id', 'mediaType', 'sha256', 'size', 'url'], label)
  if (typeof object.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(object.id)) {
    throw new TrustError(`${label}.id is invalid`)
  }
  if (typeof object.mediaType !== 'string' || !/^[\x21-\x7e]{1,127}$/.test(object.mediaType)) {
    throw new TrustError(`${label}.mediaType is invalid`)
  }
  if (typeof object.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(object.sha256)) {
    throw new TrustError(`${label}.sha256 must be a SHA-256 hex digest`)
  }
  const size = nonNegativeSafeInteger(object.size, `${label}.size`)
  let url
  try {
    url = new URL(object.url)
  } catch {
    throw new TrustError(`${label}.url must be an HTTPS URL`)
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new TrustError(`${label}.url must be an HTTPS URL without credentials`)
  }
  return Object.freeze({
    id: object.id,
    mediaType: object.mediaType,
    sha256: object.sha256,
    size,
    url: url.href,
  })
}

export function parseArtifactList(value, label) {
  if (!Array.isArray(value)) throw new TrustError(`${label} must be an array`)
  const artifacts = value.map((entry, index) => parseArtifactDescriptor(entry, `${label}[${String(index)}]`))
  if (new Set(artifacts.map(artifact => artifact.id)).size !== artifacts.length) {
    throw new TrustError(`${label} must not contain duplicate IDs`)
  }
  return Object.freeze(artifacts)
}

export function parseReleaseManifest(bytes) {
  const object = parseJsonDocument(bytes, 'release manifest')
  const common = ['artifacts', 'issuedAt', 'keyringGeneration', 'manifestType', 'schema', 'targetSequence', 'version']
  const specific = object.manifestType === 'bootstrap'
    ? ['bootstrapApi', 'entrypoint']
    : object.manifestType === 'environment'
      ? ['bootstrapApi', 'components', 'patches', 'systemPlugins']
      : []
  exactKeys(object, [...common, ...specific], 'release manifest')
  if (object.schema !== 1) throw new TrustError('release manifest schema must be 1')
  if (typeof object.manifestType !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(object.manifestType)) {
    throw new TrustError('release manifest manifestType is invalid')
  }
  if (typeof object.version !== 'string' || object.version === '') {
    throw new TrustError('release manifest version is invalid')
  }
  return Object.freeze({
    document: object,
    keyringGeneration: positiveSafeInteger(object.keyringGeneration, 'release manifest keyringGeneration'),
    targetSequence: positiveSafeInteger(object.targetSequence, 'release manifest targetSequence'),
    issuedAt: isoTimestamp(object.issuedAt, 'release manifest issuedAt'),
    artifacts: parseArtifactList(object.artifacts, 'release manifest artifacts'),
  })
}

function descriptorsFromTarget(target) {
  return parseArtifactList(target.document.artifacts, 'release target artifacts')
}

function descriptorById(artifacts, artifactId) {
  const descriptor = artifacts.find(artifact => artifact.id === artifactId)
  if (descriptor === undefined) throw new TrustError(`artifact ${JSON.stringify(artifactId)} is not authorized`)
  return descriptor
}

async function atomicJson(path, value) {
  await durableReplace(path, `${JSON.stringify(value)}\n`)
}

async function hashFile(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  const hash = createHash('sha256')
  let size = 0
  try {
    if (!(await handle.stat()).isFile()) throw new TrustError('trusted object must be a regular file')
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk)
      size += chunk.byteLength
    }
  } finally {
    await handle.close()
  }
  return { sha256: hash.digest('hex'), size }
}

function receiptToken() {
  return randomBytes(32).toString('base64url')
}

function validateReceipt(value) {
  const receipt = plainObject(value, 'receipt')
  const required = [
    'artifactId', 'authoritySignature', 'importedAt', 'keyringGeneration', 'mediaType',
    'objectSha256', 'parentReceipt', 'parentSha256', 'signerKeyId', 'size', 'status',
    'targetSequence', 'token',
  ]
  const authorityType = receipt.authorityType ?? 'stable'
  const receiptFields = receipt.authorityType === undefined
    ? required
    : [...required, 'authorityType', ...(['experimental', 'official-dsh'].includes(authorityType) ? ['authorityVersion'] : [])]
  exactKeys(receipt, receiptFields, 'receipt')
  if (!['stable', 'experimental', 'official-dsh'].includes(authorityType)) throw new TrustError('receipt authority type is invalid')
  if (['experimental', 'official-dsh'].includes(authorityType)) {
    compareDshVersions(receipt.authorityVersion, receipt.authorityVersion)
  }
  if (typeof receipt.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(receipt.token)) {
    throw new TrustError('receipt token is invalid')
  }
  if (!['staged', 'active', 'previous', 'retired', 'revoked'].includes(receipt.status)) {
    throw new TrustError('receipt status is invalid')
  }
  if (typeof receipt.artifactId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(receipt.artifactId)) {
    throw new TrustError('receipt artifact ID is invalid')
  }
  if (typeof receipt.mediaType !== 'string' || !/^[\x21-\x7e]{1,127}$/.test(receipt.mediaType)) {
    throw new TrustError('receipt media type is invalid')
  }
  for (const [name, digest] of [
    ['object SHA-256', receipt.objectSha256],
    ['parent SHA-256', receipt.parentSha256],
    ['signer key ID', receipt.signerKeyId],
  ]) {
    const valid = name === 'signer key ID' && ['experimental', 'official-dsh'].includes(authorityType)
      ? typeof digest === 'string' && /^SHA256:[A-Za-z0-9+/]{43}$/.test(digest)
      : typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest)
    if (!valid) {
      throw new TrustError(`receipt ${name} is invalid`)
    }
  }
  nonNegativeSafeInteger(receipt.size, 'receipt size')
  positiveSafeInteger(receipt.keyringGeneration, 'receipt keyring generation')
  positiveSafeInteger(receipt.targetSequence, 'receipt target sequence')
  isoTimestamp(receipt.importedAt, 'receipt import time')
  if (
    receipt.parentReceipt !== null
    && (typeof receipt.parentReceipt !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(receipt.parentReceipt))
  ) throw new TrustError('receipt parent token is invalid')
  if (
    receipt.authoritySignature !== null
    && (typeof receipt.authoritySignature !== 'object' || Array.isArray(receipt.authoritySignature))
  ) throw new TrustError('receipt authority signature is invalid')
  return Object.assign(receipt, { authorityType })
}

export class VerifiedObjectStore {
  constructor({ root, untrustedRoot, ledger, now = () => new Date(), fetchImpl = fetch, requestTimeoutMs = 30_000 }) {
    this.root = resolve(root)
    this.untrustedRoot = resolve(untrustedRoot)
    this.ledger = ledger
    this.now = now
    this.fetchImpl = fetchImpl
    this.requestTimeoutMs = requestTimeoutMs
    this.queue = Promise.resolve()
  }

  exclusive(operation) {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  objectPath(sha256) {
    return join(this.root, 'objects', sha256)
  }

  receiptPath(token) {
    return join(this.root, 'receipts', `${token}.json`)
  }

  async readReceipt(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new TrustError('receipt token is invalid')
    }
    let value
    try {
      value = JSON.parse(await readFile(this.receiptPath(token), 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') throw new TrustError('receipt does not exist')
      throw error
    }
    return validateReceipt(value)
  }

  async authorityFromTarget(artifactId) {
    const target = await this.ledger.currentTarget()
    if (target === undefined) throw new TrustError('no accepted release target exists')
    return {
      descriptor: descriptorById(descriptorsFromTarget(target.value), artifactId),
      keyringGeneration: target.value.keyringGeneration,
      parentReceipt: null,
      parentSha256: createHash('sha256').update(target.bytes).digest('hex'),
      signerKeyId: target.value.keyId,
      targetSequence: target.value.targetSequence,
      authorityType: 'stable',
    }
  }

  async authorityFromManifest(parentToken, artifactId) {
    const parent = await this.readReceipt(parentToken)
    if (!['staged', 'active', 'previous'].includes(parent.status)) {
      throw new TrustError('parent manifest receipt is not usable')
    }
    if (parent.authoritySignature === null) throw new TrustError('parent receipt is not a verified manifest')
    const bytes = await readFile(this.objectPath(parent.objectSha256))
    const manifest = parseReleaseManifest(bytes)
    const keyring = (await this.ledger.keyringGeneration(manifest.keyringGeneration)).value
    const signerKeyId = verifyDetached(bytes, parent.authoritySignature, keyring.current.publicKey, 'release manifest')
    if (
      manifest.targetSequence !== parent.targetSequence
      || manifest.keyringGeneration !== parent.keyringGeneration
      || signerKeyId !== parent.signerKeyId
    ) throw new TrustError('parent manifest receipt is inconsistent')
    return {
      descriptor: descriptorById(manifest.artifacts, artifactId),
      keyringGeneration: manifest.keyringGeneration,
      parentReceipt: parentToken,
      parentSha256: parent.objectSha256,
      signerKeyId,
      targetSequence: manifest.targetSequence,
      authorityType: 'stable',
    }
  }

  importFromTarget(artifactId, sourcePath) {
    return this.exclusive(async () => this.importAuthorized(
      await this.authorityFromTarget(artifactId),
      sourcePath,
    ))
  }

  importFromManifest(parentToken, artifactId, sourcePath) {
    return this.exclusive(async () => this.importAuthorized(
      await this.authorityFromManifest(parentToken, artifactId),
      sourcePath,
    ))
  }

  async importAuthorized(authority, sourcePath) {
    const currentKeyring = (await this.ledger.currentKeyring())?.value
    const currentTarget = (await this.ledger.currentTarget())?.value
    if (
      currentKeyring === undefined
      || currentTarget === undefined
      || authority.keyringGeneration !== currentKeyring.generation
      || authority.signerKeyId !== currentKeyring.current.keyId
      || authority.targetSequence !== currentTarget.targetSequence
    ) throw new TrustError('artifact authority is no longer current', 'TRUST_REVOKED')
    const source = resolve(sourcePath)
    if (source !== this.untrustedRoot && !source.startsWith(`${this.untrustedRoot}/`)) {
      throw new TrustError('artifact source must be inside the untrusted download directory')
    }
    await mkdir(join(this.root, 'objects'), { recursive: true })
    const destination = this.objectPath(authority.descriptor.sha256)
    const temporary = `${destination}.${randomUUID()}.tmp`
    const sourceHandle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
    let destinationHandle
    try {
      if (!(await sourceHandle.stat()).isFile()) throw new TrustError('artifact source must be a regular file')
      destinationHandle = await open(temporary, 'wx', 0o400)
      const hash = createHash('sha256')
      let size = 0
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk)
          size += chunk.byteLength
          callback(null, chunk)
        },
      })
      await pipeline(sourceHandle.createReadStream({ autoClose: false }), meter, destinationHandle.createWriteStream())
      destinationHandle = undefined
      const sha256 = hash.digest('hex')
      if (size !== authority.descriptor.size || sha256 !== authority.descriptor.sha256) {
        throw new TrustError('artifact content does not match its signed descriptor', 'TRUST_ARTIFACT_MISMATCH')
      }
      try {
        await link(temporary, destination)
        await rm(temporary)
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        const existing = await hashFile(destination)
        if (existing.size !== size || existing.sha256 !== sha256) {
          throw new TrustError('trusted object store contains conflicting content')
        }
        await rm(temporary, { force: true })
      }
      const receipt = {
        token: receiptToken(),
        artifactId: authority.descriptor.id,
        mediaType: authority.descriptor.mediaType,
        objectSha256: sha256,
        size,
        parentReceipt: authority.parentReceipt,
        parentSha256: authority.parentSha256,
        signerKeyId: authority.signerKeyId,
        keyringGeneration: authority.keyringGeneration,
        targetSequence: authority.targetSequence,
        authorityType: authority.authorityType,
        status: 'staged',
        authoritySignature: null,
        importedAt: this.now().toISOString(),
      }
      await atomicJson(this.receiptPath(receipt.token), receipt)
      return Object.freeze({ ...receipt, path: destination })
    } finally {
      await sourceHandle.close().catch(() => {})
      await destinationHandle?.close().catch(() => {})
      await rm(temporary, { force: true }).catch(() => {})
    }
  }

  importFromExperimental(candidateValue, sourcePath) {
    return this.exclusive(async () => {
      const stable = (await this.ledger.currentTarget())?.value
      if (stable === undefined) throw new TrustError('Experimental import requires a current Stable target')
      const candidate = verifyRegistryCandidate(candidateValue, stable, this.now())
      const source = resolve(sourcePath)
      if (source !== this.untrustedRoot && !source.startsWith(`${this.untrustedRoot}/`)) {
        throw new TrustError('artifact source must be inside the untrusted download directory')
      }
      await mkdir(join(this.root, 'objects'), { recursive: true })
      const sourceHandle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
      const temporary = join(this.root, 'objects', `.${randomUUID()}.tmp`)
      let destinationHandle
      try {
        if (!(await sourceHandle.stat()).isFile()) throw new TrustError('artifact source must be a regular file')
        destinationHandle = await open(temporary, 'wx', 0o400)
        const sha256 = createHash('sha256')
        const sha512 = createHash('sha512')
        let size = 0
        const meter = new Transform({
          transform(chunk, _encoding, callback) {
            sha256.update(chunk)
            sha512.update(chunk)
            size += chunk.byteLength
            callback(null, chunk)
          },
        })
        await pipeline(sourceHandle.createReadStream({ autoClose: false }), meter, destinationHandle.createWriteStream())
        destinationHandle = undefined
        const objectSha256 = sha256.digest('hex')
        const integrity = `sha512-${sha512.digest('base64')}`
        if (integrity !== candidate.dist.integrity) {
          throw new TrustError('Experimental Artifact does not match npm integrity', 'TRUST_ARTIFACT_MISMATCH')
        }
        const destination = this.objectPath(objectSha256)
        try {
          await link(temporary, destination)
          await rm(temporary)
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error
          const existing = await hashFile(destination)
          if (existing.size !== size || existing.sha256 !== objectSha256) {
            throw new TrustError('trusted object store contains conflicting content')
          }
          await rm(temporary, { force: true })
        }
        await this.ledger.acceptExperimental(candidateValue, objectSha256, size)
        const authority = `${candidate.name}@${candidate.version}:${candidate.dist.integrity}`
        const receipt = {
          token: receiptToken(),
          artifactId: 'experimental-dsh-tarball',
          mediaType: 'application/vnd.npm.package+gzip',
          objectSha256,
          size,
          parentReceipt: null,
          parentSha256: createHash('sha256').update(authority).digest('hex'),
          signerKeyId: candidate.signerKeyId,
          keyringGeneration: stable.keyringGeneration,
          targetSequence: stable.targetSequence,
          authorityType: 'experimental',
          authorityVersion: candidate.version,
          status: 'staged',
          authoritySignature: null,
          importedAt: this.now().toISOString(),
        }
        await atomicJson(this.receiptPath(receipt.token), receipt)
        return Object.freeze({ ...receipt, path: destination })
      } finally {
        await sourceHandle.close().catch(() => {})
        await destinationHandle?.close().catch(() => {})
        await rm(temporary, { force: true }).catch(() => {})
      }
    })
  }

  ensureOfficialDsh(requestedVersion) {
    return this.exclusive(async () => {
      compareDshVersions(requestedVersion, requestedVersion)
      const target = (await this.ledger.currentTarget())?.value
      if (target === undefined || target.experimentalPolicy === null) {
        throw new TrustError('official DSH import requires an accepted registry policy')
      }
      if (compareDshVersions(requestedVersion, target.desired.dsh.version) < 0) {
        throw new TrustError('official DSH version is older than the current supported target', 'TRUST_ROLLBACK')
      }
      const signal = AbortSignal.timeout(this.requestTimeoutMs)
      const candidate = await fetchOfficialDshCandidate({
        requestedVersion,
        policy: target.experimentalPolicy,
        fetchImpl: this.fetchImpl,
        now: this.now(),
        signal,
      })
      if (requestedVersion === target.desired.dsh.version && candidate.dist.integrity !== target.desired.dsh.integrity) {
        throw new TrustError('official DSH metadata does not match the supported target integrity', 'TRUST_ARTIFACT_MISMATCH')
      }
      const body = await fetchOfficialDshTarball({ candidate, fetchImpl: this.fetchImpl, signal })
      await mkdir(join(this.root, 'objects'), { recursive: true })
      const temporary = join(this.root, 'objects', `.${randomUUID()}.tmp`)
      let destinationHandle
      try {
        destinationHandle = await open(temporary, 'wx', 0o400)
        const sha256 = createHash('sha256')
        const sha512 = createHash('sha512')
        let size = 0
        const meter = new Transform({
          transform(chunk, _encoding, callback) {
            size += chunk.byteLength
            if (size > OFFICIAL_DSH_TARBALL_LIMIT) {
              callback(new TrustError('official DSH tarball exceeds the download limit'))
              return
            }
            sha256.update(chunk)
            sha512.update(chunk)
            callback(null, chunk)
          },
        })
        await pipeline(Readable.fromWeb(body), meter, destinationHandle.createWriteStream())
        destinationHandle = undefined
        const objectSha256 = sha256.digest('hex')
        const integrity = `sha512-${sha512.digest('base64')}`
        if (integrity !== candidate.dist.integrity) {
          throw new TrustError('official DSH tarball does not match signed npm integrity', 'TRUST_ARTIFACT_MISMATCH')
        }
        const destination = this.objectPath(objectSha256)
        try {
          await link(temporary, destination)
          await rm(temporary)
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error
          const existing = await hashFile(destination)
          if (existing.size !== size || existing.sha256 !== objectSha256) {
            throw new TrustError('trusted object store contains conflicting content')
          }
          await rm(temporary, { force: true })
        }
        const accepted = await this.ledger.acceptOfficialDsh(candidate, objectSha256, size)
        const verifiedCandidate = accepted.value
        const authority = `${candidate.name}@${candidate.version}:${candidate.dist.integrity}`
        const receipt = {
          token: receiptToken(),
          artifactId: 'official-dsh-tarball',
          mediaType: 'application/vnd.npm.package+gzip',
          objectSha256,
          size,
          parentReceipt: null,
          parentSha256: createHash('sha256').update(authority).digest('hex'),
          signerKeyId: verifiedCandidate.signerKeyId,
          keyringGeneration: accepted.keyringGeneration,
          targetSequence: accepted.targetSequence,
          authorityType: 'official-dsh',
          authorityVersion: candidate.version,
          status: 'staged',
          authoritySignature: null,
          importedAt: this.now().toISOString(),
        }
        await atomicJson(this.receiptPath(receipt.token), receipt)
        return Object.freeze({ ...receipt, path: destination })
      } finally {
        await destinationHandle?.close().catch(() => {})
        await rm(temporary, { force: true }).catch(() => {})
      }
    })
  }

  acceptManifest(token, signatureToken) {
    return this.exclusive(async () => {
      const receipt = await this.readReceipt(token)
      const signatureReceipt = await this.readReceipt(signatureToken)
      if (receipt.mediaType !== MANIFEST_MEDIA_TYPE) throw new TrustError('receipt is not a manifest artifact')
      if (receipt.status !== 'staged') throw new TrustError('only a staged manifest can become an authority')
      if (signatureReceipt.mediaType !== SIGNATURE_MEDIA_TYPE) throw new TrustError('signature receipt has the wrong media type')
      if (signatureReceipt.status !== 'staged' || signatureReceipt.parentReceipt !== null) {
        throw new TrustError('manifest signature must be a staged target Artifact')
      }
      if (
        signatureReceipt.keyringGeneration !== receipt.keyringGeneration
        || signatureReceipt.targetSequence !== receipt.targetSequence
        || signatureReceipt.signerKeyId !== receipt.signerKeyId
      ) throw new TrustError('manifest and signature receipts have different authorities')
      const bytes = await readFile(this.objectPath(receipt.objectSha256))
      const signatureBytes = await readFile(this.objectPath(signatureReceipt.objectSha256))
      let signature
      try {
        signature = JSON.parse(signatureBytes.toString('utf8'))
      } catch {
        throw new TrustError('manifest signature Artifact must contain valid JSON')
      }
      const manifest = parseReleaseManifest(bytes)
      const currentTarget = await this.ledger.currentTarget()
      if (
        currentTarget === undefined
        || manifest.keyringGeneration !== currentTarget.value.keyringGeneration
        || manifest.targetSequence !== currentTarget.value.targetSequence
      ) throw new TrustError('manifest does not belong to the current release target')
      const keyring = (await this.ledger.currentKeyring()).value
      const signerKeyId = verifyDetached(bytes, signature, keyring.current.publicKey, 'release manifest')
      if (signerKeyId !== receipt.signerKeyId) throw new TrustError('manifest signer differs from its parent target')
      const updated = { ...receipt, authoritySignature: signature }
      await atomicJson(this.receiptPath(token), updated)
      return Object.freeze(updated)
    })
  }

  async receiptFiles() {
    try {
      return (await readdir(join(this.root, 'receipts'))).filter(name => name.endsWith('.json'))
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
  }

  async allReceipts() {
    return Promise.all((await this.receiptFiles()).map(async name => (
      validateReceipt(JSON.parse(await readFile(join(this.root, 'receipts', name), 'utf8')))
    )))
  }

  async activeReceipts() {
    return Object.freeze((await this.allReceipts())
      .filter(receipt => receipt.status === 'active')
      .map(receipt => Object.freeze({ token: receipt.token, authorityType: receipt.authorityType })))
  }

  reconcileRevocations(keyring) {
    return this.exclusive(async () => {
      const receipts = await this.allReceipts()
      const revoked = new Set(keyring.revokedKeyIds)
      const currentTarget = (await this.ledger.currentTarget())?.value
      const currentExperimental = await this.ledger.currentExperimental().catch(() => undefined)
      const currentOfficialDsh = await this.ledger.currentOfficialDsh().catch(() => undefined)
      const unusable = new Set(receipts.filter(receipt => (
        receipt.status === 'revoked' || receipt.status === 'retired'
      )).map(receipt => receipt.token))
      let changed = true
      while (changed) {
        changed = false
        for (const receipt of receipts) {
          if (
            receipt.status === 'staged'
            && (
              revoked.has(receipt.signerKeyId)
              || (receipt.authorityType === 'stable' && (
                currentTarget === undefined
                || receipt.keyringGeneration !== currentTarget.keyringGeneration
                || receipt.targetSequence !== currentTarget.targetSequence
              ))
              || (receipt.authorityType === 'experimental' && (
                currentExperimental === undefined
                || receipt.authorityVersion !== currentExperimental.value.version
                || receipt.objectSha256 !== currentExperimental.objectSha256
                || receipt.signerKeyId !== currentExperimental.value.signerKeyId
              ))
              || (receipt.authorityType === 'official-dsh' && (
                currentOfficialDsh === undefined
                || receipt.authorityVersion !== currentOfficialDsh.value.version
                || receipt.objectSha256 !== currentOfficialDsh.objectSha256
                || receipt.signerKeyId !== currentOfficialDsh.value.signerKeyId
              ))
              || (receipt.parentReceipt !== null && unusable.has(receipt.parentReceipt))
            )
          ) {
            receipt.status = 'revoked'
            unusable.add(receipt.token)
            changed = true
          }
        }
      }
      for (const receipt of receipts) await atomicJson(this.receiptPath(receipt.token), receipt)
      return receipts.filter(receipt => receipt.status === 'revoked').map(receipt => receipt.token)
    })
  }

  activate(tokens) {
    return this.exclusive(async () => {
      const receipts = await this.allReceipts()
      const byToken = new Map(receipts.map(receipt => [receipt.token, receipt]))
      const selected = new Set()
      const currentKeyring = (await this.ledger.currentKeyring())?.value
      if (currentKeyring === undefined) throw new TrustError('activation requires a current keyring')
      const currentTarget = (await this.ledger.currentTarget())?.value
      if (currentTarget === undefined) throw new TrustError('activation requires a current release target')
      const currentExperimental = await this.ledger.currentExperimental().catch(() => undefined)
      const currentOfficialDsh = await this.ledger.currentOfficialDsh().catch(() => undefined)
      const add = (token) => {
        const receipt = byToken.get(token)
        if (receipt === undefined) throw new TrustError('activation references an unknown receipt')
        if (!['staged', 'active', 'previous'].includes(receipt.status)) {
          throw new TrustError('activation references an unusable receipt')
        }
        const authorityCurrent = receipt.authorityType === 'official-dsh'
          ? currentOfficialDsh !== undefined
            && receipt.authorityVersion === currentOfficialDsh.value.version
            && receipt.objectSha256 === currentOfficialDsh.objectSha256
            && receipt.signerKeyId === currentOfficialDsh.value.signerKeyId
          : receipt.authorityType === 'experimental'
          ? currentExperimental !== undefined
            && receipt.authorityVersion === currentExperimental.value.version
            && receipt.objectSha256 === currentExperimental.objectSha256
            && receipt.signerKeyId === currentExperimental.value.signerKeyId
          : receipt.keyringGeneration === currentKeyring.generation
            && receipt.signerKeyId === currentKeyring.current.keyId
            && receipt.targetSequence === currentTarget.targetSequence
        if (
          receipt.status === 'staged'
          && !authorityCurrent
        ) throw new TrustError('activation references a revoked receipt', 'TRUST_REVOKED')
        if (selected.has(token)) return
        selected.add(token)
        if (receipt.parentReceipt !== null) add(receipt.parentReceipt)
      }
      for (const token of tokens) add(token)
      for (const receipt of receipts) {
        if (selected.has(receipt.token)) receipt.status = 'active'
        else if (receipt.status === 'active') receipt.status = 'previous'
        else if (receipt.status === 'previous') receipt.status = 'retired'
        await atomicJson(this.receiptPath(receipt.token), receipt)
      }
      return Object.freeze([...selected])
    })
  }

  rollback() {
    return this.exclusive(async () => {
      const receipts = await this.allReceipts()
      if (!receipts.some(receipt => receipt.status === 'previous')) {
        throw new TrustError('no previous activation exists')
      }
      for (const receipt of receipts) {
        if (receipt.status === 'active') receipt.status = 'previous'
        else if (receipt.status === 'previous') receipt.status = 'active'
        await atomicJson(this.receiptPath(receipt.token), receipt)
      }
    })
  }

  bootstrapPackage(token, version) {
    return this.exclusive(async () => {
      const receipt = await this.readReceipt(token)
      if (receipt.status !== 'staged' || receipt.parentReceipt === null) {
        throw new TrustError('Bootstrap package must be a staged manifest child')
      }
      const parent = await this.readReceipt(receipt.parentReceipt)
      if (parent.authoritySignature === null) throw new TrustError('Bootstrap package parent is not verified')
      const manifest = parseReleaseManifest(await readFile(this.objectPath(parent.objectSha256)))
      if (manifest.document.manifestType !== 'bootstrap' || manifest.document.version !== version) {
        throw new TrustError('Bootstrap package does not belong to the requested version')
      }
      if (manifest.artifacts.length !== 1 || manifest.artifacts[0].id !== receipt.artifactId) {
        throw new TrustError('Bootstrap manifest must authorize exactly one package')
      }
      const target = await this.ledger.currentTarget()
      if (target?.value.document.desired?.bootstrap?.manifestArtifactId !== parent.artifactId) {
        throw new TrustError('Bootstrap manifest is not the current desired Bootstrap')
      }
      return Object.freeze({ path: this.objectPath(receipt.objectSha256), receipt, manifest })
    })
  }

  collectGarbage() {
    return this.exclusive(async () => {
      const receipts = await this.allReceipts()
      const retained = receipts.filter(receipt => !['retired', 'revoked'].includes(receipt.status))
      const retainedObjects = new Set(retained.map(receipt => receipt.objectSha256))
      for (const receipt of receipts) {
        if (!retained.includes(receipt)) await rm(this.receiptPath(receipt.token), { force: true })
      }
      let objects = []
      try {
        objects = await readdir(join(this.root, 'objects'))
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      const removed = []
      for (const sha256 of objects) {
        if (!retainedObjects.has(sha256)) {
          await rm(this.objectPath(sha256), { force: true })
          removed.push(sha256)
        }
      }
      return Object.freeze(removed)
    })
  }
}
