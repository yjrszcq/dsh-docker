import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ManagedDeploymentBuilder } from '../../control-plane/modules/updater/lib/managed-store.mjs'
import { canonicalJson } from '../lib/canonical-json.mjs'
import { PlatformPaths, preparePersistentLayout } from '../lib/paths.mjs'

test('builds a complete content-addressed Managed Deployment from verified inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-managed-store-'))
  const paths = new PlatformPaths(join(root, 'data'), join(root, 'run'))
  await preparePersistentLayout(paths)

  const packageRoot = join(root, 'source', 'package')
  await mkdir(join(packageRoot, 'lib'), { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.8' }))
  await writeFile(join(packageRoot, 'lib', 'bin.js'), '#!/usr/bin/env node\n')
  const archive = join(root, 'dsh.tgz')
  const packed = spawnSync('tar', ['-czf', archive, '-C', join(root, 'source'), 'package'], { encoding: 'utf8' })
  assert.equal(packed.status, 0, packed.stderr)
  const objectSha256 = createHash('sha256').update(await readFile(archive)).digest('hex')

  const manifestPath = join(root, 'environment.manifest.json')
  const manifest = {
    schema: 1,
    manifestType: 'environment',
    version: '2026.08.19.1',
    keyringGeneration: 1,
    targetSequence: 2,
    issuedAt: '2026-08-19T00:00:00.000Z',
    artifacts: [],
    bootstrapApi: 1,
    components: [],
    patches: [],
    systemPlugins: [],
  }
  await writeFile(manifestPath, canonicalJson(manifest))
  const prepared = {
    stable: {
      targetSequence: 2,
      desired: { environment: { manifestArtifactId: 'environment-manifest' } },
    },
    environment: {
      manifest,
      manifestReceipt: { objectSha256: createHash('sha256').update(await readFile(manifestPath)).digest('hex') },
    },
    paths: new Map([['environment-manifest', manifestPath]]),
    dsh: { version: '0.1.0-rc.8', receipt: { path: archive, objectSha256 } },
    receiptTokens: ['stable-receipt', 'dsh-receipt'],
  }

  const builder = new ManagedDeploymentBuilder({ paths })
  const first = await builder.buildStable(prepared)
  assert.equal(first.record.authority, 'stable')
  assert.equal(first.record.targetSequence, 2)
  assert.equal(first.record.dshVersion, '0.1.0-rc.8')
  assert.deepEqual(first.record.receiptTokens, ['stable-receipt', 'dsh-receipt'])
  for (const reference of [
    first.record.environment,
    first.record.pristine,
    first.record.runtime,
    first.record.systemPlugins,
  ]) {
    assert.equal(reference.storage, 'store')
    const storeRoot = reference.kind === 'environment'
      ? paths.environmentsRoot
      : reference.kind === 'pristine'
        ? paths.pristineRoot
        : reference.kind === 'runtime'
          ? paths.runtimesRoot
          : paths.systemPluginsRoot
    assert.equal((await lstat(join(storeRoot, reference.id))).isDirectory(), true)
  }
  assert.equal(await readFile(join(first.assets.runtime.path, 'package', 'package.json'), 'utf8'), await readFile(join(packageRoot, 'package.json'), 'utf8'))
  assert.equal((await readFile(join(first.assets.systemPlugins.path, 'cordis.patch.yml'), 'utf8')).trim(), '[]')

  const repeated = await builder.buildStable(prepared)
  assert.equal(repeated.record.id, first.record.id)
  assert.deepEqual(repeated.record, first.record)

  const experimentalPackage = join(root, 'experimental-source', 'package')
  await mkdir(join(experimentalPackage, 'lib'), { recursive: true })
  await writeFile(join(experimentalPackage, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.9' }))
  await writeFile(join(experimentalPackage, 'lib', 'bin.js'), '#!/usr/bin/env node\n')
  const experimentalArchive = join(root, 'experimental.tgz')
  const experimentalPacked = spawnSync('tar', [
    '-czf', experimentalArchive, '-C', join(root, 'experimental-source'), 'package',
  ], { encoding: 'utf8' })
  assert.equal(experimentalPacked.status, 0, experimentalPacked.stderr)
  await mkdir(paths.viewsRoot, { recursive: true })
  await symlink(first.assets.environment.path, join(paths.viewsRoot, 'environment'), 'dir')
  const experimental = await builder.buildExperimental({
    version: '0.1.0-rc.9',
    receipt: {
      path: experimentalArchive,
      objectSha256: createHash('sha256').update(await readFile(experimentalArchive)).digest('hex'),
    },
  }, first.record, ['stable-receipt', 'experimental-receipt'])
  assert.equal(experimental.record.authority, 'experimental')
  assert.equal(experimental.record.dshVersion, '0.1.0-rc.9')
  assert.deepEqual(experimental.record.environment, first.record.environment)
  assert.deepEqual(experimental.record.systemPlugins, first.record.systemPlugins)
  assert.notEqual(experimental.record.pristine.id, first.record.pristine.id)
  assert.notEqual(experimental.record.runtime.id, first.record.runtime.id)
  assert.deepEqual(experimental.record.receiptTokens, ['stable-receipt', 'experimental-receipt'])
})
