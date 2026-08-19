import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

const SOURCE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/
const MAX_ENTRY_BYTES = 64 * 1024
const CONSOLE_MARKER = 'dsh-platform-log-v1'

function validateSource(source) {
  if (typeof source !== 'string' || !SOURCE_PATTERN.test(source)) throw new Error('log source is invalid')
  return source
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

export class JsonlLogManager extends EventEmitter {
  constructor({
    root,
    maxBytes = 100 * 1024 * 1024,
    retentionDays = 14,
    rotateBytes = 10 * 1024 * 1024,
    now = () => new Date(),
    output,
  }) {
    super()
    if (!Number.isSafeInteger(maxBytes) || maxBytes < MAX_ENTRY_BYTES) throw new Error('log maxBytes is invalid')
    if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) throw new Error('log retentionDays is invalid')
    if (!Number.isSafeInteger(rotateBytes) || rotateBytes < 1_024) throw new Error('log rotateBytes is invalid')
    this.root = root
    this.maxBytes = maxBytes
    this.retentionMs = retentionDays * 86_400_000
    this.rotateBytes = rotateBytes
    this.now = now
    this.output = output
    this.queue = Promise.resolve()
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
      const entry = { ...fields, timestamp: this.now().toISOString(), source, stream, message }
      const line = Buffer.from(`${JSON.stringify(entry)}\n`)
      if (line.byteLength > MAX_ENTRY_BYTES) throw new Error('log entry exceeds 64 KiB')
      await mkdir(this.root, { recursive: true })
      const path = this.currentPath(source)
      const size = await stat(path).then(value => value.size, error => error?.code === 'ENOENT' ? 0 : Promise.reject(error))
      if (size > 0 && size + line.byteLength > this.rotateBytes) {
        await rename(path, join(this.root, `${source}.${Date.now()}.${randomUUID()}.jsonl`))
      }
      await appendFile(path, line, { mode: 0o600 })
      this.emit('entry', Object.freeze(entry))
      this.mirror(entry)
      await this.pruneUnlocked()
      return Object.freeze(entry)
    })
  }

  audit(action, fields = {}) {
    return this.append('audit', 'audit', action, fields)
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

  async query({ sources, since, limit = 200 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error('log query limit is invalid')
    const selected = sources === undefined ? undefined : new Set(sources.map(validateSource))
    const threshold = since === undefined ? undefined : new Date(since).toISOString()
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
        ) entries.push(entry)
      }
    }
    entries.sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    return Object.freeze(entries.slice(-limit).map(Object.freeze))
  }

  capture(child, source, declaration = { stdout: true, stderr: true }, { acceptForwarded = false } = {}) {
    for (const streamName of ['stdout', 'stderr']) {
      if (!declaration[streamName]) continue
      const stream = child[streamName]
      if (stream === undefined || stream === null) continue
      let pending = ''
      stream.setEncoding?.('utf8')
      stream.on('data', chunk => {
        pending += String(chunk)
        const lines = pending.split('\n')
        pending = lines.pop()
        for (const line of lines) {
          const forwarded = acceptForwarded && this.output !== undefined ? parseForwardedLine(line) : undefined
          if (forwarded === undefined) {
            void this.append(source, streamName, line).catch(error => this.emit('error', error))
          } else this.writeOutput(forwarded.stream, line)
        }
      })
      stream.once('end', () => {
        if (pending !== '') void this.append(source, streamName, pending).catch(error => this.emit('error', error))
      })
    }
  }
}
