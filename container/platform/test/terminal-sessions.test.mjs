import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import WebSocket from '../../control-plane/services/management/node_modules/ws/wrapper.mjs'
import { createManagementServer } from '../../control-plane/services/management/server.mjs'
import { TerminalSessionManager, terminalSessionInternals } from '../../control-plane/services/management/terminal/sessions.mjs'

const API = '/_dsh_platform/api/v1/'

function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const outgoing = httpRequest({
      host: '127.0.0.1', port, method, path,
      headers: encoded === undefined ? undefined : { 'content-type': 'application/json', 'content-length': encoded.byteLength },
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.once('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: response.statusCode, body: text === '' ? undefined : JSON.parse(text) })
      })
    })
    outgoing.once('error', reject)
    outgoing.end(encoded)
  })
}

function collector(url) {
  const socket = new WebSocket(url)
  let output = ''
  let exit
  const waiters = new Set()
  socket.on('message', bytes => {
    const value = JSON.parse(bytes.toString())
    if (value.type === 'output') output += value.data
    if (value.type === 'exit') exit = value
    for (const waiter of waiters) waiter()
  })
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (predicate({ output, exit })) return { output, exit }
      await new Promise(resolve => {
        const timer = setTimeout(() => { waiters.delete(done); resolve() }, 25)
        const done = () => { clearTimeout(timer); waiters.delete(done); resolve() }
        waiters.add(done)
      })
    }
    throw new Error(`terminal output did not reach expected state: ${output}`)
  }
  return { socket, waitFor, output: () => output }
}

