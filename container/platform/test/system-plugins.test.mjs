import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  linkSystemPluginScope,
  listBundledSystemPlugins,
  rebuildBundledSystemPluginView,
  reconcileSystemPlugins,
} from '../../control-plane/modules/system-plugin-manager/index.mjs'
import { createHash } from 'node:crypto'
import { hashTree } from '../lib/tree-hash.mjs'

async function archive(root, id, patch) {
  const source = join(root, `source-${id}`, 'package')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'package.json'), JSON.stringify({
    name: `@dsh-docker/${id}`,
    type: 'module',
    main: 'plugin.mjs',
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
    environmentVersion: '2026.08.20.1',
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
    version: '2026.08.20.1',
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
