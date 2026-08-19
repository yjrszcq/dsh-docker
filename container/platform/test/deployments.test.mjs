import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DeploymentManager } from '../bootstrap/lib/deployments.mjs'
import { canonicalJson } from '../lib/canonical-json.mjs'
import {
  deriveImageBuildId,
  deriveRecordId,
  parseDeploymentRecord,
  parseImageInventory,
  recordsFromImageInventory,
} from '../lib/deployment-contracts.mjs'
import { PlatformPaths, preparePersistentLayout, resetRuntimeLayout } from '../lib/paths.mjs'
import { hashTree } from '../lib/tree-hash.mjs'

const kinds = ['environment', 'pristine', 'runtime', 'system-plugins']

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-deployments-'))
  const seedRoot = join(root, 'seed')
  const paths = new PlatformPaths(join(root, 'data'), join(root, 'run'))
  const assets = {}
  for (const kind of kinds) {
    const plural = kind === 'environment' ? 'environments' : kind === 'runtime' ? 'runtimes' : kind
    const id = `image-${kind}`
    const path = join(seedRoot, plural, id)
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'sentinel'), `${kind}:image`)
    assets[kind] = { id, sha256: await hashTree(path) }
  }
  const content = {
    schema: 1,
    authority: 'stable',
    platformRevision: 'deployment-fixture',
    targetSequence: 1,
    bootstrapApi: 1,
    updateApi: 1,
    bootstrap: { version: '1.0.0', id: 'bootstrap', sha256: 'a'.repeat(64) },
    deployment: {
      id: 'image-deployment',
      dshVersion: '0.1.0-rc.1',
      environmentVersion: '2026.08.19.1',
      environment: assets.environment,
      pristine: assets.pristine,
      runtime: assets.runtime,
      systemPlugins: assets['system-plugins'],
    },
  }
  const inventory = parseImageInventory({ ...content, imageBuildId: deriveImageBuildId(content) })
  await preparePersistentLayout(paths)
  await resetRuntimeLayout(paths)
  const manager = new DeploymentManager({ paths, seedRoot, inventory })
  return { root, seedRoot, paths, inventory, manager, image: recordsFromImageInventory(inventory).deployment }
}

async function managedRecord(context, suffix, sequence = 2) {
  const references = {}
  for (const kind of kinds) {
    const root = kind === 'environment'
      ? context.paths.environmentsRoot
      : kind === 'pristine'
        ? context.paths.pristineRoot
        : kind === 'runtime'
          ? context.paths.runtimesRoot
          : context.paths.systemPluginsRoot
    const id = `managed-${kind}-${suffix}`
    const path = join(root, id)
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'sentinel'), `${kind}:${suffix}`)
    references[kind] = { storage: 'store', kind, id, sha256: await hashTree(path) }
  }
  const content = {
    schema: 1,
    authority: 'stable',
    targetSequence: sequence,
    dshVersion: `0.1.0-rc.${String(sequence)}`,
    environmentVersion: '2026.08.19.1',
    environment: references.environment,
    pristine: references.pristine,
    runtime: references.runtime,
    systemPlugins: references['system-plugins'],
    receiptTokens: [],
    snapshotId: null,
  }
  return parseDeploymentRecord({ ...content, id: deriveRecordId('deployment-record', content) })
}

test('initializes an Image Deployment through one atomic runtime view', async () => {
  const context = await fixture()
  const state = await context.manager.initialize(context.image)
  assert.equal(state.current, context.image.id)
  assert.equal(state.previous, null)
  assert.equal(await readFile(join(context.paths.viewsRoot, 'runtime', 'sentinel'), 'utf8'), 'runtime:image')
  assert.match(await readlink(context.paths.deploymentView), new RegExp(`${context.image.id}$`))
})

test('commits a complete managed Deployment only after candidate health succeeds', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const candidate = await context.manager.writeRecord(await managedRecord(context, 'next'))
  let observed
  const state = await context.manager.activate(candidate.id, async () => {
    observed = await Promise.all(kinds.map(kind => readFile(join(context.paths.deploymentView, kind, 'sentinel'), 'utf8')))
  })
  assert.deepEqual(observed, kinds.map(kind => `${kind}:next`))
  assert.equal(state.current, candidate.id)
  assert.equal(state.previous, context.image.id)
})

test('restores the prior complete view and leaves slots unchanged when health fails', async () => {
  const context = await fixture()
  const before = await context.manager.initialize(context.image)
  const candidate = await context.manager.writeRecord(await managedRecord(context, 'broken'))
  await assert.rejects(context.manager.activate(candidate.id, async () => {
    const value = await readFile(join(context.paths.deploymentView, 'runtime', 'sentinel'), 'utf8')
    if (value === 'runtime:broken') throw new Error('candidate unhealthy')
  }), /candidate unhealthy/)
  assert.deepEqual(await context.manager.state(), before)
  assert.equal(await readFile(join(context.paths.viewsRoot, 'runtime', 'sentinel'), 'utf8'), 'runtime:image')
})

test('rejects modified managed content and stale Image References', async () => {
  const context = await fixture()
  const candidate = await context.manager.writeRecord(await managedRecord(context, 'tampered'))
  await writeFile(join(context.paths.runtimesRoot, candidate.runtime.id, 'sentinel'), 'changed')
  await assert.rejects(context.manager.prepareView(candidate.id), /content hash differs/)

  await context.manager.writeRecord(context.image)
  const changedContent = { ...context.inventory.document, platformRevision: 'new-image' }
  delete changedContent.imageBuildId
  const changedInventory = parseImageInventory({ ...changedContent, imageBuildId: deriveImageBuildId(changedContent) })
  const changedManager = new DeploymentManager({ paths: context.paths, seedRoot: context.seedRoot, inventory: changedInventory })
  await assert.rejects(changedManager.prepareView(context.image.id), /different image/)
})

test('writes immutable Deployment Record bytes', async () => {
  const context = await fixture()
  await context.manager.writeRecord(context.image)
  assert.deepEqual(
    await readFile(context.manager.recordPath(context.image.id)),
    canonicalJson(context.image),
  )
})
