import { request } from 'node:http'

function lifecycleReadiness(socketPath) {
  const body = Buffer.from('{}')
  return new Promise((resolve, reject) => {
    const outgoing = request({
      socketPath,
      path: '/v1/runtime/readiness',
      method: 'POST',
      headers: {
        'content-length': body.byteLength,
        'content-type': 'application/json',
      },
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.once('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`DSH lifecycle readiness returned HTTP ${String(response.statusCode)}`))
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch (error) {
          reject(error)
        }
      })
    })
    outgoing.setTimeout(750, () => outgoing.destroy(new Error('DSH lifecycle readiness timed out')))
    outgoing.once('error', reject)
    outgoing.end(body)
  })
}

function exchange(host, port, readyUrl) {
  const url = new URL(readyUrl)
  if (url.protocol !== 'http:' || url.hostname !== host || Number(url.port) !== port
    || url.pathname !== '/' || url.username !== '' || url.password !== '' || url.hash !== ''
    || url.searchParams.getAll('token').length !== 1) {
    throw new Error('DSH Web readiness URL is invalid')
  }
  return new Promise((resolve, reject) => {
    const outgoing = request({
      hostname: host,
      port,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { 'cache-control': 'no-store' },
    }, response => {
      response.resume()
      response.once('end', () => {
        const cookie = response.headers['set-cookie']?.[0]?.split(';', 1)[0]
        if (response.statusCode !== 303 || response.headers.location !== '/'
          || typeof cookie !== 'string' || cookie === '') {
          reject(new Error('DSH Web authentication exchange failed'))
        } else resolve(cookie)
      })
    })
    outgoing.setTimeout(750, () => outgoing.destroy(new Error('DSH Web authentication exchange timed out')))
    outgoing.once('error', reject)
    outgoing.end()
  })
}

export class DshUpstreamAuthentication {
  constructor({
    socketPath = '/run/dsh-platform/dsh-lifecycle.sock',
    host = '127.0.0.1',
    port = 3079,
    now = () => Date.now(),
    legacyProbeIntervalMs = 250,
  } = {}) {
    this.socketPath = socketPath
    this.host = host
    this.port = port
    this.now = now
    this.legacyProbeIntervalMs = legacyProbeIntervalMs
    this.cachedCookie = undefined
    this.nextProbeAt = 0
    this.pending = null
  }

  async cookie() {
    if (this.cachedCookie !== undefined) return this.cachedCookie
    if (this.pending !== null) return this.pending
    if (this.now() < this.nextProbeAt) return null
    this.pending = this.refresh().finally(() => { this.pending = null })
    return this.pending
  }

  async refresh() {
    const readiness = await lifecycleReadiness(this.socketPath)
    if (readiness?.ready !== true || typeof readiness.readyUrl !== 'string') {
      this.nextProbeAt = this.now() + this.legacyProbeIntervalMs
      return null
    }
    const cookie = await exchange(this.host, this.port, readiness.readyUrl)
    this.cachedCookie = cookie
    return cookie
  }
}
