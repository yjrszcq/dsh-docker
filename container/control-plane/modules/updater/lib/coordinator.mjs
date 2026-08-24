import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { recoverInterruptedUpdate } from './recovery.mjs'
import { planDesiredState } from './channel-state.mjs'
import { compareDshVersions } from '../../../../platform/lib/supported-target.mjs'

export class UpdateConflictError extends Error {}

function healthMetrics(health) {
  const components = Array.isArray(health?.components) ? health.components : []
  return {
    readyServices: components.filter(component => component?.healthy === true).length,
    totalServices: components.length,
  }
}

function journalDeployment(deployment) {
  return Object.freeze({
    dsh: deployment.dsh,
    environment: deployment.environment,
    runtime: deployment.runtime,
    dataSnapshot: deployment.dataSnapshot,
    receiptTokens: deployment.receiptTokens,
  })
}

function metricPercentage(processed, total) {
  return typeof processed === 'number' && typeof total === 'number' && total > 0
    ? Math.floor(Math.max(0, Math.min(1, processed / total)) * 100)
    : null
}

export class UpdateCoordinator extends EventEmitter {
  constructor({
    metadata, preparer, activator, state, npm, journal, snapshots, channelState, completeRecovery, automaticChecks,
    allowUnavailableMetadata = false,
    probationSeconds = 120,
    report = async () => {},
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
    this.automaticChecks = automaticChecks
    this.allowUnavailableMetadata = allowUnavailableMetadata
    this.probationSeconds = probationSeconds
    this.report = report
    this.now = now
    this.sleep = sleep
    this.task = undefined
    this.checkTask = undefined
    this.reportTimes = new Map()
  }

  async transition(status, fields = {}) {
    const previous = await this.state.read()
    const phase = fields.phase ?? (
      status === 'idle'
        ? null
        : fields.rollbackPhase ?? (
            ['success', 'failed'].includes(status)
              ? previous.phase ?? previous.rollbackPhase ?? (['idle', 'success', 'failed'].includes(previous.status) ? null : previous.status)
              : status
          )
    )
    const contextChanged = phase !== (previous.phase ?? null)
      || (fields.operation !== undefined && fields.operation !== previous.operation)
    const phaseMetrics = contextChanged ? {
      processedBytes: null,
      totalBytes: null,
      processedItems: null,
      totalItems: null,
      readyServices: null,
      totalServices: null,
      detail: null,
    } : {}
    const value = await this.state.write(status, { ...phaseMetrics, ...fields, phase })
    this.emit('state', value)
    await this.record('update.phase.changed', {
      status,
      phase,
      operation: value.operation ?? null,
      rollbackPhase: value.rollbackPhase ?? null,
      taskId: value.taskId ?? null,
      progress: value.progress ?? null,
      processedBytes: value.processedBytes ?? null,
      totalBytes: value.totalBytes ?? null,
      processedItems: value.processedItems ?? null,
      totalItems: value.totalItems ?? null,
      readyServices: value.readyServices ?? null,
      totalServices: value.totalServices ?? null,
      detail: value.detail ?? null,
      targetSequence: value.targetSequence ?? value.available?.targetSequence ?? null,
      outcome: value.outcome ?? null,
      ...(value.error === null || value.error === undefined ? {} : { error: value.error, level: 'error' }),
    })
    return value
  }

  async record(message, fields = {}) {
    try {
      const current = await this.state.read()
      const context = {
        ...(current.taskId === null || current.taskId === undefined ? {} : { taskId: current.taskId }),
        ...(current.operation === null || current.operation === undefined ? {} : { operation: current.operation }),
        ...(current.phase === null || current.phase === undefined
          ? (current.status === null || current.status === undefined ? {} : { phase: current.status })
          : { phase: current.phase }),
      }
      return await this.report(message, { ...context, ...fields })
    } catch {}
  }

  async bestEffort(message, operation, fallback, fields = {}, cooldownMs = 0) {
    try {
      return await operation()
    } catch (error) {
      const timestamp = this.now().valueOf()
      const previous = this.reportTimes.get(message)
      if (cooldownMs === 0 || previous === undefined || timestamp - previous >= cooldownMs) {
        this.reportTimes.set(message, timestamp)
        await this.record(message, { ...fields, error, level: 'warning' })
      }
      return fallback
    }
  }

  async reportHealth(status, fields) {
    if (this.activator.health === undefined) return undefined
    const health = await this.activator.health()
    await this.transition(status, { ...fields, ...healthMetrics(health) })
    return health
  }

  hasActiveTask() {
    return this.task !== undefined
  }

  check(source = 'manual') {
    if (this.task !== undefined && source === 'page-open') return Promise.resolve({ busy: true })
    if (this.task !== undefined) return Promise.reject(new UpdateConflictError('an update task is already running'))
    if (this.checkTask !== undefined) return this.checkTask
    this.checkTask = this.runCheck(source).finally(() => { this.checkTask = undefined })
    return this.checkTask
  }

  startTask(operation) {
    if (this.task !== undefined) throw new UpdateConflictError('an update task is already running')
    const taskId = randomUUID()
    const precedingCheck = this.checkTask
    this.task = (async () => {
      if (precedingCheck !== undefined) {
        try { await precedingCheck } catch {}
      }
      return operation(taskId)
    })().finally(() => { this.task = undefined })
    return { taskId, completion: this.task }
  }

  async runCheck(source) {
    await this.transition('checking', {
      checkSource: source, taskId: null, progress: 0, operation: 'check', rollbackPhase: null, error: null,
    })
    try {
      if (this.allowUnavailableMetadata) return await this.recordUnavailableMetadata(source)
      if (this.channelState !== undefined) {
        const plan = await this.desiredState()
        const rollbackPlan = await this.rollbackPlan()
        const updateAvailable = ['stable', 'experimental'].includes(plan.action)
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
          updateAvailable,
          checkedAt: this.now().toISOString(),
          metadataUnavailable: false,
        })
        if (source === 'automatic' && this.automaticChecks !== undefined) {
          await this.automaticChecks.record({
            channel: plan.updateChannel,
            current: plan.current,
            target: plan.target,
            upstream: plan.upstream,
            stableAvailable: plan.action === 'stable',
            holds: plan.holds,
          })
          this.emit('state', await this.state.read())
        }
        return { value: plan.target, updateAvailable }
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
      await this.record('update.check.failed', { error, checkSource: source })
      await this.transition('failed', { error: error instanceof Error ? error.message : 'update check failed' })
      throw error
    }
  }

