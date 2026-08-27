import { lookup } from 'node:dns/promises'
import { connect, isIP } from 'node:net'
import { domainToASCII } from 'node:url'

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
    code: 'PROXY_CONNECT_TIMEOUT',
    statusCode: 504,
  })
}

export async function connectTcp({ host, port, timeoutMs = PROXY_TIMEOUTS.connectMs, signal }) {
  if (signal?.aborted) {
    throw new ProxyTransportError('upstream connection was cancelled', {
      code: 'REQUEST_CANCELLED', statusCode: 499,
    })
  }
  const socket = connect({ host, port, allowHalfOpen: true })
  // The socket passes through async handshake and Agent/tunnel owners. Keep a
  // baseline listener so a peer reset during an ownership handoff cannot exit
  // the Proxy Manager; each active owner still installs its own error handler.
  socket.on('error', () => {})
  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        socket.off('connect', connected)
        socket.off('error', failed)
        signal?.removeEventListener('abort', cancelled)
      }
      const connected = () => { cleanup(); resolve() }
      const failed = error => { cleanup(); reject(error) }
      const cancelled = () => {
        const error = new ProxyTransportError('upstream connection was cancelled', {
          code: 'REQUEST_CANCELLED', statusCode: 499,
        })
        cleanup()
        socket.destroy()
        reject(error)
      }
      const timer = setTimeout(() => { cleanup(); reject(timeoutError('TCP connection')) }, timeoutMs)
      socket.once('connect', connected)
      socket.once('error', failed)
      signal?.addEventListener('abort', cancelled, { once: true })
    })
    socket.setTimeout(0)
    return socket
  } catch (error) {
    socket.destroy()
    if (error instanceof ProxyTransportError) throw error
    throw new ProxyTransportError('upstream connection failed', { cause: error })
  }
}

export function basicProxyAuthorization(username, password) {
  if (username === '' && password === null) return null
  return `Basic ${Buffer.from(`${username}:${password ?? ''}`, 'utf8').toString('base64')}`
}

function validateHttpHeadLimits(head) {
  const lines = head.toString('latin1').split('\r\n')
  if (lines.length - 2 > 256 || lines.some(line => Buffer.byteLength(line, 'latin1') > 64 * 1024)) {
    throw new ProxyTransportError('upstream response headers are too large', {
      code: 'UPSTREAM_HEADERS_TOO_LARGE',
    })
  }
}

export async function readHttpHead(socket, {
  maxBytes = 256 * 1024,
  timeoutMs = PROXY_TIMEOUTS.handshakeMs,
  signal,
} = {}) {
  const reader = new SocketByteReader(socket)
  const cancel = () => socket.destroy(new ProxyTransportError('proxy handshake was cancelled', {
    code: 'REQUEST_CANCELLED', statusCode: 499,
  }))
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const head = await reader.readUntil(Buffer.from('\r\n\r\n'), maxBytes, Date.now() + timeoutMs)
    return Object.freeze({ head, remainder: reader.release() })
  } catch (error) {
    if (reader.pending === null) reader.release()
    if (error instanceof ProxyTransportError) throw error
    throw new ProxyTransportError('upstream proxy handshake failed', { cause: error })
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

export async function connectThroughHttpProxy({
  endpoint,
  targetHost,
  targetPort,
  connectTimeoutMs = PROXY_TIMEOUTS.connectMs,
  handshakeTimeoutMs = PROXY_TIMEOUTS.handshakeMs,
  signal,
}) {
  const socket = await connectTcp({ ...endpoint, timeoutMs: connectTimeoutMs, signal })
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
    const result = await readHttpHead(socket, { timeoutMs: handshakeTimeoutMs, signal })
    validateHttpHeadLimits(result.head)
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

function ipv4Bytes(address) {
  const values = address.split('.').map(Number)
  if (values.length !== 4 || values.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new ProxyTransportError('SOCKS5 IPv4 target is invalid', { code: 'SOCKS5_TARGET_INVALID' })
  }
  return Buffer.from(values)
}

function ipv6Groups(input) {
  const expand = values => {
    const result = []
    for (const value of values) {
      if (value.includes('.')) {
        const bytes = ipv4Bytes(value)
        result.push(bytes.readUInt16BE(0).toString(16), bytes.readUInt16BE(2).toString(16))
      } else result.push(value)
    }
    return result
  }
  const halves = input.toLowerCase().split('::')
  if (halves.length > 2) throw new ProxyTransportError('SOCKS5 IPv6 target is invalid', { code: 'SOCKS5_TARGET_INVALID' })
  const left = expand(halves[0] === '' ? [] : halves[0].split(':'))
  const right = expand(halves.length === 1 || halves[1] === '' ? [] : halves[1].split(':'))
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    throw new ProxyTransportError('SOCKS5 IPv6 target is invalid', { code: 'SOCKS5_TARGET_INVALID' })
  }
  const groups = halves.length === 1 ? left : [...left, ...Array(missing).fill('0'), ...right]
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) {
    throw new ProxyTransportError('SOCKS5 IPv6 target is invalid', { code: 'SOCKS5_TARGET_INVALID' })
  }
  return groups.map(group => Number.parseInt(group, 16))
}

