import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { request } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseComponentManifest, parseEnvironmentManifest } from '../../lib/contracts.mjs'

function delay(milliseconds) {
  return new Promise(resolveDelay => {
    const timer = setTimeout(resolveDelay, milliseconds)
    timer.unref?.()
  })
}

function terminate(child, graceMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise(resolveTerminate => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }, graceMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolveTerminate()
    })
    child.kill('SIGTERM')
  })
}

function runCommand(spec, options) {
  return new Promise((resolveCommand, reject) => {
    const child = options.spawnImpl(spec.executable, spec.args, {
      env: options.environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    options.capture(child, options.componentId)
    const timer = setTimeout(() => child.kill('SIGKILL'), spec.timeoutSeconds * 1000)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolveCommand()
      else reject(new Error(`${options.componentId} command failed (code=${String(code)}, signal=${String(signal)})`))
    })
  })
}

function probeHttp(health) {
  return new Promise(resolveProbe => {
    const req = request({ hostname: health.host, port: health.port, path: health.path }, response => {
      response.resume()
      resolveProbe((response.statusCode ?? 500) < 500)
    })
    req.setTimeout(Math.min(health.intervalSeconds * 1000, 1_000), () => req.destroy())
    req.once('error', () => resolveProbe(false))
    req.end()
  })
}

async function waitForHealth(component, running, options) {
  if (component.health === null) return
  const deadline = Date.now() + component.health.timeoutSeconds * 1000
  while (Date.now() < deadline) {
    if (running?.child.exitCode !== null) throw new Error(`${component.id} exited before health check passed`)
    const healthy = component.health.type === 'http'
      ? await probeHttp(component.health)
      : await runCommand(component.health.command, options).then(() => true, () => false)
    if (healthy) return
    await delay(component.health.intervalSeconds * 1000)
  }
  throw new Error(`${component.id} health check timed out`)
}

function defaultCapture(child, componentId) {
  for (const [stream, source] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
    stream?.on('data', chunk => process.stdout.write(`[${componentId}:${source}] ${chunk.toString()}`))
  }
}

export async function loadEnvironment(root) {
  const environmentRoot = resolve(root)
  const manifest = parseEnvironmentManifest(await readFile(join(environmentRoot, 'environment.manifest.json')))
  const components = []
  for (const reference of manifest.components) {
    const component = parseComponentManifest(await readFile(join(environmentRoot, 'artifacts', reference.artifactId)))
    if (component.id !== reference.id || component.version !== reference.version) {
      throw new Error(`component ${reference.id} differs from the Environment manifest`)
    }
    components.push(component)
  }
  return Object.freeze({ root: environmentRoot, manifest, components: Object.freeze(components) })
}

export class EnvironmentRunner {
  constructor({ environmentRoot, spawnImpl = spawn, capture = defaultCapture }) {
    this.environmentRoot = environmentRoot
    this.spawnImpl = spawnImpl
    this.capture = capture
    this.running = []
    this.environment = undefined
    this.operation = Promise.resolve()
    this.stopping = false
    this.fatal = new Promise(resolveFatal => { this.resolveFatal = resolveFatal })
  }

  serialized(operation) {
    const result = this.operation.then(operation, operation)
    this.operation = result.then(() => undefined, () => undefined)
    return result
  }

  commandOptions(component) {
    return {
      spawnImpl: this.spawnImpl,
      capture: this.capture,
      componentId: component.id,
      environment: { ...process.env, ...component.environment },
    }
  }

  async phase(component, name) {
    const spec = component.lifecycle[name]
    if (spec !== null) await runCommand(spec, this.commandOptions(component))
  }

  start() {
    return this.serialized(() => this.startUnlocked())
  }

  async startUnlocked() {
    if (this.running.length > 0) throw new Error('Environment is already running')
    this.environment = await loadEnvironment(this.environmentRoot)
    try {
      for (const component of this.environment.components) await this.phase(component, 'prepare')
      for (const component of this.environment.components) {
        await this.phase(component, 'preStart')
        let running
        if (component.type === 'service') {
          const options = this.commandOptions(component)
          const child = this.spawnImpl(component.command.executable, component.command.args, {
            env: options.environment,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          this.capture(child, component.id)
          await Promise.race([
            once(child, 'spawn'),
            once(child, 'error').then(([error]) => { throw error }),
          ])
          running = { component, child }
          child.once('exit', (code, signal) => {
            if (!this.stopping && this.running.includes(running)) {
              this.resolveFatal(new Error(
                `${component.id} exited unexpectedly (code=${String(code)}, signal=${String(signal)})`,
              ))
            }
          })
        } else {
          await runCommand(component.command, this.commandOptions(component))
          running = { component, child: undefined }
        }
        this.running.push(running)
        await waitForHealth(component, running, this.commandOptions(component))
        await this.phase(component, 'postStart')
      }
      return this.status()
    } catch (error) {
      await this.stopUnlocked().catch(() => {})
      throw error
    }
  }

  stop() {
    return this.serialized(() => this.stopUnlocked())
  }

  async stopUnlocked() {
    this.stopping = true
    const failures = []
    for (const running of [...this.running].reverse()) {
      const { component, child } = running
      for (const phase of ['preStop', 'stop']) {
        try { await this.phase(component, phase) } catch (error) { failures.push(error) }
      }
      if (child !== undefined) {
        try { await terminate(child) } catch (error) { failures.push(error) }
      }
      try { await this.phase(component, 'postStop') } catch (error) { failures.push(error) }
    }
    this.running = []
    this.stopping = false
    if (failures.length > 0) throw new AggregateError(failures, 'Environment shutdown failed')
  }

  reload() {
    return this.serialized(async () => {
      await this.stopUnlocked()
      return this.startUnlocked()
    })
  }

  status() {
    return Object.freeze({
      environmentVersion: this.environment?.manifest.version ?? null,
      components: this.running.map(({ component, child }) => ({
        id: component.id,
        type: component.type,
        pid: child?.pid ?? null,
      })),
    })
  }
}
