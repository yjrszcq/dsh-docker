export class BootstrapRuntime {
  constructor({ controlPlane, environment }) {
    this.controlPlane = controlPlane
    this.environment = environment
    this.fatal = Promise.race([controlPlane.fatal, environment.fatal])
  }

  async start() {
    await this.controlPlane.start()
    try {
      await this.environment.start()
    } catch (error) {
      await this.controlPlane.stop().catch(() => {})
      throw error
    }
    return this.status()
  }

  async stop() {
    const failures = []
    try { await this.environment.stop() } catch (error) { failures.push(error) }
    try { await this.controlPlane.stop() } catch (error) { failures.push(error) }
    if (failures.length > 0) throw new AggregateError(failures, 'Bootstrap shutdown failed')
  }

  reload() { return this.environment.reload() }
  suspend(componentId) { return this.environment.suspend(componentId) }
  resume(componentId) { return this.environment.resume(componentId) }
  health() { return this.environment.health() }

  status() {
    const environment = this.environment.status()
    return Object.freeze({
      ...environment,
      controlPlane: this.controlPlane.status().components,
    })
  }
}
