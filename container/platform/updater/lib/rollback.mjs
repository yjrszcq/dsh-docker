import { createHash } from 'node:crypto'
import { canonicalJson } from '../../lib/canonical-json.mjs'
import { TrustError } from '../../lib/validation.mjs'

function deploymentIdentity(deployment) {
  return {
    dsh: deployment.dsh,
    environment: deployment.environment,
    runtime: deployment.runtime,
    receiptTokens: [...deployment.receiptTokens].sort(),
  }
}

export class CompleteStateRecovery {
  constructor({ journal, snapshots, activator }) {
    this.journal = journal
    this.snapshots = snapshots
    this.activator = activator
  }

  async plan() {
    const transaction = await this.journal.read()
    if (transaction?.phase !== 'committed' || transaction.snapshotId === null) return null
    const current = await this.activator.currentDeployment()
    if (
      current.dsh !== transaction.to.dsh
      || current.environment !== transaction.to.environment
      || current.runtime !== transaction.to.runtime
    ) return null
    const snapshot = await this.snapshots.inspect(transaction.snapshotId)
    if (
      snapshot.runtimeId !== transaction.from.runtime
      || snapshot.environmentVersion !== transaction.from.environment
      || snapshot.dshVersion !== transaction.from.dsh
    ) throw new TrustError('rollback snapshot does not describe the previous deployment')
    const value = {
      transactionId: transaction.transactionId,
      current: deploymentIdentity(current),
      previous: deploymentIdentity(transaction.from),
      snapshot: {
        id: snapshot.id,
        createdAt: snapshot.createdAt,
        sha256: snapshot.archiveSha256,
        size: snapshot.archiveSize,
      },
    }
    return Object.freeze({
      ...value,
      planId: createHash('sha256').update(canonicalJson(value)).digest('hex'),
    })
  }

  async restore(planId, { confirmDataLoss = false, requireConfirmation = false } = {}) {
    if (requireConfirmation && confirmDataLoss !== true) {
      throw new TrustError('return to Stable requires explicit data-loss confirmation')
    }
    const plan = await this.plan()
    if (plan === null || plan.planId !== planId) throw new TrustError('rollback plan is stale or unavailable')
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