async function fixture({ reconnectMs = 30_000 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-terminal-'))
  const workspace = join(root, 'workspace')
  const dshHome = join(root, 'dsh')
  await mkdir(workspace)
  await mkdir(dshHome)
  const reports = []
  const terminalSessions = new TerminalSessionManager({
    cwd: workspace,
    dshHome,
    reconnectMs,
    report: async (message, fields) => { reports.push({ message, fields }) },
  })
  const logs = {
    diagnostic: async () => {}, query: async () => [], on: () => {}, off: () => {},
  }
  const state = { read: async () => ({}), on: () => {}, off: () => {} }
  const coordinator = { publicStatus: async () => ({}), hasActiveTask: () => false, state, on: () => {}, off: () => {} }
  const server = createManagementServer({ coordinator, logs, terminalSessions })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  return {
    root, workspace, dshHome, reports, terminalSessions, server, port,
    close: async () => {
      await terminalSessions.shutdown()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

test('terminal HTTP and WebSocket lifecycle provides a real bounded PTY', async () => {
  const value = await fixture()
  try {
    const created = await request(value.port, 'POST', `${API}terminal/sessions`, { cols: 92, rows: 31 })
    assert.equal(created.status, 201)
    assert.match(created.body.sessionId, terminalSessionInternals.SESSION_PATTERN)
    const path = `${API}terminal/sessions/${created.body.sessionId}`
    assert.equal((await request(value.port, 'GET', path)).body.status, 'running')

    const first = collector(`ws://127.0.0.1:${value.port}${path}/stream`)
    await new Promise((resolve, reject) => {
      first.socket.once('open', resolve)
      first.socket.once('error', reject)
    })
    first.socket.send(JSON.stringify({ type: 'resize', cols: 101, rows: 37 }))
    first.socket.send(JSON.stringify({
      type: 'input',
      data: "printf '\\033[31mred\\033[0m\\n'; printf '中文✓\\n'; printf 'cwd=%s\\n' \"$PWD\"; printf 'home=%s\\n' \"$HOME\"; printf 'dsh=%s\\n' \"$DSH_HOME\"; printf 'uid=%s\\n' \"$(id -u)\"; printf 'gids=%s\\n' \"$(id -G)\"; printf 'path=%s\\n' \"$PATH\"; printf 'umask=%s\\n' \"$(umask)\"; stty size; printf 'command-complete\\n'\n",
    }))
    let initial
    try {
      initial = await first.waitFor(({ output }) => output.includes('\x1b[31mred\x1b[0m') && output.match(/command-complete/g)?.length >= 3)
    } catch (error) {
      error.message += `; status=${JSON.stringify((await request(value.port, 'GET', path)).body)} reports=${JSON.stringify(value.reports)}`
      throw error
    }
    assert.match(initial.output, /\x1b\[31mred\x1b\[0m/)
    assert.match(initial.output, /中文✓/)
    assert.match(initial.output, new RegExp(`cwd=${value.workspace.replaceAll('/', '\\/')}`))
    assert.match(initial.output, new RegExp(`home=${userInfo().homedir.replaceAll('/', '\\/')}`))
    assert.match(initial.output, new RegExp(`dsh=${value.dshHome.replaceAll('/', '\\/')}`))
    assert.match(initial.output, new RegExp(`uid=${String(process.getuid())}`))
    for (const group of process.getgroups()) assert.match(initial.output, new RegExp(`gids=[^\\r\\n]*\\b${String(group)}\\b`))
    assert.match(initial.output, /path=\S+/)
    assert.match(initial.output, /umask=0002/)
    assert.match(initial.output, /37 101/)

    first.socket.send(JSON.stringify({ type: 'input', data: "read -p 'answer: ' value; printf 'interactive=%s\\n' \"$value\"\n" }))
    await first.waitFor(({ output }) => output.includes('answer:'))
    first.socket.send(JSON.stringify({ type: 'input', data: 'works\n' }))
    await first.waitFor(({ output }) => output.includes('interactive=works'))
    first.socket.send(JSON.stringify({ type: 'input', data: "printf 'long-start\\n'; head -c 300000 /dev/zero | tr '\\0' x; printf '\\nlong-tail\\n'\n" }))
    await first.waitFor(({ output }) => output.length > 300_000 && output.match(/long-tail/g)?.length >= 2)
    first.socket.send(JSON.stringify({ type: 'input', data: "printf 'cached-marker\\n'\n" }))
    await first.waitFor(({ output }) => output.includes('cached-marker'))
    first.socket.close()
    await new Promise(resolve => first.socket.once('close', resolve))

    const second = collector(`ws://127.0.0.1:${value.port}${path}/stream`)
    await new Promise((resolve, reject) => {
      second.socket.once('open', resolve)
      second.socket.once('error', reject)
    })
    const replay = (await second.waitFor(({ output }) => output.includes('cached-marker'))).output
    assert.match(replay, /long-tail/)
    assert.match(replay, /cached-marker/)
    assert.doesNotMatch(replay, /long-start/)
    assert.ok(Buffer.byteLength(replay) <= 256 * 1024 + 1024)
    second.socket.send(JSON.stringify({ type: 'input', data: 'exit 7\n' }))
    const ended = await second.waitFor(result => result.exit !== undefined)
    assert.deepEqual({ code: ended.exit.code, signal: ended.exit.signal }, { code: 7, signal: null })
    assert.equal((await request(value.port, 'GET', path)).body.status, 'exited')
    assert.equal((await request(value.port, 'DELETE', path)).body.closed, true)
    second.socket.close()

    const messages = value.reports.map(entry => entry.message)
    for (const event of [
      'terminal.session.created', 'terminal.session.connected', 'terminal.session.disconnected',
      'terminal.session.reconnected', 'terminal.session.exited', 'terminal.session.closed',
    ]) assert.ok(messages.includes(event), `${event} was not reported`)
    assert.doesNotMatch(JSON.stringify(value.reports), /cached-marker|interactive=works|command-complete/)
  } finally {
    await value.close()
  }
})

test('terminal sessions enforce dimensions, message size, expiry, and exact IDs', async () => {
  const value = await fixture({ reconnectMs: 80 })
  try {
    for (const body of [{ cols: 1, rows: 24 }, { cols: 501, rows: 24 }, { cols: 80, rows: 0 }, { cols: 80, rows: 201 }]) {
      assert.equal((await request(value.port, 'POST', `${API}terminal/sessions`, body)).status, 400)
    }
    const created = (await request(value.port, 'POST', `${API}terminal/sessions`, {})).body
    const path = `${API}terminal/sessions/${created.sessionId}`
    const connection = collector(`ws://127.0.0.1:${value.port}${path}/stream`)
    await new Promise((resolve, reject) => {
      connection.socket.once('open', resolve)
      connection.socket.once('error', reject)
    })
    connection.socket.send(JSON.stringify({ type: 'resize', cols: 1, rows: 20 }))
    const closeCode = await new Promise(resolve => connection.socket.once('close', resolve))
    assert.equal(closeCode, 1008)
    let expiredStatus
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expiredStatus = (await request(value.port, 'GET', path)).status
      if (expiredStatus === 404) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(expiredStatus, 404)

    const oversized = (await request(value.port, 'POST', `${API}terminal/sessions`, {})).body
    const oversizedConnection = collector(`ws://127.0.0.1:${value.port}${API}terminal/sessions/${oversized.sessionId}/stream`)
    await new Promise((resolve, reject) => {
      oversizedConnection.socket.once('open', resolve)
      oversizedConnection.socket.once('error', reject)
    })
    oversizedConnection.socket.send(JSON.stringify({ type: 'input', data: 'x'.repeat(64 * 1024 + 1) }))
    const oversizedClose = await new Promise(resolve => oversizedConnection.socket.once('close', resolve))
    assert.ok([1008, 1009].includes(oversizedClose))
    assert.equal((await request(value.port, 'GET', `${API}terminal/sessions/not-a-uuid`)).status, 404)
  } finally {
    await value.close()
  }
})

test('terminal sessions default to the Root maintenance home', () => {
  const terminalSessions = new TerminalSessionManager()
  assert.equal(terminalSessions.cwd, '/root')
})

test('terminal shutdown waits for every helper process to close', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-terminal-shutdown-'))
  const workspace = join(root, 'workspace')
  const dshHome = join(root, 'dsh')
  await mkdir(workspace)
  await mkdir(dshHome)
  const terminalSessions = new TerminalSessionManager({ cwd: workspace, dshHome })
  const created = terminalSessions.create()
  const session = terminalSessions.sessions.get(created.sessionId)
  assert.equal(session.child.exitCode, null)
  await terminalSessions.shutdown()
  assert.equal(terminalSessions.sessions.size, 0)
  assert.equal(session.child.exitCode !== null || session.child.signalCode !== null, true)
})
