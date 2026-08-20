export class UpdateScheduler {
  constructor({
    check,
    intervalSeconds = 21_600,
    onError = async () => {},
    random = Math.random,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 60) throw new Error('update interval must be at least 60 seconds')
    this.check = check
    this.onError = onError
    this.intervalMs = intervalSeconds * 1_000
    this.random = random
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.timer = undefined
    this.enabled = false
  }

  schedule() {
    const jitter = 0.9 + this.random() * 0.2
    const timer = this.setTimer(async () => {
      if (this.timer !== timer) return
      this.timer = undefined
      try {
        await this.check()
      } catch (error) {
        await Promise.resolve().then(() => this.onError(error)).catch(() => {})
      }
      if (this.enabled && this.timer === undefined) this.schedule()
    }, Math.round(this.intervalMs * jitter))
    this.timer = timer
    timer.unref?.()
  }

  start() {
    this.enabled = true
    if (this.timer === undefined) this.schedule()
  }

  configure({ enabled, intervalSeconds }) {
    if (typeof enabled !== 'boolean') throw new Error('automatic check enabled must be boolean')
    if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 60) throw new Error('update interval must be at least 60 seconds')
    this.stop()
    this.intervalMs = intervalSeconds * 1_000
    if (enabled) this.start()
  }

  stop() {
    this.enabled = false
    if (this.timer !== undefined) this.clearTimer(this.timer)
    this.timer = undefined
  }
}
