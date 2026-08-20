import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { UserPluginInventory } from '../../control-plane/modules/user-plugin-manager/index.mjs'

async function fixture({ dependencies, bundles, packages = {}, selection } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-user-plugins-'))
  const profile = join(root, 'dsh/profiles/web')
  const selectionPath = join(root, 'platform/state/management/user-plugins.json')
  await mkdir(join(profile, 'node_modules'), { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: dependencies ?? {},
    dsh: { profile: { bundles: bundles ?? [] } },
  }))
  await writeFile(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  for (const [name, metadata] of Object.entries(packages)) {
    const destination = join(profile, 'node_modules', ...name.split('/'))
    if (metadata === 'dangling') {
      await mkdir(join(destination, '..'), { recursive: true })
      await symlink(join(root, 'missing-package'), destination)
      continue
    }
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, 'package.json'), typeof metadata === 'string' ? metadata : JSON.stringify({
      name,
      version: '1.2.3',
      ...metadata,
    }))
  }
  if (selection !== undefined) {
    await mkdir(join(selectionPath, '..'), { recursive: true })
    await writeFile(selectionPath, JSON.stringify(selection))
  }
  return { root, profile, selectionPath }
}

test('inventories only profile Bundle dependencies without importing their entrypoints', async () => {
  const { root, selectionPath } = await fixture({
    dependencies: {
      'working-plugin': '^1.2.0',
      'plain-library': '2.0.0',
      'git-plugin': 'github:example/plugin#main',
      'local-plugin': 'file:../local-plugin',
    },
    bundles: ['@deepseek-ai/dsh-base', 'working-plugin', 'git-plugin'],
    packages: {
      'working-plugin': { dsh: { bundle: { patch: './cordis.patch.yml' } }, main: './throw-if-imported.mjs' },
      'plain-library': {},
      'git-plugin': { dsh: { bundle: { patch: './plugin.patch.yml' } } },
      'local-plugin': { dsh: { bundle: { patch: './plugin.patch.yml' } } },
    },
    selection: { schema: 1, disabled: [{ name: 'local-plugin', index: 2 }] },
  })
  const inventory = await new UserPluginInventory({ dshHome: join(root, 'dsh'), selectionPath }).read()
  assert.match(inventory.revision, /^sha256:[a-f0-9]{64}$/)
  assert.deepEqual(inventory.plugins.map(plugin => [plugin.name, plugin.source, plugin.enabled, plugin.previousIndex]), [
    ['working-plugin', 'registry', true, null],
    ['git-plugin', 'git', true, null],
    ['local-plugin', 'file', false, 2],
  ])
  assert.equal(inventory.plugins[0].version, '1.2.3')
  assert.equal(inventory.plugins[0].damaged, false)
})

test('keeps damaged and dangling dependency metadata visible for recovery', async () => {
  const { root, selectionPath } = await fixture({
    dependencies: { broken: 'https://example.invalid/broken.tgz', dangling: 'link:../dangling' },
    bundles: ['broken', 'dangling'],
    packages: { broken: '{', dangling: 'dangling' },
  })
  const inventory = await new UserPluginInventory({ dshHome: join(root, 'dsh'), selectionPath }).read()
  assert.deepEqual(inventory.plugins.map(plugin => [plugin.name, plugin.source, plugin.enabled, plugin.damaged]), [
    ['broken', 'url', true, true],
    ['dangling', 'file', true, true],
  ])
  assert.match(inventory.plugins[0].metadataError, /valid JSON/)
  assert.match(inventory.plugins[1].metadataError, /missing/)
})

test('uses verified Environment names for reserved conflicts instead of namespace prefixes', async () => {
  const { root, selectionPath } = await fixture({
    dependencies: {
      '@dsh-docker/fake-external': '1.0.0',
      '@dsh-docker/settings-document-editor': '1.0.0',
    },
    bundles: ['@dsh-docker/fake-external', '@dsh-docker/settings-document-editor'],
    packages: {
      '@dsh-docker/fake-external': { dsh: { bundle: { patch: './cordis.patch.yml' } } },
      '@dsh-docker/settings-document-editor': {},
    },
  })
  const inventory = await new UserPluginInventory({
    dshHome: join(root, 'dsh'),
    selectionPath,
    systemPluginNames: async () => ['@dsh-docker/settings-document-editor'],
  }).read()
  assert.deepEqual(inventory.plugins.map(plugin => [plugin.name, plugin.reservedNameConflict, plugin.enabled]), [
    ['@dsh-docker/fake-external', false, true],
    ['@dsh-docker/settings-document-editor', true, false],
  ])
})

test('revision covers exact manifest, lockfile, and disabled-order bytes', async () => {
  const { root, profile, selectionPath } = await fixture({
    dependencies: { plugin: '1.0.0' },
    bundles: ['plugin'],
    packages: { plugin: { dsh: { bundle: { patch: './cordis.patch.yml' } } } },
  })
  const manager = new UserPluginInventory({ dshHome: join(root, 'dsh'), selectionPath })
  const first = await manager.read()
  await writeFile(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n# exact byte changed\n')
  const second = await manager.read()
  await mkdir(join(selectionPath, '..'), { recursive: true })
  await writeFile(selectionPath, '{"schema":1,"disabled":[]}\n')
  const third = await manager.read()
  assert.notEqual(first.revision, second.revision)
  assert.notEqual(second.revision, third.revision)
})

test('rejects malformed authoritative profile and selection state', async () => {
  const malformed = await fixture({ dependencies: { plugin: 123 } })
  await assert.rejects(
    new UserPluginInventory({ dshHome: join(malformed.root, 'dsh'), selectionPath: malformed.selectionPath }).read(),
    /non-empty string spec/,
  )
  const state = await fixture({
    dependencies: { plugin: '1.0.0' },
    packages: { plugin: { dsh: { bundle: { patch: './cordis.patch.yml' } } } },
    selection: { schema: 1, disabled: [{ name: '../unsafe', index: 0 }] },
  })
  await assert.rejects(
    new UserPluginInventory({ dshHome: join(state.root, 'dsh'), selectionPath: state.selectionPath }).read(),
    /disabled-order entry/,
  )
})
