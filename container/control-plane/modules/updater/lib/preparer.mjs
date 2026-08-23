import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseBootstrapManifest, parseEnvironmentManifest } from '../../../../platform/lib/contracts.mjs'

async function readResponse(response, onChunk = async () => {}) {
  if (response.body?.getReader !== undefined) {
    const reader = response.body.getReader()
    const chunks = []
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        const chunk = Buffer.from(next.value)
        chunks.push(chunk)
        await onChunk(chunk.byteLength)
      }
    } finally {
      reader.releaseLock?.()
    }
    return Buffer.concat(chunks)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  await onChunk(bytes.byteLength)
  return bytes
}

async function download(descriptor, destination, fetchImpl, onChunk) {
  const response = await fetchImpl(descriptor.url)
  if (!response.ok) throw new Error(`Artifact ${descriptor.id} returned HTTP ${String(response.status)}`)
  const bytes = await readResponse(response, onChunk)
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

  async prepare(stable, { onProgress = async () => {} } = {}) {
    const taskRoot = join(this.untrustedRoot, `target-${String(stable.targetSequence)}`)
    await mkdir(taskRoot, { recursive: true })
    const downloads = new Map()
    const paths = new Map()
    const receipts = new Map()
    const authorities = new Map()
    let downloadedBytes = 0
    let completedDownloads = 0
    let totalBytes = stable.artifacts.reduce((total, descriptor) => total + descriptor.size, 0)
    let totalItems = stable.artifacts.length
    const importDescriptor = async (descriptor, parentReceipt = null) => {
      const authority = parentReceipt ?? 'stable'
      if (authorities.has(descriptor.id) && authorities.get(descriptor.id) !== authority) {
        throw new Error(`Artifact ID ${descriptor.id} is reused across authorities`)
      }
      authorities.set(descriptor.id, authority)
      if (!downloads.has(descriptor.id) && !stable.artifacts.some(root => root.id === descriptor.id)) {
        totalBytes += descriptor.size
        totalItems += 1
      }
      if (!downloads.has(descriptor.id)) {
        const downloaded = await download(
          descriptor,
          join(taskRoot, descriptor.id),
          this.fetchImpl,
          async bytes => {
            downloadedBytes += bytes
            await onProgress({ processedBytes: downloadedBytes, totalBytes, processedItems: completedDownloads, totalItems })
          },
        )
        downloads.set(descriptor.id, downloaded)
        completedDownloads += 1
        await onProgress({ processedBytes: downloadedBytes, totalBytes, processedItems: completedDownloads, totalItems })
      }
      if (!receipts.has(descriptor.id)) {
        const receipt = await this.trust.importArtifact(
          descriptor.id,
          downloads.get(descriptor.id),
          parentReceipt,
        )
        receipts.set(descriptor.id, receipt)
        paths.set(descriptor.id, receipt.path)
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
    const dshReceipt = await this.trust.ensureOfficialDsh(stable.desired.dsh.version)
    return Object.freeze({
      stable,
      paths,
      receipts,
      bootstrap,
      environment,
      dsh: Object.freeze({ version: stable.desired.dsh.version, receipt: dshReceipt }),
      receiptTokens: Object.freeze([...receipts.values(), dshReceipt].map(receipt => receipt.token)),
    })
  }

  async prepareExperimental(candidate) {
    const receipt = await this.trust.ensureOfficialDsh(candidate.version)
    return Object.freeze({ version: candidate.version, receipt, receiptTokens: Object.freeze([receipt.token]) })
  }
}
