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
