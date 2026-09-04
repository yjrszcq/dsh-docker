import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, chmod, chown, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

const SOURCE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/
const MAX_ENTRY_BYTES = 64 * 1024
const CONSOLE_MARKER = 'dsh-platform-log-v1'
const LOG_LEVELS = new Set(['debug', 'info', 'warning', 'error'])
const MAX_DIAGNOSTIC_STRING = 16 * 1024
const MAX_ERROR_DEPTH = 3
const MAX_AGGREGATE_ERRORS = 8
const SUPPRESSION_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,255}$/

function boundedString(value) {
  const text = String(value)
  return text.length <= MAX_DIAGNOSTIC_STRING ? text : `${text.slice(0, MAX_DIAGNOSTIC_STRING)}...[truncated]`
}

export function errorDetails(error, depth = 0) {
  if (error === undefined || error === null) return {}
  if (!(error instanceof Error)) return { error: boundedString(error), errorType: typeof error }
  const details = {
    error: boundedString(error.message || error.name),
    errorName: boundedString(error.name),
  }
  if (typeof error.code === 'string' || typeof error.code === 'number') details.errorCode = error.code
  if (typeof error.stack === 'string') details.errorStack = boundedString(error.stack)
  if (depth >= MAX_ERROR_DEPTH) return details
  if (error.cause !== undefined) details.errorCause = errorDetails(error.cause, depth + 1)
  if (error instanceof AggregateError) {
    details.errors = [...error.errors].slice(0, MAX_AGGREGATE_ERRORS).map(value => errorDetails(value, depth + 1))
    if (error.errors.length > MAX_AGGREGATE_ERRORS) details.errorsTruncated = error.errors.length - MAX_AGGREGATE_ERRORS
  }
  return details
}

function validateSource(source) {
  if (typeof source !== 'string' || !SOURCE_PATTERN.test(source)) throw new Error('log source is invalid')
  return source
}

function validateFilter(value, label) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || /[\0\r\n]/u.test(value)) {
    throw new Error(`${label} filter is invalid`)
  }
  return value
}

function matches(entry, filters) {
  return (filters.taskId === undefined || entry.taskId === filters.taskId)
    && (filters.operation === undefined || entry.operation === filters.operation)
    && (filters.phase === undefined || entry.phase === filters.phase)
}

function parseLine(line) {
  try { return JSON.parse(line) } catch { return undefined }
}

function parseForwardedLine(line) {
  const entry = parseLine(line)
  if (
    entry?.platformLog !== CONSOLE_MARKER
    || typeof entry.timestamp !== 'string'
    || typeof entry.message !== 'string'
    || !['stdout', 'stderr', 'audit', 'platform'].includes(entry.stream)
  ) return undefined
  try { validateSource(entry.source) } catch { return undefined }
  return entry
}

export function capturedLogLevel(stream, message) {
  if (stream !== 'stderr') return 'info'
  const text = String(message).trim()
  const lines = text.split('\n')
  if (lines.some(line => /^(?:\s*at\s+|.*\b(?:error|fatal|failed|failure|exception|panic|unhandled)\b)|错误|失败|异常|致命/iu.test(line))) {
    return 'error'
  }
  if (lines.some(line => /\b(?:warn|warning|deprecated|deprecation)\b|警告|已弃用/iu.test(line))) return 'warning'
  return 'info'
}

const NODE_ERROR_LINE = /^\s*(?:AggregateError|Error|EvalError|RangeError|ReferenceError|SyntaxError|TypeError|URIError):/u
const NODE_LOCATION_LINE = /^(?:file:\/\/|\/).*:\d+(?::\d+)?$/u

function isNodeErrorContinuation(line) {
  return line === ''
    || /^\s/u.test(line)
    || NODE_ERROR_LINE.test(line)
    || /^Node\.js v\d/u.test(line)
    || /^\s*(?:\[cause\]|\[errors\]|Caused by:)/u.test(line)
    || /^\s*[{}\[\]},]+$/u.test(line)
}

