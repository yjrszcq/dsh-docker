import { AccessError } from './errors.mjs'

export class AuthenticationLimiter {
  constructor({
    globalLimit = 20,
    windowMs = 60_000,
    maxConcurrent = 2,
    backoffThreshold = 5,
    initialBackoffMs = 30_000,
    maxBackoffMs = 15 * 60_000,
    consecutiveResetMs = 24 * 60 * 60_000,
    sourceWindows,
    globalWindows,
    clock = () => Date.now(),
  } = {}) {
    this.globalLimit = globalLimit
    this.windowMs = windowMs
    this.maxConcurrent = maxConcurrent
    this.backoffThreshold = backoffThreshold
    this.initialBackoffMs = initialBackoffMs
    this.maxBackoffMs = maxBackoffMs
    this.consecutiveResetMs = consecutiveResetMs
    this.sourceWindows = sourceWindows ?? [
      { limit: 12, windowMs: 60 * 60_000 },
      { limit: 24, windowMs: 24 * 60 * 60_000 },
    ]
    this.globalWindows = globalWindows ?? [
      { limit: globalLimit, windowMs },
      { limit: 60, windowMs: 60 * 60_000 },
      { limit: 120, windowMs: 24 * 60 * 60_000 },
    ]
    this.maxSourceWindowMs = Math.max(...this.sourceWindows.map(value => value.windowMs))
    this.maxGlobalWindowMs = Math.max(...this.globalWindows.map(value => value.windowMs))
    this.clock = clock
    this.global = []
    this.sources = new Map()
    this.consecutiveFailures = new Map()
    this.active = 0
    this.lastPruneAt = Number.NEGATIVE_INFINITY
  }

  prune(values, now, windowMs = this.windowMs) {
    while (values.length > 0 && values[0] <= now - windowMs) values.shift()
  }

  retryAfterSeconds(values, windows, now) {
    let retryAfterMs = 0
    for (const { limit, windowMs } of windows) {
      const withinWindow = values.filter(value => value > now - windowMs)
      if (withinWindow.length < limit) continue
      retryAfterMs = Math.max(retryAfterMs, withinWindow[withinWindow.length - limit] + windowMs - now)
    }
    return Math.max(0, Math.ceil(retryAfterMs / 1_000))
  }

  retryKey(accountId, sourceId) { return `${accountId}\u0000${sourceId}` }

  pruneExpiredSources(now) {
    if (now - this.lastPruneAt < this.windowMs) return
    this.lastPruneAt = now
    for (const [key, values] of this.sources) {
      this.prune(values, now, this.maxSourceWindowMs)
      if (values.length === 0) this.sources.delete(key)
    }
    for (const [key, retry] of this.consecutiveFailures) {
      if (retry.lastFailureAt <= now - this.consecutiveResetMs) {
        this.consecutiveFailures.delete(key)
      }
    }
  }

  currentRetry(accountId = 'unknown', sourceId = 'unknown', now = this.clock()) {
    const retryKey = this.retryKey(accountId, sourceId)
    const retry = this.consecutiveFailures.get(retryKey)
    if (retry !== undefined && retry.lastFailureAt <= now - this.consecutiveResetMs) {
      this.consecutiveFailures.delete(retryKey)
      return undefined
    }
    return retry
  }