function ipv6Bytes(address) {
  const output = Buffer.alloc(16)
  ipv6Groups(address).forEach((value, index) => output.writeUInt16BE(value, index * 2))
  return output
}

async function socksTarget(host, remoteDns, resolver) {
  let value = host
  let type = isIP(value)
  if (type === 0 && !remoteDns) {
    let record
    try { record = await resolver(value, { verbatim: true }) } catch (error) {
      throw new ProxyTransportError('SOCKS5 target DNS resolution failed', {
        code: 'TARGET_DNS_FAILED',
        cause: error,
      })
    }
    value = record.address
    type = record.family
  }
  if (type === 4) return Buffer.concat([Buffer.from([0x01]), ipv4Bytes(value)])
  if (type === 6) return Buffer.concat([Buffer.from([0x04]), ipv6Bytes(value)])
  const ascii = domainToASCII(value)
  const bytes = Buffer.from(ascii, 'ascii')
  if (ascii === '' || bytes.byteLength > 255) {
    throw new ProxyTransportError('SOCKS5 domain target is invalid', { code: 'SOCKS5_TARGET_INVALID' })
  }
  return Buffer.concat([Buffer.from([0x03, bytes.byteLength]), bytes])
}

class SocketByteReader {
  constructor(socket) {
    this.socket = socket
    this.buffer = Buffer.alloc(0)
    this.pending = null
    this.ended = false
    this.failure = null
    this.onData = chunk => {
      this.buffer = this.buffer.byteLength === 0 ? chunk : Buffer.concat([this.buffer, chunk])
      this.flush()
    }
    this.onEnd = () => {
      this.ended = true
      this.flush()
    }
    this.onError = error => {
      this.failure = error
      this.flush()
    }
    socket.on('data', this.onData)
    socket.on('end', this.onEnd)
    socket.on('error', this.onError)
  }

  flush() {
    if (this.pending === null) return
    let size = null
    if (this.pending.kind === 'exact' && this.buffer.byteLength >= this.pending.size) size = this.pending.size
    if (this.pending.kind === 'until') {
      const boundary = this.buffer.indexOf(this.pending.delimiter)
      if (boundary >= 0) {
        size = boundary + this.pending.delimiter.byteLength
        if (size > this.pending.maxBytes) {
          const pending = this.pending
          this.pending = null
          clearTimeout(pending.timer)
          pending.reject(new ProxyTransportError('upstream response headers are too large', {
            code: 'UPSTREAM_HEADERS_TOO_LARGE',
          }))
          return
        }
      }
      else if (this.buffer.byteLength > this.pending.maxBytes) {
        const pending = this.pending
        this.pending = null
        clearTimeout(pending.timer)
        pending.reject(new ProxyTransportError('upstream response headers are too large', {
          code: 'UPSTREAM_HEADERS_TOO_LARGE',
        }))
        return
      }
    }
    if (size !== null) {
      const pending = this.pending
      this.pending = null
      clearTimeout(pending.timer)
      const value = this.buffer.subarray(0, size)
      this.buffer = this.buffer.subarray(size)
      pending.resolve(value)
      return
    }
    if (this.failure !== null || this.ended) {
      const pending = this.pending
      this.pending = null
      clearTimeout(pending.timer)
      pending.reject(this.failure ?? new ProxyTransportError('upstream closed during SOCKS5 handshake'))
    }
  }

