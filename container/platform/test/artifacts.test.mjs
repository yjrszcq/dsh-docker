import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MANIFEST_MEDIA_TYPE, SIGNATURE_MEDIA_TYPE, VerifiedObjectStore } from '../stage0/lib/artifacts.mjs'
import { TrustLedger } from '../stage0/lib/ledger.mjs'
import { document, experimentalPolicy, keyPair, keyring, registryCandidate, registryKeyPair, signature } from './helpers.mjs'

function descriptor(id, content, mediaType = 'application/octet-stream') {
  return {
    id,
    mediaType,
    sha256: createHash('sha256').update(content).digest('hex'),
    size: content.byteLength,
    url: `https://github.com/example/releases/download/v1/${id}`,
  }
}

function releaseTarget(generation, sequence, artifacts, policy) {
  const selected = artifacts[0]
  const signatureArtifact = descriptor('stable-signature', Buffer.from('signature'), 'application/vnd.dsh-platform.signature.v1+json')
  const targetArtifacts = artifacts.some(artifact => artifact.id === signatureArtifact.id)
    ? artifacts
    : [...artifacts, signatureArtifact]
  return {
    schema: policy === undefined ? 1 : 2,
    updateApi: 1,
    keyringGeneration: generation,
    targetSequence: sequence,
    issuedAt: '2026-08-19T00:00:00.000Z',
    artifacts: targetArtifacts,
    desired: {
      bootstrap: { version: '1.0.0', manifestArtifactId: selected.id, signatureArtifactId: signatureArtifact.id },
      environment: { version: '2026.08.19.1', manifestArtifactId: selected.id, signatureArtifactId: signatureArtifact.id },
      dsh: {
        version: '0.1.0-rc.7',
        tarballArtifactId: selected.id,
        integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
      },
    },
    ...(policy === undefined ? {} : { experimentalPolicy: policy }),
  }
}

function manifest(generation, sequence, artifacts) {
  return {
    schema: 1,
    manifestType: 'environment',
    version: '2026.08.19.1',
    keyringGeneration: generation,
    targetSequence: sequence,
    issuedAt: '2026-08-19T00:00:00.000Z',
    artifacts,
    bootstrapApi: 1,
    components: [],
    patches: [],
    systemPlugins: [],
  }
}

async function fixture(targetArtifacts, policy = undefined) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-object-store-'))
  const recovery = keyPair()
  const current = keyPair()
  const next = keyPair()
  const ledger = new TrustLedger(join(directory, 'trust'), recovery.publicKey)
  const ringBytes = document(keyring(1, current, next))
  await ledger.acceptKeyring(ringBytes, signature(ringBytes, recovery))
  const artifacts = typeof targetArtifacts === 'function' ? targetArtifacts(current) : targetArtifacts
  const targetBytes = document(releaseTarget(1, 1, artifacts, policy))
  await ledger.acceptTarget(targetBytes, signature(targetBytes, current))
  const untrustedRoot = join(directory, 'downloads', 'untrusted')
  await mkdir(untrustedRoot, { recursive: true })
  return {
    current,
    directory,
    ledger,
    next,
    recovery,
    store: new VerifiedObjectStore({ root: join(directory, 'trust'), untrustedRoot, ledger }),
    untrustedRoot,
  }
}

async function importSignature(store, untrustedRoot, signatureBytes) {
  const path = join(untrustedRoot, 'manifest.sig.json')
  await writeFile(path, signatureBytes)
  return store.importFromTarget('stable-signature', path)
}

test('imports only target-authorized bytes from the untrusted directory', async () => {
  const content = Buffer.from('verified artifact')
  const expected = descriptor('gateway', content)
  const { store, untrustedRoot, directory } = await fixture([expected])
  const source = join(untrustedRoot, 'gateway.bin')
  await writeFile(source, content)
  const receipt = await store.importFromTarget('gateway', source)
  assert.equal(receipt.objectSha256, expected.sha256)
  assert.deepEqual(await readFile(receipt.path), content)
  await assert.rejects(store.importFromTarget('missing', source), /not authorized/)
  await assert.rejects(store.importFromTarget('gateway', join(directory, 'outside.bin')), /untrusted/)
})

test('treats receipts written before authority typing as Stable receipts', async () => {
  const content = Buffer.from('legacy stable artifact')
  const { store, untrustedRoot } = await fixture([descriptor('legacy', content)])
  const source = join(untrustedRoot, 'legacy')
  await writeFile(source, content)
  const receipt = await store.importFromTarget('legacy', source)
  const persisted = JSON.parse(await readFile(store.receiptPath(receipt.token), 'utf8'))
  delete persisted.authorityType
  await writeFile(store.receiptPath(receipt.token), `${JSON.stringify(persisted)}\n`)
  assert.equal((await store.readReceipt(receipt.token)).authorityType, 'stable')
})

