import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { durableReplace } from '../../../platform/lib/atomic.mjs'
import { compareDshVersions } from '../../../platform/lib/supported-target.mjs'
import { isoTimestamp, plainObject, TrustError } from '../../../platform/lib/validation.mjs'

const DEFAULT_STATE = Object.freeze({
  schema: 1,
  updateChannel: 'stable',
  holds: Object.freeze([]),
  experimentalBlocked: null,
})

function text(value, label) {
  if (typeof value !== 'string' || value === '' || value.length > 512 || value.includes('\0')) {
    throw new TrustError(`${label} is invalid`)
  }
  return value
}

function parseHold(value) {
  const hold = plainObject(value, 'update hold')
  const keys = Object.keys(hold).sort()
  const expected = ['createdAt', 'dshVersion', 'environmentVersion', 'id', 'reason', 'type']
  if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new TrustError('update hold has unexpected fields')
  if (!['version', 'combination'].includes(hold.type)) throw new TrustError('update hold type is invalid')
  if (hold.type === 'version' && hold.environmentVersion !== null) throw new TrustError('version hold cannot name an Environment')
  if (hold.type === 'combination' && typeof hold.environmentVersion !== 'string') {
    throw new TrustError('combination hold requires an Environment')
  }
  isoTimestamp(hold.createdAt, 'update hold creation time')
  return Object.freeze({
    id: text(hold.id, 'update hold ID'),
    type: hold.type,
    dshVersion: text(hold.dshVersion, 'update hold DSH version'),
    environmentVersion: hold.environmentVersion === null ? null : text(hold.environmentVersion, 'update hold Environment'),
    reason: text(hold.reason, 'update hold reason'),
    createdAt: hold.createdAt,
  })
}

function parseState(value) {
  const state = plainObject(value, 'channel state')
  const keys = Object.keys(state).sort()
  if (JSON.stringify(keys) !== JSON.stringify(['experimentalBlocked', 'holds', 'schema', 'updateChannel'])) {
    throw new TrustError('channel state has unexpected fields')
  }
  if (state.schema !== 1) throw new TrustError('channel state schema must be 1')
  if (!['stable', 'experimental'].includes(state.updateChannel)) throw new TrustError('update channel is invalid')
  if (!Array.isArray(state.holds)) throw new TrustError('channel holds must be an array')
  const holds = state.holds.map(parseHold)
  if (new Set(holds.map(hold => hold.id)).size !== holds.length) throw new TrustError('update hold IDs must be unique')
  const blocked = state.experimentalBlocked === null ? null : parseHold(state.experimentalBlocked)
  if (blocked !== null && blocked.type !== 'combination') throw new TrustError('Experimental block must identify a combination')
  return Object.freeze({ schema: 1, updateChannel: state.updateChannel, holds: Object.freeze(holds), experimentalBlocked: blocked })
}

export class ChannelStateStore {
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
    try { return parseState(JSON.parse(await readFile(this.path, 'utf8'))) } catch (error) {
      if (error?.code === 'ENOENT') return DEFAULT_STATE
      throw error
    }
  }

  write(value) { return durableReplace(this.path, `${JSON.stringify(parseState(value))}\n`) }

  setChannel(updateChannel) {
    return this.exclusive(async () => {
      const current = await this.read()
      const next = parseState({ ...current, updateChannel })
      await this.write(next)
      return next
    })
  }

  addHold({ type, dshVersion, environmentVersion = null, reason }) {
    return this.exclusive(async () => {
      const current = await this.read()
      const identity = `${type}\0${dshVersion}\0${environmentVersion ?? ''}`
      const id = createHash('sha256').update(identity).digest('hex').slice(0, 24)
      const hold = parseHold({
        id, type, dshVersion, environmentVersion, reason,
        createdAt: this.now().toISOString(),
      })
      const holds = [...current.holds.filter(item => item.id !== id), hold]
      const next = parseState({ ...current, holds })
      await this.write(next)
      return hold
    })
  }

  retry(id) {
    return this.exclusive(async () => {
      const current = await this.read()
      const holds = current.holds.filter(hold => hold.id !== id)
      const clearsBlock = current.experimentalBlocked?.id === id
      if (holds.length === current.holds.length && !clearsBlock) throw new TrustError('update hold does not exist')
      const next = parseState({ ...current, holds, experimentalBlocked: clearsBlock ? null : current.experimentalBlocked })
      await this.write(next)
      return next
    })
  }

  block({ dshVersion, environmentVersion, reason }) {
    return this.exclusive(async () => {
      const current = await this.read()
      const blocked = parseHold({
        id: `blocked-${randomUUID()}`, type: 'combination', dshVersion, environmentVersion, reason,
        createdAt: this.now().toISOString(),
      })
      const next = parseState({ ...current, experimentalBlocked: blocked })
      await this.write(next)
      return next
    })
  }
}

function held(local, dshVersion, environmentVersion) {
  return local.holds.find(hold => (
    hold.dshVersion === dshVersion
    && (hold.type === 'version' || hold.environmentVersion === environmentVersion)
  ))
}

export function planDesiredState({ local, current, supported, upstream = null }) {
  const aheadOfStable = compareDshVersions(current.dsh, supported.dsh) > 0
  const base = {
    updateChannel: local.updateChannel,
    current,
    supported,
    upstream,
    aheadOfStable,
    experimentalBlocked: local.experimentalBlocked,
    holds: local.holds,
  }
  if (aheadOfStable) return Object.freeze({ ...base, action: 'frozen', reason: 'Stable has not caught up with the current DSH' })
  if (compareDshVersions(current.dsh, supported.dsh) < 0 || current.environment !== supported.environment) {
    return Object.freeze({ ...base, action: 'stable', reason: 'converge the signed Stable target before Experimental DSH' })
  }
  if (local.updateChannel === 'stable' || upstream === null) {
    return Object.freeze({ ...base, action: 'none', reason: null })
  }
  const matchingHold = held(local, upstream.version, supported.environment)
  if (matchingHold !== undefined) return Object.freeze({ ...base, action: 'held', reason: matchingHold.reason, hold: matchingHold })
  if (
    local.experimentalBlocked?.dshVersion === upstream.version
    && local.experimentalBlocked.environmentVersion === supported.environment
  ) return Object.freeze({ ...base, action: 'blocked', reason: local.experimentalBlocked.reason })
  return Object.freeze({ ...base, action: 'experimental', reason: null })
}
