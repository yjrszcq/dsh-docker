export class BootstrapRuntime {
  constructor({
    controlPlane,
    environment,
    validateDeployment = async () => {},
    prepareDeployment = async () => {},
    onEnvironmentFatal = async () => {},
    report = async () => {},
  }) {
    this.controlPlane = controlPlane
    this.environment = environment
    this.fatal = controlPlane.fatal
    this.recoveryMode = null
    this.startupComplete = false
    this.recovery = Promise.resolve()
    this.validateDeployment = validateDeployment
    this.prepareDeployment = prepareDeployment
    this.onEnvironmentFatal = onEnvironmentFatal
    this.report = report
    const handleEnvironmentFatal = error => {
      this.recoveryMode = error instanceof Error ? error.message : String(error)
      this.recovery = this.recovery.then(async () => {
        try {
          await this.onEnvironmentFatal(error)
        } catch (reportError) {
          await this.record('environment.recovery-report.failed', { error: reportError, originalError: String(error) })
        }
        try {
          await this.environment.stop()
        } catch (stopError) {
          await this.record('environment.recovery-stop.failed', { error: stopError, originalError: String(error) })
        }
      })
    }
    if (typeof environment.onFatal === 'function') {
      this.offEnvironmentFatal = environment.onFatal(handleEnvironmentFatal)
    } else {
      void environment.fatal.then(handleEnvironmentFatal)
      this.offEnvironmentFatal = undefined
    }
  }

  record(message, fields = {}) {
    return Promise.resolve().then(() => this.report(message, fields)).catch(() => {})
  }

  async stopControlPlane(phase, cause) {
    try {
      await this.controlPlane.stop()
    } catch (error) {
      await this.record('control-plane.cleanup.failed', {
        error,
        phase,
        originalError: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  async start({ onEnvironmentFailure, allowRecovery = false } = {}) {
    await this.controlPlane.start()
    try {
      await this.validateDeployment()
      await this.prepareDeployment()
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
        await this.stopControlPlane('fallback-resolution', failure)
        throw failure
      }
      if (retry === true) {
        try {
          await this.validateDeployment()
          await this.prepareDeployment()
          await this.environment.start()
        } catch (fallbackError) {
          const failure = new AggregateError([error, fallbackError], 'Deployment candidate and fallback both failed')
          if (allowRecovery) this.recoveryMode = failure.message
          else {
            await this.stopControlPlane('fallback-start', failure)
            throw failure
          }
        }
      } else if (allowRecovery) {
        this.recoveryMode = error instanceof Error ? error.message : 'Deployment failed to start'
      } else {
        await this.stopControlPlane('environment-start', error)
        throw error
      }
    }
    return this.status()
  }

  async stop() {
    this.offEnvironmentFatal?.()
    await this.recovery
    const failures = []
    try { await this.environment.stop() } catch (error) { failures.push(error) }
    try { await this.controlPlane.stop() } catch (error) { failures.push(error) }
    if (failures.length > 0) throw new AggregateError(failures, 'Bootstrap shutdown failed')
  }

  async reload() {
    await this.validateDeployment()
    await this.prepareDeployment()
    const status = await this.environment.reload()
    this.recoveryMode = null
    return status
  }
  suspend(componentId) { return this.environment.suspend(componentId) }
  pause(componentId) { return this.environment.pause(componentId, { allowMissing: componentId === 'dsh-runtime' }) }
  async resume(componentId, options) {
    if (componentId === 'dsh-runtime') {
      if (options?.skipValidation !== true) await this.validateDeployment()
      if (options?.skipPreparation !== true) await this.prepareDeployment()
    }
    const status = await this.environment.resume(componentId)
    if (componentId === 'dsh-runtime') this.recoveryMode = null
    return status
  }
  async restart(componentId, options) {
    if (componentId === 'dsh-runtime') {
      if (options?.skipValidation !== true) await this.validateDeployment()
      if (options?.skipPreparation !== true) await this.prepareDeployment()
    }
    const status = await this.environment.restart(componentId, options)
    if (componentId === 'dsh-runtime') this.recoveryMode = null
    return status
  }
  health() { return this.environment.health() }

  markStartupComplete() { this.startupComplete = true }

  enterRecovery(error) {
    this.recoveryMode = error instanceof Error ? error.message : String(error)
  }

  status() {
    const environment = this.environment.status()
    return Object.freeze({
      ...environment,
      controlPlane: this.controlPlane.status().components,
      recoveryMode: this.recoveryMode,
      startupComplete: this.startupComplete,
    })
  }
}