test('imports Experimental bytes only through the separate signed authority', async () => {
  const content = Buffer.from('experimental tarball')
  const registry = registryKeyPair()
  const { store, untrustedRoot } = await fixture(
    [descriptor('stable-only', Buffer.alloc(0))],
    experimentalPolicy(registry),
  )
  const candidate = registryCandidate(registry, '0.1.0-rc.8', content)
  const source = join(untrustedRoot, 'experimental.tgz')
  await writeFile(source, content)
  await assert.rejects(store.importFromTarget('experimental-dsh-tarball', source), /not authorized/)
  const receipt = await store.importFromExperimental(candidate, source)
  assert.equal(receipt.authorityType, 'experimental')
  assert.equal(receipt.authorityVersion, '0.1.0-rc.8')
  await store.activate([receipt.token])
  assert.equal((await store.readReceipt(receipt.token)).status, 'active')
})

test('revokes staged Experimental receipts after Registry delegation changes but retains active objects', async () => {
  const content = Buffer.from('experimental tarball')
  const registry = registryKeyPair()
  const replacement = registryKeyPair()
  const { current, ledger, store, untrustedRoot } = await fixture(
    [descriptor('stable-only', Buffer.alloc(0))],
    experimentalPolicy(registry),
  )
  const candidate = registryCandidate(registry, '0.1.0-rc.8', content)
  const source = join(untrustedRoot, 'experimental-policy-change.tgz')
  await writeFile(source, content)
  const active = await store.importFromExperimental(candidate, source)
  await store.activate([active.token])
  const staged = await store.importFromExperimental(candidate, source)

  const advanced = document(releaseTarget(
    1,
    2,
    [descriptor('stable-only', Buffer.alloc(0))],
    experimentalPolicy(replacement),
  ))
  await ledger.acceptTarget(advanced, signature(advanced, current))
  await store.reconcileRevocations((await ledger.currentKeyring()).value)
  assert.equal((await store.readReceipt(active.token)).status, 'active')
  assert.equal((await store.readReceipt(staged.token)).status, 'revoked')
})

test('rejects mismatched content and symbolic-link sources', async () => {
  const expected = descriptor('gateway', Buffer.from('expected'))
  const { store, untrustedRoot } = await fixture([expected])
  const bad = join(untrustedRoot, 'bad.bin')
  await writeFile(bad, 'different')
  await assert.rejects(store.importFromTarget('gateway', bad), { code: 'TRUST_ARTIFACT_MISMATCH' })
  const real = join(untrustedRoot, 'real.bin')
  const link = join(untrustedRoot, 'link.bin')
  await writeFile(real, 'expected')
  await symlink(real, link)
  await assert.rejects(store.importFromTarget('gateway', link), /ELOOP|symbolic/i)
})

test('verifies a signed manifest before authorizing its child artifacts', async () => {
  const component = Buffer.from('component')
  const manifestBytes = document(manifest(1, 1, [descriptor('component', component)]))
  const manifestDescriptor = descriptor('environment-manifest', manifestBytes, MANIFEST_MEDIA_TYPE)
  let signatureBytes
  const { store, untrustedRoot } = await fixture(current => {
    signatureBytes = document(signature(manifestBytes, current))
    return [manifestDescriptor, descriptor('stable-signature', signatureBytes, SIGNATURE_MEDIA_TYPE)]
  })
  const manifestPath = join(untrustedRoot, 'manifest.json')
  await writeFile(manifestPath, manifestBytes)
  const imported = await store.importFromTarget('environment-manifest', manifestPath)
  await assert.rejects(store.importFromManifest(imported.token, 'component', manifestPath), /verified manifest/)
  const signatureReceipt = await importSignature(store, untrustedRoot, signatureBytes)
  await store.acceptManifest(imported.token, signatureReceipt.token)
  const componentPath = join(untrustedRoot, 'component.bin')
  await writeFile(componentPath, component)
  const child = await store.importFromManifest(imported.token, 'component', componentPath)
  assert.equal(child.parentReceipt, imported.token)
})

