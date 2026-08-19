const TERMINAL_PHASES = new Set(['committed', 'rolled-back', 'failed'])
const PRE_SWITCH_PHASES = new Set(['planning', 'candidate-ready', 'suspended'])

export async function recoverInterruptedUpdate({ journal, snapshots, activator, resume = true }) {
  const transaction = await journal.read()
  if (transaction === undefined || TERMINAL_PHASES.has(transaction.phase)) return transaction

  if (PRE_SWITCH_PHASES.has(transaction.phase)) {
    if (resume) await activator.resumeDsh().catch(() => {})
    return journal.transition('failed', { error: 'interrupted before Runtime switch' })
  }

  const restoring = transaction.phase === 'restoring-data'
    ? transaction
    : await journal.transition('restoring-data', { error: 'recovering interrupted update' })
  if (resume) await activator.suspendDsh().catch(() => {})
  await activator.restoreDeployment(restoring.from, { resume: false })
  if (restoring.snapshotId !== null) await snapshots.restore(restoring.snapshotId)
  if (resume) await activator.resumeDsh()
  return journal.transition('rolled-back', { error: 'recovered interrupted update' })
}

export async function reconcileRecoveredState({ journal, state }) {
  const [transaction, persisted] = await Promise.all([journal.read(), state.read()])
  const sameTask = transaction !== undefined && persisted.taskId === transaction.transactionId
  if (sameTask && !['idle', 'success', 'failed'].includes(persisted.status)) {
    if (transaction.phase === 'committed') {
      return { transaction, persisted: await state.write('success', { progress: 100, error: null }) }
    }
    if (['rolled-back', 'failed'].includes(transaction.phase)) {
      return {
        transaction,
        persisted: await state.write('failed', { error: transaction.error ?? 'interrupted update was not committed' }),
      }
    }
  }
  return { transaction, persisted }
}
