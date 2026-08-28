import { AccessError } from './errors.mjs'

export class AuthenticationLimiter {
  constructor({
    globalLimit = 30,
    accountLimit = 10,
    windowMs = 60_000,
    maxConcurrent = 2,
    clock = () => Date.now(),
  } = {}) {
    this.globalLimit = globalLimit
    this.accountLimit = accountLimit
    this.windowMs = windowMs
    this.maxConcurrent = maxConcurrent
    this.clock = clock
    this.global = []
    this.accounts = new Map()
    this.active = 0
  }

  prune(values, now) {
    while (values.length > 0 && values[0] <= now - this.windowMs) values.shift()
  }

  enter(accountId = 'unknown') {
    const now = this.clock()
    this.prune(this.global, now)
    const account = this.accounts.get(accountId) ?? []
    this.prune(account, now)
    this.accounts.set(accountId, account)
    if (this.active >= this.maxConcurrent || this.global.length >= this.globalLimit || account.length >= this.accountLimit) {
      throw new AccessError('AUTHENTICATION_RATE_LIMITED', 'authentication is temporarily unavailable', 429)
    }
    this.active += 1
    const failures = Math.max(this.global.length, account.length)
    const threshold = Math.max(1, Math.floor(Math.min(this.globalLimit, this.accountLimit) / 2))
    const delayMs = failures < threshold ? 0 : Math.min(2_000, 100 * (2 ** (failures - threshold)))
    let released = false
    const release = success => {
      if (released) return
      released = true
      this.active -= 1
      if (success !== true) {
        const failedAt = this.clock()
        this.global.push(failedAt)
        account.push(failedAt)
      } else {
        account.length = 0
      }
    }
    return { delayMs, release }
  }
}
