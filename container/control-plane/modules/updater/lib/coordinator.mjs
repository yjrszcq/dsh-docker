import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { recoverInterruptedUpdate } from './recovery.mjs'
import { planDesiredState } from './channel-state.mjs'
import { compareDshVersions } from '../../../../platform/lib/supported-target.mjs'
import { MetadataUnavailableError } from './metadata.mjs'

export class UpdateConflictError extends Error {}

export class UpdateCoordinator extends EventEmitter {
  constructor({
    metadata, preparer, activator, state, npm, journal, snapshots, channelState, completeRecovery,
    allowUnavailableMetadata = false,
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
    this.channelState = channelState
    this.completeRecovery = completeRecovery
    this.allowUnavailableMetadata = allowUnavailableMetadata
    this.probationSeconds = probationSeconds
    this.now = now
    this.sleep = sleep
    this.task = undefined
    this.checkTask = undefined
  }

  async transition(status, fields = {}) {
    const value = await this.state.write(status, fields)
    this.emit('state', value)
    return value
  }

  check() {
    if (this.task !== undefined) return Promise.reject(new UpdateConflictError('an update task is already running'))
    if (this.checkTask !== undefined) return this.checkTask
    this.checkTask = this.runCheck().finally(() => { this.checkTask = undefined })
    return this.checkTask
  }

  async runCheck() {
    await this.transition('checking', { error: null })
    try {
      if (this.channelState !== undefined) {
        const plan = await this.desiredState()
        const rollbackPlan = await this.rollbackPlan()
        await this.transition('idle', {
          available: {
            targetSequence: plan.target.targetSequence,
            bootstrap: plan.target.desired.bootstrap.version,
            environment: plan.target.desired.environment.version,
            dsh: plan.target.desired.dsh.version,
          },
          supported: plan.supported,
          ...(plan.upstream === null ? {} : { upstream: { version: plan.upstream.version } }),
          current: { dsh: plan.current.dsh, environment: plan.current.environment, runtime: plan.current.runtime },
          aheadOfStable: plan.aheadOfStable,
          experimentalBlocked: plan.experimentalBlocked,
          holds: plan.holds,
          rollbackPlan,
          checkedAt: this.now().toISOString(),
          metadataUnavailable: false,
        })
        return { value: plan.target }
      }
      const target = await this.metadata.check()
      await this.transition('idle', {
        available: {
          targetSequence: target.value.targetSequence,
          bootstrap: target.value.desired.bootstrap.version,
          environment: target.value.desired.environment.version,
          dsh: target.value.desired.dsh.version,
        },
        checkedAt: new Date().toISOString(),
        metadataUnavailable: false,
      })
      return target
    } catch (error) {
      if (error instanceof MetadataUnavailableError && this.allowUnavailableMetadata) {
        const local = await this.channelState?.read()
        const upstream = local?.updateChannel === 'experimental' && this.npm !== undefined
          ? await this.npm.discover().catch(() => null)
          : null
        await this.transition('idle', {
          metadataUnavailable: true,
          ...(upstream === null ? {} : { upstream }),
          checkedAt: this.now().toISOString(),
          error: null,
        })
        return { unavailable: true, upstream }
      }
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

  startReconcile() {
    if (this.task !== undefined) throw new UpdateConflictError('an update task is already running')
    const taskId = randomUUID()
    this.task = this.runReconcile(taskId).finally(() => { this.task = undefined })
    return { taskId, completion: this.task }
  }

  async setChannel(updateChannel) {
    if (this.task !== undefined) throw new UpdateConflictError('an update task is already running')
    if (this.channelState === undefined) throw new Error('update channels are not configured')
    return this.channelState.setChannel(updateChannel)
  }

  async retryHold(id) {
    if (this.task !== undefined) throw new UpdateConflictError('an update task is already running')
    if (this.channelState === undefined) throw new Error('update channels are not configured')
    return this.channelState.retry(id)
  }

  rollbackPlan() {
    if (this.completeRecovery === undefined) return Promise.resolve(null)
    return this.completeRecovery.plan()
  }

  startCompleteRollback(planId, options = {}) {
    if (this.task !== undefined) throw new UpdateConflictError('an update task is already running')
    if (this.completeRecovery === undefined) throw new Error('complete rollback is not configured')
    const taskId = randomUUID()
    this.task = this.runCompleteRollback(taskId, planId, options).finally(() => { this.task = undefined })
    return { taskId, completion: this.task }
  }

  async runCompleteRollback(taskId, planId, options) {
    try {
      await this.transition('restoring-data', { taskId, progress: 20, error: null })
      if (options.requireConfirmation) {
        const [plan, target] = await Promise.all([this.completeRecovery.plan(), this.metadata.check()])
        if (
          plan === null
          || plan.planId !== planId
          || compareDshVersions(plan.previous.dsh, target.value.desired.dsh.version) > 0
        ) throw new Error('no verified pre-Experimental Stable recovery point is available')
      }
      const result = await this.completeRecovery.restore(planId, options)
      await this.transition('success', { taskId, progress: 100, error: null })
      return result
    } catch (error) {
      await this.transition('failed', { taskId, error: error instanceof Error ? error.message : 'rollback failed' })
      throw error
    }
  }

  async desiredState() {
    if (this.channelState === undefined) throw new Error('update channels are not configured')
    const stable = (await this.metadata.check()).value
    const [current, local] = await Promise.all([this.activator.currentDeployment(), this.channelState.read()])
    const supported = { dsh: stable.desired.dsh.version, environment: stable.desired.environment.version }
    let upstream = null
    let upstreamCandidate = null
    if (
      local.updateChannel === 'experimental'
      && compareDshVersions(current.dsh, supported.dsh) <= 0
      && current.environment === supported.environment
    ) {
      upstream = await this.npm.discover(stable.officialDshPolicy)
      upstreamCandidate = compareDshVersions(upstream.version, supported.dsh) > 0 ? upstream : null
    }
    return Object.freeze({
      ...planDesiredState({ local, current, supported, upstream: upstreamCandidate }),
      upstream,
      target: stable,
    })
  }

  async publicStatus() {
    const [update, local, current, rollbackPlan, journal] = await Promise.all([
      this.state.read(),
      this.channelState?.read() ?? Promise.resolve({ updateChannel: 'stable', holds: [], experimentalBlocked: null }),
      this.activator.currentDeployment().catch(() => null),
      this.rollbackPlan().catch(() => null),
      this.journal?.read().catch(() => undefined),
    ])
    const returnStableAvailable = rollbackPlan !== null && rollbackPlan.snapshot !== null && update.supported?.dsh !== undefined
      && compareDshVersions(rollbackPlan.previous.dsh, update.supported.dsh) <= 0
    return Object.freeze({
      update,
      updateChannel: local.updateChannel,
      current: current === null ? null : { dsh: current.dsh, environment: current.environment, runtime: current.runtime },
      supported: update.supported ?? null,
      upstream: update.upstream ?? null,
      aheadOfStable: update.aheadOfStable ?? false,
      experimentalBlocked: local.experimentalBlocked,
      holds: local.holds,
      probation: journal?.phase === 'probation' ? { until: journal.probationUntil } : null,
      rollbackPlan: rollbackPlan === null ? null : { ...rollbackPlan, returnStableAvailable },
    })
  }

  async runReconcile(taskId) {
    try {
      const plan = await this.desiredState()
      if (plan.action === 'stable') return this.run(taskId)
      if (plan.action === 'experimental') return this.runExperimental(taskId)
      return this.transition('success', {
        taskId, progress: 100, error: null,
        outcome: plan.action,
      })
    } catch (error) {
      const current = await this.state.read()
      if (current.status !== 'failed') {
        await this.transition('failed', { taskId, error: error instanceof Error ? error.message : 'update planning failed' })
      }
      throw error
    }
  }

  async run(taskId) {
    try {
      await this.transition('planning', { taskId, progress: 0, error: null })
      const target = await this.metadata.check()
      await this.transition('downloading', { taskId, progress: 10, targetSequence: target.value.targetSequence })
      const prepared = await this.preparer.prepare(target.value)
      await this.transition('validating', { taskId, progress: 70 })
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

  async runExperimental(taskId) {
    let transaction
    let candidate
    let failureClass = 'check'
    let obsoleteSnapshotId = null
    try {
      await this.transition('checking-upstream', { taskId, progress: 0, error: null })
      const stable = (await this.metadata.check()).value
      candidate = await this.npm.latest(stable)
      if (candidate === null) return this.transition('success', { taskId, progress: 100, error: null })
      const from = await this.activator.currentDeployment()
      const bootstrap = await this.activator.bootstrap.status()
      if (
        from.environment !== stable.desired.environment.version
        || bootstrap.bootstrapVersion !== stable.desired.bootstrap.version
      ) throw new Error('Stable Environment and Bootstrap must converge before Experimental DSH')

      await this.transition('downloading', { taskId, progress: 10 })
      failureClass = 'candidate'
      const prepared = await this.preparer.prepareExperimental(candidate)
      await this.transition('building-candidate', { taskId, progress: 35 })
      const built = await this.activator.prepareExperimental(prepared)
      const previousJournal = await this.journal.read()
      if (previousJournal !== undefined && ['committed', 'rolled-back', 'failed'].includes(previousJournal.phase)) {
        obsoleteSnapshotId = previousJournal.snapshotId
      }
      transaction = await this.journal.begin({
        transactionId: taskId,
        mode: 'experimental',
        from,
        to: { dsh: built.dshVersion, environment: built.environmentVersion, runtime: built.runtimeId },
      })
      transaction = await this.journal.transition('candidate-ready', { receiptTokens: prepared.receiptTokens })

      await this.transition('snapshotting-data', { taskId, progress: 55 })
      failureClass = 'snapshot'
      await this.activator.suspendDsh()
      transaction = await this.journal.transition('suspended')
      const snapshot = await this.snapshots.create({
        id: taskId,
        runtimeId: from.runtime,
        environmentVersion: from.environment,
        dshVersion: from.dsh,
      })
      const candidateRuntimeId = this.activator.bindExperimentalSnapshot === undefined
        ? built.runtimeId
        : await this.activator.bindExperimentalSnapshot(built.runtimeId, snapshot.id)
      transaction = await this.journal.transition('snapshot-created', {
        snapshotId: snapshot.id,
        to: { ...transaction.to, runtime: candidateRuntimeId },
      })

      await this.transition('switching', { taskId, progress: 70 })
      await this.activator.switchExperimental(candidateRuntimeId)
      failureClass = 'combination'
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
      await this.activator.commitExperimental(candidateRuntimeId)
      transaction = await this.journal.transition('committed')
      await this.activator.cleanup?.().catch(() => {})
      if (obsoleteSnapshotId !== null && obsoleteSnapshotId !== transaction.snapshotId) {
        await this.snapshots.remove?.(obsoleteSnapshotId).catch(() => {})
      }
      return this.transition('success', { taskId, progress: 100, error: null })
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Experimental update failed'
      if (candidate !== undefined && this.channelState !== undefined) {
        if (failureClass === 'candidate') {
          await this.channelState.addHold({ type: 'version', dshVersion: candidate.version, reason: message }).catch(() => {})
        } else if (failureClass === 'combination') {
          const environmentVersion = transaction?.to.environment
          if (environmentVersion !== undefined) await this.channelState.addHold({
            type: 'combination', dshVersion: candidate.version, environmentVersion, reason: message,
          }).catch(() => {})
        }
      }
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
