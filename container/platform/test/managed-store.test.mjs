import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ManagedDeploymentBuilder } from '../../control-plane/modules/updater/lib/managed-store.mjs'
import { canonicalJson } from '../lib/canonical-json.mjs'
import { deriveRecordId } from '../lib/deployment-contracts.mjs'
import { PlatformPaths, preparePersistentLayout } from '../lib/paths.mjs'

test('builds a complete content-addressed Managed Deployment from verified inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-managed-store-'))
  const paths = new PlatformPaths(join(root, 'data'), join(root, 'run'))
  await preparePersistentLayout(paths)

  const dependencyRoot = join(root, 'dependency', 'package')
  await mkdir(join(dependencyRoot, 'lib'), { recursive: true })
  await writeFile(join(dependencyRoot, 'package.json'), JSON.stringify({ name: 'fixture-dependency', version: '1.0.0' }))
  await writeFile(join(dependencyRoot, 'lib', 'index.js'), 'export const installed = true\n')
  const dependencyArchive = join(root, 'fixture-dependency.tgz')
  const packedDependency = spawnSync('tar', ['-czf', dependencyArchive, '-C', join(root, 'dependency'), 'package'], { encoding: 'utf8' })
  assert.equal(packedDependency.status, 0, packedDependency.stderr)

  const packageRoot = join(root, 'source', 'package')
  await mkdir(join(packageRoot, 'lib'), { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh',
    version: '0.1.0-rc.8',
    dependencies: { 'fixture-dependency': `file:${dependencyArchive}` },
  }))
  await writeFile(join(packageRoot, 'lib', 'bin.js'), '#!/usr/bin/env node\n')
  const archive = join(root, 'dsh.tgz')
  const packed = spawnSync('tar', ['-czf', archive, '-C', join(root, 'source'), 'package'], { encoding: 'utf8' })
  assert.equal(packed.status, 0, packed.stderr)
  const archiveBytes = await readFile(archive)
  const objectSha256 = createHash('sha256').update(archiveBytes).digest('hex')
  const trustedObjectPath = join(paths.objectsRoot, objectSha256)
  await writeFile(trustedObjectPath, archiveBytes)

  const manifestPath = join(root, 'environment.manifest.json')
  const manifest = {
    schema: 1,
    manifestType: 'environment',
    version: '1.0.0',
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
    dsh: { version: '0.1.0-rc.8', receipt: { path: trustedObjectPath, objectSha256 } },
    receiptTokens: ['stable-receipt', 'dsh-receipt'],
  }

  const builder = new ManagedDeploymentBuilder({ paths })
  const progress = []
  const first = await builder.buildStable(prepared, { onProgress: async value => progress.push(value) })
  assert.deepEqual(progress.filter(value => typeof value === 'number'), [80, 82, 87, 89])
  const runtimeProgress = progress.filter(value => typeof value === 'object')
  assert.ok(runtimeProgress.length > 0)
  assert.equal(runtimeProgress.at(-1).processedBytes, runtimeProgress.at(-1).totalBytes)
  assert.equal(runtimeProgress.at(-1).processedItems, runtimeProgress.at(-1).totalItems)
  assert.equal(first.assets.pristine.id, `pristine-npm-${objectSha256}`)
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
  assert.equal(
    await readFile(join(first.assets.pristine.path, 'node_modules', 'fixture-dependency', 'lib', 'index.js'), 'utf8'),
    'export const installed = true\n',
  )
  await assert.rejects(lstat(join(first.assets.pristine.path, 'npm-cache')), error => error?.code === 'ENOENT')
  assert.deepEqual(await readFile(trustedObjectPath), archiveBytes)
  assert.equal((await lstat(trustedObjectPath)).isSymbolicLink(), false)
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
  const { id: _stableId, ...developmentContent } = first.record
  developmentContent.authority = 'development'
  developmentContent.targetSequence = 0
  const developmentRecord = { ...developmentContent, id: deriveRecordId('deployment-record', developmentContent) }
  const experimental = await builder.buildExperimental({
    version: '0.1.0-rc.9',
    receipt: {
      path: experimentalArchive,
      objectSha256: createHash('sha256').update(await readFile(experimentalArchive)).digest('hex'),
    },
  }, developmentRecord, ['stable-receipt', 'experimental-receipt'], { targetSequence: 11 })
  assert.equal(experimental.record.authority, 'experimental')
  assert.equal(experimental.record.targetSequence, 11)
  assert.equal(experimental.record.dshVersion, '0.1.0-rc.9')
  assert.deepEqual(experimental.record.environment, first.record.environment)
  assert.deepEqual(experimental.record.systemPlugins, first.record.systemPlugins)
  assert.notEqual(experimental.record.pristine.id, first.record.pristine.id)
  assert.notEqual(experimental.record.runtime.id, first.record.runtime.id)
  assert.deepEqual(experimental.record.receiptTokens, ['stable-receipt', 'experimental-receipt'])
})
