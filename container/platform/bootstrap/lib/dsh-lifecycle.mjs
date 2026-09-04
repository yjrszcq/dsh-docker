import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname } from 'node:path'

const MAX_BODY_BYTES = 4 * 1024

function exactObject(value, keys, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${name} fields are invalid`)
  }
  return value
}

async function jsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('lifecycle request body is too large')
    chunks.push(chunk)
  }
  if (size === 0) throw new Error('lifecycle request body is required')
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(value)}\n`)
}

function matchesSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

export class DshLifecycleBroker {
  constructor({ shouldTerminate = async () => false, report = async () => {} } = {}) {
    this.shouldTerminate = shouldTerminate
    this.report = report
    this.launch = null
    this.session = null
    this.shuttingDown = false
  }

  record(message, fields = {}) {
    return Promise.resolve().then(() => this.report(message, fields)).catch(() => {})
  }

  prepareLaunch(componentId) {
    if (componentId !== 'dsh-runtime') return Object.freeze({ environment: Object.freeze({}), release: () => {} })
    const launch = Object.freeze({ id: randomUUID(), token: randomBytes(32).toString('base64url') })
    this.launch = launch
    this.session = null
    void this.record('dsh.launch.authorized')
    return Object.freeze({
      environment: Object.freeze({ DSH_PLATFORM_LAUNCH_TOKEN: launch.token }),
      release: () => this.release(launch.id),
    })
  }

  release(launchId) {
    if (this.launch?.id !== launchId) return
    this.launch = null
    this.session = null
    void this.record('dsh.launch.released')
  }

  claim(launchToken) {
    if (this.launch === null || this.session !== null || !matchesSecret(launchToken, this.launch.token)) {
      throw Object.assign(new Error('DSH launch token is invalid or already consumed'), { statusCode: 409 })
    }
    const sessionId = randomUUID()
    this.session = Object.freeze({ id: sessionId, launchId: this.launch.id, ready: false })
    this.launch = Object.freeze({ ...this.launch, token: null })
    void this.record('dsh.launch.claimed')
    return Object.freeze({ sessionId })
  }

  ready(sessionId, readyUrl = null) {
    if (this.session === null || !matchesSecret(sessionId, this.session.id)) {
      throw Object.assign(new Error('DSH lifecycle session is invalid'), { statusCode: 409 })
    }
    if (readyUrl !== null) {
      let parsed
      try {
        parsed = new URL(readyUrl)
      } catch {
        throw Object.assign(new Error('DSH Web readiness URL is invalid'), { statusCode: 400 })
      }
      if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1'
        || parsed.pathname !== '/' || parsed.username !== '' || parsed.password !== ''
        || parsed.hash !== '' || parsed.searchParams.getAll('token').length !== 1) {
        throw Object.assign(new Error('DSH Web readiness URL is invalid'), { statusCode: 400 })
      }
    }
    if (!this.session.ready) {
      this.session = Object.freeze({ ...this.session, ready: true, readyUrl })
      void this.record('dsh.launch.ready')
    }
    return Object.freeze({ ready: true })
  }

  readiness() {
    const ready = this.session?.ready === true
    return Object.freeze({ ready, readyUrl: ready ? this.session.readyUrl ?? null : null })
  }

  async signal(sessionId, signal) {
    if (signal !== 'SIGTERM') throw Object.assign(new Error('lifecycle signal is invalid'), { statusCode: 400 })
    if (this.session === null || !matchesSecret(sessionId, this.session.id)) {
      throw Object.assign(new Error('DSH lifecycle session is invalid'), { statusCode: 409 })
    }
    const disposition = this.session.ready !== true || this.shuttingDown || await this.shouldTerminate()
      ? 'terminate'
      : 'request-restart'
    await this.record('dsh.signal.disposition', { disposition, signal })
    return Object.freeze({ disposition })
  }

  beginShutdown() {
    this.shuttingDown = true
  }
}

export function createDshLifecycleServer(broker) {
  return createServer(async (request, response) => {
    let pathname = 'invalid-url'
    try {
      pathname = new URL(request.url ?? '/', 'http://dsh-lifecycle.internal').pathname
      if (request.method !== 'POST') {
        send(response, 404, { error: 'not found' })
        return
      }
      if (pathname === '/v1/runtime/claim') {
        const body = exactObject(await jsonBody(request), ['launchToken'], 'claim request')
        send(response, 200, broker.claim(body.launchToken))
      } else if (pathname === '/v1/runtime/ready') {
        const value = await jsonBody(request)
        const body = Object.hasOwn(value, 'readyUrl')
          ? exactObject(value, ['readyUrl', 'sessionId'], 'ready request')
          : exactObject(value, ['sessionId'], 'ready request')
        send(response, 200, broker.ready(body.sessionId, body.readyUrl ?? null))
      } else if (pathname === '/v1/runtime/readiness') {
        exactObject(await jsonBody(request), [], 'readiness request')
        send(response, 200, broker.readiness())
      } else if (pathname === '/v1/runtime/signal') {
        const body = exactObject(await jsonBody(request), ['sessionId', 'signal'], 'signal request')
        send(response, 200, await broker.signal(body.sessionId, body.signal))
      } else send(response, 404, { error: 'not found' })
    } catch (error) {
      await broker.record('dsh.lifecycle-request.failed', {
        error,
        method: request.method ?? null,
        pathname,
        level: error?.statusCode === 409 ? 'warning' : 'error',
      })
      send(response, Number.isInteger(error?.statusCode) ? error.statusCode : 400, {
        error: error instanceof Error ? error.message : 'invalid lifecycle request',
      })
    }
  })
}

export async function listenDshLifecycle(server, socketPath) {
  await mkdir(dirname(socketPath), { recursive: true })
  await rm(socketPath, { force: true })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  await chmod(socketPath, 0o600)
}
