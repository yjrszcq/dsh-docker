import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { replaceRuntimeView } from '../../lib/paths.mjs'

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
    runRoot = '/run/dsh-platform',
    paths,
    node = process.execPath,
    entrypoint = 'index.mjs',
    seedRoot,
    readyTimeoutMs = 30_000,
    spawnImpl = spawn,
    uid,
    gid,
  }) {
    this.slots = slots
    this.dataRoot = dataRoot
    this.runRoot = runRoot
    this.paths = paths
    this.node = node
    this.entrypoint = entrypoint
    this.seedRoot = seedRoot
    this.readyTimeoutMs = readyTimeoutMs
    this.spawnImpl = spawnImpl
    this.uid = uid
    this.gid = gid
    this.child = undefined
    this.fatal = new Promise(resolveFatal => { this.resolveFatal = resolveFatal })
  }

  async launch(recordId) {
    const resolved = await this.slots.resolveRecord(recordId)
    if (this.paths !== undefined) await replaceRuntimeView(this.paths, 'bootstrap', resolved.path)
    const child = this.spawnImpl(this.node, [join(resolved.path, this.entrypoint)], {
      env: {
        ...process.env,
        DSH_PLATFORM_DATA: this.dataRoot,
        DSH_PLATFORM_RUN: this.runRoot,
        ...(this.seedRoot === undefined ? {} : { DSH_PLATFORM_SEED: this.seedRoot }),
        DSH_BOOTSTRAP_VERSION: resolved.record.version,
      },
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
      child.once('exit', (code, signal) => {
        if (this.child === child) this.resolveFatal(new Error(
          `Bootstrap exited unexpectedly (code=${String(code)}, signal=${String(signal)})`,
        ))
      })
      return child
    } catch (error) {
      await terminateChild(child)
      if (this.child === child) this.child = undefined
      throw error
    }
  }

  async startWithRollback() {
    const state = await this.slots.state()
    if (state.current === null) throw new Error('no current Bootstrap is installed')
    try {
      return await this.launch(state.current)
    } catch (candidateError) {
      if (state.previous === null) throw candidateError
      await this.slots.rollback()
      try {
        return await this.launch(state.previous)
      } catch (rollbackError) {
        throw new AggregateError([candidateError, rollbackError], 'Bootstrap candidate and rollback both failed')
      }
    }
  }

  async restart() {
    const child = this.child
    this.child = undefined
    if (child !== undefined) await terminateChild(child)
    return this.startWithRollback()
  }

  async stop() {
    const child = this.child
    this.child = undefined
    if (child !== undefined) await terminateChild(child)
  }
}
