export class UpdateScheduler {
  constructor({ check, intervalSeconds = 21_600, random = Math.random, setTimer = setTimeout, clearTimer = clearTimeout }) {
    if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 60) throw new Error('update interval must be at least 60 seconds')
    this.check = check
    this.intervalMs = intervalSeconds * 1_000
    this.random = random
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.timer = undefined
  }

  schedule() {
    const jitter = 0.9 + this.random() * 0.2
    this.timer = this.setTimer(async () => {
      try { await this.check() } catch {}
      if (this.timer !== undefined) this.schedule()
    }, Math.round(this.intervalMs * jitter))
    this.timer.unref?.()
  }

  start() {
    if (this.timer === undefined) this.schedule()
  }

  stop() {
    if (this.timer !== undefined) this.clearTimer(this.timer)
    this.timer = undefined
  }
}
