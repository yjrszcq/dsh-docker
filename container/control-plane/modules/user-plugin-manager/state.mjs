import { open, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { canonicalJson } from '../../../platform/lib/canonical-json.mjs'
import { durableReplace } from '../../../platform/lib/atomic.mjs'
import { userPluginInternals } from './index.mjs'

function parse(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'disabled,schema'
    || value.schema !== 1 || !Array.isArray(value.disabled)) {
    throw new Error('User Plugin selection state is invalid')
  }
  const names = new Set()
  const disabled = value.disabled.map(entry => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).some(key => !['index', 'name'].includes(key))
      || !userPluginInternals.PACKAGE_NAME_PATTERN.test(entry.name)
      || !Number.isSafeInteger(entry.index) || entry.index < 0 || names.has(entry.name)) {
      throw new Error('User Plugin disabled-order entry is invalid')
    }
    names.add(entry.name)
    return Object.freeze({ name: entry.name, index: entry.index })
  })
  return Object.freeze({ schema: 1, disabled: Object.freeze(disabled) })
}

export class UserPluginSelectionStore {
  constructor(path) {
    this.path = path
  }

  async read() {
    return (await this.snapshot()).state
  }

  async snapshot() {
    try {
      return Object.freeze({ present: true, state: parse(JSON.parse(await readFile(this.path, 'utf8'))) })
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return Object.freeze({ present: false, state: parse({ schema: 1, disabled: [] }) })
      }
      throw error
    }
  }

  async write(value) {
    const state = parse(value)
    await durableReplace(this.path, `${canonicalJson(state).toString('utf8')}\n`)
    return state
  }

  async restore(snapshot) {
    if (snapshot === null || typeof snapshot !== 'object' || typeof snapshot.present !== 'boolean') {
      throw new Error('User Plugin selection snapshot is invalid')
    }
    if (snapshot.present) return this.write(snapshot.state)
    await rm(this.path, { force: true })
    const directory = await open(dirname(this.path), 'r').catch(error => error?.code === 'ENOENT' ? undefined : Promise.reject(error))
    if (directory !== undefined) {
      try { await directory.sync() } finally { await directory.close() }
    }
    return parse({ schema: 1, disabled: [] })
  }
}

export const userPluginStateInternals = Object.freeze({ parse })