  read(size, deadline) {
    if (!Number.isSafeInteger(size) || size < 0) {
      return Promise.reject(new ProxyTransportError('SOCKS5 response length is invalid'))
    }
    if (this.pending !== null) {
      return Promise.reject(new ProxyTransportError('concurrent SOCKS5 reads are not supported'))
    }
    if (this.buffer.byteLength >= size) {
      const value = this.buffer.subarray(0, size)
      this.buffer = this.buffer.subarray(size)
      return Promise.resolve(value)
    }
    if (this.failure !== null) return Promise.reject(this.failure)
    if (this.ended) return Promise.reject(new ProxyTransportError('upstream closed during SOCKS5 handshake'))
    const remaining = deadline - Date.now()
    if (remaining <= 0) return Promise.reject(timeoutError('SOCKS5 handshake'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.timer !== timer) return
        this.pending = null
        reject(timeoutError('SOCKS5 handshake'))
      }, remaining)
      this.pending = { kind: 'exact', size, resolve, reject, timer }
      this.flush()
    })
  }

  readUntil(delimiter, maxBytes, deadline) {
    if (!Buffer.isBuffer(delimiter) || delimiter.byteLength === 0 || !Number.isSafeInteger(maxBytes) || maxBytes < delimiter.byteLength) {
      return Promise.reject(new ProxyTransportError('proxy handshake boundary is invalid'))
    }
    if (this.pending !== null) return Promise.reject(new ProxyTransportError('concurrent proxy handshake reads are not supported'))
    const boundary = this.buffer.indexOf(delimiter)
    if (boundary >= 0) {
      const size = boundary + delimiter.byteLength
      if (size > maxBytes) return Promise.reject(new ProxyTransportError('upstream response headers are too large', { code: 'UPSTREAM_HEADERS_TOO_LARGE' }))
      const value = this.buffer.subarray(0, size)
      this.buffer = this.buffer.subarray(size)
      return Promise.resolve(value)
    }
    if (this.buffer.byteLength > maxBytes) return Promise.reject(new ProxyTransportError('upstream response headers are too large', { code: 'UPSTREAM_HEADERS_TOO_LARGE' }))
    if (this.failure !== null) return Promise.reject(this.failure)
    if (this.ended) return Promise.reject(new ProxyTransportError('upstream closed during proxy handshake'))
    const remaining = deadline - Date.now()
    if (remaining <= 0) return Promise.reject(timeoutError('proxy handshake'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.timer !== timer) return
        this.pending = null
        reject(timeoutError('proxy handshake'))
      }, remaining)
      this.pending = { kind: 'until', delimiter, maxBytes, resolve, reject, timer }
      this.flush()
    })
  }

  release() {
    if (this.pending !== null) throw new ProxyTransportError('proxy handshake read is still pending')
    this.socket.pause()
    this.socket.off('data', this.onData)
    this.socket.off('end', this.onEnd)
    this.socket.off('error', this.onError)
    const remainder = this.buffer
    this.buffer = Buffer.alloc(0)
    return remainder
  }
}

