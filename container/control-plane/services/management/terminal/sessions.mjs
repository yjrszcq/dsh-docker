import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { WebSocketServer } from 'ws'

const SESSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MAX_INPUT_BYTES = 64 * 1024
const MAX_OUTPUT_BYTES = 256 * 1024
const MAX_SOCKET_BUFFER_BYTES = 1024 * 1024
const MAX_HELPER_INPUT_BUFFER_BYTES = 256 * 1024
const MAX_SESSIONS = 32
const MIN_COLS = 2
const MAX_COLS = 500
const MIN_ROWS = 1
const MAX_ROWS = 200

function dimensions(value = {}) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['cols', 'rows'].includes(key))) throw new Error('Terminal dimensions are invalid')
  const cols = value.cols ?? 80
  const rows = value.rows ?? 24
  if (!Number.isSafeInteger(cols) || cols < MIN_COLS || cols > MAX_COLS
    || !Number.isSafeInteger(rows) || rows < MIN_ROWS || rows > MAX_ROWS) {
    throw new Error('Terminal dimensions are outside the supported range')
  }
  return { cols, rows }
}

function exactMessage(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

class TerminalSession extends EventEmitter {
  constructor({ id, helperPath, cwd, env, cols, rows, reconnectMs, report, python }) {
    super()
    this.id = id
    this.createdAt = new Date().toISOString()
    this.updatedAt = this.createdAt
    this.status = 'running'
    this.exit = null
    this.output = Buffer.alloc(0)
    this.connections = new Set()
    this.everConnected = false
    this.reconnectMs = reconnectMs
    this.report = report
    this.decoder = new StringDecoder('utf8')
    this.outputDecoder = new StringDecoder('utf8')
    this.lineBuffer = ''
    this.closed = false
    this.terminationTimers = []
    this.child = spawn(python, [helperPath, cwd, String(cols), String(rows)], {
      cwd,
      env: { ...env, TERM: 'xterm-256color' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child.stdout.on('data', chunk => this.consume(chunk))
    this.child.stderr.on('data', chunk => this.report('terminal.helper.stderr', {
      sessionId: this.id,
      bytes: chunk.byteLength,
      level: 'warning',
    }))
    this.child.once('error', error => this.fail(error))
    this.child.once('exit', (code, signal) => {
      for (const timer of this.terminationTimers) clearTimeout(timer)
      if (this.status === 'running') this.finish({ code, signal })
    })
    this.scheduleExpiry()
  }

  publicStatus() {
    return Object.freeze({
      sessionId: this.id,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      connected: this.connections.size > 0,
      exit: this.exit,
    })
  }

  scheduleExpiry() {
    clearTimeout(this.expiry)
    this.expiry = setTimeout(() => {
      if (this.connections.size === 0) this.terminate('reconnect-expired')
    }, this.reconnectMs)
    this.expiry.unref()
  }

  sendCommand(value) {
    if (this.status !== 'running' || !this.child.stdin.writable) return false
    this.child.stdin.write(`${JSON.stringify(value)}\n`)
    return true
  }

  consume(chunk) {
    this.lineBuffer += this.decoder.write(chunk)
    for (let newline = this.lineBuffer.indexOf('\n'); newline !== -1; newline = this.lineBuffer.indexOf('\n')) {
      const line = this.lineBuffer.slice(0, newline)
      this.lineBuffer = this.lineBuffer.slice(newline + 1)
      try {
        const value = JSON.parse(line)
        if (value.type === 'output' && typeof value.data === 'string') this.broadcastOutput(Buffer.from(value.data, 'base64'))
        else if (value.type === 'exit') this.finish({ code: value.code ?? null, signal: value.signal ?? null })
        else if (value.type === 'error') this.fail(new Error(String(value.message)))
        else this.fail(new Error('PTY helper emitted an invalid message'))
      } catch (error) {
        this.fail(error)
      }
    }
  }

  broadcastOutput(bytes) {
    this.output = Buffer.concat([this.output, bytes])
    if (this.output.byteLength > MAX_OUTPUT_BYTES) this.output = this.output.subarray(this.output.byteLength - MAX_OUTPUT_BYTES)
    const data = this.outputDecoder.write(bytes)
    if (data === '') return
    const message = JSON.stringify({ type: 'output', data })
    for (const socket of this.connections) if (socket.readyState === 1) {
      if (socket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) socket.close(1013, 'terminal client is too slow')
      else socket.send(message)
    }
  }

  attach(socket) {
    clearTimeout(this.expiry)
    const reconnect = this.everConnected
    this.everConnected = true
    this.connections.add(socket)
    void this.report(reconnect ? 'terminal.session.reconnected' : 'terminal.session.connected', { sessionId: this.id })
    if (this.output.byteLength > 0) socket.send(JSON.stringify({ type: 'output', data: this.output.toString('utf8') }))
    if (this.exit !== null) socket.send(JSON.stringify({ type: 'exit', ...this.exit }))
    socket.on('message', data => this.handleMessage(socket, data))
    socket.once('close', () => {
      this.connections.delete(socket)
      void this.report('terminal.session.disconnected', { sessionId: this.id })
      if (!this.closed && this.connections.size === 0) this.scheduleExpiry()
    })
    socket.once('error', error => this.report('terminal.session.connection.failed', { error, sessionId: this.id }))
  }

  handleMessage(socket, data) {
    try {
      if (Buffer.byteLength(data) > MAX_INPUT_BYTES + 1024) throw new Error('Terminal message is too large')
      const value = JSON.parse(data.toString())
      if (value.type === 'input') {
        if (!exactMessage(value, ['type', 'data']) || typeof value.data !== 'string'
          || Buffer.byteLength(value.data) > MAX_INPUT_BYTES) throw new Error('Terminal input is invalid')
        if (this.child.stdin.writableLength > MAX_HELPER_INPUT_BUFFER_BYTES) {
          socket.close(1013, 'terminal input is too fast')
          return
        }
        this.sendCommand({ type: 'input', data: Buffer.from(value.data).toString('base64') })
      } else if (value.type === 'resize') {
        if (!exactMessage(value, ['type', 'cols', 'rows'])) throw new Error('Terminal resize is invalid')
        this.sendCommand({ type: 'resize', ...dimensions({ cols: value.cols, rows: value.rows }) })
      } else throw new Error('Terminal message type is invalid')
    } catch {
      socket.close(1008, 'invalid terminal message')
    }
  }

  finish(exit) {
    if (this.status !== 'running') return
    this.status = 'exited'
    this.exit = Object.freeze({ code: exit.code ?? null, signal: exit.signal ?? null })
    this.updatedAt = new Date().toISOString()
    for (const socket of this.connections) if (socket.readyState === 1) {
      socket.send(JSON.stringify({ type: 'exit', ...this.exit }))
    }
    void this.report('terminal.session.exited', { sessionId: this.id, ...this.exit })
    if (this.connections.size === 0) this.scheduleExpiry()
    this.emit('terminal-exit')
  }

  fail(error) {
    if (this.status !== 'running') return
    void this.report('terminal.session.failed', { error, sessionId: this.id })
    this.terminate('failed')
  }

  terminate(reason = 'closed') {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.expiry)
    if (this.status === 'running') {
      this.sendCommand({ type: 'signal', signal: 15 })
      for (const [delay, signal] of [[2_000, 'SIGTERM'], [4_000, 'SIGKILL']]) {
        const timer = setTimeout(() => this.child.kill(signal), delay)
        timer.unref()
        this.terminationTimers.push(timer)
      }
    }
    this.child.stdin.destroy()
    for (const socket of this.connections) socket.close(1001, 'terminal session closed')
    this.connections.clear()
    void this.report('terminal.session.closed', { reason, sessionId: this.id })
    this.emit('terminal-close')
  }
}

export class TerminalSessionManager {
  constructor({
    helperPath = new URL('./pty-helper.py', import.meta.url).pathname,
    cwd = '/workspace',
    dshHome = '/data/dsh',
    env = process.env,
    python = '/usr/bin/python3',
    reconnectMs = 30_000,
    report = async () => {},
  } = {}) {
    this.helperPath = resolve(helperPath)
    this.cwd = resolve(cwd)
    this.env = { ...env, DSH_HOME: dshHome }
    this.python = python
    this.reconnectMs = reconnectMs
    this.report = (message, fields) => Promise.resolve().then(() => report(message, fields)).catch(() => {})
    this.sessions = new Map()
    this.webSockets = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: MAX_INPUT_BYTES + 1024 })
  }

  create(value = {}) {
    if (this.sessions.size >= MAX_SESSIONS) {
      const error = new Error('Terminal session limit reached')
      error.statusCode = 409
      throw error
    }
    const { cols, rows } = dimensions(value)
    const sessionId = randomUUID()
    const session = new TerminalSession({
      id: sessionId, helperPath: this.helperPath, cwd: this.cwd, env: this.env,
      cols, rows, reconnectMs: this.reconnectMs, report: this.report, python: this.python,
    })
    this.sessions.set(sessionId, session)
    session.once('terminal-close', () => this.sessions.delete(sessionId))
    void this.report('terminal.session.created', { sessionId })
    return session.publicStatus()
  }

  require(id) {
    if (!SESSION_PATTERN.test(id) || !this.sessions.has(id)) {
      const error = new Error('Terminal session was not found')
      error.statusCode = 404
      throw error
    }
    return this.sessions.get(id)
  }

  status(id) {
    return this.require(id).publicStatus()
  }

  close(id) {
    const session = this.require(id)
    session.terminate('deleted')
    return { sessionId: id, closed: true }
  }

  upgrade(request, socket, head, id) {
    const session = this.require(id)
    this.webSockets.handleUpgrade(request, socket, head, webSocket => session.attach(webSocket))
  }

  async shutdown() {
    for (const session of [...this.sessions.values()]) session.terminate('management-stopping')
    this.webSockets.close()
  }
}

export const terminalSessionInternals = Object.freeze({ dimensions, SESSION_PATTERN })
