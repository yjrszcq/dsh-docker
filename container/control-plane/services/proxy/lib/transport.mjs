import { once } from 'node:events'
import { connect } from 'node:net'

export const PROXY_TIMEOUTS = Object.freeze({
  connectMs: 10_000,
  handshakeMs: 15_000,
  responseHeaderMs: 60_000,
  streamIdleMs: 120_000,
  tunnelIdleMs: 30 * 60_000,
})

export class ProxyTransportError extends Error {
  constructor(message, { code = 'UPSTREAM_CONNECT_FAILED', statusCode = 502, cause } = {}) {
    super(message, { cause })
    this.name = 'ProxyTransportError'
    this.code = code
    this.statusCode = statusCode
  }
}

function timeoutError(stage) {
  return new ProxyTransportError(`${stage} timed out`, {
    code: 'UPSTREAM_TIMEOUT',
    statusCode: 504,
  })
}

export async function connectTcp({ host, port, timeoutMs = PROXY_TIMEOUTS.connectMs }) {
  const socket = connect({ host, port, allowHalfOpen: true })
  let timer
  try {
    await Promise.race([
      once(socket, 'connect'),
      once(socket, 'error').then(([error]) => { throw error }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError('TCP connection')), timeoutMs) }),
    ])
    socket.setTimeout(0)
    return socket
  } catch (error) {
    socket.destroy()
    if (error instanceof ProxyTransportError) throw error
    throw new ProxyTransportError('upstream connection failed', { cause: error })
  } finally {
    clearTimeout(timer)
  }
}

export function basicProxyAuthorization(username, password) {
  if (username === '' && password === null) return null
  return `Basic ${Buffer.from(`${username}:${password ?? ''}`, 'utf8').toString('base64')}`
}

export async function readHttpHead(socket, {
  maxBytes = 256 * 1024,
  timeoutMs = PROXY_TIMEOUTS.handshakeMs,
} = {}) {
  let bytes = Buffer.alloc(0)
  try {
    while (true) {
      const boundary = bytes.indexOf('\r\n\r\n')
      if (boundary >= 0) {
        return Object.freeze({
          head: bytes.subarray(0, boundary + 4),
          remainder: bytes.subarray(boundary + 4),
        })
      }
      if (bytes.byteLength > maxBytes) {
        throw new ProxyTransportError('upstream response headers are too large', {
          code: 'UPSTREAM_HEADERS_TOO_LARGE',
        })
      }
      const chunk = await new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer)
          socket.off('data', onData)
          socket.off('end', onEnd)
          socket.off('error', onError)
        }
        const onData = value => { cleanup(); resolve(value) }
        const onEnd = () => { cleanup(); reject(new ProxyTransportError('upstream closed during handshake')) }
        const onError = error => { cleanup(); reject(error) }
        const timer = setTimeout(() => { cleanup(); reject(timeoutError('proxy handshake')) }, timeoutMs)
        socket.once('data', onData)
        socket.once('end', onEnd)
        socket.once('error', onError)
      })
      bytes = Buffer.concat([bytes, chunk])
    }
  } catch (error) {
    if (error instanceof ProxyTransportError) throw error
    throw new ProxyTransportError('upstream proxy handshake failed', { cause: error })
  }
}

export async function connectThroughHttpProxy({ endpoint, targetHost, targetPort }) {
  const socket = await connectTcp(endpoint)
  const authorization = basicProxyAuthorization(endpoint.username, endpoint.password)
  const authority = targetHost.includes(':') ? `[${targetHost}]:${targetPort}` : `${targetHost}:${targetPort}`
  socket.write([
    `CONNECT ${authority} HTTP/1.1`,
    `Host: ${authority}`,
    ...(authorization === null ? [] : [`Proxy-Authorization: ${authorization}`]),
    'Proxy-Connection: keep-alive',
    '',
    '',
  ].join('\r\n'))
  try {
    const result = await readHttpHead(socket)
    const first = result.head.subarray(0, result.head.indexOf('\r\n')).toString('latin1')
    const match = /^HTTP\/1\.[01] ([0-9]{3})(?: |$)/.exec(first)
    if (match === null) throw new ProxyTransportError('upstream proxy returned an invalid response')
    const status = Number(match[1])
    if (status < 200 || status >= 300) {
      throw new ProxyTransportError(
        status === 407 ? 'upstream proxy authentication failed' : 'upstream proxy rejected the tunnel',
        { code: status === 407 ? 'UPSTREAM_PROXY_AUTH_FAILED' : 'UPSTREAM_PROXY_REJECTED' },
      )
    }
    return Object.freeze({ socket, remainder: result.remainder })
  } catch (error) {
    socket.destroy()
    throw error
  }
}
