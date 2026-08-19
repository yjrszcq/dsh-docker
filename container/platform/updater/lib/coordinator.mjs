import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'

export class UpdateConflictError extends Error {}

export class UpdateCoordinator extends EventEmitter {
  constructor({ metadata, preparer, activator, state }) {
    super()
    this.metadata = metadata
    this.preparer = preparer
    this.activator = activator
    this.state = state
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

  async run(taskId) {
    try {
      await this.transition('planning', { taskId, progress: 0, error: null })
      const target = await this.metadata.check()
      await this.transition('downloading', { taskId, progress: 10, targetSequence: target.value.targetSequence })
      const prepared = await this.preparer.prepare(target.value)
      await this.transition('validating', { taskId, progress: 70 })
      await this.trustActivate(prepared)
      await this.transition('switching', { taskId, progress: 85 })
      await this.activator.activate(prepared)
      return this.transition('success', { taskId, progress: 100, error: null })
    } catch (error) {
      await this.transition('failed', { taskId, error: error instanceof Error ? error.message : 'update failed' })
      throw error
    }
  }

  trustActivate(prepared) {
    return this.preparer.trust.activate(prepared.receiptTokens)
  }
}
