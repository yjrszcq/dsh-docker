import { lstat, mkdir, readFile, rename, rm, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { canonicalJson } from '../../lib/canonical-json.mjs'
import {
  parseDeploymentRecord,
  parseSlots,
} from '../../lib/deployment-contracts.mjs'
import { durableCreate, durableReplace } from '../../lib/atomic.mjs'
import { replaceDeploymentView } from '../../lib/paths.mjs'
import { hashTree } from '../../lib/tree-hash.mjs'
import { TrustError } from '../../lib/validation.mjs'

const KINDS = Object.freeze(['environment', 'pristine', 'runtime', 'system-plugins'])

async function readOptional(path) {
  try { return await readFile(path) } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

export class DeploymentManager {
  constructor({ paths, seedRoot, inventory }) {
    this.paths = paths
    this.seedRoot = resolve(seedRoot)
    this.inventory = inventory
    this.stateRoot = paths.deploymentStateRoot
    this.recordsRoot = join(this.stateRoot, 'records')
    this.slotsPath = join(this.stateRoot, 'slots.json')
    this.queue = Promise.resolve()
  }

  exclusive(operation) {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  recordPath(id) {
    return join(this.recordsRoot, `${id}.json`)
  }

  async writeRecord(value) {
    const record = parseDeploymentRecord(value)
    const bytes = canonicalJson(record)
    const path = this.recordPath(record.id)
    const existing = await readOptional(path)
    if (existing === undefined) await durableCreate(path, bytes)
    else if (!existing.equals(bytes)) throw new TrustError('Deployment Record ID identifies conflicting content')
    return record
  }

  async record(id) {
    const bytes = await readOptional(this.recordPath(id))
    if (bytes === undefined) throw new TrustError(`Deployment Record ${id} does not exist`)
    return parseDeploymentRecord(bytes)
  }

  async state() {
    const bytes = await readOptional(this.slotsPath)
    if (bytes === undefined) return Object.freeze({ generation: 0, current: null, previous: null })
    return parseSlots(bytes, 'deployment-record', 'Deployment slots')
  }

  async commit(current, previous) {
    const state = await this.state()
    if (current === previous) previous = null
    const slots = parseSlots({
      schema: 1,
      generation: state.generation + 1,
      current,
      previous,
    }, 'deployment-record', 'Deployment slots')
    await durableReplace(this.slotsPath, canonicalJson(slots))
    return slots
  }

  imageAsset(reference) {
    if (reference.imageBuildId !== this.inventory.imageBuildId) {
      throw new TrustError('Deployment Image Reference belongs to a different image')
    }
    const expected = reference.kind === 'system-plugins'
      ? this.inventory.deployment.systemPlugins
      : this.inventory.deployment[reference.kind]
    if (expected === undefined || reference.id !== expected.id || reference.sha256 !== expected.sha256) {
      throw new TrustError(`Deployment Image Reference for ${reference.kind} is absent from inventory`)
    }
    const roots = {
      environment: 'environments',
      pristine: 'pristine',
      runtime: 'runtimes',
      'system-plugins': 'system-plugins',
    }
    return join(this.seedRoot, roots[reference.kind], reference.id)
  }

  storeAsset(reference) {
    const roots = {
      environment: this.paths.environmentsRoot,
      pristine: this.paths.pristineRoot,
      runtime: this.paths.runtimesRoot,
      'system-plugins': this.paths.systemPluginsRoot,
    }
    return join(roots[reference.kind], reference.id)
  }

  async resolveReference(reference) {
    const path = reference.storage === 'image' ? this.imageAsset(reference) : this.storeAsset(reference)
    const details = await lstat(path)
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new TrustError(`resolved ${reference.kind} must be an immutable directory`)
    }
    // Image bytes are bound to the signed inventory during image assembly. Rehashing a large
    // Runtime on every boot would defeat zero-copy startup; managed objects are checked here.
    if (reference.storage === 'store' && await hashTree(path) !== reference.sha256) {
      throw new TrustError(`resolved ${reference.kind} content hash differs from its Record`)
    }
    return path
  }

  async resolveRecord(recordId) {
    const record = await this.record(recordId)
    const entries = await Promise.all(KINDS.map(async kind => [kind, await this.resolveReference(record[kind === 'system-plugins' ? 'systemPlugins' : kind])]))
    return Object.freeze({ record, paths: Object.freeze(Object.fromEntries(entries)) })
  }

  async prepareView(recordId) {
    const resolved = await this.resolveRecord(recordId)
    const destination = join(this.paths.deploymentViewsRoot, recordId)
    const temporary = join(this.paths.deploymentViewsRoot, `.${recordId}.${randomUUID()}.tmp`)
    await mkdir(temporary, { recursive: false })
    try {
      for (const kind of KINDS) await symlink(resolved.paths[kind], join(temporary, kind), 'dir')
      try {
        await rename(temporary, destination)
      } catch (error) {
        if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error
      }
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
    return Object.freeze({ ...resolved, view: destination })
  }

  async select(recordId) {
    const candidate = await this.prepareView(recordId)
    await replaceDeploymentView(this.paths, candidate.view)
    return candidate
  }

  async initialize(record) {
    return this.exclusive(async () => {
      const image = await this.writeRecord(record)
      const state = await this.state()
      if (state.current === null) await this.commit(image.id, null)
      const selected = await this.state()
      await this.select(selected.current)
      return selected
    })
  }

  async activate(recordId, healthCheck) {
    return this.exclusive(async () => {
      await this.record(recordId)
      const state = await this.state()
      if (state.current === recordId) {
        await this.select(recordId)
        return state
      }
      await this.select(recordId)
      try {
        await healthCheck()
      } catch (error) {
        if (state.current !== null) {
          await this.select(state.current)
          await healthCheck().catch(() => {})
        }
        throw error
      }
      return this.commit(recordId, state.current)
    })
  }

  async rollback(healthCheck) {
    return this.exclusive(async () => {
      const state = await this.state()
      if (state.previous === null) throw new TrustError('no previous Deployment exists')
      await this.select(state.previous)
      try {
        await healthCheck()
      } catch (error) {
        await this.select(state.current)
        await healthCheck().catch(() => {})
        throw error
      }
      return this.commit(state.previous, state.current)
    })
  }
}
