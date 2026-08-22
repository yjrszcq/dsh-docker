import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { request } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { artifactForReference, parseComponentManifest, parseEnvironmentManifest } from '../../lib/contracts.mjs'
import { exactKeys, parseJsonDocument, plainObject, TrustError } from '../../lib/validation.mjs'

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

function runCommand(spec, options, captureOutput = true) {
  return new Promise((resolveCommand, reject) => {
    const child = options.spawnImpl(spec.executable, spec.args, {
      env: options.environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (captureOutput) options.capture(child, options.componentId, options.logging)
    else {
      child.stdout?.resume()
      child.stderr?.resume()
    }
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
      : await runCommand(component.health.command, options, false).then(() => true, () => false)
    if (healthy) return
    await delay(component.health.intervalSeconds * 1000)
  }
  if (running?.child !== undefined && running.child.exitCode !== null) {
    throw new Error(`${component.id} exited before health check passed`)
  }
  throw new Error(`${component.id} health check timed out`)
}

function defaultCapture(child, componentId) {
  for (const [stream, source] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
    stream?.on('data', chunk => process.stdout.write(`[${componentId}:${source}] ${chunk.toString()}`))
  }
}

export class ComponentExitError extends Error {
  constructor(componentId, code, signal) {
    super(`${componentId} exited unexpectedly (code=${String(code)}, signal=${String(signal)})`)
    this.name = 'ComponentExitError'
    this.componentId = componentId
    this.exitCode = code
    this.signal = signal
  }
}

export async function loadEnvironment(root) {
  const environmentRoot = resolve(root)
  const manifest = parseEnvironmentManifest(await readFile(join(environmentRoot, 'environment.manifest.json')))
  const components = []
  for (const reference of manifest.components) {
    const artifact = artifactForReference(manifest, reference)
    const component = parseComponentManifest(await readFile(join(environmentRoot, 'artifacts', artifact.id)))
    if (component.id !== reference.id) {
      throw new Error(`component ${reference.id} differs from the Environment manifest`)
    }
    components.push(component)
  }
  return Object.freeze({ root: environmentRoot, manifest, components: Object.freeze(components) })
}

export async function loadControlPlane(root) {
  const controlPlaneRoot = resolve(root)
  const definition = parseJsonDocument(await readFile(join(controlPlaneRoot, 'definition.json')), 'control plane')
  exactKeys(definition, ['components', 'schema'], 'control plane')
  if (definition.schema !== 1) throw new TrustError('control plane schema must be 1')
  if (!Array.isArray(definition.components) || definition.components.length === 0) {
    throw new TrustError('control plane components must be a non-empty array')
  }
  const components = []
  const ids = new Set()
  for (const [index, value] of definition.components.entries()) {
    const reference = plainObject(value, `control plane components[${String(index)}]`)
    exactKeys(reference, ['id', 'source'], `control plane components[${String(index)}]`)
    if (typeof reference.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(reference.id)) {
      throw new TrustError('control plane component ID is invalid')
    }
    if (ids.has(reference.id)) throw new TrustError('control plane component IDs must be unique')
    if (typeof reference.source !== 'string' || reference.source.startsWith('/')) {
      throw new TrustError('control plane component source is invalid')
    }
    const source = resolve(controlPlaneRoot, reference.source)
    if (source === controlPlaneRoot || !source.startsWith(`${controlPlaneRoot}/`)) {
      throw new TrustError('control plane component source escapes its root')
    }
    const component = parseComponentManifest(await readFile(source))
    if (component.id !== reference.id) throw new TrustError(`control plane component ${reference.id} differs from its manifest`)
    ids.add(reference.id)
    components.push(component)
  }
  return Object.freeze({
    root: controlPlaneRoot,
    manifest: Object.freeze({ version: null }),
    components: Object.freeze(components),
  })
}

export class EnvironmentRunner {
  constructor({ environmentRoot, spawnImpl = spawn, capture = defaultCapture, loader = loadEnvironment, report = () => {} }) {
    this.environmentRoot = environmentRoot
    this.spawnImpl = spawnImpl
    this.capture = capture
    this.loader = loader
    this.report = report
    this.running = []
    this.environment = undefined
    this.operation = Promise.resolve()
    this.stopping = false
    this.fatalListeners = new Set()
    this.fatal = new Promise(resolveFatal => { this.resolveFatal = resolveFatal })
  }

  onFatal(listener) {
    this.fatalListeners.add(listener)
    return () => this.fatalListeners.delete(listener)
  }

  emitFatal(error) {
    this.resolveFatal(error)
    for (const listener of this.fatalListeners) {
      try { listener(error) } catch {}
    }
  }

  emitLifecycle(message, fields = {}) {
    void Promise.resolve().then(() => this.report(message, fields)).catch(() => {})
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
      logging: component.logging,
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
    this.environment = await this.loader(this.environmentRoot)
    try {
      for (const component of this.environment.components) await this.phase(component, 'prepare')
      for (const component of this.environment.components) {
        await this.startComponentUnlocked(component)
      }
      return this.status()
    } catch (error) {
      try {
        await this.stopUnlocked()
      } catch (cleanupError) {
        this.emitLifecycle('environment.cleanup.failed', {
          error: cleanupError,
          level: 'warning',
          originalError: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    }
  }

  async startComponentUnlocked(component, prepare = false) {
    if (this.running.some(running => running.component.id === component.id)) {
      throw new Error(`component ${component.id} is already running`)
    }
    const startedAt = Date.now()
    this.emitLifecycle('component.starting', { componentId: component.id, componentType: component.type })
    let running
    try {
      if (prepare) await this.phase(component, 'prepare')
      await this.phase(component, 'preStart')
      if (component.type === 'service') {
        const options = this.commandOptions(component)
        const child = this.spawnImpl(component.command.executable, component.command.args, {
          env: options.environment,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        this.capture(child, component.id, component.logging)
        await Promise.race([
          once(child, 'spawn'),
          once(child, 'error').then(([error]) => { throw error }),
        ])
        running = { component, child, ready: false }
        this.emitLifecycle('component.spawned', { componentId: component.id, pid: child.pid ?? null })
        child.once('exit', (code, signal) => {
          if (running.ready && !this.stopping && this.running.includes(running)) {
            const error = new ComponentExitError(component.id, code, signal)
            this.emitLifecycle('component.exited', {
              componentId: component.id,
              code,
              signal,
              error: error.message,
              level: 'error',
            })
            this.emitFatal(error)
          }
        })
      } else {
        await runCommand(component.command, this.commandOptions(component))
        running = { component, child: undefined }
      }
      this.running.push(running)
      this.running.sort((left, right) => (
        this.environment.components.indexOf(left.component) - this.environment.components.indexOf(right.component)
      ))
      await waitForHealth(component, running, this.commandOptions(component))
      await this.phase(component, 'postStart')
      if (running.child !== undefined && running.child.exitCode !== null) {
        throw new Error(`${component.id} exited before startup completed`)
      }
      running.ready = true
      this.emitLifecycle('component.ready', { componentId: component.id, elapsedMs: Date.now() - startedAt })
      return running
    } catch (error) {
      this.emitLifecycle('component.start.failed', {
        componentId: component.id,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        level: 'error',
      })
      if (running !== undefined) {
        try {
          await this.stopComponentUnlocked(running)
        } catch (cleanupError) {
          this.emitLifecycle('component.cleanup.failed', {
            componentId: component.id,
            error: cleanupError,
            level: 'warning',
            originalError: error instanceof Error ? error.message : String(error),
          })
        }
      }
      throw error
    }
  }

  async stopComponentUnlocked(running) {
    const { component, child } = running
    const failures = []
    this.emitLifecycle('component.stopping', { componentId: component.id, pid: child?.pid ?? null })
    this.running = this.running.filter(value => value !== running)
    for (const phase of ['preStop', 'stop']) {
      try { await this.phase(component, phase) } catch (error) { failures.push(error) }
    }
    if (child !== undefined) {
      try { await terminate(child) } catch (error) { failures.push(error) }
    }
    try { await this.phase(component, 'postStop') } catch (error) { failures.push(error) }
    if (failures.length > 0) {
      this.emitLifecycle('component.stop.failed', {
        componentId: component.id,
        errors: failures.map(error => error instanceof Error ? error.message : String(error)),
        level: 'error',
      })
      throw new AggregateError(failures, `component ${component.id} shutdown failed`)
    }
    this.emitLifecycle('component.stopped', { componentId: component.id })
  }

  stop() {
    return this.serialized(() => this.stopUnlocked())
  }

  async stopUnlocked() {
    this.stopping = true
    const failures = []
    for (const running of [...this.running].reverse()) {
      try { await this.stopComponentUnlocked(running) } catch (error) { failures.push(error) }
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

  suspend(componentId) {
    return this.serialized(async () => {
      const running = this.running.find(value => value.component.id === componentId)
      if (running === undefined) throw new Error(`component ${componentId} is not running`)
      if (running.component.type !== 'service') throw new Error(`component ${componentId} is not a service`)
      await this.stopComponentUnlocked(running)
      return this.status()
    })
  }

  pause(componentId, { allowMissing = false } = {}) {
    return this.serialized(async () => {
      const running = this.running.find(value => value.component.id === componentId)
      const component = running?.component ?? this.environment?.components.find(value => value.id === componentId)
      if (component === undefined) {
        if (allowMissing) return this.status()
        throw new Error(`component ${componentId} does not exist`)
      }
      if (component.type !== 'service') throw new Error(`component ${componentId} is not a service`)
      if (running === undefined) return this.status()
      await this.stopComponentUnlocked(running)
      return this.status()
    })
  }

  resume(componentId) {
    return this.serialized(async () => {
      if (this.environment === undefined) throw new Error('Environment is not loaded')
      const component = this.environment.components.find(value => value.id === componentId)
      if (component === undefined) throw new Error(`component ${componentId} does not exist`)
      if (this.running.some(value => value.component.id === componentId)) return this.status()
      await this.startComponentUnlocked(component, true)
      return this.status()
    })
  }

  restart(componentId, { beforeStart, recoverStart = false, onStartFailure } = {}) {
    return this.serialized(async () => {
      if (this.environment === undefined) this.environment = await this.loader(this.environmentRoot)
      const running = this.running.find(value => value.component.id === componentId)
      const component = running?.component
        ?? this.environment.components.find(value => value.id === componentId)
      if (component === undefined) throw new Error(`component ${componentId} does not exist`)
      if (component.type !== 'service') throw new Error(`component ${componentId} is not a service`)
      if (running !== undefined) await this.stopComponentUnlocked(running)
      try {
        await beforeStart?.()
        await this.startComponentUnlocked(component, true)
        return this.status()
      } catch (error) {
        const failures = [error]
        try { await onStartFailure?.(error) } catch (recoveryError) { failures.push(recoveryError) }
        if (recoverStart && failures.length === 1) {
          try { await this.startComponentUnlocked(component, true) } catch (recoveryError) { failures.push(recoveryError) }
        }
        if (failures.length > 1) throw new AggregateError(failures, `component ${componentId} restart recovery failed`)
        throw error
      }
    })
  }

  health() {
    return this.serialized(async () => {
      const components = await Promise.all((this.environment?.components ?? []).map(async component => {
        const running = this.running.find(value => value.component.id === component.id)
        if (running === undefined) return { id: component.id, running: false, healthy: false }
        const healthy = component.health === null
          ? running.child === undefined || running.child.exitCode === null
          : component.health.type === 'http'
            ? await probeHttp(component.health)
            : await runCommand(component.health.command, this.commandOptions(component), false).then(() => true, () => false)
        return { id: component.id, running: true, healthy }
      }))
      return { healthy: components.length > 0 && components.every(component => component.healthy), components }
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
