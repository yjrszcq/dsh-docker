import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { link, mkdir, open, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { parseBootstrapManifest, parseEnvironmentManifest } from '../../../../platform/lib/contracts.mjs'
import { OfficialDshDownloader } from './official-dsh-download.mjs'

async function verifyExisting(path, descriptor) {
  const handle = await open(path, 'r')
  const hash = createHash('sha256')
  let size = 0
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.byteLength
      if (size > descriptor.size) return false
      hash.update(chunk)
    }
  } finally {
    await handle.close()
  }
  return size === descriptor.size && hash.digest('hex') === descriptor.sha256
}

async function download(descriptor, destination, fetchImpl, onChunk) {
  let lastError
  let reportedBytes = 0
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const temporary = `${destination}.${randomUUID()}.tmp`
    try {
      const response = await fetchImpl(descriptor.url)
      if (!response.ok) {
        const error = new Error(`Artifact ${descriptor.id} returned HTTP ${String(response.status)}`)
        error.status = response.status
        throw error
      }
      if (response.body === null || response.body === undefined) throw new Error(`Artifact ${descriptor.id} has no response body`)
      const declaredHeader = response.headers?.get?.('content-length')
      if (declaredHeader !== null && declaredHeader !== undefined && declaredHeader !== '') {
        const declared = Number(declaredHeader)
        if (!Number.isSafeInteger(declared) || declared !== descriptor.size) {
          throw new Error(`Artifact ${descriptor.id} does not match stable metadata`)
        }
      }
      const hash = createHash('sha256')
      let size = 0
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          size += chunk.byteLength
          if (size > descriptor.size) {
            callback(new Error(`Artifact ${descriptor.id} does not match stable metadata`))
            return
          }
          hash.update(chunk)
          reportedBytes = Math.max(reportedBytes, size)
          Promise.resolve(onChunk(reportedBytes)).then(() => callback(null, chunk), callback)
        },
      })
      await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
      if (size !== descriptor.size || hash.digest('hex') !== descriptor.sha256) {
        throw new Error(`Artifact ${descriptor.id} does not match stable metadata`)
      }
      const handle = await open(temporary, 'r+')
      try { await handle.sync() } finally { await handle.close() }
      try {
        await link(temporary, destination)
        await rm(temporary)
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        if (!await verifyExisting(destination, descriptor)) {
          throw new Error(`existing Artifact ${descriptor.id} differs from the target`)
        }
        await rm(temporary, { force: true })
      }
      return destination
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      lastError = error
      const status = error?.status
      if ((Number.isInteger(status) && status < 500 && status !== 408 && status !== 429) || attempt === 3) throw error
      await delay(250)
    }
  }
  throw lastError
}

export class TargetPreparer {
  constructor({ untrustedRoot, trust, fetchImpl = fetch, officialDsh = new OfficialDshDownloader({ fetchImpl }) }) {
    this.untrustedRoot = untrustedRoot
    this.trust = trust
    this.fetchImpl = fetchImpl
    this.officialDsh = officialDsh
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
        const downloadBase = downloadedBytes
        const downloaded = await download(
          descriptor,
          join(taskRoot, descriptor.id),
          this.fetchImpl,
          async processed => {
            await onProgress({
              processedBytes: downloadBase + processed,
              totalBytes,
              processedItems: completedDownloads,
              totalItems,
            })
          },
        )
        downloadedBytes = downloadBase + descriptor.size
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
    const dshBaseBytes = downloadedBytes
    const dshBaseItems = completedDownloads
    const dshSources = await this.officialDsh.download(
      stable.desired.dsh.version,
      join(taskRoot, 'official-dsh'),
      {
        onProgress: metrics => onProgress({
          processedBytes: dshBaseBytes + metrics.processedBytes,
          totalBytes: metrics.totalBytes === null ? null : totalBytes + metrics.totalBytes,
          processedItems: dshBaseItems + metrics.processedItems,
          totalItems: totalItems + metrics.totalItems,
          detail: metrics.detail,
        }),
      },
    )
    const dshReceipt = await this.trust.ensureOfficialDsh(
      stable.desired.dsh.version,
      dshSources.metadataPath,
      dshSources.tarballPath,
    )
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

  async prepareExperimental(candidate, { onProgress = async () => {} } = {}) {
    const taskRoot = join(this.untrustedRoot, `experimental-${candidate.version}`)
    const sources = await this.officialDsh.download(candidate.version, taskRoot, { onProgress })
    const receipt = await this.trust.ensureOfficialDsh(candidate.version, sources.metadataPath, sources.tarballPath)
    return Object.freeze({ version: candidate.version, receipt, receiptTokens: Object.freeze([receipt.token]) })
  }
}
