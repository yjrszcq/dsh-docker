import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { replaceRuntimeView } from '../../lib/paths.mjs'

function timeout(milliseconds, message) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds)
    timer.unref?.()
  })
}

export function bootstrapLaunchCommand({ node, script, uid, gid }) {
  if (uid === undefined && gid === undefined) return { executable: node, args: [script] }
  if (!Number.isInteger(uid) || uid < 0 || !Number.isInteger(gid) || gid < 0) {
    throw new Error('Bootstrap UID and GID must be non-negative integers')
  }
  return {
    executable: '/usr/bin/setpriv',
    args: [
      `--reuid=${String(uid)}`,
      `--regid=${String(gid)}`,
      '--keep-groups',
      '--',
      node,
      script,
    ],
  }
}

export function bootstrapLaunchEnvironment({
  environment = process.env,
  dataRoot,
  runRoot,
  seedRoot,
  bootstrapVersion,
  user,
  home,
}) {
  return {
    ...environment,
    ...(home === undefined ? {} : {
      HOME: home,
      XDG_CACHE_HOME: join(home, '.cache'),
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
    }),
    ...(user === undefined ? {} : { USER: user, LOGNAME: user }),
    DSH_PLATFORM_DATA: dataRoot,
    DSH_PLATFORM_RUN: runRoot,
    ...(seedRoot === undefined ? {} : { DSH_PLATFORM_SEED: seedRoot }),
    DSH_BOOTSTRAP_VERSION: bootstrapVersion,
  }
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
    report = async () => {},
    uid,
    gid,
    user,
    home,
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
    this.report = report
    this.uid = uid
    this.gid = gid
    this.user = user
    this.home = home
    this.child = undefined
    this.requests = new Map()
    this.fatal = new Promise(resolveFatal => { this.resolveFatal = resolveFatal })
  }

  emit(message, fields = {}) {
    void Promise.resolve().then(() => this.report(message, fields)).catch(() => {})
  }

  rejectRequests(error) {
    for (const pending of this.requests.values()) pending.reject(error)
    this.requests.clear()
  }

  async launch(recordId) {
    const startedAt = Date.now()
    const resolved = await this.slots.resolveRecord(recordId)
    this.emit('bootstrap.launch.started', {
      recordId,
      bootstrapVersion: resolved.record.version,
      targetSequence: resolved.record.targetSequence,
    })
    if (this.paths !== undefined) await replaceRuntimeView(this.paths, 'bootstrap', resolved.path)
    const command = bootstrapLaunchCommand({
      node: this.node,
      script: join(resolved.path, this.entrypoint),
      uid: this.uid,
      gid: this.gid,
    })
    const child = this.spawnImpl(command.executable, command.args, {
      env: bootstrapLaunchEnvironment({
        dataRoot: this.dataRoot,
        runRoot: this.runRoot,
        seedRoot: this.seedRoot,
        bootstrapVersion: resolved.record.version,
        user: this.user,
        home: this.home,
      }),
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    this.child = child
    const ready = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => reject(new Error(
        `Bootstrap exited before readiness (code=${String(code)}, signal=${String(signal)})`,
      )))
      child.on('message', message => {
        if (message?.type === 'ready' && message.bootstrapApi === 1) resolve()
        if (message?.type === 'recovery-result' && typeof message.requestId === 'string') {
          const pending = this.requests.get(message.requestId)
          if (pending !== undefined) {
            this.requests.delete(message.requestId)
            if (message.error === undefined) pending.resolve(message.slots)
            else pending.reject(new Error(message.error))
          }
        }
      })
    })
    try {
      await Promise.race([ready, timeout(this.readyTimeoutMs, 'Bootstrap readiness timed out')])
      this.emit('bootstrap.ready', {
        recordId,
        bootstrapVersion: resolved.record.version,
        pid: child.pid ?? null,
        elapsedMs: Date.now() - startedAt,
      })
      child.once('exit', (code, signal) => {
        if (this.child === child) {
          const error = new Error(`Bootstrap exited unexpectedly (code=${String(code)}, signal=${String(signal)})`)
          this.emit('bootstrap.exited', {
            error,
            recordId,
            pid: child.pid ?? null,
            code,
            signal,
            elapsedMs: Date.now() - startedAt,
          })
          this.rejectRequests(error)
          this.resolveFatal(error)
        }
      })
      return child
    } catch (error) {
      await terminateChild(child)
      if (this.child === child) this.child = undefined
      this.emit('bootstrap.launch.failed', {
        error,
        recordId,
        bootstrapVersion: resolved.record.version,
        pid: child.pid ?? null,
        elapsedMs: Date.now() - startedAt,
      })
      throw error
    }
  }

  async startWithRollback() {
    const state = await this.slots.state()
    if (state.current === null) throw new Error('no current Bootstrap is installed')
    try {
      return await this.launch(state.current)
    } catch (candidateError) {
      if (state.previous === null) {
        this.emit('bootstrap.start.failed', { error: candidateError, failedRecordId: state.current })
        throw candidateError
      }
      this.emit('bootstrap.rollback.started', {
        level: 'warning',
        error: candidateError,
        failedRecordId: state.current,
        targetRecordId: state.previous,
      })
      await this.slots.rollback()
      try {
        const child = await this.launch(state.previous)
        this.emit('bootstrap.rollback.completed', {
          level: 'warning',
          failedRecordId: state.current,
          recordId: state.previous,
          pid: child.pid ?? null,
        })
        return child
      } catch (rollbackError) {
        const error = new AggregateError([candidateError, rollbackError], 'Bootstrap candidate and rollback both failed')
        this.emit('bootstrap.rollback.failed', {
          error,
          failedRecordId: state.current,
          targetRecordId: state.previous,
        })
        throw error
      }
    }
  }

  async restart() {
    this.emit('bootstrap.restart.started', { pid: this.child?.pid ?? null })
    const child = this.child
    this.child = undefined
    this.rejectRequests(new Error('Bootstrap restarted during recovery'))
    if (child !== undefined) await terminateChild(child)
    try {
      const restarted = await this.startWithRollback()
      this.emit('bootstrap.restart.completed', { pid: restarted.pid ?? null })
      return restarted
    } catch (error) {
      this.emit('bootstrap.restart.failed', { error })
      throw error
    }
  }

  async stop() {
    const child = this.child
    this.emit('bootstrap.stop.started', { pid: child?.pid ?? null })
    this.child = undefined
    this.rejectRequests(new Error('Bootstrap stopped during recovery'))
    if (child !== undefined) await terminateChild(child)
    this.emit('bootstrap.stop.completed', {
      pid: child?.pid ?? null,
      code: child?.exitCode ?? null,
      signal: child?.signalCode ?? null,
    })
  }

  recoverImageBaseline(timeoutMs = 60_000) {
    if (this.child === undefined || this.child.connected !== true) throw new Error('Bootstrap is unavailable for recovery')
    const requestId = randomUUID()
    this.emit('bootstrap.recovery.started', { requestId })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(requestId)
        const error = new Error('image baseline recovery timed out')
        this.emit('bootstrap.recovery.failed', { error, requestId })
        reject(error)
      }, timeoutMs)
      this.requests.set(requestId, {
        resolve: value => {
          clearTimeout(timer)
          this.emit('bootstrap.recovery.completed', { requestId })
          resolve(value)
        },
        reject: error => {
          clearTimeout(timer)
          this.emit('bootstrap.recovery.failed', { error, requestId })
          reject(error)
        },
      })
      this.child.send({ type: 'recover-image-baseline', requestId }, error => {
        if (error !== null && error !== undefined) {
          clearTimeout(timer)
          this.requests.delete(requestId)
          this.emit('bootstrap.recovery.failed', { error, requestId })
          reject(error)
        }
      })
    })
  }
}
