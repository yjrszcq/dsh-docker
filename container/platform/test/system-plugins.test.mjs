import assert from 'node:assert/strict'
import { cp, lstat, mkdtemp, mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  discardSystemPluginSelection,
  linkSystemPluginScope,
  listBundledSystemPlugins,
  listManagedSystemPlugins,
  materializeSystemPluginSelection,
  rebuildBundledSystemPluginView,
  reconcileSystemPlugins,
  SystemPluginSelectionStore,
} from '../../control-plane/modules/plugin-manager/system.mjs'
import { createHash } from 'node:crypto'
import { hashTree } from '../lib/tree-hash.mjs'

test('Bootstrap lists System Plugins from the selected runtime view without rehashing the Deployment', async () => {
  const source = await readFile(new URL('../bootstrap/index.mjs', import.meta.url), 'utf8')
  const list = source.slice(source.indexOf('const systemPlugins = {'), source.indexOf('  mutate:', source.indexOf('const systemPlugins = {')))
  assert.match(list, /realpath\(paths\.deploymentView\)/)
  assert.match(list, /environmentRoot: join\(deploymentRoot, 'environment'\)/)
  assert.match(list, /sourceRoot: join\(deploymentRoot, 'system-plugins'\)/)
  assert.doesNotMatch(list, /deployments\.selected\(\)/)
})

async function archive(root, id, patch) {
  const source = join(root, `source-${id}`, 'package')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'package.json'), JSON.stringify({
    name: `@dsh-docker/${id}`,
    type: 'module',
    main: 'plugin.mjs',
    dshDocker: { description: { zh: `${id} 功能`, en: `${id} feature` } },
  }))
  await writeFile(join(source, 'cordis.patch.json'), JSON.stringify(patch))
  await writeFile(join(source, 'plugin.mjs'), `export const id = ${JSON.stringify(id)}\n`)
  const path = join(root, `${id}.tgz`)
  const result = spawnSync('tar', ['-czf', path, '-C', dirname(source), 'package'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return path
}

function dirname(path) {
  return path.slice(0, path.lastIndexOf('/'))
}

test('reconciles only declared System Plugins into a separate immutable overlay', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-system-plugins-'))
  const userHome = join(root, 'user-home')
  await mkdir(join(userHome, 'profiles/web'), { recursive: true })
  await writeFile(join(userHome, 'cordis.patch.yml'), '[{"id":"user-owned"}]\n')
  await writeFile(join(userHome, 'profiles/web/package.json'), '{"dependencies":{"third-party":"1.0.0"}}\n')
  const first = await archive(root, 'update-ui', [{ insert: [{ id: 'dsh-docker.update-ui.host', name: '@dsh-docker/update-ui' }] }])
  const second = await archive(root, 'diagnostics', [{ insert: [{ id: 'dsh-docker.diagnostics.host', name: '@dsh-docker/diagnostics' }] }])
  const artifacts = new Map([['update-ui', first], ['diagnostics', second]])
  await reconcileSystemPlugins({
    root: join(root, 'managed'),
    environmentVersion: '1.0.0',
    plugins: [
      { id: 'update-ui', sha256: '1'.repeat(64) },
      { id: 'diagnostics', sha256: '2'.repeat(64) },
    ],
    artifactPath: reference => artifacts.get(reference.id),
  })
  const overlay = JSON.parse(await readFile(join(root, 'managed/current/cordis.patch.yml'), 'utf8'))
  assert.deepEqual(overlay.flatMap(entry => entry.insert).map(entry => entry.id), ['dsh-docker.update-ui.host', 'dsh-docker.diagnostics.host'])
  assert.deepEqual(overlay.flatMap(entry => entry.insert).map(entry => entry.name), [
    '@dsh-docker/update-ui',
    '@dsh-docker/diagnostics',
  ])
  assert.equal(await readFile(join(userHome, 'cordis.patch.yml'), 'utf8'), '[{"id":"user-owned"}]\n')
  assert.match(await readFile(join(userHome, 'profiles/web/package.json'), 'utf8'), /third-party/)
})

test('rejects a System Plugin which claims another namespace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-system-plugin-invalid-'))
  const artifact = await archive(root, 'update-ui', [{ insert: [{ id: 'unowned-row', name: '@dsh-docker/update-ui' }] }])
  await assert.rejects(reconcileSystemPlugins({
    root: join(root, 'managed'),
    environmentVersion: 'invalid',
    plugins: [{ id: 'update-ui', sha256: '1'.repeat(64) }],
    artifactPath: () => artifact,
  }), /namespace/)
})

test('rejects a System Plugin which patches an existing DSH row', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-system-plugin-mutation-'))
  const artifact = await archive(root, 'update-ui', [{
    id: 'dsh-docker.update-ui.host',
    name: '@dsh-docker/update-ui',
  }])
  await assert.rejects(reconcileSystemPlugins({
    root: join(root, 'managed'),
    environmentVersion: 'invalid',
    plugins: [{ id: 'update-ui', sha256: '1'.repeat(64) }],
    artifactPath: () => artifact,
  }), /only a non-empty insert list/)
})

