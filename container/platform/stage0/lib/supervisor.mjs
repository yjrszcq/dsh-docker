import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'

function timeout(milliseconds, message) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds)
    timer.unref?.()
  })
}

export async function terminateChild(child, graceMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), graceMs)),
  ])
  if (!graceful && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

export class BootstrapSupervisor {
  constructor({
    slots,
    dataRoot,
    node = process.execPath,
    entrypoint = 'index.mjs',
    readyTimeoutMs = 30_000,
    spawnImpl = spawn,
    uid,
    gid,
  }) {
    this.slots = slots
    this.dataRoot = dataRoot
    this.node = node
    this.entrypoint = entrypoint
    this.readyTimeoutMs = readyTimeoutMs
    this.spawnImpl = spawnImpl
    this.uid = uid
    this.gid = gid
    this.child = undefined
  }

  async launch(version) {
    const child = this.spawnImpl(this.node, [join(this.slots.versionPath(version), this.entrypoint)], {
      env: { ...process.env, DSH_PLATFORM_DATA: this.dataRoot },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      uid: this.uid,
      gid: this.gid,
    })
    this.child = child
    const ready = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => reject(new Error(
        `Bootstrap exited before readiness (code=${String(code)}, signal=${String(signal)})`,
      )))
      child.on('message', message => {
        if (message?.type === 'ready' && message.bootstrapApi === 1) resolve()
      })
    })
    try {
      await Promise.race([ready, timeout(this.readyTimeoutMs, 'Bootstrap readiness timed out')])
      return child
    } catch (error) {
      await terminateChild(child)
      if (this.child === child) this.child = undefined
      throw error
    }
  }

  async startWithRollback() {
    const state = await this.slots.state()
    if (state.current === undefined) throw new Error('no current Bootstrap is installed')
    try {
      return await this.launch(state.current)
    } catch (candidateError) {
      if (state.previous === undefined) throw candidateError
      await this.slots.rollback()
      try {
        return await this.launch(state.previous)
      } catch (rollbackError) {
        throw new AggregateError([candidateError, rollbackError], 'Bootstrap candidate and rollback both failed')
      }
    }
  }

  async restart() {
    if (this.child !== undefined) await terminateChild(this.child)
    this.child = undefined
    return this.startWithRollback()
  }

  async stop() {
    if (this.child !== undefined) await terminateChild(this.child)
    this.child = undefined
  }
}
