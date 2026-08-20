import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { canonicalJson } from '../../../platform/lib/canonical-json.mjs'
import { durableReplace } from '../../../platform/lib/atomic.mjs'
import { userPluginInternals } from './index.mjs'

function runDshPlugin({ dshHome, profile, name }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('/usr/local/bin/dsh', ['plugin', '--profile', profile, 'remove', name], {
      env: { ...process.env, DSH_HOME: dshHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    let size = 0
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      size += chunk.byteLength
      if (size <= 256 * 1024) (stream === child.stdout ? stdout : stderr).push(chunk)
    })
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolveRun()
      : reject(new Error(`dsh plugin remove failed for ${name}: ${Buffer.concat(stderr).toString('utf8').trim()}`)))
  })
}

function message(error) {
  return error instanceof Error ? error.message : String(error)
}

function validateActions(inventory, actions) {
  if (!Array.isArray(actions) || actions.length === 0 || actions.length > 128) {
    throw new Error('User Plugin actions must be a non-empty bounded array')
  }
  const plugins = new Map(inventory.plugins.map(plugin => [plugin.name, plugin]))
  const names = new Set()
  return Object.freeze(actions.map(value => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'action,name'
      || !userPluginInternals.PACKAGE_NAME_PATTERN.test(value.name)
      || !['enable', 'disable', 'uninstall'].includes(value.action)
      || names.has(value.name)) {
      throw new Error('User Plugin action is invalid')
    }
    names.add(value.name)
    const plugin = plugins.get(value.name)
    if (plugin === undefined) throw new Error(`User Plugin ${value.name} is not managed by the Web Profile`)
    if (value.action === 'enable' && (plugin.damaged || plugin.reservedNameConflict)) {
      throw new Error(`User Plugin ${value.name} cannot be enabled`)
    }
    return Object.freeze({ name: value.name, action: value.action })
  }))
}

