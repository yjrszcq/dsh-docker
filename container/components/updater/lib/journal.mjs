import { open, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { durableReplace } from '../../../platform/lib/atomic.mjs'
import { exactKeys, isoTimestamp, plainObject, TrustError } from '../../../platform/lib/validation.mjs'

const PHASES = new Set([
  'planning', 'candidate-ready', 'suspended', 'snapshot-created', 'switched', 'probation',
  'committed', 'restoring-data', 'rolled-back', 'failed',
])

const TRANSITIONS = new Map([
  ['planning', new Set(['candidate-ready', 'failed'])],
  ['candidate-ready', new Set(['suspended', 'failed'])],
  ['suspended', new Set(['snapshot-created', 'failed'])],
  ['snapshot-created', new Set(['switched', 'restoring-data', 'failed'])],
  ['switched', new Set(['probation', 'restoring-data'])],
  ['probation', new Set(['committed', 'restoring-data'])],
  ['restoring-data', new Set(['rolled-back', 'failed'])],
  ['committed', new Set(['restoring-data'])],
  ['rolled-back', new Set()],
  ['failed', new Set()],
])

function deployment(value, label, snapshot) {
  const object = plainObject(value, label)
  exactKeys(object, ['dsh', 'environment', 'runtime', ...(snapshot ? ['dataSnapshot', 'receiptTokens'] : [])], label)
  for (const name of ['dsh', 'environment', 'runtime']) {
    if (typeof object[name] !== 'string' || object[name] === '') throw new TrustError(`${label}.${name} is invalid`)
  }
  if (snapshot && object.dataSnapshot !== null && typeof object.dataSnapshot !== 'string') {
    throw new TrustError(`${label}.dataSnapshot is invalid`)
  }
  if (snapshot && (!Array.isArray(object.receiptTokens) || object.receiptTokens.some(token => typeof token !== 'string'))) {
    throw new TrustError(`${label}.receiptTokens is invalid`)
  }
  return Object.freeze({ ...object, ...(snapshot ? { receiptTokens: Object.freeze([...object.receiptTokens]) } : {}) })
}

function parseJournal(value) {
  const object = plainObject(value, 'update journal')
  exactKeys(object, [
    'error', 'from', 'mode', 'phase', 'probationUntil', 'receiptTokens', 'schema',
    'snapshotId', 'to', 'transactionId', 'updatedAt',
  ], 'update journal')
  if (object.schema !== 1) throw new TrustError('update journal schema must be 1')
  if (typeof object.transactionId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(object.transactionId)) {
    throw new TrustError('update journal transaction ID is invalid')
  }
  if (!['stable', 'experimental'].includes(object.mode)) throw new TrustError('update journal mode is invalid')
  if (!PHASES.has(object.phase)) throw new TrustError('update journal phase is invalid')
  if (!Array.isArray(object.receiptTokens) || object.receiptTokens.some(token => typeof token !== 'string')) {
    throw new TrustError('update journal receipt tokens are invalid')
  }
  for (const name of ['snapshotId', 'probationUntil', 'error']) {
    if (object[name] !== null && typeof object[name] !== 'string') throw new TrustError(`update journal ${name} is invalid`)
  }
  if (object.probationUntil !== null) isoTimestamp(object.probationUntil, 'update journal probation deadline')
  isoTimestamp(object.updatedAt, 'update journal update time')
  return Object.freeze({
    ...object,
    from: deployment(object.from, 'update journal from', true),
    to: deployment(object.to, 'update journal to', false),
    receiptTokens: Object.freeze([...object.receiptTokens]),
  })
}

async function syncDirectory(path) {
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}

export class UpdateJournal {
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
    try { return parseJournal(JSON.parse(await readFile(this.path, 'utf8'))) } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
  }

  begin(value) {
    return this.exclusive(async () => {
      const previous = await this.read()
      if (previous !== undefined && !['committed', 'rolled-back', 'failed'].includes(previous.phase)) {
        throw new TrustError('an update transaction journal already exists')
      }
      const journal = parseJournal({
        schema: 1,
        transactionId: value.transactionId,
        mode: value.mode,
        phase: 'planning',
        from: value.from,
        to: value.to,
        snapshotId: null,
        receiptTokens: [],
        probationUntil: null,
        error: null,
        updatedAt: this.now().toISOString(),
      })
      await durableReplace(this.path, `${JSON.stringify(journal)}\n`)
      return journal
    })
  }

  transition(phase, fields = {}) {
    return this.exclusive(async () => {
      const current = await this.read()
      if (current === undefined) throw new TrustError('update transaction journal does not exist')
      if (!TRANSITIONS.get(current.phase)?.has(phase)) {
        throw new TrustError(`update journal cannot transition from ${current.phase} to ${phase}`)
      }
      const next = parseJournal({ ...current, ...fields, phase, updatedAt: this.now().toISOString() })
      if (next.transactionId !== current.transactionId || next.mode !== current.mode) {
        throw new TrustError('update journal identity cannot change')
      }
      await durableReplace(this.path, `${JSON.stringify(next)}\n`)
      return next
    })
  }

  clear() {
    return this.exclusive(async () => {
      const current = await this.read()
      if (current !== undefined && !['committed', 'rolled-back', 'failed'].includes(current.phase)) {
        throw new TrustError('cannot clear a nonterminal update journal')
      }
      await rm(this.path, { force: true })
      await syncDirectory(dirname(this.path)).catch(error => { if (error?.code !== 'ENOENT') throw error })
    })
  }
}
