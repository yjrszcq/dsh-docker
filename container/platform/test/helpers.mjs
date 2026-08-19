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

export function target(generation, sequence) {
  const emptyHash = '0'.repeat(64)
  const artifacts = ['bootstrap-manifest', 'environment-manifest', 'dsh-tarball'].map(id => ({
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
      bootstrap: { version: '1.0.0', manifestArtifactId: 'bootstrap-manifest' },
      environment: { version: '2026.08.19.1', manifestArtifactId: 'environment-manifest' },
      dsh: {
        version: '0.1.0-rc.7',
        tarballArtifactId: 'dsh-tarball',
        integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
      },
    },
  }
}