  async recordUnavailableMetadata(source) {
    const local = await this.channelState?.read()
    const upstream = local?.updateChannel === 'experimental' && this.npm !== undefined
      ? await this.bestEffort('update.upstream-discovery.failed', () => this.npm.discover(), null, { checkSource: source })
      : null
    await this.transition('idle', {
      metadataUnavailable: true,
      ...(upstream === null ? {} : { upstream }),
      updateAvailable: false,
      checkedAt: this.now().toISOString(),
      error: null,
    })
    return { unavailable: true, upstream }
  }

  start() {
    return this.startTask(taskId => this.run(taskId))
  }

  startExperimental() {
    if (this.npm === undefined || this.journal === undefined || this.snapshots === undefined) {
      throw new Error('Experimental updates are not configured')
    }
    return this.startTask(taskId => this.runExperimental(taskId))
  }

  startReconcile() {
    return this.startTask(taskId => this.runReconcile(taskId))
  }

  async setChannel(updateChannel) {
    if (this.task !== undefined) throw new UpdateConflictError('an update task is already running')
    if (this.channelState === undefined) throw new Error('update channels are not configured')
    const result = await this.channelState.setChannel(updateChannel)
    if (updateChannel === 'stable') await this.automaticChecks?.clearUpstream()
    await this.record('update.channel.changed', { updateChannel })
    return result
  }