  checkRetry(accountId = 'unknown', sourceId = 'unknown') {
    const now = this.clock()
    const retry = this.currentRetry(accountId, sourceId, now)
    if (retry !== undefined && retry.blockedUntil > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((retry.blockedUntil - now) / 1_000))
      throw new AccessError(
        'AUTHENTICATION_RETRY_REQUIRED',
        `authentication retry is available in ${retryAfterSeconds} seconds`,
        429,
        { retryAfterSeconds },
      )
    }
  }

  enter(accountId = 'unknown', sourceId = 'unknown') {
    this.checkRetry(accountId, sourceId)
    const now = this.clock()
    this.pruneExpiredSources(now)
    const retryKey = this.retryKey(accountId, sourceId)
    const source = this.sources.get(retryKey) ?? []
    this.prune(source, now, this.maxSourceWindowMs)
    this.sources.set(retryKey, source)
    this.prune(this.global, now, this.maxGlobalWindowMs)
    if (this.active >= this.maxConcurrent) {
      throw new AccessError(
        'AUTHENTICATION_RATE_LIMITED',
        'authentication is temporarily unavailable',
        429,
        { retryAfterSeconds: 1 },
      )
    }
    const globalRetryAfterSeconds = this.retryAfterSeconds(this.global, this.globalWindows, now)
    const sourceRetryAfterSeconds = this.retryAfterSeconds(source, this.sourceWindows, now)
    if (sourceRetryAfterSeconds > 0) {
      throw new AccessError(
        'AUTHENTICATION_RATE_LIMITED',
        `browser authentication is available in ${sourceRetryAfterSeconds} seconds`,
        429,
        { retryAfterSeconds: sourceRetryAfterSeconds },
      )
    }
    if (globalRetryAfterSeconds > 0) {
      throw new AccessError(
        'AUTHENTICATION_RATE_LIMITED',
        `administrator authentication is available in ${globalRetryAfterSeconds} seconds`,
        429,
        { retryAfterSeconds: globalRetryAfterSeconds },
      )
    }
    this.active += 1
    let released = false
    const release = success => {
      if (released) return this.sourceStatus(accountId, sourceId)
      released = true
      this.active -= 1
      if (success !== true) {
        const failedAt = this.clock()
        this.global.push(failedAt)
        source.push(failedAt)
        const previous = this.consecutiveFailures.get(retryKey)
        const failures = (previous !== undefined
          && previous.lastFailureAt > failedAt - this.consecutiveResetMs ? previous.failures : 0) + 1
        const exponent = Math.max(0, failures - this.backoffThreshold)
        const backoffMs = failures < this.backoffThreshold
          ? 0
          : Math.min(this.maxBackoffMs, this.initialBackoffMs * (2 ** exponent))
        this.consecutiveFailures.set(retryKey, {
          failures,
          blockedUntil: backoffMs === 0 ? 0 : failedAt + backoffMs,
          lastFailureAt: failedAt,
        })
      } else {
        this.consecutiveFailures.delete(this.retryKey(accountId, sourceId))
        this.sources.delete(this.retryKey(accountId, sourceId))
      }
      return this.sourceStatus(accountId, sourceId)
    }
    return { release }
  }

  sourceStatus(accountId = 'unknown', sourceId = 'unknown') {
    const retry = this.currentRetry(accountId, sourceId)
    if (retry === undefined) return { consecutiveFailures: 0, retryAfterSeconds: 0 }
    return {
      consecutiveFailures: retry.failures,
      retryAfterSeconds: Math.max(0, Math.ceil((retry.blockedUntil - this.clock()) / 1_000)),
    }
  }

  status(accountId = 'unknown') {
    const now = this.clock()
    this.pruneExpiredSources(now)
    this.prune(this.global, now, this.maxGlobalWindowMs)
    const prefix = `${accountId}\u0000`
    for (const [key, retry] of this.consecutiveFailures) {
      if (key.startsWith(prefix) && retry.lastFailureAt <= now - this.consecutiveResetMs) {
        this.consecutiveFailures.delete(key)
      }
    }
    const states = [...this.consecutiveFailures.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, retry]) => ({
        consecutiveFailures: retry.failures,
        retryAfterSeconds: Math.max(0, Math.ceil((retry.blockedUntil - this.clock()) / 1_000)),
      }))
    const sourcePrefix = `${accountId}\u0000`
    const sourceRetryAfterSeconds = Math.max(0, ...[...this.sources.entries()]
      .filter(([key]) => key.startsWith(sourcePrefix))
      .map(([, values]) => this.retryAfterSeconds(values, this.sourceWindows, now)))
    return {
      activeSources: states.length,
      consecutiveFailures: Math.max(0, ...states.map(value => value.consecutiveFailures)),
      retryAfterSeconds: Math.max(0, ...states.map(value => value.retryAfterSeconds)),
      sourceRetryAfterSeconds,
      globalFailures: this.global.length,
      globalRetryAfterSeconds: this.retryAfterSeconds(this.global, this.globalWindows, now),
    }
  }

  clear(accountId = 'unknown') {
    const previous = this.status(accountId)
    const prefix = `${accountId}\u0000`
    for (const key of this.consecutiveFailures.keys()) {
      if (key.startsWith(prefix)) this.consecutiveFailures.delete(key)
    }
    for (const key of this.sources.keys()) {
      if (key.startsWith(prefix)) this.sources.delete(key)
    }
    this.global.length = 0
    return { cleared: previous.activeSources > 0 || previous.globalFailures > 0, ...previous }
  }

  clearGlobal() {
    const now = this.clock()
    this.prune(this.global, now, this.maxGlobalWindowMs)
    const globalFailures = this.global.length
    const globalRetryAfterSeconds = this.retryAfterSeconds(this.global, this.globalWindows, now)
    this.global.length = 0
    return {
      cleared: globalFailures > 0,
      globalFailures,
      globalRetryAfterSeconds,
    }
  }
}
