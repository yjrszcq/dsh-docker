import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { canonicalJson } from '../../../platform/lib/canonical-json.mjs'
import { durableReplace } from '../../../platform/lib/atomic.mjs'
import { userPluginInternals } from './index.mjs'

function pluginEnvironment(dshHome, home = userInfo().homedir) {
  return {
    ...process.env,
    HOME: home,
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    DSH_HOME: dshHome,
  }
}

function runDshPlugin({ dshHome, profile, name }, timeoutMs = 300_000) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('/usr/local/bin/dsh', ['plugin', '--profile', profile, 'remove', name], {
      env: pluginEnvironment(dshHome),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    let size = 0
    let settled = false
    let timeoutError
    let killTimer
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(killTimer)
      if (error === undefined) resolveRun()
      else reject(error)
    }
    const timer = setTimeout(() => {
      timeoutError = new Error(`dsh plugin remove timed out for ${name}`)
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
      killTimer.unref()
    }, timeoutMs)
    timer.unref()
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      size += chunk.byteLength
      if (size <= 256 * 1024) (stream === child.stdout ? stdout : stderr).push(chunk)
    })
    child.once('error', finish)
    child.once('exit', code => timeoutError !== undefined
      ? finish(timeoutError)
      : code === 0
        ? finish()
        : finish(new Error(`dsh plugin remove failed for ${name}: ${[
          ['stdout', Buffer.concat(stdout).toString('utf8').trim()],
          ['stderr', Buffer.concat(stderr).toString('utf8').trim()],
        ].filter(([, value]) => value !== '').map(([stream, value]) => `${stream}: ${value}`).join('\\n')}`)))
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
  const originalBundles = [...bundles]
  const selection = await selectionStore.read()
  const disabled = new Map(selection.disabled.map(entry => [entry.name, entry.index]))
  for (const { name, action } of actions) {
    if (action === 'disable') {
      const index = bundles.indexOf(name)
      if (index !== -1) {
        disabled.set(name, originalBundles.indexOf(name))
        for (let found = bundles.indexOf(name); found !== -1; found = bundles.indexOf(name)) bundles.splice(found, 1)
      }
    } else if (action === 'enable') {
      if (!bundles.includes(name)) bundles.splice(Math.min(disabled.get(name) ?? bundles.length, bundles.length), 0, name)
      disabled.delete(name)
    } else if (action === 'uninstall') {
      for (let found = bundles.indexOf(name); found !== -1; found = bundles.indexOf(name)) bundles.splice(found, 1)
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
  if (actions.some(({ action }) => action === 'uninstall')) {
    const installedManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    installedManifest.dsh = {
      ...installedManifest.dsh,
      profile: { ...installedManifest.dsh?.profile, bundles },
    }
    await durableReplace(manifestPath, `${canonicalJson(installedManifest).toString('utf8')}\n`)
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

  async validate({ revision, actions }) {
    const current = await this.inventory.read()
    if (revision !== current.revision) {
      const error = new Error('User Plugin inventory revision has changed')
      error.code = 'REVISION_CONFLICT'
      throw error
    }
    return Object.freeze({ revision, actions: validateActions(current, actions) })
  }

  async apply({ taskId = randomUUID(), revision, actions, onProgress = () => {} }) {
    const validated = await this.validate({ revision, actions })
    const normalized = validated.actions
    const publishProgress = state => { try { onProgress(state) } catch {} }
    const selectionBefore = await this.selectionStore.snapshot()
    let state = await this.journal.begin({ taskId, revision, actions: normalized, selection: selectionBefore })
    publishProgress(state)
    let paused = false
    let snapshotCreated = false
    await this.record('user-plugin.transaction.started', { taskId, actions: normalized })
    try {
      await this.pauseDsh()
      paused = true
      state = await this.journal.transition('paused')
      publishProgress(state)
      await this.snapshots.create(taskId)
      snapshotCreated = true
      state = await this.journal.transition('snapshotted', { snapshotId: taskId })
      publishProgress(state)
      state = await this.journal.transition('mutating')
      publishProgress(state)
      const result = await mutateProfile({
        inventory: this.inventory,
        selectionStore: this.selectionStore,
        actions: normalized,
        runPlugin: this.runPlugin,
      })
      state = await this.journal.transition('committed')
      publishProgress(state)
      state = await this.journal.transition('restarting')
      publishProgress(state)
      await this.restartDsh()
      state = await this.journal.transition('completed')
      publishProgress(state)
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
          await this.snapshots.remove(snapshotId).catch(cleanupError => this.record('user-plugin.snapshot.cleanup.failed', {
            taskId,
            error: cleanupError,
          }))
        } catch (recoveryError) {
          const aggregate = new AggregateError([error, recoveryError], 'User Plugin transaction and recovery failed')
          aggregate.journal = await this.journal.transition('failed', {
            error: `${message(error)}; recovery failed: ${message(recoveryError)}`,
            recoveryResult: 'failed',
          }).catch(() => {})
          throw aggregate
        }
      } else if (paused) {
        try {
          await this.restartDsh()
          await this.journal.transition('failed', { error: message(error), recoveryResult: 'success' })
        } catch (recoveryError) {
          const aggregate = new AggregateError([error, recoveryError], 'User Plugin transaction and recovery failed')
          aggregate.journal = await this.journal.transition('failed', {
            error: `${message(error)}; recovery failed: ${message(recoveryError)}`,
            recoveryResult: 'failed',
          }).catch(() => {})
          throw aggregate
        }
      } else {
        await this.journal.transition('failed', { error: message(error) }).catch(() => {})
      }
      await this.record('user-plugin.transaction.failed', { taskId, error, committed })
      if (error !== null && typeof error === 'object') error.journal = await this.journal.read().catch(() => undefined)
      throw error
    }
  }

  async recover() {
    const state = await this.journal.read()
    if (state === undefined) return undefined
    if (['completed', 'failed'].includes(state.phase)) {
      if (state.snapshotId !== null) await this.snapshots.remove(state.snapshotId).catch(error => this.record('user-plugin.snapshot.cleanup.failed', {
        taskId: state.taskId,
        error,
      }))
      return state
    }
    if (['committed', 'restarting'].includes(state.phase)) {
      try {
        if (state.phase === 'committed') await this.journal.transition('restarting')
        await this.restartDsh()
        const completed = await this.journal.transition('completed')
        if (state.snapshotId !== null) await this.snapshots.remove(state.snapshotId).catch(error => this.record('user-plugin.snapshot.cleanup.failed', {
          taskId: state.taskId,
          error,
        }))
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
    await this.pauseDsh()
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
      await this.snapshots.remove(restoring.snapshotId).catch(error => this.record('user-plugin.snapshot.cleanup.failed', {
        taskId: state.taskId,
        error,
      }))
      return failed
    } catch (error) {
      return this.journal.transition('failed', { error: message(error), recoveryResult: 'failed' })
    }
  }

  async recoverBeforeDshStart() {
    let state = await this.journal.read()
    if (state === undefined) return undefined
    if (['completed', 'failed'].includes(state.phase)) {
      if (state.snapshotId !== null) await this.snapshots.remove(state.snapshotId).catch(error => this.record('user-plugin.snapshot.cleanup.failed', {
        taskId: state.taskId,
        error,
      }))
      return state
    }
    if (state.phase === 'validated') {
      return this.journal.transition('failed', {
        error: 'transaction interrupted before DSH pause', recoveryResult: 'success',
      })
    }
    if (state.phase === 'paused') {
      return this.journal.transition('failed', {
        error: 'transaction interrupted before snapshot', recoveryResult: 'success',
      })
    }
    if (['committed', 'restarting'].includes(state.phase)) {
      if (state.phase === 'committed') state = await this.journal.transition('restarting')
      return state
    }
    try {
      if (state.phase !== 'restoring') state = await this.journal.transition('restoring', {
        error: state.error ?? 'transaction interrupted before commit',
      })
      await this.snapshots.restore(state.snapshotId)
      await this.selectionStore.restore({
        present: state.selectionPresent,
        state: { schema: 1, disabled: state.previousDisabled },
      })
      const failed = await this.journal.transition('failed', { recoveryResult: 'success' })
      await this.snapshots.remove(state.snapshotId).catch(error => this.record('user-plugin.snapshot.cleanup.failed', {
        taskId: state.taskId,
        error,
      }))
      return failed
    } catch (error) {
      return this.journal.transition('failed', { error: message(error), recoveryResult: 'failed' })
    }
  }

  async completeDshStartup({ healthy, error = null }) {
    const state = await this.journal.read()
    if (state === undefined || state.phase !== 'restarting') return state
    const next = healthy
      ? await this.journal.transition('completed')
      : await this.journal.transition('failed', { error: error ?? 'DSH failed to start after the committed User Plugin change' })
    if (state.snapshotId !== null) {
      await this.snapshots.remove(state.snapshotId).catch(cleanupError => this.record('user-plugin.snapshot.cleanup.failed', {
        taskId: state.taskId,
        error: cleanupError,
      }))
    }
    return next
  }
}

export const userPluginTransactionInternals = Object.freeze({ mutateProfile, pluginEnvironment, runDshPlugin, validateActions })
