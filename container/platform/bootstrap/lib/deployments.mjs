import { cp, lstat, mkdir, readFile, rename, rm, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { canonicalJson } from '../../lib/canonical-json.mjs'
import {
  deriveRecordId,
  parseDeploymentRecord,
  parseSlots,
} from '../../lib/deployment-contracts.mjs'
import { durableCreate, durableReplace } from '../../lib/atomic.mjs'
import { writeDeploymentStatus } from '../../lib/deployment-status.mjs'
import { replaceDeploymentView } from '../../lib/paths.mjs'
import { hashTree } from '../../lib/tree-hash.mjs'
import { compareDshVersions } from '../../lib/supported-target.mjs'
import { TrustError } from '../../lib/validation.mjs'

const KINDS = Object.freeze(['environment', 'pristine', 'runtime', 'system-plugins'])

function sameDeployment(left, right) {
  return left.dshVersion === right.dshVersion
    && left.environmentVersion === right.environmentVersion
    && KINDS.every(kind => {
      const field = kind === 'system-plugins' ? 'systemPlugins' : kind
      return left[field].sha256 === right[field].sha256
    })
}

async function readOptional(path) {
  try { return await readFile(path) } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

async function exists(path) {
  return lstat(path).then(() => true, error => error?.code === 'ENOENT' ? false : Promise.reject(error))
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
    const plan = await this.prepareImage(record)
    return this.acceptImage(plan)
  }

  async prepareImage(record) {
    return this.exclusive(async () => {
      const image = await this.writeRecord(record)
      const state = await this.state()
      if (state.current === null) {
        await this.select(image.id)
        return Object.freeze({
          baseGeneration: 0,
          target: image.id,
          fallback: null,
          action: 'initialize',
          imageBehindCurrent: false,
          requiresExperimentalRebuild: false,
        })
      }

      const current = await this.record(state.current)
      let target = current.id
      let action = 'retain'
      let imageBehindCurrent = false
      let requiresExperimentalRebuild = false

      if (current.authority === 'experimental') {
        const dshCaughtUp = compareDshVersions(image.dshVersion, current.dshVersion) >= 0
        if (image.targetSequence >= current.targetSequence && dshCaughtUp) {
          target = image.id
          action = 'stable-caught-up'
        } else {
          imageBehindCurrent = image.targetSequence < current.targetSequence
          requiresExperimentalRebuild = image.targetSequence > current.targetSequence && !dshCaughtUp
        }
      } else if (image.targetSequence > current.targetSequence) {
        target = image.id
        action = 'image-forward'
      } else if (image.targetSequence < current.targetSequence) {
        imageBehindCurrent = true
      } else if (!sameDeployment(current, image)) {
        throw new TrustError('Deployment image conflicts with current content at the same targetSequence')
      } else if (current.id !== image.id) {
        target = image.id
        action = 'prefer-image'
      }

      await this.select(target)
      return Object.freeze({
        baseGeneration: state.generation,
        target,
        fallback: target === current.id ? null : current.id,
        action,
        imageBehindCurrent,
        requiresExperimentalRebuild,
      })
    })
  }

  async acceptImage(plan) {
    return this.exclusive(async () => {
      const state = await this.state()
      if (state.generation !== plan.baseGeneration) throw new TrustError('Deployment slots changed during image startup')
      if (state.current === plan.target) return state
      return this.commit(plan.target, state.current)
    })
  }

  async rejectImage(plan) {
    return this.exclusive(async () => {
      const state = await this.state()
      if (state.generation !== plan.baseGeneration) throw new TrustError('Deployment slots changed during image startup')
      if (plan.fallback === null) return false
      await this.select(plan.fallback)
      return true
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

  async materializeRecord(recordId) {
    const record = await this.record(recordId)
    const fields = {
      environment: 'environment',
      pristine: 'pristine',
      runtime: 'runtime',
      systemPlugins: 'system-plugins',
    }
    const references = {}
    for (const [field, kind] of Object.entries(fields)) {
      const reference = record[field]
      if (reference.storage === 'store') {
        references[field] = reference
        continue
      }
      const source = await this.resolveReference(reference)
      const id = `image-${kind}-${reference.sha256}`
      const destination = this.storeAsset({ kind, id })
      if (!await exists(destination)) {
        const temporary = `${destination}.${randomUUID()}.tmp`
        try {
          await cp(source, temporary, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true })
          if (await hashTree(temporary) !== reference.sha256) throw new TrustError(`materialized ${kind} differs from Image Reference`)
          await rename(temporary, destination)
        } finally {
          await rm(temporary, { recursive: true, force: true })
        }
      } else if (await hashTree(destination) !== reference.sha256) {
        throw new TrustError(`materialized ${kind} conflicts with Managed Store`)
      }
      references[field] = { storage: 'store', kind, id, sha256: reference.sha256 }
    }
    const content = {
      schema: 1,
      authority: record.authority,
      targetSequence: record.targetSequence,
      dshVersion: record.dshVersion,
      environmentVersion: record.environmentVersion,
      ...references,
      receiptTokens: [...record.receiptTokens],
      snapshotId: record.snapshotId,
    }
    return this.writeRecord({ ...content, id: deriveRecordId('deployment-record', content) })
  }

  async materializeCurrent() {
    return this.exclusive(async () => {
      const state = await this.state()
      if (state.current === null) throw new TrustError('no current Deployment exists')
      const current = await this.record(state.current)
      const references = [current.environment, current.pristine, current.runtime, current.systemPlugins]
      if (references.every(reference => reference.storage === 'store')) return current
      const materialized = await this.materializeRecord(current.id)
      await this.select(materialized.id)
      await this.commit(materialized.id, state.previous)
      return materialized
    })
  }

  describe(record) {
    const references = [record.environment, record.pristine, record.runtime, record.systemPlugins]
    return Object.freeze({
      recordId: record.id,
      source: references.every(reference => reference.storage === 'image') ? 'image' : 'managed',
      authority: record.authority,
      targetSequence: record.targetSequence,
      dsh: record.dshVersion,
      environment: record.environmentVersion,
    })
  }

  async publishStatus({ plan = null, recoveryMode = null, currentId } = {}) {
    const state = await this.state().catch(() => ({ current: null }))
    const selectedId = currentId === undefined ? state.current : currentId
    const current = selectedId === null
      ? null
      : await this.record(selectedId).then(record => this.describe(record), () => null)
    const value = Object.freeze({
      platformLayout: 1,
      imageBaseline: Object.freeze({
        imageBuildId: this.inventory.imageBuildId,
        targetSequence: this.inventory.targetSequence,
        dsh: this.inventory.deployment.dshVersion,
        environment: this.inventory.deployment.environmentVersion,
      }),
      current,
      imageBehindCurrent: plan?.imageBehindCurrent ?? false,
      recoveryMode,
    })
    return writeDeploymentStatus(this.paths.deploymentStatusPath, value)
  }
}
