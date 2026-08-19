import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { recoverInterruptedUpdate } from './recovery.mjs'

export class UpdateConflictError extends Error {}

export class UpdateCoordinator extends EventEmitter {
  constructor({
    metadata, preparer, activator, state, npm, journal, snapshots,
    probationSeconds = 120,
    now = () => new Date(),
    sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  }) {
    super()
    this.metadata = metadata
    this.preparer = preparer
    this.activator = activator
    this.state = state
    this.npm = npm
    this.journal = journal
    this.snapshots = snapshots
    this.probationSeconds = probationSeconds
    this.now = now
    this.sleep = sleep
    this.task = undefined
  }

  async transition(status, fields = {}) {
    const value = await this.state.write(status, fields)
    this.emit('state', value)
    return value
  }

  async check() {
    if (this.task !== undefined) throw new UpdateConflictError('an update task is already running')
    await this.transition('checking', { error: null })
    try {
      const target = await this.metadata.check()
      await this.transition('idle', {
        available: {
          targetSequence: target.value.targetSequence,
          bootstrap: target.value.desired.bootstrap.version,
          environment: target.value.desired.environment.version,
          dsh: target.value.desired.dsh.version,
        },
        checkedAt: new Date().toISOString(),
      })
      return target
    } catch (error) {
      await this.transition('failed', { error: error instanceof Error ? error.message : 'update check failed' })
      throw error
    }
  }

  start() {
    if (this.task !== undefined) throw new UpdateConflictError('an update task is already running')
    const taskId = randomUUID()
    this.task = this.run(taskId).finally(() => { this.task = undefined })
    return { taskId, completion: this.task }
  }

  startExperimental() {
    if (this.task !== undefined) throw new UpdateConflictError('an update task is already running')
    if (this.npm === undefined || this.journal === undefined || this.snapshots === undefined) {
      throw new Error('Experimental updates are not configured')
    }
    const taskId = randomUUID()
    this.task = this.runExperimental(taskId).finally(() => { this.task = undefined })
    return { taskId, completion: this.task }
  }

  async run(taskId) {
    try {
      await this.transition('planning', { taskId, progress: 0, error: null })
      const target = await this.metadata.check()
      await this.transition('downloading', { taskId, progress: 10, targetSequence: target.value.targetSequence })
      const prepared = await this.preparer.prepare(target.value)
      await this.transition('validating', { taskId, progress: 70 })
      await this.transition('switching', { taskId, progress: 85 })
      try {
        await this.activator.activate(prepared)
        await this.trustActivate(prepared)
      } catch (error) {
        await this.activator.rollback?.(prepared)
        throw error
      }
      return this.transition('success', { taskId, progress: 100, error: null })
    } catch (error) {
      await this.transition('failed', { taskId, error: error instanceof Error ? error.message : 'update failed' })
      throw error
    }
  }

  trustActivate(prepared) {
    return this.preparer.trust.activate(prepared.receiptTokens)
  }

  async runExperimental(taskId) {
    let transaction
    try {
      await this.transition('checking-upstream', { taskId, progress: 0, error: null })
      const stable = (await this.metadata.check()).value
      const candidate = await this.npm.latest(stable)
      if (candidate === null) return this.transition('success', { taskId, progress: 100, error: null })
      const from = await this.activator.currentDeployment()
      const bootstrap = await this.activator.bootstrap.status()
      if (
        from.environment !== stable.desired.environment.version
        || bootstrap.bootstrapVersion !== stable.desired.bootstrap.version
      ) throw new Error('Stable Environment and Bootstrap must converge before Experimental DSH')

      await this.transition('downloading', { taskId, progress: 10 })
      const prepared = await this.preparer.prepareExperimental(candidate)
      await this.transition('building-candidate', { taskId, progress: 35 })
      const built = await this.activator.prepareExperimental(prepared)
      transaction = await this.journal.begin({
        transactionId: taskId,
        mode: 'experimental',
        from,
        to: { dsh: built.dshVersion, environment: built.environmentVersion, runtime: built.runtimeId },
      })
      transaction = await this.journal.transition('candidate-ready', { receiptTokens: prepared.receiptTokens })

      await this.transition('snapshotting-data', { taskId, progress: 55 })
      await this.activator.suspendDsh()
      transaction = await this.journal.transition('suspended')
      const snapshot = await this.snapshots.create({
        id: taskId,
        runtimeId: from.runtime,
        environmentVersion: from.environment,
        dshVersion: from.dsh,
      })
      transaction = await this.journal.transition('snapshot-created', { snapshotId: snapshot.id })

      await this.transition('switching', { taskId, progress: 70 })
      await this.activator.switchExperimental(built.runtimeId)
      transaction = await this.journal.transition('switched')
      const probationUntil = new Date(this.now().valueOf() + this.probationSeconds * 1000).toISOString()
      transaction = await this.journal.transition('probation', { probationUntil })
      await this.transition('probation', { taskId, progress: 85, probationUntil })
      do {
        const health = await this.activator.health()
        if (!health.healthy) throw new Error('Experimental Runtime failed probation health checks')
        if (this.now().valueOf() >= new Date(probationUntil).valueOf()) break
        await this.sleep(Math.min(1_000, Math.max(0, new Date(probationUntil).valueOf() - this.now().valueOf())))
      } while (true)
      const activationTokens = await this.activator.experimentalActivationTokens(prepared.receiptTokens)
      await this.preparer.trust.activate(activationTokens)
      transaction = await this.journal.transition('committed')
      return this.transition('success', { taskId, progress: 100, error: null })
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Experimental update failed'
      transaction = await this.journal?.read().catch(() => transaction)
      if (transaction !== undefined && !['committed', 'rolled-back', 'failed'].includes(transaction.phase)) {
        try {
          if (['snapshot-created', 'switched', 'probation', 'restoring-data'].includes(transaction.phase)) {
            if (transaction.phase !== 'restoring-data') transaction = await this.journal.transition('restoring-data', { error: message })
            await this.activator.suspendDsh().catch(() => {})
            await this.activator.restoreDeployment(transaction.from, { resume: false })
            if (transaction.snapshotId !== null) await this.snapshots.restore(transaction.snapshotId)
            await this.activator.resumeDsh()
            await this.journal.transition('rolled-back', { error: message })
          } else {
            await this.activator.resumeDsh().catch(() => {})
            await this.journal.transition('failed', { error: message })
          }
        } catch (rollbackError) {
          const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : 'unknown error'
          message = `${message}; rollback failed: ${rollbackMessage}`
        }
      }
      await this.transition('failed', { taskId, error: message })
      throw error
    }
  }

  async recover() {
    if (this.journal === undefined || this.snapshots === undefined) return undefined
    return recoverInterruptedUpdate({ journal: this.journal, snapshots: this.snapshots, activator: this.activator })
  }
}
