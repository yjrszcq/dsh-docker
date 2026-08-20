import { readFile } from 'node:fs/promises'
import { durableReplace } from '../../../platform/lib/atomic.mjs'

const PHASES = new Set([
  'validated', 'paused', 'snapshotted', 'mutating', 'committed', 'restarting',
  'restoring', 'completed', 'failed',
])
const TERMINAL = new Set(['completed', 'failed'])
const TRANSITIONS = new Map([
  ['validated', new Set(['paused', 'failed'])],
  ['paused', new Set(['snapshotted', 'restoring', 'failed'])],
  ['snapshotted', new Set(['mutating', 'restoring'])],
  ['mutating', new Set(['committed', 'restoring'])],
  ['committed', new Set(['restarting', 'failed'])],
  ['restarting', new Set(['completed', 'failed'])],
  ['restoring', new Set(['failed'])],
  ['completed', new Set()],
  ['failed', new Set()],
])

function parseAction(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'action,name'
    || typeof value.name !== 'string' || !['enable', 'disable', 'uninstall'].includes(value.action)) {
    throw new Error('User Plugin journal action is invalid')
  }
  return Object.freeze({ name: value.name, action: value.action })
}

function parse(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || value.schema !== 1 || typeof value.taskId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(value.taskId)
    || !PHASES.has(value.phase) || typeof value.revision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value.revision)
    || !Array.isArray(value.actions) || value.actions.length === 0
    || typeof value.selectionPresent !== 'boolean' || !Array.isArray(value.previousDisabled)
    || (value.snapshotId !== null && typeof value.snapshotId !== 'string')
    || (value.error !== null && typeof value.error !== 'string')
    || ![null, 'success', 'failed'].includes(value.recoveryResult)
    || typeof value.updatedAt !== 'string' || new Date(value.updatedAt).toISOString() !== value.updatedAt) {
    throw new Error('User Plugin transaction journal is invalid')
  }
  const names = new Set()
  const previousDisabled = value.previousDisabled.map(entry => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).sort().join(',') !== 'index,name'
      || typeof entry.name !== 'string' || !Number.isSafeInteger(entry.index) || entry.index < 0
      || names.has(entry.name)) throw new Error('User Plugin journal disabled-order state is invalid')
    names.add(entry.name)
    return Object.freeze({ name: entry.name, index: entry.index })
  })
  return Object.freeze({
    ...value,
    actions: Object.freeze(value.actions.map(parseAction)),
    previousDisabled: Object.freeze(previousDisabled),
  })
}

export class UserPluginJournal {
  constructor(path, now = () => new Date()) {
    this.path = path
    this.now = now
    this.queue = Promise.resolve()
  }

  exclusive(operation) {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  async read() {
    try { return parse(JSON.parse(await readFile(this.path, 'utf8'))) } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
  }

  begin({ taskId, revision, actions, selection }) {
    return this.exclusive(async () => {
      const current = await this.read()
      if (current !== undefined && !TERMINAL.has(current.phase)) {
        throw new Error('a User Plugin transaction is already active')
      }
      const next = parse({
        schema: 1, taskId, revision, actions,
        selectionPresent: selection.present,
        previousDisabled: selection.state.disabled,
        phase: 'validated', snapshotId: null,
        error: null, recoveryResult: null, updatedAt: this.now().toISOString(),
      })
      await durableReplace(this.path, `${JSON.stringify(next)}\n`)
      return next
    })
  }

  transition(phase, fields = {}) {
    return this.exclusive(async () => {
      const current = await this.read()
      if (current === undefined || !TRANSITIONS.get(current.phase)?.has(phase)) {
        throw new Error(`User Plugin journal cannot transition to ${phase}`)
      }
      const next = parse({ ...current, ...fields, phase, updatedAt: this.now().toISOString() })
      if (next.taskId !== current.taskId || next.revision !== current.revision) {
        throw new Error('User Plugin journal identity cannot change')
      }
      await durableReplace(this.path, `${JSON.stringify(next)}\n`)
      return next
    })
  }
}

export const userPluginJournalInternals = Object.freeze({ parse, TERMINAL })