test('links only the reserved System Plugin package scope into DSH profiles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-system-plugin-scope-'))
  const dshHome = join(root, 'dsh')
  const viewRoot = join(root, 'run', 'system-plugins')
  await mkdir(join(viewRoot, 'packages'), { recursive: true })
  const link = await linkSystemPluginScope({ dshHome, viewRoot })
  assert.equal(await readlink(link), join(viewRoot, 'packages'))
  assert.equal(await linkSystemPluginScope({ dshHome, viewRoot }), link)
})

test('rebuilds a bundled System Plugin view only from the current Environment artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-system-plugin-repair-'))
  const environment = join(root, 'environment')
  const artifact = await archive(root, 'platform-management', [{
    insert: [{ id: 'dsh-docker.platform-management.plugin', name: '@dsh-docker/platform-management' }],
  }])
  const bytes = await readFile(artifact)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  await mkdir(join(environment, 'artifacts'), { recursive: true })
  await cp(artifact, join(environment, 'artifacts', 'system-plugin-platform-management'))
  await writeFile(join(environment, 'environment.manifest.json'), JSON.stringify({
    schema: 1,
    manifestType: 'environment',
    version: '1.0.0',
    keyringGeneration: 1,
    targetSequence: 1,
    issuedAt: '2026-08-20T00:00:00.000Z',
    artifacts: [{
      id: 'system-plugin-platform-management',
      mediaType: 'application/vnd.dsh-platform.system-plugin.v1+tar+gzip',
      sha256,
      size: bytes.byteLength,
      url: 'https://example.invalid/system-plugin-platform-management',
    }],
    bootstrapApi: 1,
    components: [],
    patches: [],
    systemPlugins: [{ id: 'platform-management', sha256 }],
  }))
  const initialRoot = join(root, 'initial')
  const initial = await reconcileSystemPlugins({
    root: initialRoot,
    environmentVersion: 'fixture',
    plugins: [{ id: 'platform-management', sha256 }],
    artifactPath: () => artifact,
  })
  const expectedSha256 = await hashTree(initial)
  const rebuilt = await rebuildBundledSystemPluginView({
    environmentRoot: environment,
    outputRoot: join(root, 'views'),
    expectedSha256,
    requestedPluginId: 'platform-management',
  })
  assert.equal(await hashTree(rebuilt), expectedSha256)
  assert.deepEqual(await listBundledSystemPlugins({ environmentRoot: environment, viewRoot: rebuilt }), [{
    id: 'platform-management',
    artifactId: 'system-plugin-platform-management',
    sha256,
    installed: true,
    reason: null,
  }])
  await rm(join(rebuilt, 'packages', 'platform-management'), { recursive: true })
  const repairedAgain = await rebuildBundledSystemPluginView({
    environmentRoot: environment,
    outputRoot: join(root, 'views'),
    expectedSha256,
    requestedPluginId: 'platform-management',
  })
  assert.equal(await hashTree(repairedAgain), expectedSha256)
  await assert.rejects(rebuildBundledSystemPluginView({
    environmentRoot: environment,
    outputRoot: join(root, 'views'),
    expectedSha256,
    requestedPluginId: 'unknown',
  }), /not bundled/)
})

