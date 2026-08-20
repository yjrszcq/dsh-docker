export class BootstrapRuntime {
  constructor({ controlPlane, environment, validateDeployment = async () => {} }) {
    this.controlPlane = controlPlane
    this.environment = environment
    this.fatal = Promise.race([controlPlane.fatal, environment.fatal])
    this.recoveryMode = null
    this.validateDeployment = validateDeployment
  }

  async start({ onEnvironmentFailure, allowRecovery = false } = {}) {
    await this.controlPlane.start()
    try {
      await this.validateDeployment()
      await this.environment.start()
    } catch (error) {
      let retry
      try {
        retry = await onEnvironmentFailure?.(error)
      } catch (recoveryError) {
        const failure = new AggregateError([error, recoveryError], 'Deployment failed and its fallback could not be resolved')
        if (allowRecovery) {
          this.recoveryMode = failure.message
          return this.status()
        }
        await this.controlPlane.stop().catch(() => {})
        throw failure
      }
      if (retry === true) {
        try {
          await this.validateDeployment()
          await this.environment.start()
        } catch (fallbackError) {
          const failure = new AggregateError([error, fallbackError], 'Deployment candidate and fallback both failed')
          if (allowRecovery) this.recoveryMode = failure.message
          else {
            await this.controlPlane.stop().catch(() => {})
            throw failure
          }
        }
      } else if (allowRecovery) {
        this.recoveryMode = error instanceof Error ? error.message : 'Deployment failed to start'
      } else {
        await this.controlPlane.stop().catch(() => {})
        throw error
      }
    }
    return this.status()
  }

  async stop() {
    const failures = []
    try { await this.environment.stop() } catch (error) { failures.push(error) }
    try { await this.controlPlane.stop() } catch (error) { failures.push(error) }
    if (failures.length > 0) throw new AggregateError(failures, 'Bootstrap shutdown failed')
  }

  async reload() {
    await this.validateDeployment()
    return this.environment.reload()
  }
  suspend(componentId) { return this.environment.suspend(componentId) }
  async resume(componentId) {
    if (componentId === 'dsh-runtime') await this.validateDeployment()
    return this.environment.resume(componentId)
  }
  async restart(componentId) {
    if (componentId === 'dsh-runtime') await this.validateDeployment()
    return this.environment.restart(componentId)
  }
  health() { return this.environment.health() }

  status() {
    const environment = this.environment.status()
    return Object.freeze({
      ...environment,
      controlPlane: this.controlPlane.status().components,
      recoveryMode: this.recoveryMode,
    })
  }
}
