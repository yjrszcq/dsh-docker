import { lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { canonicalJson } from '../../lib/canonical-json.mjs'
import { deriveRecordId, parseBootstrapRecord, parseSlots } from '../../lib/deployment-contracts.mjs'
import { durableCreate, durableReplace } from '../../lib/atomic.mjs'
import { hashTree } from '../../lib/tree-hash.mjs'
import { TrustError } from '../../lib/validation.mjs'

async function readOptional(path) {
  try { return await readFile(path) } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

function tar(args, capture = false) {
  return new Promise((resolveTar, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout?.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolveTar(Buffer.concat(stdout).toString('utf8'))
      : reject(new Error(`Bootstrap archive failed: ${Buffer.concat(stderr).toString('utf8')}`)))
  })
}

function recordDocument(content) {
  return parseBootstrapRecord({ ...content, id: deriveRecordId('bootstrap-record', content) })
}

export class BootstrapManager {
  constructor({ stateRoot, storeRoot, seedRoot, inventory }) {
    this.stateRoot = resolve(stateRoot)
    this.storeRoot = resolve(storeRoot)
    this.seedRoot = resolve(seedRoot)
    this.inventory = inventory
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
    const record = parseBootstrapRecord(value)
    const bytes = canonicalJson(record)
    const path = this.recordPath(record.id)
    const existing = await readOptional(path)
    if (existing === undefined) await durableCreate(path, bytes)
    else if (!existing.equals(bytes)) throw new TrustError('Bootstrap Record ID identifies conflicting content')
    return record
  }

  async record(id) {
    const bytes = await readOptional(this.recordPath(id))
    if (bytes === undefined) throw new TrustError(`Bootstrap Record ${id} does not exist`)
    return parseBootstrapRecord(bytes)
  }

  async state() {
    const bytes = await readOptional(this.slotsPath)
    if (bytes === undefined) return Object.freeze({ generation: 0, current: null, previous: null })
    return parseSlots(bytes, 'bootstrap-record', 'Bootstrap slots')
  }

  async commit(current, previous) {
    const state = await this.state()
    if (current === previous) previous = null
    const slots = parseSlots({
      schema: 1,
      generation: state.generation + 1,
      current,
      previous,
    }, 'bootstrap-record', 'Bootstrap slots')
    await durableReplace(this.slotsPath, canonicalJson(slots))
    return slots
  }

  async reconcileImage(record) {
    return this.exclusive(async () => {
      const image = await this.writeRecord(record)
      const state = await this.state()
      if (state.current === null) return this.commit(image.id, null)
      const current = await this.record(state.current)
      if (current.targetSequence > image.targetSequence) return state
      if (current.targetSequence < image.targetSequence) return this.commit(image.id, state.current)
      if (current.version !== image.version || current.artifact.sha256 !== image.artifact.sha256) {
        throw new TrustError('Bootstrap image conflicts with current content at the same targetSequence')
      }
      if (current.id === image.id) return state
      return this.commit(image.id, state.current)
    })
  }

  async promote(recordId) {
    return this.exclusive(async () => {
      await this.record(recordId)
      const state = await this.state()
      if (state.current === recordId) return state
      return this.commit(recordId, state.current)
    })
  }

  async rollback() {
    return this.exclusive(async () => {
      const state = await this.state()
      if (state.previous === null) throw new TrustError('no previous Bootstrap exists')
      await this.record(state.previous)
      return this.commit(state.previous, state.current)
    })
  }

  async resolveRecord(recordId) {
    const record = await this.record(recordId)
    const reference = record.artifact
    let path
    if (reference.storage === 'image') {
      if (reference.imageBuildId !== this.inventory.imageBuildId) {
        throw new TrustError('Bootstrap Image Reference belongs to a different image')
      }
      if (reference.id !== this.inventory.bootstrap.id || reference.sha256 !== this.inventory.bootstrap.sha256) {
        throw new TrustError('Bootstrap Image Reference is absent from inventory')
      }
      path = join(this.seedRoot, 'bootstrap', reference.id)
    } else {
      path = join(this.storeRoot, reference.id)
    }
    const details = await lstat(path)
    if (!details.isDirectory() || details.isSymbolicLink()) throw new TrustError('resolved Bootstrap must be an immutable directory')
    if (await hashTree(path) !== reference.sha256) throw new TrustError('resolved Bootstrap content hash differs from its Record')
    return Object.freeze({ record, path })
  }

  async current() {
    const state = await this.state()
    if (state.current === null) throw new TrustError('no current Bootstrap exists')
    return this.resolveRecord(state.current)
  }

  async installArchive(archive, { version, targetSequence }) {
    const temporary = join(this.storeRoot, `.${randomUUID()}.tmp`)
    await mkdir(temporary, { recursive: true })
    try {
      const allowed = new Set(['platform', 'control-plane'])
      const entries = (await tar(['-tzf', archive], true)).split('\n').filter(Boolean)
      if (entries.length === 0 || entries.some(name => (
        name.startsWith('/') || name.split('/').includes('..') || !allowed.has(name.split('/')[0])
      ))) throw new TrustError('Bootstrap archive contains an unsafe path')
      await tar(['-xzf', archive, '--no-same-owner', '--no-same-permissions', '-C', temporary])
      await lstat(join(temporary, 'platform', 'bootstrap', 'index.mjs'))
      const sha256 = await hashTree(temporary)
      const artifactId = `bootstrap-${sha256}`
      const destination = join(this.storeRoot, artifactId)
      try {
        await rename(temporary, destination)
      } catch (error) {
        if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error
        if (await hashTree(destination) !== sha256) throw new TrustError('Bootstrap Store contains conflicting content')
      }
      return this.writeRecord(recordDocument({
        schema: 1,
        version,
        bootstrapApi: 1,
        targetSequence,
        artifact: { storage: 'store', kind: 'bootstrap', id: artifactId, sha256 },
      }))
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }

  async collectGarbage() {
    const state = await this.state()
    const retainedRecords = new Set([state.current, state.previous].filter(Boolean))
    const retainedAssets = new Set()
    let names
    try { names = await readdir(this.recordsRoot) } catch (error) {
      if (error?.code === 'ENOENT') return Object.freeze({ assets: [], records: [] })
      throw error
    }
    const records = []
    for (const name of names.filter(name => name.endsWith('.json')).sort()) {
      const record = parseBootstrapRecord(await readFile(join(this.recordsRoot, name)))
      records.push(record)
      if (retainedRecords.has(record.id) && record.artifact.storage === 'store') retainedAssets.add(record.artifact.id)
    }
    const removedAssets = []
    for (const name of await readdir(this.storeRoot).catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error))) {
      if (name.startsWith('.') || retainedAssets.has(name)) continue
      const path = join(this.storeRoot, name)
      const details = await lstat(path)
      if (!details.isDirectory() || details.isSymbolicLink()) continue
      await rm(path, { recursive: true, force: true })
      removedAssets.push(name)
    }
    const removedRecords = []
    for (const record of records) if (!retainedRecords.has(record.id)) {
      await rm(this.recordPath(record.id), { force: true })
      removedRecords.push(record.id)
    }
    return Object.freeze({ assets: removedAssets.sort(), records: removedRecords.sort() })
  }
}