test('persists install and enable selection while protecting Platform Management', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-system-plugin-selection-'))
  const environment = join(root, 'environment')
  const definitions = [
    ['platform-management', '1'],
    ['diagnostics', '2'],
  ]
  const artifacts = []
  await mkdir(join(environment, 'artifacts'), { recursive: true })
  for (const [id] of definitions) {
    const artifact = await archive(root, id, [{
      insert: [{ id: `dsh-docker.${id}.plugin`, name: `@dsh-docker/${id}` }],
    }])
    const bytes = await readFile(artifact)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const artifactId = `system-plugin-${id}`
    await cp(artifact, join(environment, 'artifacts', artifactId))
    artifacts.push({ id: artifactId, sha256, size: bytes.byteLength, pluginId: id, path: artifact })
  }
  await writeFile(join(environment, 'environment.manifest.json'), JSON.stringify({
    schema: 1,
    manifestType: 'environment',
    version: '1.0.0',
    keyringGeneration: 1,
    targetSequence: 1,
    issuedAt: '2026-08-20T00:00:00.000Z',
    artifacts: artifacts.map(artifact => ({
      id: artifact.id,
      mediaType: 'application/vnd.dsh-platform.system-plugin.v1+tar+gzip',
      sha256: artifact.sha256,
      size: artifact.size,
      url: `https://example.invalid/${artifact.id}`,
    })),
    bootstrapApi: 1,
    components: [],
    patches: [],
    systemPlugins: artifacts.map(artifact => ({ id: artifact.pluginId, sha256: artifact.sha256 })),
  }))
  const source = await reconcileSystemPlugins({
    root: join(root, 'source'),
    environmentVersion: 'fixture',
    plugins: artifacts.map(artifact => ({ id: artifact.pluginId, sha256: artifact.sha256 })),
    artifactPath: reference => artifacts.find(artifact => artifact.pluginId === reference.id).path,
  })
  const store = new SystemPluginSelectionStore(join(root, 'state', 'system-plugins.json'))
  const pluginIds = artifacts.map(artifact => artifact.pluginId)
  const initial = await listManagedSystemPlugins({ environmentRoot: environment, sourceRoot: source, selectionStore: store })
  assert.deepEqual(initial.map(plugin => [plugin.id, plugin.description, plugin.installed, plugin.enabled, plugin.protected]), [
    ['platform-management', { zh: 'platform-management 功能', en: 'platform-management feature' }, true, true, true],
    ['diagnostics', { zh: 'diagnostics 功能', en: 'diagnostics feature' }, true, true, false],
  ])
  const active = await materializeSystemPluginSelection({
    environmentRoot: environment,
    sourceRoot: source,
    outputRoot: join(root, 'views'),
    selectionStore: store,
  })

  await assert.rejects(store.configure(pluginIds, 'platform-management', 'uninstall'), /managed by the platform/)
  await assert.rejects(store.recover(pluginIds, 'diagnostics', 'uninstall'), /not a platform recovery target/)
  await store.recover(pluginIds, 'platform-management', 'uninstall')
  assert.deepEqual(await store.read(pluginIds).then(value => value['platform-management']), {
    installed: false, enabled: false, protected: true,
  })
  await store.recover(pluginIds, 'platform-management', 'install')
  await store.configure(pluginIds, 'diagnostics', 'disable')
  const pending = await listManagedSystemPlugins({
    environmentRoot: environment,
    sourceRoot: source,
    selectionStore: store,
    activeRoot: active.path,
  })
  assert.deepEqual(pending.find(plugin => plugin.id === 'diagnostics'), {
    id: 'diagnostics',
    artifactId: 'system-plugin-diagnostics',
    sha256: artifacts.find(artifact => artifact.pluginId === 'diagnostics').sha256,
    description: { zh: 'diagnostics 功能', en: 'diagnostics feature' },
    installed: true,
    enabled: false,
    activeInstalled: true,
    activeEnabled: true,
    pendingRestart: true,
    protected: false,
    reason: null,
  })
  const discarded = await discardSystemPluginSelection({
    environmentRoot: environment,
    sourceRoot: source,
    selectionStore: store,
    activeRoot: active.path,
  })
  assert.equal(discarded.find(plugin => plugin.id === 'diagnostics').pendingRestart, false)
  assert.deepEqual((await store.read(pluginIds)).diagnostics, {
    installed: true, enabled: true, protected: false,
  })
  await store.configure(pluginIds, 'diagnostics', 'disable')
  const disabled = await materializeSystemPluginSelection({
    environmentRoot: environment,
    sourceRoot: source,
    outputRoot: join(root, 'views'),
    selectionStore: store,
  })
  assert.equal((await lstat(join(disabled.path, 'packages', 'diagnostics'))).isSymbolicLink(), true)
  assert.deepEqual(JSON.parse(await readFile(join(disabled.path, 'cordis.patch.yml'), 'utf8'))
    .flatMap(entry => entry.insert).map(row => row.name), ['@dsh-docker/platform-management'])
  assert.equal((await listManagedSystemPlugins({
    environmentRoot: environment,
    sourceRoot: source,
    selectionStore: store,
    activeRoot: disabled.path,
  })).find(plugin => plugin.id === 'diagnostics').pendingRestart, false)

  await store.configure(pluginIds, 'diagnostics', 'uninstall')
  const deleted = await materializeSystemPluginSelection({
    environmentRoot: environment,
    sourceRoot: source,
    outputRoot: join(root, 'views'),
    selectionStore: store,
  })
  await assert.rejects(lstat(join(deleted.path, 'packages', 'diagnostics')), error => error.code === 'ENOENT')
  assert.deepEqual((await listManagedSystemPlugins({ environmentRoot: environment, sourceRoot: source, selectionStore: store }))
    .map(plugin => [plugin.id, plugin.installed, plugin.enabled]), [
      ['platform-management', true, true],
      ['diagnostics', false, false],
    ])

  await store.configure(pluginIds, 'diagnostics', 'install')
  assert.deepEqual((await new SystemPluginSelectionStore(join(root, 'state', 'system-plugins.json')).read(pluginIds)).diagnostics, {
    installed: true,
    enabled: true,
    protected: false,
  })
})
