import { spawn } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { chmod, chown, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

const MAX_BODY_BYTES = 1024

function sameToken(left, right) {
  const a = Buffer.from(left ?? '')
  const b = Buffer.from(right ?? '')
  return a.byteLength === b.byteLength && a.byteLength > 0 && timingSafeEqual(a, b)
}

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(value)}\n`)
}

async function body(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('proxy launch request body is too large')
    chunks.push(chunk)
  }
  return size === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function proxyLaunchCommand({ node, script, uid, gid, platformGid }) {
  if (!Number.isInteger(uid) || uid < 1 || !Number.isInteger(gid) || gid < 1) {
    throw new Error('Proxy Manager UID and GID must be positive integers')
  }
  if (!Number.isInteger(platformGid) || platformGid < 1) {
    throw new Error('Proxy Manager platform GID must be a positive integer')
  }
  return {
    executable: '/usr/bin/setpriv',
    args: [
      `--reuid=${String(uid)}`,
      `--regid=${String(gid)}`,
      `--groups=${String(platformGid)}`,
      '--', node, script,
    ],
  }
}

export function proxyLaunchEnvironment({ environment = process.env, dataRoot, runRoot }) {
  return {
    HOME: '/nonexistent',
    USER: 'dsh-proxy',
    LOGNAME: 'dsh-proxy',
    PATH: environment.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    DSH_PLATFORM_DATA: dataRoot,
    DSH_PLATFORM_RUN: runRoot,
    ...(environment.DSH_PROXY_MASTER_KEY === undefined
      ? {}
      : { DSH_PROXY_MASTER_KEY: environment.DSH_PROXY_MASTER_KEY }),
  }
}

export class ProxyLaunchBroker {
  constructor({
    token,
    dataRoot,
    runRoot,
    script,
    controlSocket,
    uid,
    gid,
    platformGid,
    node = process.execPath,
    spawnImpl = spawn,
    capture = () => {},
    report = async () => {},
    readyTimeoutMs = 10_000,
  }) {
    this.token = token
    this.dataRoot = dataRoot
    this.runRoot = runRoot
    this.script = script
    this.controlSocket = controlSocket
    this.uid = uid
    this.gid = gid
    this.platformGid = platformGid
    this.node = node
    this.spawnImpl = spawnImpl
    this.capture = capture
    this.report = report
    this.readyTimeoutMs = readyTimeoutMs
    this.child = undefined
    this.ready = undefined
  }

  status() {
    const running = this.child !== undefined
      && this.child.exitCode === null
      && this.child.signalCode === null
    return {
      running,
      componentReady: running && this.ready?.componentReady === true,
      pid: running ? this.child.pid ?? null : null,
      revision: running ? this.ready?.revision ?? null : null,
      ports: running ? this.ready?.ports ?? [] : [],
    }
  }

  async start() {
    if (this.status().running) return this.status()
    const command = proxyLaunchCommand({
      node: this.node,
      script: this.script,
      uid: this.uid,
      gid: this.gid,
      platformGid: this.platformGid,
    })
    const child = this.spawnImpl(command.executable, command.args, {
      env: proxyLaunchEnvironment({ dataRoot: this.dataRoot, runRoot: this.runRoot }),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    this.child = child
    this.ready = undefined
    this.capture(child, 'proxy-manager', { stdout: true, stderr: true })
    const ready = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => reject(new Error(
        `Proxy Manager exited before readiness (code=${String(code)}, signal=${String(signal)})`,
      )))
      child.on('message', message => {
        if (message?.type === 'ready' && message.componentReady === true) resolve(message)
      })
    })
    let timer
    try {
      const message = await Promise.race([
        ready,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Proxy Manager readiness timed out')), this.readyTimeoutMs)
          timer.unref?.()
        }),
      ])
      this.ready = Object.freeze({
        componentReady: true,
        revision: message.revision ?? null,
        ports: Array.isArray(message.ports) ? [...message.ports] : [],
      })
      if (process.getuid?.() === 0 && this.platformGid !== undefined) {
        await chown(this.controlSocket, this.uid, this.platformGid)
        await chmod(this.controlSocket, 0o660)
      }
      await this.report('proxy-manager.launch.completed', { pid: child.pid ?? null })
      child.once('exit', (code, signal) => {
        if (this.child !== child) return
        this.child = undefined
        this.ready = undefined
        void this.report('proxy-manager.exited', {
          level: code === 0 || signal === 'SIGTERM' ? 'info' : 'error', code, signal,
        })
      })
      return this.status()
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill('SIGTERM')
        await exited.catch(() => {})
      }
      if (this.child === child) this.child = undefined
      this.ready = undefined
      await this.report('proxy-manager.launch.failed', { error })
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  async stop() {
    const child = this.child
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) {
      this.child = undefined
      this.ready = undefined
      return this.status()
    }
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 5_000)),
    ])
    if (!graceful && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await once(child, 'exit')
    }
    if (this.child === child) this.child = undefined
    this.ready = undefined
    await this.report('proxy-manager.stop.completed')
    return this.status()
  }
}

export function createProxyLaunchServer({ broker, token, report = async () => {} }) {
  return createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url ?? '/', 'http://proxy-launch.internal').pathname
      if (request.method === 'GET' && pathname === '/v1/status') return send(response, 200, broker.status())
      if (request.method !== 'POST' || !['/v1/start', '/v1/stop'].includes(pathname)) {
        return send(response, 404, { error: 'not found' })
      }
      const value = await body(request)
      if (!sameToken(value.token, token)) return send(response, 403, { error: 'proxy launch authorization failed' })
      const result = pathname === '/v1/start' ? await broker.start() : await broker.stop()
      send(response, 200, result)
    })().catch(async error => {
      await report('proxy-launch.request.failed', {
        error, method: request.method ?? null, pathname: request.url ?? null,
      })
      send(response, 500, { error: error instanceof Error ? error.message : 'proxy launch failed' })
    })
  })
}

export async function listenProxyLaunch(server, socketPath, platformGid) {
  await mkdir(dirname(socketPath), { recursive: true })
  await rm(socketPath, { force: true })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  if (process.getuid?.() === 0) await chown(socketPath, 0, platformGid)
  await chmod(socketPath, process.getuid?.() === 0 ? 0o660 : 0o600)
}
