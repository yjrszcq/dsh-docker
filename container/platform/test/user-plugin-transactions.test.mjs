import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { UserPluginInventory } from '../../control-plane/modules/plugin-manager/user-inventory.mjs'
import { UserPluginJournal, userPluginJournalInternals } from '../../control-plane/modules/plugin-manager/user-journal.mjs'
import { UserPluginSnapshots, userPluginSnapshotInternals } from '../../control-plane/modules/plugin-manager/user-snapshots.mjs'
import { UserPluginSelectionStore, userPluginStateInternals } from '../../control-plane/modules/plugin-manager/user-state.mjs'
import { UserPluginTransactionManager, userPluginTransactionInternals } from '../../control-plane/modules/plugin-manager/user-transaction.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-user-plugin-transaction-'))
  const dshHome = join(root, 'dsh')
  const profileRoot = join(dshHome, 'profiles/web')
  const stateRoot = join(root, 'platform/state/management')
  const selectionPath = join(stateRoot, 'user-plugins.json')
  const journalPath = join(stateRoot, 'user-plugin-transaction.json')
  const snapshotsRoot = join(root, 'platform/store/snapshots/user-plugins')
  await mkdir(join(profileRoot, 'node_modules'), { recursive: true })
  await writeFile(join(profileRoot, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: { alpha: '1.0.0', beta: '1.0.0', gamma: '1.0.0' },
    dsh: { profile: { bundles: ['alpha', 'beta'] } },
  }))
  await writeFile(join(profileRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  for (const name of ['alpha', 'beta', 'gamma']) {
    const installed = join(profileRoot, 'node_modules', name)
    await mkdir(installed)
    await writeFile(join(installed, 'package.json'), JSON.stringify({
      name, version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    await writeFile(join(installed, 'cordis.patch.yml'), '[]\n')
  }
  const inventory = new UserPluginInventory({ dshHome, selectionPath })
  const selectionStore = new UserPluginSelectionStore(selectionPath)
  const journal = new UserPluginJournal(journalPath)
  const snapshots = new UserPluginSnapshots({ root: snapshotsRoot, profileRoot })
  return { root, dshHome, profileRoot, selectionPath, journal, snapshots, inventory, selectionStore }
}

function manager(value, overrides = {}) {
  const calls = []
  return {
    calls,
    value: new UserPluginTransactionManager({
      inventory: value.inventory,
      selectionStore: value.selectionStore,
      snapshots: value.snapshots,
      journal: value.journal,
      pauseDsh: async () => { calls.push('pause') },
      restartDsh: async () => { calls.push('restart') },
      runPlugin: async details => { calls.push(['remove', details]) },
      report: async message => { calls.push(['report', message]) },
      ...overrides,
    }),
  }
}

test('runs DSH plugin removal with writable user configuration directories', () => {
  const previous = {
    HOME: process.env.HOME,
    npm_config_userconfig: process.env.npm_config_userconfig,
    NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE,
    PNPM_HOME: process.env.PNPM_HOME,
    npm_config_prefix: process.env.npm_config_prefix,
  }
  process.env.HOME = '/root'
  process.env.npm_config_userconfig = '/root/.npmrc'
  process.env.NPM_CONFIG_CACHE = '/root/.npm'
  process.env.PNPM_HOME = '/root/.local/share/pnpm'
  process.env.npm_config_prefix = '/root/.local'
  try {
    const environment = userPluginTransactionInternals.pluginEnvironment('/data/dsh')
    assert.equal(environment.HOME, '/home/node')
    assert.equal(environment.XDG_CACHE_HOME, '/home/node/.cache')
    assert.equal(environment.XDG_CONFIG_HOME, '/home/node/.config')
    assert.equal(environment.XDG_DATA_HOME, '/home/node/.local/share')
    assert.equal(environment.XDG_STATE_HOME, '/home/node/.local/state')
    assert.equal(environment.DSH_HOME, '/data/dsh')
    assert.equal(environment.npm_config_userconfig, undefined)
    assert.equal(environment.NPM_CONFIG_CACHE, undefined)
    assert.equal(environment.PNPM_HOME, undefined)
    assert.equal(environment.npm_config_prefix, undefined)
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('snapshots and restores the complete Web Profile with hidden files, modes, and symlinks', async () => {
  const value = await fixture()
  await writeFile(join(value.profileRoot, '.hidden'), 'hidden\n')
  await chmod(join(value.profileRoot, '.hidden'), 0o640)
  await symlink('package.json', join(value.profileRoot, 'manifest-link'))
  await value.snapshots.create('snapshot-one')
  await rm(join(value.profileRoot, '.hidden'))
  await writeFile(join(value.profileRoot, 'package.json'), '{}\n')
  await value.snapshots.restore('snapshot-one')
  assert.equal(await readFile(join(value.profileRoot, '.hidden'), 'utf8'), 'hidden\n')
  assert.equal((await lstat(join(value.profileRoot, '.hidden'))).mode & 0o777, 0o640)
  assert.equal(await readlink(join(value.profileRoot, 'manifest-link')), 'package.json')
  assert.match(await readFile(join(value.profileRoot, 'package.json'), 'utf8'), /dsh-profile-web/)
  await writeFile(join(value.snapshots.path('snapshot-one'), 'profile.tar'), 'corrupt')
  await assert.rejects(value.snapshots.inspect('snapshot-one'), /does not match/)
})

test('creates full Profile snapshots without compression overhead', async () => {
  const value = await fixture()
  await value.snapshots.create('snapshot-uncompressed')
  assert.equal((await lstat(join(value.snapshots.path('snapshot-uncompressed'), 'profile.tar'))).isFile(), true)
  await assert.rejects(lstat(join(value.snapshots.path('snapshot-uncompressed'), 'profile.tar.gz')), { code: 'ENOENT' })
})

test('atomically applies ordered enable and disable actions around one DSH pause', async () => {
  const value = await fixture()
  const before = await value.inventory.read()
  const transaction = manager(value)
  const result = await transaction.value.apply({
    taskId: 'task-enable-disable',
    revision: before.revision,
    actions: [{ name: 'alpha', action: 'disable' }, { name: 'gamma', action: 'enable' }],
  })
  assert.equal(result.status, 'success')
  const manifest = JSON.parse(await readFile(join(value.profileRoot, 'package.json'), 'utf8'))
  assert.deepEqual(manifest.dsh.profile.bundles, ['beta', 'gamma'])
  assert.deepEqual((await value.selectionStore.read()).disabled, [{ name: 'alpha', index: 0 }])
  assert.deepEqual(result.inventory.plugins.map(plugin => [plugin.name, plugin.enabled]), [
    ['alpha', false], ['beta', true], ['gamma', true],
  ])
  assert.equal((await value.journal.read()).phase, 'completed')
  await assert.rejects(lstat(value.snapshots.path('task-enable-disable')), { code: 'ENOENT' })
  assert.deepEqual(transaction.calls.filter(call => typeof call === 'string'), ['pause', 'restart'])
})

test('records every disabled plugin position from the original Bundle order', async () => {
  const value = await fixture()
  const before = await value.inventory.read()
  const transaction = manager(value)
  await transaction.value.apply({
    taskId: 'task-disable-order', revision: before.revision,
    actions: [{ name: 'alpha', action: 'disable' }, { name: 'beta', action: 'disable' }],
  })
  assert.deepEqual((await value.selectionStore.read()).disabled, [
    { name: 'alpha', index: 0 }, { name: 'beta', index: 1 },
  ])
})

test('restores the full Profile when an exact uninstall command fails before commit', async () => {
  const value = await fixture()
  const beforeBytes = await readFile(join(value.profileRoot, 'package.json'))
  const before = await value.inventory.read()
  const transaction = manager(value, {
    runPlugin: async ({ name }) => {
      await writeFile(join(value.profileRoot, 'package.json'), '{}\n')
      throw new Error(`pnpm failed for ${name}`)
    },
  })
  await assert.rejects(transaction.value.apply({
    taskId: 'task-uninstall-failure',
    revision: before.revision,
    actions: [{ name: 'alpha', action: 'uninstall' }],
  }), /pnpm failed/)
  assert.deepEqual(await readFile(join(value.profileRoot, 'package.json')), beforeBytes)
  assert.equal((await value.journal.read()).phase, 'failed')
  assert.equal((await value.journal.read()).recoveryResult, 'success')
  assert.deepEqual(transaction.calls.filter(call => typeof call === 'string'), ['pause', 'restart'])
})

test('uninstalls one exact package name without exposing package-manager arguments', async () => {
  const value = await fixture()
  const before = await value.inventory.read()
  const removals = []
  const transaction = manager(value, {
    runPlugin: async details => {
      removals.push(details)
      const manifestPath = join(value.profileRoot, 'package.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      delete manifest.dependencies[details.name]
      manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(name => name !== details.name)
      await writeFile(manifestPath, JSON.stringify(manifest))
      await writeFile(join(value.profileRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9\npackages: {}\n')
      await rm(join(value.profileRoot, 'node_modules', details.name), { recursive: true, force: true })
    },
  })
  const result = await transaction.value.apply({
    taskId: 'task-uninstall-success',
    revision: before.revision,
    actions: [{ name: 'alpha', action: 'uninstall' }],
  })
  assert.deepEqual(removals, [{ dshHome: value.dshHome, profile: 'web', name: 'alpha' }])
  assert.equal(result.inventory.plugins.some(plugin => plugin.name === 'alpha'), false)
})

test('reapplies disabled Bundle selection after DSH plugin removal reconciles the Profile', async () => {
  const value = await fixture()
  const before = await value.inventory.read()
  const transaction = manager(value, {
    runPlugin: async details => {
      const manifestPath = join(value.profileRoot, 'package.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      delete manifest.dependencies[details.name]
      manifest.dsh.profile.bundles = ['beta']
      await writeFile(manifestPath, JSON.stringify(manifest))
      await rm(join(value.profileRoot, 'node_modules', details.name), { recursive: true, force: true })
    },
  })
  const result = await transaction.value.apply({
    taskId: 'task-disable-and-uninstall',
    revision: before.revision,
    actions: [{ name: 'beta', action: 'disable' }, { name: 'alpha', action: 'uninstall' }],
  })
  const manifest = JSON.parse(await readFile(join(value.profileRoot, 'package.json'), 'utf8'))
  assert.deepEqual(manifest.dsh.profile.bundles, [])
  assert.equal(result.inventory.plugins.find(plugin => plugin.name === 'beta')?.enabled, false)
  assert.equal(result.inventory.plugins.some(plugin => plugin.name === 'alpha'), false)
})

test('restarts unchanged DSH when the mandatory Profile snapshot cannot be created', async () => {
  const value = await fixture()
  const beforeBytes = await readFile(join(value.profileRoot, 'package.json'))
  const before = await value.inventory.read()
  const transaction = manager(value, {
    snapshots: {
      create: async () => { throw new Error('snapshot disk full') },
      remove: async () => {},
    },
  })
  await assert.rejects(transaction.value.apply({
    taskId: 'task-snapshot-failure',
    revision: before.revision,
    actions: [{ name: 'alpha', action: 'disable' }],
  }), /snapshot disk full/)
  assert.deepEqual(await readFile(join(value.profileRoot, 'package.json')), beforeBytes)
  assert.deepEqual(transaction.calls.filter(call => typeof call === 'string'), ['pause', 'restart'])
  const journal = await value.journal.read()
  assert.equal(journal.phase, 'failed')
  assert.equal(journal.recoveryResult, 'success')
})

test('retains a committed plugin change when DSH still fails to restart', async () => {
  const value = await fixture()
  const before = await value.inventory.read()
  const transaction = manager(value, { restartDsh: async () => { throw new Error('DSH remains broken') } })
  await assert.rejects(transaction.value.apply({
    taskId: 'task-restart-failure',
    revision: before.revision,
    actions: [{ name: 'alpha', action: 'disable' }],
  }), /DSH remains broken/)
  const manifest = JSON.parse(await readFile(join(value.profileRoot, 'package.json'), 'utf8'))
  assert.deepEqual(manifest.dsh.profile.bundles, ['beta'])
  const journal = await value.journal.read()
  assert.equal(journal.phase, 'failed')
  assert.equal(journal.recoveryResult, null)
  await assert.rejects(lstat(value.snapshots.path('task-restart-failure')), { code: 'ENOENT' })
})

test('recovers an interrupted pre-commit mutation from its persisted snapshot', async () => {
  const value = await fixture()
  const before = await value.inventory.read()
  await value.journal.begin({
    taskId: 'task-interrupted', revision: before.revision,
    actions: [{ name: 'alpha', action: 'disable' }],
    selection: await value.selectionStore.snapshot(),
  })
  await value.journal.transition('paused')
  await value.snapshots.create('task-interrupted')
  await value.journal.transition('snapshotted', { snapshotId: 'task-interrupted' })
  await value.journal.transition('mutating')
  await writeFile(join(value.profileRoot, 'package.json'), '{}\n')
  const transaction = manager(value)
  const recovered = await transaction.value.recover()
  assert.equal(recovered.phase, 'failed')
  assert.equal(recovered.recoveryResult, 'success')
  assert.match(await readFile(join(value.profileRoot, 'package.json'), 'utf8'), /dsh-profile-web/)
  await assert.rejects(lstat(value.selectionPath), { code: 'ENOENT' })
  assert.deepEqual(transaction.calls.filter(call => typeof call === 'string'), ['pause', 'restart'])
})

test('restores an interrupted pre-commit Profile before Bootstrap starts DSH', async () => {
  const value = await fixture()
  const before = await value.inventory.read()
  await value.journal.begin({
    taskId: 'task-prestart-restore', revision: before.revision,
    actions: [{ name: 'alpha', action: 'disable' }],
    selection: await value.selectionStore.snapshot(),
  })
  await value.journal.transition('paused')
  await value.snapshots.create('task-prestart-restore')
  await value.journal.transition('snapshotted', { snapshotId: 'task-prestart-restore' })
  await value.journal.transition('mutating')
  await writeFile(join(value.profileRoot, 'package.json'), '{}\n')
  const transaction = manager(value)
  const recovered = await transaction.value.recoverBeforeDshStart()
  assert.equal(recovered.phase, 'failed')
  assert.equal(recovered.recoveryResult, 'success')
  assert.match(await readFile(join(value.profileRoot, 'package.json'), 'utf8'), /dsh-profile-web/)
  assert.deepEqual(transaction.calls, [])
})

test('lets Bootstrap start a committed Profile once and then finalizes the journal', async () => {
  const value = await fixture()
  const before = await value.inventory.read()
  await value.journal.begin({
    taskId: 'task-prestart-committed', revision: before.revision,
    actions: [{ name: 'alpha', action: 'disable' }],
    selection: await value.selectionStore.snapshot(),
  })
  await value.journal.transition('paused')
  await value.snapshots.create('task-prestart-committed')
  await value.journal.transition('snapshotted', { snapshotId: 'task-prestart-committed' })
  await value.journal.transition('mutating')
  await value.journal.transition('committed')
  const transaction = manager(value)
  const pending = await transaction.value.recoverBeforeDshStart()
  assert.equal(pending.phase, 'restarting')
  assert.deepEqual(transaction.calls, [])
  const completed = await transaction.value.completeDshStartup({ healthy: true })
  assert.equal(completed.phase, 'completed')
  await assert.rejects(lstat(value.snapshots.path('task-prestart-committed')), { code: 'ENOENT' })
})

test('restores platform selection state when final Profile validation fails', async () => {
  const value = await fixture()
  await value.selectionStore.write({ schema: 1, disabled: [{ name: 'gamma', index: 2 }] })
  const initial = await value.inventory.read()
  let reads = 0
  const inventory = Object.create(value.inventory)
  inventory.read = async () => {
    reads += 1
    if (reads === 2) throw new Error('result validation failed')
    return value.inventory.read()
  }
  const transaction = manager({ ...value, inventory })
  await assert.rejects(transaction.value.apply({
    taskId: 'task-selection-restore',
    revision: initial.revision,
    actions: [{ name: 'alpha', action: 'disable' }],
  }), /result validation failed/)
  assert.deepEqual((await value.selectionStore.read()).disabled, [{ name: 'gamma', index: 2 }])
  const manifest = JSON.parse(await readFile(join(value.profileRoot, 'package.json'), 'utf8'))
  assert.deepEqual(manifest.dsh.profile.bundles, ['alpha', 'beta'])
})

test('rejects stale revisions and reserved-name enablement before pausing DSH', async () => {
  const value = await fixture()
  const transaction = manager(value)
  await assert.rejects(transaction.value.apply({
    revision: `sha256:${'0'.repeat(64)}`,
    actions: [{ name: 'alpha', action: 'disable' }],
  }), error => error.code === 'REVISION_CONFLICT')
  assert.deepEqual(transaction.calls, [])

  const reserved = new UserPluginInventory({
    dshHome: value.dshHome,
    selectionPath: value.selectionPath,
    systemPluginNames: async () => ['alpha'],
  })
  const reservedManager = manager({ ...value, inventory: reserved })
  const current = await reserved.read()
  await assert.rejects(reservedManager.value.apply({
    revision: current.revision,
    actions: [{ name: 'alpha', action: 'enable' }],
  }), /cannot be enabled/)
  assert.deepEqual(reservedManager.calls, [])
})

test('rejects extension fields in every persisted User Plugin state document', () => {
  assert.throws(() => userPluginStateInternals.parse({ schema: 1, disabled: [], extra: true }), /invalid/)
  assert.throws(() => userPluginSnapshotInternals.parseManifest({
    schema: 1,
    id: 'snapshot',
    source: '/data/dsh/profiles/web',
    createdAt: new Date(0).toISOString(),
    archiveSha256: 'a'.repeat(64),
    archiveSize: 1,
    extra: true,
  }), /invalid/)
  assert.throws(() => userPluginJournalInternals.parse({
    schema: 1,
    taskId: 'task',
    revision: `sha256:${'a'.repeat(64)}`,
    actions: [{ name: 'plugin', action: 'disable' }],
    selectionPresent: false,
    previousDisabled: [],
    phase: 'validated',
    snapshotId: null,
    error: null,
    recoveryResult: null,
    updatedAt: new Date(0).toISOString(),
    extra: true,
  }), /invalid/)
})

test('does not turn successful recovery into failure when snapshot cleanup fails', async () => {
  const value = await fixture()
  const before = await value.inventory.read()
  const reports = []
  const snapshots = {
    ...value.snapshots,
    create: (...args) => value.snapshots.create(...args),
    restore: (...args) => value.snapshots.restore(...args),
    remove: async () => { throw new Error('cleanup failed') },
  }
  const transaction = manager(value, {
    snapshots,
    report: async message => { reports.push(message) },
  })
  const result = await transaction.value.apply({
    taskId: 'task-cleanup-warning', revision: before.revision,
    actions: [{ name: 'alpha', action: 'disable' }],
  })
  assert.equal(result.status, 'success')
  assert.equal((await value.journal.read()).phase, 'completed')
  assert.equal(reports.includes('user-plugin.snapshot.cleanup.failed'), true)
})
