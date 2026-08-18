export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
    this.exitCode = 64
  }
}