function capturedMessages(source, stream, lines) {
  if (source !== 'dsh-runtime' || stream !== 'stderr') return lines
  const messages = []
  let cursor = 0
  while (cursor < lines.length) {
    const relativeError = lines.slice(cursor).findIndex(line => NODE_ERROR_LINE.test(line))
    if (relativeError < 0) {
      messages.push(...lines.slice(cursor))
      break
    }
    const errorIndex = cursor + relativeError
    let start = errorIndex
    for (let index = errorIndex - 1; index >= cursor && index >= errorIndex - 6; index -= 1) {
      if (NODE_LOCATION_LINE.test(lines[index])) {
        start = index
        break
      }
    }
    messages.push(...lines.slice(cursor, start))
    let end = errorIndex + 1
    while (end < lines.length && isNodeErrorContinuation(lines[end])) {
      const terminal = /^Node\.js v\d/u.test(lines[end])
      end += 1
      if (terminal) break
    }
    messages.push(boundedString(lines.slice(start, end).join('\n')))
    cursor = end
  }
  return messages
}

export class JsonlLogManager extends EventEmitter {
  constructor({
    root,
    maxBytes = 100 * 1024 * 1024,
    retentionDays = 14,
    rotateBytes = 10 * 1024 * 1024,
    now = () => new Date(),
    output,
    fileMode = 0o660,
    fileUid,
    fileGid,
  }) {
    super()
    if (!Number.isSafeInteger(maxBytes) || maxBytes < MAX_ENTRY_BYTES) throw new Error('log maxBytes is invalid')
    if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) throw new Error('log retentionDays is invalid')
    if (!Number.isSafeInteger(rotateBytes) || rotateBytes < 1_024) throw new Error('log rotateBytes is invalid')
    if (!Number.isSafeInteger(fileMode) || fileMode < 0 || fileMode > 0o777) throw new Error('log fileMode is invalid')
    this.root = root
    this.maxBytes = maxBytes
    this.retentionMs = retentionDays * 86_400_000
    this.rotateBytes = rotateBytes
    this.now = now
    this.output = output
    this.fileMode = fileMode
    this.fileUid = fileUid
    this.fileGid = fileGid
    this.queue = Promise.resolve()
    this.suppressedDiagnostics = new Map()
  }

  prepare() {
    return this.serialized(async () => {
      await mkdir(this.root, { recursive: true })
      const names = (await readdir(this.root)).filter(name => name.endsWith('.jsonl'))
      for (const name of names) {
        const path = join(this.root, name)
        if (this.fileGid !== undefined) await chown(path, -1, this.fileGid)
        await chmod(path, this.fileMode)
      }
    })
  }

  writeOutput(stream, line) {
    const destination = stream === 'stderr' ? this.output?.stderr : this.output?.stdout
    destination?.write(`${line}\n`)
  }

  mirror(entry) {
    if (this.output === undefined) return
    this.writeOutput(entry.stream, JSON.stringify({ ...entry, platformLog: CONSOLE_MARKER }))
  }

  serialized(operation) {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  currentPath(source) {
    return join(this.root, `${validateSource(source)}.jsonl`)
  }

  append(source, stream, message, fields = {}) {
    return this.serialized(async () => {
      validateSource(source)
      if (!['stdout', 'stderr', 'audit', 'platform'].includes(stream)) throw new Error('log stream is invalid')
      if (typeof message !== 'string') throw new Error('log message must be a string')
      const level = fields.level ?? (stream === 'stderr' ? 'error' : 'info')
      if (!LOG_LEVELS.has(level)) throw new Error('log level is invalid')
      const entry = { ...fields, timestamp: this.now().toISOString(), source, stream, level, message }
      const line = Buffer.from(`${JSON.stringify(entry)}\n`)
      if (line.byteLength > MAX_ENTRY_BYTES) throw new Error('log entry exceeds 64 KiB')
      await mkdir(this.root, { recursive: true })
      const path = this.currentPath(source)
      let exists = true
      const size = await stat(path).then(value => value.size, error => {
        if (error?.code !== 'ENOENT') throw error
        exists = false
        return 0
      })
      if (size > 0 && size + line.byteLength > this.rotateBytes) {
        await rename(path, join(this.root, `${source}.${Date.now()}.${randomUUID()}.jsonl`))
        exists = false
      }
      await appendFile(path, line, { mode: this.fileMode })
      if (!exists) {
        if (this.fileUid !== undefined || this.fileGid !== undefined) await chown(path, this.fileUid ?? -1, this.fileGid ?? -1)
        await chmod(path, this.fileMode)
      }
      this.emit('entry', Object.freeze(entry))
      this.mirror(entry)
      await this.pruneUnlocked()
      return Object.freeze(entry)
    })
  }

  audit(action, fields = {}) {
    return this.append('audit', 'audit', action, fields)
  }

  async diagnostic(source, message, { error, level = error === undefined || error === null ? 'info' : 'error', stream = 'platform', ...fields } = {}) {
    const details = { ...fields, ...errorDetails(error), level }
    try {
      return await this.append(source, stream, message, details)
    } catch (loggingError) {
      try {
        this.writeOutput('stderr', JSON.stringify({
          timestamp: this.now().toISOString(),
          source: 'log-manager',
          stream: 'stderr',
          level: 'error',
          message: 'diagnostic.write.failed',
          diagnostic: { source, stream, message, ...details },
          loggingError: errorDetails(loggingError),
          platformLog: CONSOLE_MARKER,
        }))
      } catch {}
      return undefined
    }
  }

  diagnosticRateLimited(key, source, message, fields = {}, { intervalMs = 30_000 } = {}) {
    if (typeof key !== 'string' || !SUPPRESSION_KEY_PATTERN.test(key)) {
      throw new Error('diagnostic suppression key is invalid')
    }
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 86_400_000) {
      throw new Error('diagnostic suppression interval is invalid')
    }
    const timestamp = this.now().getTime()
    const previous = this.suppressedDiagnostics.get(key)
    if (previous !== undefined && timestamp - previous.lastReportedAt < intervalMs) {
      previous.suppressedCount += 1
      return Promise.resolve(undefined)
    }
    const suppressedCount = previous?.suppressedCount ?? 0
    this.suppressedDiagnostics.set(key, { lastReportedAt: timestamp, suppressedCount: 0 })
    return this.diagnostic(source, message, {
      ...fields,
      ...(suppressedCount === 0 ? {} : { suppressedCount }),
    })
  }

  async files() {
    try {
      const names = (await readdir(this.root)).filter(name => name.endsWith('.jsonl'))
      return Promise.all(names.map(async name => ({ name, path: join(this.root, name), details: await stat(join(this.root, name)) })))
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
  }

  async pruneUnlocked() {
    const cutoff = this.now().getTime() - this.retentionMs
    let files = await this.files()
    for (const file of files) {
      if (file.details.mtimeMs < cutoff) await rm(file.path, { force: true })
    }
    files = (await this.files()).sort((left, right) => left.details.mtimeMs - right.details.mtimeMs)
    let total = files.reduce((sum, file) => sum + file.details.size, 0)
    for (const file of files) {
      if (total <= this.maxBytes) break
      await rm(file.path, { force: true })
      total -= file.details.size
    }
  }

  prune() {
    return this.serialized(() => this.pruneUnlocked())
  }

  async query({ sources, since, taskId, operation, phase, limit = 200 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5_000) throw new Error('log query limit is invalid')
    const selected = sources === undefined ? undefined : new Set(sources.map(validateSource))
    const threshold = since === undefined ? undefined : new Date(since).toISOString()
    const filters = {
      taskId: validateFilter(taskId, 'taskId'),
      operation: validateFilter(operation, 'operation'),
      phase: validateFilter(phase, 'phase'),
    }
    const entries = []
    for (const file of await this.files()) {
      const lines = (await readFile(file.path, 'utf8')).split('\n')
      for (const line of lines) {
        if (line === '') continue
        const entry = parseLine(line)
        if (
          entry !== undefined
          && (selected === undefined || selected.has(entry.source))
          && (threshold === undefined || entry.timestamp >= threshold)
          && matches(entry, filters)
        ) entries.push(entry)
      }
    }
    entries.sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    return Object.freeze(entries.slice(-limit).map(Object.freeze))
  }

  async follow({ sources, since, taskId, operation, phase } = {}, listener, { intervalMs = 250, onError = () => {} } = {}) {
    if (typeof listener !== 'function') throw new Error('log follow listener is required')
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 50) throw new Error('log follow interval is invalid')
    const selected = sources === undefined ? undefined : new Set(sources.map(validateSource))
    const threshold = since === undefined ? undefined : new Date(since).toISOString()
    const filters = {
      taskId: validateFilter(taskId, 'taskId'),
      operation: validateFilter(operation, 'operation'),
      phase: validateFilter(phase, 'phase'),
    }
    await mkdir(this.root, { recursive: true })
    let states = new Map()
    for (const file of await this.files()) {
      states.set(file.name, { identity: `${String(file.details.dev)}:${String(file.details.ino)}`, offset: file.details.size, pending: Buffer.alloc(0) })
    }
    let closed = false
    let scanning = false
    let scanAgain = false
    const scan = async () => {
      if (closed) return
      if (scanning) {
        scanAgain = true
        return
      }
      scanning = true
      try {
        const files = await this.files()
        const byIdentity = new Map([...states.values()].map(state => [state.identity, state]))
        const nextStates = new Map()
        const entries = []
        for (const file of files) {
          const identity = `${String(file.details.dev)}:${String(file.details.ino)}`
          let state = states.get(file.name)
          if (state?.identity !== identity) state = byIdentity.get(identity)
          if (state === undefined || file.details.size < state.offset) state = { identity, offset: 0, pending: Buffer.alloc(0) }
          if (file.details.size > state.offset) {
            const chunks = []
            const end = file.details.size - 1
            for await (const chunk of createReadStream(file.path, { start: state.offset, end })) chunks.push(chunk)
            const content = Buffer.concat([state.pending, ...chunks])
            let lineStart = 0
            for (let index = 0; index < content.length; index += 1) {
              if (content[index] !== 0x0a) continue
              const line = content.subarray(lineStart, index).toString('utf8')
              lineStart = index + 1
              if (line === '') continue
              const entry = parseLine(line)
              if (entry !== undefined
                && (selected === undefined || selected.has(entry.source))
                && (threshold === undefined || entry.timestamp >= threshold)
                && matches(entry, filters)) entries.push(entry)
            }
            state = { ...state, identity, offset: file.details.size, pending: content.subarray(lineStart) }
          }
          nextStates.set(file.name, state)
        }
        states = nextStates
        entries.sort((left, right) => left.timestamp.localeCompare(right.timestamp))
        for (const entry of entries) listener(Object.freeze(entry))
      } catch (error) {
        onError(error)
      } finally {
        scanning = false
        if (scanAgain) {
          scanAgain = false
          void scan()
        }
      }
    }
    const timer = setInterval(() => { void scan() }, intervalMs)
    timer.unref()
    return Object.freeze({
      close: () => {
        closed = true
        clearInterval(timer)
      },
    })
  }

  capture(child, source, declaration = { stdout: true, stderr: true }, { acceptForwarded = false } = {}) {
    for (const streamName of ['stdout', 'stderr']) {
      if (!declaration[streamName]) continue
      const stream = child[streamName]
      if (stream === undefined || stream === null) continue
      let pending = ''
      let completeLines = []
      let flushScheduled = false
      const appendLines = lines => {
        if (lines.length === 0) return
        const messages = capturedMessages(source, streamName, lines)
        for (const message of messages) {
          void this.append(source, streamName, message, { level: capturedLogLevel(streamName, message) })
            .catch(error => this.emit('error', error))
        }
      }
      const flush = () => {
        flushScheduled = false
        const lines = completeLines
        completeLines = []
        let unforwarded = []
        const flushUnforwarded = () => {
          appendLines(unforwarded)
          unforwarded = []
        }
        for (const line of lines) {
          const forwarded = acceptForwarded && this.output !== undefined ? parseForwardedLine(line) : undefined
          if (forwarded === undefined) unforwarded.push(line)
          else {
            flushUnforwarded()
            this.writeOutput(forwarded.stream, line)
          }
        }
        flushUnforwarded()
      }
      const scheduleFlush = () => {
        if (flushScheduled) return
        flushScheduled = true
        setImmediate(flush)
      }
      stream.setEncoding?.('utf8')
      stream.on('data', chunk => {
        pending += String(chunk)
        const lines = pending.split('\n')
        pending = lines.pop()
        completeLines.push(...lines)
        scheduleFlush()
      })
      stream.once('end', () => {
        if (pending !== '') completeLines.push(pending)
        pending = ''
        flush()
      })
    }
  }
}
