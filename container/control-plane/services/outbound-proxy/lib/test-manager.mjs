import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { connect as tlsConnect } from 'node:tls'
import { canonicalJson } from '../../../../platform/lib/canonical-json.mjs'
import { durableReplace } from '../../../../platform/lib/atomic.mjs'
import { validateProxyConfiguration } from './contracts.mjs'
import { ProxyDnsCache } from './dns-cache.mjs'
import { ProxyConfigurationError } from './errors.mjs'
import { selectProxyRoute } from './policy.mjs'
import {
  connectTcp,
  connectThroughHttpProxy,
  connectThroughSocks5,
  readHttpHead,
  ProxyTransportError,
} from './transport.mjs'

const TASK_SCHEMA = 1
const PHASE_TIMEOUT_MS = 15_000
const TOTAL_TIMEOUT_MS = 60_000
const RETENTION_MS = 10 * 60_000
const STAGES = Object.freeze([
  'proxy-address', 'proxy-connect', 'proxy-handshake', 'target-dns', 'target-tls', 'target-http',
])
const TARGETS = Object.freeze([
  Object.freeze({ id: 'github-metadata', host: 'api.github.com', port: 443, path: '/repos/yjrszcq/dsh-docker/releases/latest' }),
  Object.freeze({ id: 'npm-registry', host: 'registry.npmjs.org', port: 443, path: '/@deepseek-ai%2fdsh/latest' }),
])

function safeError(error) {
  return Object.freeze({
    errorCode: typeof error?.code === 'string' ? error.code : 'PROXY_TEST_FAILED',
    detail: error instanceof Error ? error.message : 'proxy test failed',
  })
}

function pendingStage(stage) {
  return { stage, status: 'pending', durationMs: null, errorCode: null, detail: null }
}

function taskHash(configuration, baseRevision) {
  return `sha256:${createHash('sha256').update(canonicalJson({ baseRevision, configuration })).digest('hex')}`
}

function publicTask(task) {
  return Object.freeze({
    schema: TASK_SCHEMA,
    taskId: task.taskId,
    status: task.status,
    baseRevision: task.baseRevision,
    candidateHash: task.candidateHash,
    mode: task.mode,
    currentStage: task.currentStage,
    stages: Object.freeze(task.stages.map(stage => Object.freeze({ ...stage }))),
    error: task.error === null ? null : Object.freeze({ ...task.error }),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  })
}

function modeFor(routes) {
  const modes = new Set(routes.map(route => route.mode === 'direct' ? 'direct' : 'proxy'))
  return modes.size === 1 ? modes.values().next().value : 'mixed'
}

async function firstConnection(route, target, signal) {
  if (route.mode === 'direct') {
    const candidates = route.targets ?? [{ address: target.host }]
    let failure
    for (const candidate of candidates) {
      try {
        return Object.freeze({
          socket: await connectTcp({ host: candidate.address, port: target.port, signal }),
          remainder: Buffer.alloc(0),
        })
      } catch (error) { failure = error }
    }
    throw failure ?? new ProxyTransportError('target connection failed')
  }
  if (route.mode === 'http') return connectThroughHttpProxy({
    endpoint: route.endpoint, targetHost: target.host, targetPort: target.port, signal,
  })
  if (route.mode === 'socks5') {
    const candidates = route.targets ?? [{ address: target.host }]
    let failure
    for (const candidate of candidates) {
      try {
        return await connectThroughSocks5({
          endpoint: route.endpoint, targetHost: candidate.address, targetPort: target.port, signal,
        })
      } catch (error) { failure = error }
    }
    throw failure ?? new ProxyTransportError('SOCKS5 target connection failed')
  }
  throw new ProxyTransportError('proxy route is invalid', { code: 'PROXY_PROTOCOL_UNAVAILABLE' })
}

