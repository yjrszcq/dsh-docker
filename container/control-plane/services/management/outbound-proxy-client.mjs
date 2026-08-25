import { request } from 'node:http'

const MAX_RESPONSE_BYTES = 256 * 1024

export class OutboundProxyControlError extends Error {
  constructor(error, statusCode, path) {
    super(error?.message ?? `Outbound Proxy returned HTTP ${String(statusCode)}`)
    this.name = 'OutboundProxyControlError'
    this.statusCode = statusCode
    this.code = error?.code ?? 'PROXY_MANAGER_UNAVAILABLE'
    this.stage = error?.stage ?? 'unknown'
    this.retryable = error?.retryable === true
    this.localApiPath = path
    this.proxyError = Object.freeze({
      code: this.code,
      message: this.message,
      stage: this.stage,
      retryable: this.retryable,
    })
  }
}

export class OutboundProxyControlClient {
  constructor(socketPath, { timeoutMs = 10_000 } = {}) {
    this.socketPath = socketPath
    this.timeoutMs = timeoutMs
  }

  request(method, path, body) {
    return new Promise((resolve, reject) => {
      const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
      const outgoing = request({
        socketPath: this.socketPath,
        method,
        path,
        headers: bytes === undefined ? {} : {
          'content-type': 'application/json',
          'content-length': bytes.byteLength,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      }, response => {
        const chunks = []
        let size = 0
        response.on('data', chunk => {
          size += chunk.byteLength
          if (size > MAX_RESPONSE_BYTES) outgoing.destroy(new Error('Outbound Proxy response is too large'))
          else chunks.push(chunk)
        })
        response.on('end', () => {
          let value
          try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
            reject(new Error('Outbound Proxy response is invalid'))
            return
          }
          const statusCode = response.statusCode ?? 500
          if (statusCode >= 400) reject(new OutboundProxyControlError(value.error, statusCode, path))
          else resolve(value)
        })
      })
      outgoing.once('error', reject)
      outgoing.end(bytes)
    })
  }

  configuration() { return this.request('GET', '/v1/configuration') }
  updateConfiguration(value) { return this.request('PUT', '/v1/configuration', value) }
  startTest(value) { return this.request('POST', '/v1/test', value) }
  test(taskId) { return this.request('GET', `/v1/test/tasks/${encodeURIComponent(taskId)}`) }
  cancelTest(taskId) { return this.request('DELETE', `/v1/test/tasks/${encodeURIComponent(taskId)}`) }
  status() { return this.request('GET', '/v1/status') }
}
