import { request } from 'node:http'

export class LocalApiClient {
  constructor(socketPath) {
    this.socketPath = socketPath
  }

  request(method, path, body, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
      const req = request({
        socketPath: this.socketPath,
        method,
        path,
        headers: {
          ...extraHeaders,
          ...(bytes === undefined ? {} : {
          'content-type': 'application/json',
          'content-length': bytes.byteLength,
          }),
        },
      }, response => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => {
          let value
          try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { value = {} }
          if ((response.statusCode ?? 500) >= 400) {
            const error = new Error(value.error ?? `local API returned ${String(response.statusCode)}`)
            error.statusCode = response.statusCode
            if (typeof value.code === 'string') error.code = value.code
            if (Number.isInteger(value.retryAfterSeconds)) error.retryAfterSeconds = value.retryAfterSeconds
            error.localApiPath = path
            reject(error)
          } else resolve(value)
        })
      })
      req.once('error', reject)
      req.end(bytes)
    })
  }

  status() { return this.request('GET', '/v1/status') }
  activeReceipts() { return this.request('GET', '/v1/receipts/active') }
  acceptKeyring(document, signature) {
    return this.request('POST', '/v1/keyring', { document: document.toString('base64'), signature })
  }
  acceptTarget(document, signature) {
    return this.request('POST', '/v1/target', { document: document.toString('base64'), signature })
  }
  importArtifact(artifactId, sourcePath, parentReceipt = null) {
    return this.request('POST', '/v1/artifacts/import', { artifactId, sourcePath, parentReceipt })
  }
  ensureOfficialDsh(version, metadataPath, tarballPath) {
    return this.request('POST', '/v1/dsh/ensure', { version, metadataPath, tarballPath })
  }
  acceptManifest(receipt, signatureReceipt) {
    return this.request('POST', '/v1/manifests/accept', { receipt, signatureReceipt })
  }
  activate(receipts) { return this.request('POST', '/v1/activate', { receipts }) }
  collectGarbage() { return this.request('POST', '/v1/objects/collect', {}) }
  stageBootstrap(receipt, version) {
    return this.request('POST', '/v1/bootstrap/stage', { receipt, version })
  }
  collectBootstrap() { return this.request('POST', '/v1/bootstrap/collect', {}) }
}