function socksReplyError(code) {
  const names = new Map([
    [0x01, 'general failure'], [0x02, 'connection not allowed'], [0x03, 'network unreachable'],
    [0x04, 'host unreachable'], [0x05, 'connection refused'], [0x06, 'TTL expired'],
    [0x07, 'command not supported'], [0x08, 'address type not supported'],
  ])
  return new ProxyTransportError(`SOCKS5 proxy rejected the connection (${names.get(code) ?? 'unknown error'})`, {
    code: 'UPSTREAM_PROXY_REJECTED',
  })
}

export async function connectThroughSocks5({
  endpoint,
  targetHost,
  targetPort,
  resolver = lookup,
  connectTimeoutMs = PROXY_TIMEOUTS.connectMs,
  handshakeTimeoutMs = PROXY_TIMEOUTS.handshakeMs,
  timeoutMs,
  signal,
}) {
  const socket = await connectTcp({ ...endpoint, timeoutMs: connectTimeoutMs, signal })
  const cancel = () => socket.destroy(new ProxyTransportError('SOCKS5 handshake was cancelled', {
    code: 'REQUEST_CANCELLED', statusCode: 499,
  }))
  signal?.addEventListener('abort', cancel, { once: true })
  const reader = new SocketByteReader(socket)
  const deadline = Date.now() + (timeoutMs ?? handshakeTimeoutMs)
  try {
    const username = Buffer.from(endpoint.username ?? '', 'utf8')
    const password = Buffer.from(endpoint.password ?? '', 'utf8')
    const authenticated = username.byteLength > 0 || endpoint.password !== null
    if (username.byteLength > 255 || password.byteLength > 255) {
      throw new ProxyTransportError('SOCKS5 credentials are too long', { code: 'SOCKS5_CREDENTIALS_INVALID' })
    }
    socket.write(authenticated ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]))
    const greeting = await reader.read(2, deadline)
    if (greeting[0] !== 0x05) throw new ProxyTransportError('SOCKS5 proxy returned an invalid greeting')
    if (greeting[1] === 0xff) throw new ProxyTransportError('SOCKS5 proxy has no acceptable authentication method', { code: 'UPSTREAM_PROXY_AUTH_FAILED' })
    if (greeting[1] === 0x02) {
      if (!authenticated) throw new ProxyTransportError('SOCKS5 proxy requires authentication', { code: 'UPSTREAM_PROXY_AUTH_FAILED' })
      socket.write(Buffer.concat([
        Buffer.from([0x01, username.byteLength]), username,
        Buffer.from([password.byteLength]), password,
      ]))
      const authentication = await reader.read(2, deadline)
      if (authentication[0] !== 0x01 || authentication[1] !== 0x00) {
        throw new ProxyTransportError('SOCKS5 proxy authentication failed', { code: 'UPSTREAM_PROXY_AUTH_FAILED' })
      }
    } else if (greeting[1] !== 0x00) {
      throw new ProxyTransportError('SOCKS5 proxy selected an unsupported authentication method', { code: 'UPSTREAM_PROXY_AUTH_FAILED' })
    }
    const address = await socksTarget(targetHost, endpoint.remoteDns, resolver)
    const port = Buffer.alloc(2)
    port.writeUInt16BE(targetPort)
    socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), address, port]))
    const response = await reader.read(4, deadline)
    if (response[0] !== 0x05 || response[2] !== 0x00) throw new ProxyTransportError('SOCKS5 proxy returned an invalid CONNECT response')
    if (response[1] !== 0x00) throw socksReplyError(response[1])
    if (response[3] === 0x01) await reader.read(6, deadline)
    else if (response[3] === 0x04) await reader.read(18, deadline)
    else if (response[3] === 0x03) {
      const length = (await reader.read(1, deadline))[0]
      await reader.read(length + 2, deadline)
    } else throw new ProxyTransportError('SOCKS5 proxy returned an invalid address type')
    const remainder = reader.release()
    return Object.freeze({ socket, remainder })
  } catch (error) {
    if (reader.pending === null) reader.release()
    socket.destroy()
    if (error instanceof ProxyTransportError) throw error
    throw new ProxyTransportError('SOCKS5 proxy handshake failed', { cause: error })
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}
