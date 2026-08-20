import { readFile } from 'node:fs/promises'
import { durableReplace } from '../../../../platform/lib/atomic.mjs'
import { compareDshVersions } from '../../../../platform/lib/supported-target.mjs'

export const AUTOMATIC_CHECK_INTERVALS = Object.freeze([3_600, 10_800, 21_600, 43_200, 86_400])

const DEFAULT_STATE = Object.freeze({
  schema: 1,
  automaticCheck: Object.freeze({
    enabled: true,
    intervalSeconds: 21_600,
    notificationsEnabled: true,
  }),
  latestAutomatic: Object.freeze({ stable: null, upstream: null }),
})

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  const keys = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} fields are invalid`)
  }
}

function parseConfig(value) {
  exactKeys(value, ['enabled', 'intervalSeconds', 'notificationsEnabled'], 'automatic check config')
  if (typeof value.enabled !== 'boolean') throw new Error('automatic check enabled must be boolean')
  if (!AUTOMATIC_CHECK_INTERVALS.includes(value.intervalSeconds)) throw new Error('automatic check interval is invalid')
  if (typeof value.notificationsEnabled !== 'boolean') throw new Error('update notifications enabled must be boolean')
  return Object.freeze({ ...value })
}

function parseStable(value) {
  if (value === null) return null
  exactKeys(value, ['checkedAt', 'dsh', 'environment', 'targetSequence'], 'Stable notification')
  if (!Number.isSafeInteger(value.targetSequence) || value.targetSequence < 1) throw new Error('Stable notification sequence is invalid')
  compareDshVersions(value.dsh, value.dsh)
  if (typeof value.environment !== 'string' || value.environment.length === 0) throw new Error('Stable notification Environment is invalid')
  if (Number.isNaN(Date.parse(value.checkedAt))) throw new Error('Stable notification timestamp is invalid')
  return Object.freeze({ ...value })
}

function parseUpstream(value) {
  if (value === null) return null
  exactKeys(value, ['checkedAt', 'version'], 'Upstream notification')
  compareDshVersions(value.version, value.version)
  if (Number.isNaN(Date.parse(value.checkedAt))) throw new Error('Upstream notification timestamp is invalid')
  return Object.freeze({ ...value })
}

function parseState(value) {
  exactKeys(value, ['automaticCheck', 'latestAutomatic', 'schema'], 'automatic check state')
  if (value.schema !== 1) throw new Error('automatic check state schema must be 1')
  exactKeys(value.latestAutomatic, ['stable', 'upstream'], 'automatic notification state')
  return Object.freeze({
    schema: 1,
    automaticCheck: parseConfig(value.automaticCheck),
    latestAutomatic: Object.freeze({
      stable: parseStable(value.latestAutomatic.stable),
      upstream: parseUpstream(value.latestAutomatic.upstream),
    }),
  })
}

function isHeld(version, environment, holds) {
  return holds.some(hold => hold.dshVersion === version
    && (hold.type !== 'combination' || hold.environmentVersion === environment))
}

function stableSatisfied(candidate, current) {
  return current.environment === candidate.environment && compareDshVersions(current.dsh, candidate.dsh) >= 0
}

export class AutomaticCheckStateStore {
  constructor(path, now = () => new Date()) {
    this.path = path
    this.now = now
    this.pending = Promise.resolve()
  }

  async read() {
    try {
      return parseState(JSON.parse(await readFile(this.path, 'utf8')))
    } catch (error) {
      if (error?.code === 'ENOENT') return DEFAULT_STATE
      throw error
    }
  }

  async replace(update) {
    const operation = this.pending.then(async () => {
      const next = parseState(await update(await this.read()))
      await durableReplace(this.path, `${JSON.stringify(next)}\n`)
      return next
    })
    this.pending = operation.catch(() => {})
    return operation
  }

  configure(value) {
    const config = parseConfig(value)
    return this.replace(previous => ({
      ...previous,
      automaticCheck: config,
      latestAutomatic: !config.enabled || !config.notificationsEnabled
        ? { stable: null, upstream: null }
        : previous.latestAutomatic,
    }))
  }

  record({ channel, current, target, upstream, stableAvailable, holds = [] }) {
    return this.replace(previous => {
      if (!previous.automaticCheck.enabled || !previous.automaticCheck.notificationsEnabled) return previous
      const checkedAt = this.now().toISOString()
      let stable = previous.latestAutomatic.stable
      let latestUpstream = previous.latestAutomatic.upstream

      if (stable !== null && stableSatisfied(stable, current)) stable = null
      if (
        stableAvailable === true
        && (stable === null || target.targetSequence > stable.targetSequence)
      ) {
        stable = {
          targetSequence: target.targetSequence,
          dsh: target.desired.dsh.version,
          environment: target.desired.environment.version,
          checkedAt,
        }
      }

      if (channel !== 'experimental') {
        latestUpstream = null
      } else {
        if (latestUpstream !== null && compareDshVersions(current.dsh, latestUpstream.version) >= 0) latestUpstream = null
        if (
          upstream !== null
          && compareDshVersions(upstream.version, current.dsh) > 0
          && !isHeld(upstream.version, target.desired.environment.version, holds)
          && (latestUpstream === null || compareDshVersions(upstream.version, latestUpstream.version) > 0)
        ) latestUpstream = { version: upstream.version, checkedAt }
      }

      return { ...previous, latestAutomatic: { stable, upstream: latestUpstream } }
    })
  }

  clearSatisfied(current) {
    return this.replace(previous => ({
      ...previous,
      latestAutomatic: {
        stable: previous.latestAutomatic.stable !== null
          && stableSatisfied(previous.latestAutomatic.stable, current)
          ? null
          : previous.latestAutomatic.stable,
        upstream: previous.latestAutomatic.upstream !== null
          && compareDshVersions(current.dsh, previous.latestAutomatic.upstream.version) >= 0
          ? null
          : previous.latestAutomatic.upstream,
      },
    }))
  }

  clearUpstream() {
    return this.replace(previous => ({
      ...previous,
      latestAutomatic: { ...previous.latestAutomatic, upstream: null },
    }))
  }
}
