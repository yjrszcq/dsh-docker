import { createHash, generateKeyPairSync, sign } from 'node:crypto'

export function keyPair() {
  const pair = generateKeyPairSync('ed25519')
  const der = pair.publicKey.export({ format: 'der', type: 'spki' })
  return {
    privateKey: pair.privateKey,
    publicKey: der.toString('base64'),
    keyId: createHash('sha256').update(der).digest('hex'),
  }
}

export function registryKeyPair() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const der = pair.publicKey.export({ format: 'der', type: 'spki' })
  return {
    privateKey: pair.privateKey,
    publicKey: der.toString('base64'),
    keyId: `SHA256:${createHash('sha256').update(der).digest('base64').replace(/=$/, '')}`,
  }
}

const defaultRegistry = registryKeyPair()

export function officialDshPolicy(pair = defaultRegistry, expires = null) {
  return {
    registry: 'https://registry.npmjs.org/',
    packageName: '@deepseek-ai/dsh',
    keys: [{ algorithm: 'ECDSA-P256-SHA256', keyId: pair.keyId, publicKey: pair.publicKey, expires }],
  }
}

export function registryCandidate(pair, version = '0.1.0-rc.8', content = Buffer.alloc(0)) {
  const integrity = `sha512-${createHash('sha512').update(content).digest('base64')}`
  const message = `@deepseek-ai/dsh@${version}:${integrity}`
  return {
    schema: 1,
    name: '@deepseek-ai/dsh',
    version,
    dist: {
      integrity,
      tarball: `https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-${version}.tgz`,
      signatures: [{ keyid: pair.keyId, sig: sign('sha256', Buffer.from(message), pair.privateKey).toString('base64') }],
    },
  }
}

export function releaseKey(pair) {
  return { algorithm: 'Ed25519', keyId: pair.keyId, publicKey: pair.publicKey }
}

export function document(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`)
}

export function signature(bytes, pair) {
  return {
    schema: 1,
    algorithm: 'Ed25519',
    keyId: pair.keyId,
    signature: sign(null, bytes, pair.privateKey).toString('base64'),
  }
}

export function keyring(generation, current, next, revokedKeyIds = []) {
  return {
    schema: 1,
    generation,
    issuedAt: new Date(Date.UTC(2026, 7, 19, 0, 0, generation)).toISOString(),
    current: releaseKey(current),
    next: releaseKey(next),
    revokedKeyIds: [...revokedKeyIds].sort(),
  }
}

export function target(generation, sequence, policy = officialDshPolicy()) {
  const emptyHash = '0'.repeat(64)
  const artifacts = ['bootstrap-manifest', 'bootstrap-signature', 'environment-manifest', 'environment-signature'].map(id => ({
    id,
    mediaType: 'application/octet-stream',
    sha256: emptyHash,
    size: 0,
    url: `https://example.com/${id}`,
  }))
  return {
    schema: 1,
    updateApi: 1,
    keyringGeneration: generation,
    targetSequence: sequence,
    issuedAt: new Date(Date.UTC(2026, 7, 19, 1, 0, sequence)).toISOString(),
    artifacts,
    desired: {
      bootstrap: { version: '1.0.0', manifestArtifactId: 'bootstrap-manifest', signatureArtifactId: 'bootstrap-signature' },
      environment: { version: '1.0.0', manifestArtifactId: 'environment-manifest', signatureArtifactId: 'environment-signature' },
      dsh: {
        version: '0.1.0-rc.7',
        integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
      },
    },
    officialDshPolicy: policy,
  }
}