async function mutateProfile({ inventory, selectionStore, actions, runPlugin }) {
  const manifestPath = join(inventory.profileRoot, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const bundles = [...(manifest.dsh?.profile?.bundles ?? [])]
  const selection = await selectionStore.read()
  const disabled = new Map(selection.disabled.map(entry => [entry.name, entry.index]))
  for (const { name, action } of actions) {
    if (action === 'disable') {
      const index = bundles.indexOf(name)
      if (index !== -1) {
        disabled.set(name, index)
        for (let found = bundles.indexOf(name); found !== -1; found = bundles.indexOf(name)) bundles.splice(found, 1)
      }
    } else if (action === 'enable') {
      if (!bundles.includes(name)) bundles.splice(Math.min(disabled.get(name) ?? bundles.length, bundles.length), 0, name)
      disabled.delete(name)
    }
  }
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
  await durableReplace(manifestPath, `${canonicalJson(manifest).toString('utf8')}\n`)
  for (const { name, action } of actions) {
    if (action === 'uninstall') {
      await runPlugin({ dshHome: join(inventory.profileRoot, '..', '..'), profile: inventory.profile, name })
      disabled.delete(name)
    }
  }
  await selectionStore.write({
    schema: 1,
    disabled: [...disabled].map(([name, index]) => ({ name, index })),
  })
  const resulting = await inventory.read()
  const result = new Map(resulting.plugins.map(plugin => [plugin.name, plugin]))
  for (const { name, action } of actions) {
    if (action === 'uninstall' && result.has(name)) throw new Error(`User Plugin ${name} remains installed`)
    if (action === 'enable' && result.get(name)?.enabled !== true) throw new Error(`User Plugin ${name} was not enabled`)
    if (action === 'disable' && result.get(name)?.enabled !== false) throw new Error(`User Plugin ${name} was not disabled`)
  }
  return resulting
}

export class UserPluginTransactionManager {
  constructor({ inventory, selectionStore, snapshots, journal, pauseDsh, restartDsh, runPlugin = runDshPlugin, report = async () => {} }) {
    this.inventory = inventory
    this.selectionStore = selectionStore
    this.snapshots = snapshots
    this.journal = journal
    this.pauseDsh = pauseDsh
    this.restartDsh = restartDsh
    this.runPlugin = runPlugin
    this.report = report
  }

  record(messageValue, fields = {}) {
    return Promise.resolve().then(() => this.report(messageValue, fields)).catch(() => {})
  }

  async apply({ taskId = randomUUID(), revision, actions }) {
    const current = await this.inventory.read()
    if (revision !== current.revision) {
      const error = new Error('User Plugin inventory revision has changed')
      error.code = 'REVISION_CONFLICT'
      throw error
    }
    const normalized = validateActions(current, actions)
    const selectionBefore = await this.selectionStore.snapshot()
    let state = await this.journal.begin({ taskId, revision, actions: normalized, selection: selectionBefore })
    let paused = false
    let snapshotCreated = false
    await this.record('user-plugin.transaction.started', { taskId, actions: normalized })
    try {
      await this.pauseDsh()
      paused = true
      state = await this.journal.transition('paused')
      await this.snapshots.create(taskId)
      snapshotCreated = true
      state = await this.journal.transition('snapshotted', { snapshotId: taskId })
      state = await this.journal.transition('mutating')
      const result = await mutateProfile({
        inventory: this.inventory,
        selectionStore: this.selectionStore,
        actions: normalized,
        runPlugin: this.runPlugin,
      })
      state = await this.journal.transition('committed')
      state = await this.journal.transition('restarting')
      await this.restartDsh()
      state = await this.journal.transition('completed')
      await this.snapshots.remove(taskId).catch(error => this.record('user-plugin.snapshot.cleanup.failed', { taskId, error }))
      await this.record('user-plugin.transaction.completed', { taskId })
      return Object.freeze({ taskId, status: 'success', inventory: result })
    } catch (error) {
      const committed = ['committed', 'restarting'].includes(state.phase)
      if (committed) {
        await this.journal.transition('failed', { error: message(error) })
        await this.snapshots.remove(taskId).catch(cleanupError => this.record('user-plugin.snapshot.cleanup.failed', { taskId, error: cleanupError }))
      } else if (snapshotCreated || state.snapshotId !== null) {
        const snapshotId = state.snapshotId ?? taskId
        try {
          if (state.phase !== 'restoring') state = await this.journal.transition('restoring', {
            error: message(error),
            snapshotId,
          })
          await this.snapshots.restore(snapshotId)
          await this.selectionStore.restore(selectionBefore)
          await this.restartDsh()
          await this.journal.transition('failed', { recoveryResult: 'success' })
          await this.snapshots.remove(snapshotId)
        } catch (recoveryError) {
          await this.journal.transition('failed', {
            error: `${message(error)}; recovery failed: ${message(recoveryError)}`,
            recoveryResult: 'failed',
          }).catch(() => {})
          throw new AggregateError([error, recoveryError], 'User Plugin transaction and recovery failed')
        }
      } else if (paused) {
        try {
          await this.restartDsh()
          await this.journal.transition('failed', { error: message(error), recoveryResult: 'success' })
        } catch (recoveryError) {
          await this.journal.transition('failed', {
            error: `${message(error)}; recovery failed: ${message(recoveryError)}`,
            recoveryResult: 'failed',
          }).catch(() => {})
          throw new AggregateError([error, recoveryError], 'User Plugin transaction and recovery failed')
        }
      } else {
        await this.journal.transition('failed', { error: message(error) }).catch(() => {})
      }
      await this.record('user-plugin.transaction.failed', { taskId, error, committed })
      throw error
    }
  }

  async recover() {
    const state = await this.journal.read()
    if (state === undefined) return undefined
    if (['completed', 'failed'].includes(state.phase)) {
      if (state.snapshotId !== null) await this.snapshots.remove(state.snapshotId)
      return state
    }
    if (['committed', 'restarting'].includes(state.phase)) {
      try {
        if (state.phase === 'committed') await this.journal.transition('restarting')
        await this.restartDsh()
        const completed = await this.journal.transition('completed')
        if (state.snapshotId !== null) await this.snapshots.remove(state.snapshotId)
        return completed
      } catch (error) {
        const failed = await this.journal.transition('failed', { error: message(error) })
        if (state.snapshotId !== null) {
          await this.snapshots.remove(state.snapshotId).catch(cleanupError => this.record('user-plugin.snapshot.cleanup.failed', {
            taskId: state.taskId,
            error: cleanupError,
          }))
        }
        return failed
      }
    }
    if (state.phase === 'validated') return this.journal.transition('failed', { error: 'transaction interrupted before DSH pause' })
    if (state.phase === 'paused') {
      try {
        await this.restartDsh()
        return this.journal.transition('failed', { error: 'transaction interrupted before snapshot', recoveryResult: 'success' })
      } catch (error) {
        return this.journal.transition('failed', { error: message(error), recoveryResult: 'failed' })
      }
    }
    try {
      const restoring = state.phase === 'restoring' ? state : await this.journal.transition('restoring', {
        error: state.error ?? 'transaction interrupted before commit',
      })
      await this.snapshots.restore(restoring.snapshotId)
      await this.selectionStore.restore({
        present: restoring.selectionPresent,
        state: { schema: 1, disabled: restoring.previousDisabled },
      })
      await this.restartDsh()
      const failed = await this.journal.transition('failed', { recoveryResult: 'success' })
      await this.snapshots.remove(restoring.snapshotId)
      return failed
    } catch (error) {
      return this.journal.transition('failed', { error: message(error), recoveryResult: 'failed' })
    }
  }
}

export const userPluginTransactionInternals = Object.freeze({ mutateProfile, validateActions })