  async retryHold(id) {
    if (this.task !== undefined) throw new UpdateConflictError('an update task is already running')
    if (this.channelState === undefined) throw new Error('update channels are not configured')
    const result = await this.channelState.retry(id)
    await this.record('update.hold.retried', { holdId: id })
    return result
  }

  rollbackPlan() {
    if (this.completeRecovery === undefined) return Promise.resolve(null)
    return this.completeRecovery.plan()
  }

  startCompleteRollback(planId, options = {}) {
    if (this.completeRecovery === undefined) throw new Error('complete rollback is not configured')
    return this.startTask(taskId => this.runCompleteRollback(taskId, planId, options))
  }

  async runCompleteRollback(taskId, planId, options) {
    const operation = options.requireConfirmation ? 'return-stable' : 'rollback'
    try {
      const rollbackPlan = await this.completeRecovery.plan()
      let verifiedStable = null
      await this.transition('restoring-data', {
        taskId,
        progress: 5,
        operation,
        rollbackPhase: 'preparing',
        rollbackIncludesSnapshot: rollbackPlan?.snapshot !== null && rollbackPlan?.snapshot !== undefined,
        error: null,
      })
      if (options.requireConfirmation) {
        const [plan, target] = await Promise.all([this.completeRecovery.plan(), this.metadata.check()])
        if (
          plan === null
          || plan.planId !== planId
          || compareDshVersions(plan.previous.dsh, target.value.desired.dsh.version) > 0
        ) throw new Error('no verified pre-Experimental Stable recovery point is available')
        verifiedStable = target.value
      }
      const result = await this.completeRecovery.restore(planId, {
        ...options,
        onProgress: (() => {
          let previousKey
          return (rollbackPhase, progress, metrics = {}) => {
            const key = [
              rollbackPhase,
              progress,
              metricPercentage(metrics.processedBytes, metrics.totalBytes),
              metricPercentage(metrics.processedItems, metrics.totalItems),
            ].join(':')
            if (key === previousKey) return undefined
            previousKey = key
            return this.transition('restoring-data', {
              taskId,
              progress,
              operation,
              rollbackPhase,
              processedBytes: metrics.processedBytes ?? null,
              totalBytes: metrics.totalBytes ?? null,
              processedItems: metrics.processedItems ?? null,
              totalItems: metrics.totalItems ?? null,
            })
          }
        })(),
      })
      await this.reportHealth('restoring-data', {
        taskId,
        progress: 95,
        operation,
        rollbackPhase: 'verifying',
      })
      const current = await this.activator.currentDeployment()
      if (
        rollbackPlan === null
        || current.dsh !== rollbackPlan.previous.dsh
        || current.environment !== rollbackPlan.previous.environment
        || current.runtime !== rollbackPlan.previous.runtime
      ) throw new Error('restored Deployment differs from the rollback plan')
      const [stored, local] = await Promise.all([
        this.state.read(),
        this.channelState?.read() ?? Promise.resolve({ updateChannel: 'stable', holds: [], experimentalBlocked: null }),
      ])
      const supported = verifiedStable === null
        ? stored.supported ?? null
        : {
            dsh: verifiedStable.desired.dsh.version,
            environment: verifiedStable.desired.environment.version,
          }
      let aheadOfStable = false
      let updateAvailable = false
      if (supported !== null) {
        const upstream = local.updateChannel === 'experimental'
          && typeof stored.upstream?.version === 'string'
          && compareDshVersions(stored.upstream.version, supported.dsh) > 0
          ? stored.upstream
          : null
        const plan = planDesiredState({
          local,
          current,
          supported,
          stableTargetSequence: verifiedStable?.targetSequence ?? stored.available?.targetSequence,
          upstream,
        })
        aheadOfStable = plan.aheadOfStable
        updateAvailable = ['stable', 'experimental'].includes(plan.action)
      }
      await this.bestEffort('update.notifications.cleanup.failed', () => this.clearSatisfiedNotifications(), undefined, { taskId })
      await this.transition('success', {
        taskId,
        progress: 100,
        current: { dsh: current.dsh, environment: current.environment, runtime: current.runtime },
        aheadOfStable,
        updateAvailable,
        experimentalBlocked: local.experimentalBlocked,
        holds: local.holds,
        outcome: null,
        probationUntil: null,
        error: null,
      })
      return result
    } catch (error) {
      await this.record('update.rollback.failed', { error, taskId, operation })
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
      ...planDesiredState({ local, current, supported, stableTargetSequence: stable.targetSequence, upstream: upstreamCandidate }),
      upstream,
      target: stable,
    })
  }

  async publicStatus() {
    const [update, local, current, rollbackPlan, journal, automatic] = await Promise.all([
      this.state.read(),
      this.channelState?.read() ?? Promise.resolve({ updateChannel: 'stable', holds: [], experimentalBlocked: null }),
      this.bestEffort(
        'update.status.current.failed',
        () => this.activator.currentDeployment({ required: false }),
        null,
        {},
        60_000,
      ),
      this.bestEffort('update.status.rollback-plan.failed', () => this.rollbackPlan(), null, {}, 60_000),
      this.journal === undefined
        ? Promise.resolve(undefined)
        : this.bestEffort('update.status.journal.failed', () => this.journal.read(), undefined, {}, 60_000),
      this.automaticChecks?.read() ?? Promise.resolve(null),
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
      ...(automatic === null ? {} : {
        automaticCheck: automatic.automaticCheck,
        latestAutomatic: automatic.latestAutomatic,
      }),
    })
  }

  async runReconcile(taskId) {
    try {
      const plan = await this.desiredState()
      if (plan.action === 'stable') {
        await this.run(taskId, { complete: false })
        const next = await this.desiredState()
        if (next.action === 'experimental') return this.runExperimental(taskId)
        return this.transition('success', { taskId, progress: 100, error: null, outcome: next.action })
      }
      if (plan.action === 'experimental') return this.runExperimental(taskId)
      return this.transition('success', {
        taskId, progress: 100, error: null,
        outcome: plan.action,
      })
    } catch (error) {
      await this.record('update.reconcile.failed', { error, taskId })
      const current = await this.state.read()
      if (current.status !== 'failed') {
        await this.transition('failed', { taskId, error: error instanceof Error ? error.message : 'update planning failed' })
      }
      throw error
    }
  }

  async run(taskId, { complete = true } = {}) {
    try {
      await this.transition('planning', {
        taskId, progress: 0, operation: 'update', rollbackPhase: null, rollbackIncludesSnapshot: null,
        processedBytes: null, totalBytes: null, processedItems: null, totalItems: null,
        readyServices: null, totalServices: null, detail: null, error: null,
      })
      const target = await this.metadata.check()
      const artifacts = Array.isArray(target.value.artifacts) ? target.value.artifacts : []
      await this.transition('downloading', {
        taskId,
        progress: 10,
        targetSequence: target.value.targetSequence,
        processedBytes: 0,
        totalBytes: artifacts.reduce((total, artifact) => total + artifact.size, 0),
        processedItems: 0,
        totalItems: artifacts.length,
        detail: 'downloading',
      })
      let previousDownloadKey
      const prepared = await this.preparer.prepare(target.value, {
        onProgress: metrics => {
          const progress = artifacts.length === 0 || metrics.totalBytes === 0
            ? 10
            : 10 + Math.round((metrics.processedBytes / metrics.totalBytes) * 55)
          const key = `${progress}:${metrics.processedItems}:${metrics.totalItems}`
          if (key === previousDownloadKey) return undefined
          previousDownloadKey = key
          return this.transition('downloading', {
            taskId,
            progress,
            processedBytes: metrics.processedBytes,
            totalBytes: metrics.totalBytes,
            processedItems: metrics.processedItems,
            totalItems: metrics.totalItems,
          })
        },
      })
      await this.transition('validating', { taskId, progress: 70 })
      await this.transition('building-candidate', { taskId, progress: 75 })
      let previousBuildProgress = 75
      let buildComplete = false
      await this.activator.activate(prepared, {
        onProgress: progress => {
          if (typeof progress === 'number') {
            const stageProgress = Math.max(previousBuildProgress, progress)
            if (stageProgress === previousBuildProgress) return undefined
            previousBuildProgress = stageProgress
            return this.transition('building-candidate', { taskId, progress: stageProgress })
          }
          const ratio = progress.totalBytes > 0 ? progress.processedBytes / progress.totalBytes : 0
          const stageProgress = Math.max(
            previousBuildProgress,
            75 + Math.round(Math.max(0, Math.min(1, ratio)) * 14),
          )
          const complete = progress.processedBytes === progress.totalBytes
            && progress.processedItems === progress.totalItems
          if (stageProgress === previousBuildProgress && (!complete || buildComplete)) return undefined
          previousBuildProgress = stageProgress
          buildComplete = complete
          return this.transition('building-candidate', {
            taskId,
            progress: stageProgress,
            processedBytes: progress.processedBytes,
            totalBytes: progress.totalBytes,
            processedItems: progress.processedItems,
            totalItems: progress.totalItems,
          })
        },
        onSwitching: () => this.transition('switching', { taskId, progress: 90 }),
      })
      const health = await this.reportHealth('switching', { taskId, progress: 95 })
      await this.bestEffort('update.notifications.cleanup.failed', () => this.clearSatisfiedNotifications(), undefined, { taskId })
      return complete ? this.transition('success', { taskId, progress: 100, error: null }) : health
    } catch (error) {
      await this.record('update.stable.failed', { error, taskId })
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
      await this.transition('checking-upstream', {
        taskId, progress: 0, operation: 'update', rollbackPhase: null, rollbackIncludesSnapshot: null, error: null,
      })
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
      const built = await this.activator.prepareExperimental(prepared, { targetSequence: stable.targetSequence })
      const previousJournal = await this.journal.read()
      if (previousJournal !== undefined && ['committed', 'rolled-back', 'failed'].includes(previousJournal.phase)) {
        obsoleteSnapshotId = previousJournal.snapshotId
      }
      transaction = await this.journal.begin({
        transactionId: taskId,
        mode: 'experimental',
        from: journalDeployment(from),
        to: { dsh: built.dshVersion, environment: built.environmentVersion, runtime: built.runtimeId },
      })
      transaction = await this.journal.transition('candidate-ready', { receiptTokens: prepared.receiptTokens })

      await this.transition('snapshotting-data', { taskId, progress: 55 })
      failureClass = 'snapshot'
      await this.activator.suspendDsh()
      transaction = await this.journal.transition('suspended')
      let previousSnapshotProgress
      const snapshot = await this.snapshots.create({
        id: taskId,
        runtimeId: from.runtime,
        environmentVersion: from.environment,
        dshVersion: from.dsh,
        onProgress: metrics => {
          const metricProgress = metricPercentage(metrics.processedItems, metrics.totalItems)
            ?? metricPercentage(metrics.processedBytes, metrics.totalBytes)
          if (metricProgress === previousSnapshotProgress) return undefined
          previousSnapshotProgress = metricProgress
          return this.transition('snapshotting-data', {
            taskId,
            progress: 55,
            processedBytes: metrics.processedBytes ?? null,
            totalBytes: metrics.totalBytes ?? null,
            processedItems: metrics.processedItems ?? null,
            totalItems: metrics.totalItems ?? null,
          })
        },
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
        const remainingMs = Math.max(0, new Date(probationUntil).valueOf() - this.now().valueOf())
        const elapsedRatio = this.probationSeconds <= 0
          ? 1
          : Math.max(0, Math.min(1, 1 - remainingMs / (this.probationSeconds * 1000)))
        await this.transition('probation', {
          taskId,
          progress: 85 + Math.round(elapsedRatio * 14),
          probationUntil,
          detail: `probation:${String(Math.ceil(remainingMs / 1000))}`,
          ...healthMetrics(health),
        })
        if (!health.healthy) throw new Error('Experimental Runtime failed probation health checks')
        if (this.now().valueOf() >= new Date(probationUntil).valueOf()) break
        await this.sleep(Math.min(1_000, Math.max(0, new Date(probationUntil).valueOf() - this.now().valueOf())))
      } while (true)
      await this.activator.commitExperimental(candidateRuntimeId)
      transaction = await this.journal.transition('committed')
      await this.bestEffort('update.notifications.cleanup.failed', () => this.clearSatisfiedNotifications(), undefined, { taskId })
      if (this.activator.cleanup !== undefined) {
        await this.bestEffort('update.assets.cleanup.failed', () => this.activator.cleanup(), undefined, { taskId })
      }
      if (obsoleteSnapshotId !== null && obsoleteSnapshotId !== transaction.snapshotId) {
        if (this.snapshots.remove !== undefined) {
          await this.bestEffort('update.snapshot.cleanup.failed', () => this.snapshots.remove(obsoleteSnapshotId), undefined, {
            snapshotId: obsoleteSnapshotId,
            taskId,
          })
        }
      }
      return this.transition('success', { taskId, progress: 100, error: null })
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Experimental update failed'
      await this.record('update.experimental.failed', { error, failureClass, taskId })
      if (candidate !== undefined && this.channelState !== undefined) {
        if (failureClass === 'candidate') {
          await this.bestEffort('update.hold.persist.failed', () => this.channelState.addHold({
            type: 'version', dshVersion: candidate.version, reason: message,
          }), undefined, { dshVersion: candidate.version, holdType: 'version', taskId })
        } else if (failureClass === 'combination') {
          const environmentVersion = transaction?.to.environment
          if (environmentVersion !== undefined) await this.bestEffort('update.hold.persist.failed', () => this.channelState.addHold({
            type: 'combination', dshVersion: candidate.version, environmentVersion, reason: message,
          }), undefined, { dshVersion: candidate.version, environmentVersion, holdType: 'combination', taskId })
        }
      }
      if (this.journal !== undefined) {
        transaction = await this.bestEffort('update.journal.read.failed', () => this.journal.read(), transaction, { taskId })
      }
      if (transaction !== undefined && !['committed', 'rolled-back', 'failed'].includes(transaction.phase)) {
        try {
          if (['snapshot-created', 'switched', 'probation', 'restoring-data'].includes(transaction.phase)) {
            if (transaction.phase !== 'restoring-data') transaction = await this.journal.transition('restoring-data', { error: message })
            await this.bestEffort('update.rollback.suspend.failed', () => this.activator.suspendDsh(), undefined, { taskId })
            await this.activator.restoreDeployment(transaction.from, { resume: false })
            if (transaction.snapshotId !== null) await this.snapshots.restore(transaction.snapshotId)
            await this.activator.resumeDsh()
            await this.journal.transition('rolled-back', { error: message })
          } else {
            await this.bestEffort('update.rollback.resume.failed', () => this.activator.resumeDsh(), undefined, { taskId })
            await this.journal.transition('failed', { error: message })
          }
        } catch (rollbackError) {
          await this.record('update.experimental.rollback.failed', { error: rollbackError, taskId })
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

  async clearSatisfiedNotifications() {
    if (this.automaticChecks === undefined) return
    await this.automaticChecks.clearSatisfied(await this.activator.currentDeployment())
  }
}
