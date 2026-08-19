import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseBootstrapManifest, parseEnvironmentManifest } from '../../lib/contracts.mjs'

async function download(descriptor, destination, fetchImpl) {
  const response = await fetchImpl(descriptor.url)
  if (!response.ok) throw new Error(`Artifact ${descriptor.id} returned HTTP ${String(response.status)}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength !== descriptor.size || createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) {
    throw new Error(`Artifact ${descriptor.id} does not match stable metadata`)
  }
  try {
    await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const existing = await readFile(destination)
    if (!existing.equals(bytes)) throw new Error(`existing Artifact ${descriptor.id} differs from the target`)
  }
  return destination
}

export class TargetPreparer {
  constructor({ untrustedRoot, trust, fetchImpl = fetch }) {
    this.untrustedRoot = untrustedRoot
    this.trust = trust
    this.fetchImpl = fetchImpl
  }

  async prepare(stable) {
    const taskRoot = join(this.untrustedRoot, `target-${String(stable.targetSequence)}`)
    await mkdir(taskRoot, { recursive: true })
    const paths = new Map()
    const receipts = new Map()
    const authorities = new Map()
    const importDescriptor = async (descriptor, parentReceipt = null) => {
      const authority = parentReceipt ?? 'stable'
      if (authorities.has(descriptor.id) && authorities.get(descriptor.id) !== authority) {
        throw new Error(`Artifact ID ${descriptor.id} is reused across authorities`)
      }
      authorities.set(descriptor.id, authority)
      if (!paths.has(descriptor.id)) {
        paths.set(descriptor.id, await download(descriptor, join(taskRoot, descriptor.id), this.fetchImpl))
      }
      if (!receipts.has(descriptor.id)) {
        receipts.set(descriptor.id, await this.trust.importArtifact(
          descriptor.id,
          paths.get(descriptor.id),
          parentReceipt,
        ))
      }
      return receipts.get(descriptor.id)
    }
    for (const descriptor of stable.artifacts) await importDescriptor(descriptor)

    const prepareManifest = async (reference, parser) => {
      const manifestReceipt = receipts.get(reference.manifestArtifactId)
      const signatureReceipt = receipts.get(reference.signatureArtifactId)
      await this.trust.acceptManifest(manifestReceipt.token, signatureReceipt.token)
      const manifest = parser(await readFile(paths.get(reference.manifestArtifactId)))
      for (const descriptor of manifest.artifacts) await importDescriptor(descriptor, manifestReceipt.token)
      return { manifest, manifestReceipt }
    }
    const bootstrap = await prepareManifest(stable.desired.bootstrap, parseBootstrapManifest)
    const environment = await prepareManifest(stable.desired.environment, parseEnvironmentManifest)
    return Object.freeze({
      stable,
      paths,
      receipts,
      bootstrap,
      environment,
      receiptTokens: Object.freeze([...receipts.values()].map(receipt => receipt.token)),
    })
  }

  async prepareExperimental(candidate) {
    const taskId = createHash('sha256').update(JSON.stringify(candidate)).digest('hex')
    const taskRoot = join(this.untrustedRoot, `experimental-${taskId}`)
    await mkdir(taskRoot, { recursive: true })
    const path = join(taskRoot, 'dsh.tgz')
    const response = await this.fetchImpl(candidate.dist.tarball)
    if (!response.ok) throw new Error(`Experimental DSH returned HTTP ${String(response.status)}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > 512 * 1024 * 1024) throw new Error('Experimental DSH exceeds the download limit')
    try {
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      if (!(await readFile(path)).equals(bytes)) throw new Error('existing Experimental download differs from npm')
    }
    const receipt = await this.trust.importExperimentalArtifact(candidate, path)
    return Object.freeze({ candidate, path, receipt, receiptTokens: Object.freeze([receipt.token]) })
  }
}
