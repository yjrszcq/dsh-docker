import { createHash, createPublicKey, verify } from 'node:crypto'
import { exactKeys, plainObject, TrustError } from '../../lib/validation.mjs'

export const SIGNATURE_SCHEMA = 1
export const SIGNATURE_ALGORITHM = 'Ed25519'

function canonicalBase64(value, label) {
  if (typeof value !== 'string' || value === '') throw new TrustError(`${label} must be base64`)
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== value) {
    throw new TrustError(`${label} must be canonical base64`)
  }
  return bytes
}

export function publicKeyFromBase64(value, label = 'public key') {
  const der = canonicalBase64(value, label)
  let key
  try {
    key = createPublicKey({ key: der, format: 'der', type: 'spki' })
  } catch {
    throw new TrustError(`${label} must be an Ed25519 SPKI public key`)
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new TrustError(`${label} must be an Ed25519 SPKI public key`)
  }
  return { der, key }
}

export function releaseKeyId(publicKey) {
  const { der } = publicKeyFromBase64(publicKey)
  return createHash('sha256').update(der).digest('hex')
}

export function parseSignature(value, label = 'signature') {
  const object = plainObject(value, label)
  exactKeys(object, ['algorithm', 'keyId', 'schema', 'signature'], label)
  if (object.schema !== SIGNATURE_SCHEMA) throw new TrustError(`${label}.schema must be 1`)
  if (object.algorithm !== SIGNATURE_ALGORITHM) {
    throw new TrustError(`${label}.algorithm must be Ed25519`)
  }
  if (typeof object.keyId !== 'string' || !/^[a-f0-9]{64}$/.test(object.keyId)) {
    throw new TrustError(`${label}.keyId must be a SHA-256 hex digest`)
  }
  return Object.freeze({
    schema: object.schema,
    algorithm: object.algorithm,
    keyId: object.keyId,
    signature: canonicalBase64(object.signature, `${label}.signature`),
  })
}

export function verifyDetached(document, signatureValue, publicKey, label = 'document') {
  if (!Buffer.isBuffer(document)) throw new TrustError(`${label} must be bytes`)
  const signature = parseSignature(signatureValue)
  const parsedKey = publicKeyFromBase64(publicKey, `${label} signing key`)
  const expectedKeyId = createHash('sha256').update(parsedKey.der).digest('hex')
  if (signature.keyId !== expectedKeyId) {
    throw new TrustError(`${label} signature key is not trusted`, 'TRUST_UNKNOWN_KEY')
  }
  if (!verify(null, document, parsedKey.key, signature.signature)) {
    throw new TrustError(`${label} signature is invalid`, 'TRUST_BAD_SIGNATURE')
  }
  return signature.keyId
}