async function secureConnection(route, target, signal) {
  const connection = await firstConnection(route, target, signal)
  if (connection.remainder.byteLength > 0) connection.socket.unshift(connection.remainder)
  const socket = tlsConnect({ socket: connection.socket, servername: target.host, rejectUnauthorized: true })
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off('secureConnect', connected)
      socket.off('error', failed)
      signal.removeEventListener('abort', cancelled)
    }
    const connected = () => { cleanup(); resolve() }
    const failed = error => { cleanup(); reject(error) }
    const cancelled = () => {
      cleanup()
      socket.destroy()
      reject(new ProxyTransportError('TLS connection was cancelled', { code: 'REQUEST_CANCELLED', statusCode: 499 }))
    }
    socket.once('secureConnect', connected)
    socket.once('error', failed)
    signal.addEventListener('abort', cancelled, { once: true })
  })
  return socket
}

async function targetHttp(route, target, signal) {
  const socket = await secureConnection(route, target, signal)
  try {
    socket.write([
      `GET ${target.path} HTTP/1.1`,
      `Host: ${target.host}`,
      'User-Agent: DSH-Docker-Proxy-Test/1',
      'Accept: application/json',
      'Connection: close',
      '',
      '',
    ].join('\r\n'))
    const { head } = await readHttpHead(socket, { signal })
    const status = Number(/^HTTP\/1\.[01] ([0-9]{3})/.exec(head.toString('latin1'))?.[1])
    if (!Number.isInteger(status) || status >= 500) {
      throw new ProxyTransportError(`target returned HTTP ${Number.isInteger(status) ? String(status) : 'invalid'}`, {
        code: 'TARGET_HTTP_FAILED',
      })
    }
    return status
  } finally {
    socket.destroy()
  }
}

export class ProxyTestManager {
  constructor({
    statePath,
    now = () => new Date(),
    resolve = lookup,
    phaseTimeoutMs = PHASE_TIMEOUT_MS,
    totalTimeoutMs = TOTAL_TIMEOUT_MS,
    retentionMs = RETENTION_MS,
    targets = TARGETS,
  }) {
    this.statePath = statePath
    this.now = now
    this.resolve = resolve
    this.phaseTimeoutMs = phaseTimeoutMs
    this.totalTimeoutMs = totalTimeoutMs
    this.retentionMs = retentionMs
    this.targets = targets
    this.tasks = new Map()
    this.active = null
    this.lastTest = null
    this.writeQueue = Promise.resolve()
  }