test('revokes unactivated receipts after key rotation but retains active and previous objects', async () => {
  const one = Buffer.from('one')
  const two = Buffer.from('two')
  const third = Buffer.from('three')
  const descriptors = [descriptor('one', one), descriptor('two', two), descriptor('three', third)]
  const { current, next, recovery, ledger, store, untrustedRoot } = await fixture(descriptors)
  for (const [name, content] of [['one', one], ['two', two], ['three', third]]) {
    await writeFile(join(untrustedRoot, name), content)
  }
  const first = await store.importFromTarget('one', join(untrustedRoot, 'one'))
  const second = await store.importFromTarget('two', join(untrustedRoot, 'two'))
  const unactivated = await store.importFromTarget('three', join(untrustedRoot, 'three'))
  await store.activate([first.token])
  await store.activate([second.token])

  const future = keyPair()
  const rotated = document(keyring(2, next, future, [current.keyId]))
  const rotatedValue = await ledger.acceptKeyring(rotated, signature(rotated, recovery))
  await assert.rejects(store.importFromTarget('three', join(untrustedRoot, 'three')), { code: 'TRUST_REVOKED' })
  await assert.rejects(store.activate([unactivated.token]), { code: 'TRUST_REVOKED' })
  const revoked = await store.reconcileRevocations(rotatedValue)
  assert.deepEqual(revoked, [unactivated.token])
  assert.equal((await store.readReceipt(first.token)).status, 'previous')
  assert.equal((await store.readReceipt(second.token)).status, 'active')

  await store.collectGarbage()
  await assert.rejects(store.readReceipt(unactivated.token), /does not exist/)
  assert.deepEqual(await readFile(store.objectPath(descriptors[0].sha256)), one)
  assert.deepEqual(await readFile(store.objectPath(descriptors[1].sha256)), two)
})

test('activation includes manifest ancestors and rollback swaps current and previous', async () => {
  const component = Buffer.from('component')
  const other = Buffer.from('other')
  const manifestBytes = document(manifest(1, 1, [descriptor('component', component)]))
  const manifestDescriptor = descriptor('environment-manifest', manifestBytes, MANIFEST_MEDIA_TYPE)
  let signatureBytes
  const { store, untrustedRoot } = await fixture(current => {
    signatureBytes = document(signature(manifestBytes, current))
    return [
      manifestDescriptor,
      descriptor('stable-signature', signatureBytes, SIGNATURE_MEDIA_TYPE),
      descriptor('other', other),
    ]
  })
  await writeFile(join(untrustedRoot, 'manifest'), manifestBytes)
  await writeFile(join(untrustedRoot, 'component'), component)
  await writeFile(join(untrustedRoot, 'other'), other)
  const parent = await store.importFromTarget('environment-manifest', join(untrustedRoot, 'manifest'))
  const signatureReceipt = await importSignature(store, untrustedRoot, signatureBytes)
  await store.acceptManifest(parent.token, signatureReceipt.token)
  const child = await store.importFromManifest(parent.token, 'component', join(untrustedRoot, 'component'))
  const selected = await store.activate([child.token])
  assert.deepEqual(new Set(selected), new Set([parent.token, child.token]))
  assert.equal((await store.readReceipt(parent.token)).status, 'active')
  const nextReceipt = await store.importFromTarget('other', join(untrustedRoot, 'other'))
  await store.activate([nextReceipt.token])
  assert.equal((await store.readReceipt(parent.token)).status, 'previous')
  await store.rollback()
  assert.equal((await store.readReceipt(parent.token)).status, 'active')
  assert.equal((await store.readReceipt(nextReceipt.token)).status, 'previous')
})

test('rejects staged receipts after the current Release Key advances targetSequence', async () => {
  const content = Buffer.from('old target artifact')
  const expected = descriptor('artifact', content)
  const { current, ledger, store, untrustedRoot } = await fixture([expected])
  const source = join(untrustedRoot, 'artifact')
  await writeFile(source, content)
  const receipt = await store.importFromTarget('artifact', source)
  const advanced = document(releaseTarget(1, 2, [expected]))
  await ledger.acceptTarget(advanced, signature(advanced, current))
  await assert.rejects(store.activate([receipt.token]), { code: 'TRUST_REVOKED' })
})

test('rejects child imports through a manifest from an older targetSequence', async () => {
  const component = Buffer.from('component')
  const componentDescriptor = descriptor('component', component)
  const manifestBytes = document(manifest(1, 1, [componentDescriptor]))
  const manifestDescriptor = descriptor('environment-manifest', manifestBytes, MANIFEST_MEDIA_TYPE)
  let signatureBytes
  const { current, ledger, store, untrustedRoot } = await fixture(release => {
    signatureBytes = document(signature(manifestBytes, release))
    return [manifestDescriptor, descriptor('stable-signature', signatureBytes, SIGNATURE_MEDIA_TYPE)]
  })
  await writeFile(join(untrustedRoot, 'manifest'), manifestBytes)
  await writeFile(join(untrustedRoot, 'component'), component)
  const parent = await store.importFromTarget('environment-manifest', join(untrustedRoot, 'manifest'))
  const signatureReceipt = await importSignature(store, untrustedRoot, signatureBytes)
  await store.acceptManifest(parent.token, signatureReceipt.token)
  const advanced = document(releaseTarget(1, 2, [manifestDescriptor]))
  await ledger.acceptTarget(advanced, signature(advanced, current))
  await assert.rejects(
    store.importFromManifest(parent.token, 'component', join(untrustedRoot, 'component')),
    { code: 'TRUST_REVOKED' },
  )
})
