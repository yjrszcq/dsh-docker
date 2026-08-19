import { createHash } from 'node:crypto'
import { canonicalJson } from '../../../../platform/lib/canonical-json.mjs'
import { TrustError } from '../../../../platform/lib/validation.mjs'

function deploymentIdentity(deployment) {
  return {
    dsh: deployment.dsh,
    environment: deployment.environment,
    runtime: deployment.runtime,
    receiptTokens: [...deployment.receiptTokens].sort(),
  }
}

function recordIdentity(record) {
  return deploymentIdentity({
    dsh: record.dshVersion,
    environment: record.environmentVersion,
    runtime: record.id,
    receiptTokens: record.receiptTokens,
  })
}

function sameRecordContent(left, right) {
  return left.authority === right.authority
    && left.targetSequence === right.targetSequence
    && left.dshVersion === right.dshVersion
    && left.environmentVersion === right.environmentVersion
    && left.environment.sha256 === right.environment.sha256
    && left.pristine.sha256 === right.pristine.sha256
    && left.runtime.sha256 === right.runtime.sha256
    && left.systemPlugins.sha256 === right.systemPlugins.sha256
}

function bindPlan(value) {
  return Object.freeze({
    ...value,
    planId: createHash('sha256').update(canonicalJson(value)).digest('hex'),
  })
}

export class CompleteStateRecovery {
  constructor({ journal, snapshots, activator }) {
    this.journal = journal
    this.snapshots = snapshots
    this.activator = activator
  }

  async plan() {
    const transaction = await this.journal.read()
    if (transaction?.phase === 'committed' && transaction.snapshotId !== null) {
      const current = await this.activator.currentDeployment()
      if (
        current.dsh === transaction.to.dsh
        && current.environment === transaction.to.environment
        && current.runtime === transaction.to.runtime
      ) {
        const snapshot = await this.snapshots.inspect(transaction.snapshotId)
        if (
          snapshot.runtimeId !== transaction.from.runtime
          || snapshot.environmentVersion !== transaction.from.environment
          || snapshot.dshVersion !== transaction.from.dsh
        ) throw new TrustError('rollback snapshot does not describe the previous deployment')
        return bindPlan({
          transactionId: transaction.transactionId,
          mode: transaction.mode,
          current: deploymentIdentity(current),
          previous: deploymentIdentity(transaction.from),
          snapshot: {
            id: snapshot.id,
            createdAt: snapshot.createdAt,
            sha256: snapshot.archiveSha256,
            size: snapshot.archiveSize,
          },
        })
      }
    }
    if (this.activator.rollbackDeployments === undefined) return null
    const { current, previous } = await this.activator.rollbackDeployments()
    if (current === null || previous === null) return null
    if (sameRecordContent(current, previous)) return null
    return bindPlan({
      transactionId: null,
      mode: 'stable',
      current: recordIdentity(current),
      previous: recordIdentity(previous),
      snapshot: null,
    })
  }

  async restore(planId, { confirmDataLoss = false, requireConfirmation = false } = {}) {
    if (requireConfirmation && confirmDataLoss !== true) {
      throw new TrustError('return to Stable requires explicit data-loss confirmation')
    }
    const plan = await this.plan()
    if (plan === null || plan.planId !== planId) throw new TrustError('rollback plan is stale or unavailable')
    if (requireConfirmation && plan.snapshot === null) {
      throw new TrustError('return to Stable requires a verified data snapshot')
    }
    if (plan.snapshot === null) {
      await this.activator.rollback(plan.previous.runtime)
      return Object.freeze({ status: 'rolled-back', transactionId: null })
    }
    let transaction = await this.journal.transition('restoring-data', { error: 'manual complete-state rollback' })
    await this.activator.suspendDsh()
    try {
      await this.activator.restoreDeployment(transaction.from, { resume: false })
      await this.snapshots.restore(transaction.snapshotId)
      await this.activator.resumeDsh()
      transaction = await this.journal.transition('rolled-back', { error: 'manual complete-state rollback completed' })
      return Object.freeze({ status: 'rolled-back', transactionId: transaction.transactionId })
    } catch (error) {
      throw error
    }
  }
}
