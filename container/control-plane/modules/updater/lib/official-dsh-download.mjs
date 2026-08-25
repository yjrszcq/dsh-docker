import { constants } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import {
  OFFICIAL_DSH_METADATA_LIMIT,
  OFFICIAL_DSH_PACKAGE,
  OFFICIAL_DSH_TARBALL_LIMIT,
  officialDshMetadataUrl,
  officialDshTarballUrl,
} from '../../../../platform/lib/official-dsh-contracts.mjs'
import { compareDshVersions } from '../../../../platform/lib/supported-target.mjs'

function exactResponse(response, url, label) {
  if (response.redirected || (response.url !== undefined && response.url !== '' && response.url !== url.href)) {
    throw new Error(`${label} changed origin or redirected`)
  }
  if (!response.ok) {
    const error = new Error(`${label} returned HTTP ${String(response.status)}`)
    error.status = response.status
    throw error
  }
  return response
}

function responseLength(response) {
  const header = response.headers?.get?.('content-length')
  if (header === null || header === undefined || header === '') return null
  const value = Number(header)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

async function boundedBytes(response, label, maxBytes) {
  const declared = responseLength(response)
  if (declared !== null && declared > maxBytes) throw new Error(`${label} exceeds the download limit`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new Error(`${label} exceeds the download limit`)
  return bytes
}

async function atomicBytes(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

async function streamToFile(response, path, label, maxBytes, onProgress) {
  if (response.body === null || response.body === undefined) throw new Error(`${label} has no response body`)
  const declared = responseLength(response)
  if (declared !== null && declared > maxBytes) throw new Error(`${label} exceeds the download limit`)
  const temporary = `${path}.${randomUUID()}.tmp`
  let processedBytes = 0
  try {
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        processedBytes += chunk.byteLength
        if (processedBytes > maxBytes) {
          callback(new Error(`${label} exceeds the download limit`))
          return
        }
        Promise.resolve(onProgress({ processedBytes, totalBytes: Number.isFinite(declared) ? declared : null }))
          .then(() => callback(null, chunk), callback)
      },
    })
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
    const handle = await open(temporary, constants.O_RDWR)
    try { await handle.sync() } finally { await handle.close() }
    await rename(temporary, path)
    return { processedBytes, totalBytes: declared }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

export class OfficialDshDownloader {
  constructor({ fetchImpl = fetch, attempts = 3, retryMs = 250 }) {
    this.fetchImpl = fetchImpl
    this.attempts = attempts
    this.retryMs = retryMs
  }

  async retry(operation) {
    let lastError
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        return await operation(attempt)
      } catch (error) {
        lastError = error
        const status = error?.status
        if ((Number.isInteger(status) && status < 500 && status !== 408 && status !== 429) || attempt === this.attempts) {
          throw error
        }
        await delay(this.retryMs)
      }
    }
    throw lastError
  }

  async download(version, root, { onProgress = async () => {} } = {}) {
    compareDshVersions(version, version)
    await mkdir(root, { recursive: true })
    const metadataUrl = officialDshMetadataUrl()
    const metadata = await this.retry(async () => {
      const metadataResponse = exactResponse(await this.fetchImpl(metadataUrl, {
        headers: { accept: 'application/vnd.npm.install-v1+json', 'accept-encoding': 'identity' },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      }), metadataUrl, 'official DSH metadata')
      return boundedBytes(metadataResponse, 'official DSH metadata', OFFICIAL_DSH_METADATA_LIMIT)
    })
    let packument
    try { packument = JSON.parse(metadata.toString('utf8')) } catch { throw new Error('official DSH metadata is not valid JSON') }
    const selected = packument?.versions?.[version]
    if (selected?.name !== OFFICIAL_DSH_PACKAGE || selected?.version !== version) {
      throw new Error('official DSH metadata has no coherent requested version')
    }
    const tarballUrl = officialDshTarballUrl(version)
    if (selected?.dist?.tarball !== tarballUrl.href) throw new Error('official DSH tarball URL is not canonical')
    const metadataPath = join(root, 'official-dsh-packument.json')
    const tarballPath = join(root, 'official-dsh.tgz')
    await atomicBytes(metadataPath, metadata)
    try {
      let reportedBytes = metadata.byteLength
      const result = await this.retry(async () => {
        const tarballResponse = exactResponse(await this.fetchImpl(tarballUrl, {
          headers: { accept: 'application/octet-stream', 'accept-encoding': 'identity' },
          redirect: 'error',
        }), tarballUrl, 'official DSH tarball')
        if (tarballResponse.headers?.get?.('content-encoding')) {
          throw new Error('official DSH tarball must not use content encoding')
        }
        const declaredTarball = responseLength(tarballResponse)
        const knownTotal = declaredTarball === null ? null : metadata.byteLength + declaredTarball
        await onProgress({
          processedBytes: reportedBytes,
          totalBytes: knownTotal,
          processedItems: 1,
          totalItems: 2,
          detail: 'official-dsh-metadata',
        })
        return streamToFile(
          tarballResponse,
          tarballPath,
          'official DSH tarball',
          OFFICIAL_DSH_TARBALL_LIMIT,
          metrics => {
            reportedBytes = Math.max(reportedBytes, metadata.byteLength + metrics.processedBytes)
            return onProgress({
              processedBytes: reportedBytes,
              totalBytes: knownTotal,
              processedItems: 1,
              totalItems: 2,
              detail: 'official-dsh-tarball',
            })
          },
        )
      })
      await onProgress({
        processedBytes: Math.max(reportedBytes, metadata.byteLength + result.processedBytes),
        totalBytes: result.totalBytes === null ? null : metadata.byteLength + result.totalBytes,
        processedItems: 2,
        totalItems: 2,
        detail: 'official-dsh-tarball',
      })
      return Object.freeze({ metadataPath, tarballPath })
    } catch (error) {
      await rm(metadataPath, { force: true }).catch(() => {})
      await rm(tarballPath, { force: true }).catch(() => {})
      throw error
    }
  }
}