  async initialize(readState) {
    let value
    try { value = await readState(this.statePath) } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    if (value?.schema !== TASK_SCHEMA || !Array.isArray(value.tasks)) return
    for (const stored of value.tasks) {
      if (stored?.schema !== TASK_SCHEMA || typeof stored.taskId !== 'string') continue
      const task = { ...stored, stages: stored.stages.map(stage => ({ ...stage })), controller: undefined }
      if (task.status === 'running') {
        task.status = 'failed'
        task.error = { errorCode: 'PROXY_TEST_INTERRUPTED', detail: 'Proxy Manager restarted during the test' }
        task.updatedAt = this.now().toISOString()
        for (const stage of task.stages) if (['pending', 'running'].includes(stage.status)) stage.status = 'skipped'
      }
      this.tasks.set(task.taskId, task)
    }
    this.prune()
    this.lastTest = [...this.tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
    await this.persist()
  }

  getState() {
    return { lastTest: this.lastTest === null ? null : publicTask(this.lastTest) }
  }

  prune() {
    const cutoff = this.now().getTime() - this.retentionMs
    for (const [id, task] of this.tasks) {
      if (task.status !== 'running' && Date.parse(task.updatedAt) < cutoff) this.tasks.delete(id)
    }
  }

  async persist() {
    this.prune()
    const tasks = [...this.tasks.values()].map(task => publicTask(task))
    const bytes = canonicalJson({ schema: TASK_SCHEMA, tasks })
    const write = this.writeQueue.then(() => durableReplace(this.statePath, bytes, 0o640))
    this.writeQueue = write.catch(() => {})
    await write
  }

  async lookup(host, signal) {
    if (signal?.aborted) throw signal.reason
    return new Promise((resolve, reject) => {
      const cancelled = () => reject(signal.reason ?? new ProxyTransportError('DNS resolution was cancelled', {
        code: 'REQUEST_CANCELLED', statusCode: 499,
      }))
      signal?.addEventListener('abort', cancelled, { once: true })
      Promise.resolve(this.resolve(host, { all: true, verbatim: true })).then(resolve, reject).finally(() => {
        signal?.removeEventListener('abort', cancelled)
      })
    })
  }

  async start(request, current) {
    if (request === null || typeof request !== 'object' || Array.isArray(request)
      || Object.keys(request).sort().join(',') !== 'baseRevision,value') {
      throw new ProxyConfigurationError('proxy test request is invalid', { stage: 'test' })
    }
    const { baseRevision, value } = request
    if (this.active !== null) {
      throw new ProxyConfigurationError('another proxy test is already running', {
        code: 'PROXY_TEST_BUSY', statusCode: 409, stage: 'test', retryable: true,
      })
    }
    if (baseRevision !== current.revision) {
      throw new ProxyConfigurationError('proxy configuration changed', {
        code: 'REVISION_CONFLICT', statusCode: 409, stage: 'test', retryable: true,
      })
    }
    const testedValue = {
      ...value,
      enabled: true,
      scopes: { ...value.scopes, updates: true },
      noProxy: { ...value.noProxy, user: [] },
      bypass: { ...value.bypass, additional: [] },
    }
    const validated = validateProxyConfiguration(testedValue, { existingPassword: current.credentials.password })
    const snapshot = Object.freeze({
      revision: `test-${randomUUID()}`,
      configuration: validated.configuration,
      credentials: validated.credentials,
    })
    const createdAt = this.now().toISOString()
    const task = {
      schema: TASK_SCHEMA,
      taskId: randomUUID(),
      status: 'running',
      baseRevision,
      candidateHash: taskHash(validated.configuration, baseRevision),
      mode: null,
      currentStage: STAGES[0],
      stages: STAGES.map(pendingStage),
      error: null,
      createdAt,
      updatedAt: createdAt,
      controller: new AbortController(),
    }
    this.tasks.set(task.taskId, task)
    this.active = task
    await this.persist()
    void this.run(task, snapshot).catch(() => {})
    return publicTask(task)
  }

  async update(task, value) {
    Object.assign(task, value, { updatedAt: this.now().toISOString() })
    await this.persist()
  }

  async stage(task, name, operation) {
    const entry = task.stages.find(value => value.stage === name)
    entry.status = 'running'
    task.currentStage = name
    await this.update(task, {})
    const started = Date.now()
    const signal = AbortSignal.any([task.controller.signal, AbortSignal.timeout(this.phaseTimeoutMs)])
    try {
      const detail = await operation(signal)
      Object.assign(entry, {
        status: 'success', durationMs: Date.now() - started, errorCode: null,
        detail: typeof detail === 'string' ? detail : null,
      })
      await this.update(task, {})
    } catch (error) {
      const failure = signal.reason?.name === 'TimeoutError'
        ? { errorCode: 'PROXY_TEST_STAGE_TIMEOUT', detail: `${name} timed out` }
        : safeError(error)
      Object.assign(entry, { status: 'failed', durationMs: Date.now() - started, ...failure })
      throw error
    }
  }

  async run(task, snapshot) {
    const totalTimer = setTimeout(() => task.controller.abort(new ProxyTransportError('proxy test timed out', {
      code: 'PROXY_TEST_TIMEOUT', statusCode: 504,
    })), this.totalTimeoutMs)
    totalTimer.unref?.()
    const dnsCache = new ProxyDnsCache({ resolver: this.resolve })
    let routes
    try {
      routes = await Promise.all(this.targets.map(target => selectProxyRoute({
        snapshot, scope: 'updates', host: target.host, port: target.port, dnsCache,
        signal: task.controller.signal,
      })))
      task.mode = modeFor(routes)
      const proxied = routes.find(route => route.mode !== 'direct')
      if (proxied === undefined) {
        for (const name of ['proxy-address', 'proxy-connect', 'proxy-handshake']) {
          const stage = task.stages.find(value => value.stage === name)
          Object.assign(stage, { status: 'skipped', durationMs: 0, detail: 'candidate route is direct' })
        }
        await this.update(task, {})
      } else {
        await this.stage(task, 'proxy-address', async () => {
          const records = await this.lookup(proxied.endpoint.host, task.controller.signal)
          if (!Array.isArray(records) || records.length === 0) throw new ProxyTransportError('proxy address resolution returned no records', { code: 'PROXY_DNS_FAILED' })
          return `resolved ${String(records.length)} proxy address record(s)`
        })
        await this.stage(task, 'proxy-connect', async signal => {
          const socket = await connectTcp({ host: proxied.endpoint.host, port: proxied.endpoint.port, signal })
          socket.destroy()
          return 'proxy TCP connection succeeded'
        })
        await this.stage(task, 'proxy-handshake', async signal => {
          const target = this.targets[routes.indexOf(proxied)]
          const connection = await firstConnection(proxied, target, signal)
          connection.socket.destroy()
          return `${snapshot.configuration.proxy.protocol.toUpperCase()} proxy authentication succeeded`
        })
      }
      const remoteDns = routes.every(route => route.mode === 'http'
        || (route.mode === 'socks5' && route.endpoint.remoteDns === true))
      if (remoteDns && task.mode !== 'direct') {
        const stage = task.stages.find(value => value.stage === 'target-dns')
        Object.assign(stage, { status: 'skipped', durationMs: 0, detail: 'target DNS is resolved by the proxy' })
        await this.update(task, {})
      } else {
        await this.stage(task, 'target-dns', async () => {
          for (const target of this.targets) {
            const records = await this.lookup(target.host, task.controller.signal)
            if (!Array.isArray(records) || records.length === 0) throw new ProxyTransportError('target DNS returned no records', { code: 'TARGET_DNS_FAILED' })
          }
          return `resolved ${String(this.targets.length)} target(s)`
        })
      }
      await this.stage(task, 'target-tls', async signal => {
        for (let index = 0; index < this.targets.length; index += 1) {
          const socket = await secureConnection(routes[index], this.targets[index], signal)
          socket.destroy()
        }
        return `TLS verified for ${String(this.targets.length)} target(s)`
      })
      await this.stage(task, 'target-http', async signal => {
        const results = []
        for (let index = 0; index < this.targets.length; index += 1) {
          const status = await targetHttp(routes[index], this.targets[index], signal)
          results.push(`${this.targets[index].id}=HTTP ${String(status)}`)
        }
        return results.join(', ')
      })
      await this.update(task, { status: 'success', currentStage: null, error: null })
    } catch (error) {
      const timeout = task.controller.signal.reason?.code === 'PROXY_TEST_TIMEOUT'
      const cancelled = task.controller.signal.aborted && !timeout
      for (const stage of task.stages) {
        if (stage.status === 'pending') Object.assign(stage, { status: 'skipped', durationMs: 0 })
      }
      await this.update(task, {
        status: cancelled ? 'cancelled' : 'failed',
        currentStage: null,
        error: cancelled
          ? { errorCode: 'REQUEST_CANCELLED', detail: 'proxy test was cancelled' }
          : timeout ? safeError(task.controller.signal.reason) : safeError(error),
      })
    } finally {
      clearTimeout(totalTimer)
      if (this.active === task) this.active = null
      task.controller = undefined
      this.lastTest = task
      await this.persist()
    }
  }

  get(taskId) {
    this.prune()
    const task = this.tasks.get(taskId)
    if (task === undefined) throw new ProxyConfigurationError('proxy test task was not found', {
      code: 'PROXY_TEST_NOT_FOUND', statusCode: 404, stage: 'test',
    })
    return publicTask(task)
  }

  async cancel(taskId) {
    const task = this.tasks.get(taskId)
    if (task === undefined) return this.get(taskId)
    if (task.status === 'running') task.controller.abort(new Error('proxy test cancelled'))
    return publicTask(task)
  }
}

export const proxyTestInternals = Object.freeze({ STAGES, TARGETS, modeFor, publicTask })
