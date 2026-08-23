import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdtemp, mkdir, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DeploymentManager, DeploymentResolutionError } from '../bootstrap/lib/deployments.mjs'
import { PlatformGarbageCollector } from '../bootstrap/lib/gc.mjs'
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
import { buildRuntime } from '../../control-plane/modules/patch-manager/index.mjs'

const kinds = ['environment', 'pristine', 'runtime', 'system-plugins']

async function fixture({
  root,
  paths,
  authority = 'stable',
  targetSequence = 1,
  marker = 'image',
} = {}) {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-deployments-'))
  paths ??= new PlatformPaths(join(root, 'data'), join(root, 'run'))
  const seedRoot = join(root, `seed-${marker}`)
  const assets = {}
  for (const kind of kinds) {
    const plural = kind === 'environment' ? 'environments' : kind === 'runtime' ? 'runtimes' : kind
    const id = `image-${kind}-${marker}`
    const path = join(seedRoot, plural, id)
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'sentinel'), `${kind}:${marker}`)
    assets[kind] = { id, sha256: await hashTree(path) }
  }
  const content = {
    schema: 1,
    authority,
    platformRevision: `deployment-fixture-${marker}`,
    targetSequence,
    bootstrapApi: 1,
    updateApi: 1,
    bootstrap: { version: '1.0.0', id: 'bootstrap', sha256: 'a'.repeat(64) },
    deployment: {
      id: `image-deployment-${marker}`,
      dshVersion: '0.1.0-rc.1',
      environmentVersion: '1.0.0',
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

async function repairableFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-reset-'))
  const paths = new PlatformPaths(join(root, 'data'), join(root, 'run'))
  const seedRoot = join(root, 'seed')
  const pristineRoot = join(seedRoot, 'pristine', 'dsh')
  const environmentRoot = join(seedRoot, 'environments', 'environment')
  const runtimeRoot = join(seedRoot, 'runtimes', 'dsh')
  const systemPluginsRoot = join(seedRoot, 'system-plugins', 'environment')
  await mkdir(join(pristineRoot, 'lib'), { recursive: true })
  await mkdir(join(environmentRoot, 'artifacts'), { recursive: true })
  await mkdir(systemPluginsRoot, { recursive: true })
  await writeFile(join(pristineRoot, 'lib', 'bin.js'), '#!/usr/bin/env node\n')
  const patch = [
    "import { readFile, writeFile } from 'node:fs/promises'",
    "import { join } from 'node:path'",
    "export async function applyPatch(root) { await writeFile(join(root, 'patched.txt'), 'patched\\n') }",
    "export async function verifyPatch(root) { if (await readFile(join(root, 'patched.txt'), 'utf8') !== 'patched\\n') throw new Error('patch missing') }",
    '',
  ].join('\n')
  const patchBytes = Buffer.from(patch)
  const patchSha256 = createHash('sha256').update(patchBytes).digest('hex')
  await writeFile(join(environmentRoot, 'artifacts', 'runtime-patch'), patchBytes)
  await writeFile(join(environmentRoot, 'environment.manifest.json'), JSON.stringify({
    schema: 1,
    manifestType: 'environment',
    version: '1.0.0',
    keyringGeneration: 1,
    targetSequence: 1,
    issuedAt: '2026-08-20T00:00:00.000Z',
    artifacts: [{
      id: 'runtime-patch',
      mediaType: 'text/javascript',
      sha256: patchSha256,
      size: patchBytes.byteLength,
      url: 'https://example.invalid/runtime-patch',
    }],
    bootstrapApi: 1,
    components: [],
    patches: [{ id: 'runtime-patch', sha256: patchSha256 }],
    systemPlugins: [],
  }))
  await buildRuntime({
    pristineRoot,
    versionsRoot: join(seedRoot, 'runtimes'),
    runtimeId: 'dsh',
    patchPaths: [join(environmentRoot, 'artifacts', 'runtime-patch')],
  })
  const assets = {
    environment: { id: 'environment', sha256: await hashTree(environmentRoot) },
    pristine: { id: 'dsh', sha256: await hashTree(pristineRoot) },
    runtime: { id: 'dsh', sha256: await hashTree(runtimeRoot) },
    systemPlugins: { id: 'environment', sha256: await hashTree(systemPluginsRoot) },
  }
  const content = {
    schema: 1,
    authority: 'development',
    platformRevision: 'runtime-reset-fixture',
    targetSequence: 0,
    bootstrapApi: 1,
    updateApi: 1,
    bootstrap: { version: '1.0.0', id: 'bootstrap', sha256: 'a'.repeat(64) },
    deployment: {
      id: 'image-deployment-runtime-reset',
      dshVersion: '0.1.0-rc.1',
      environmentVersion: '1.0.0',
      ...assets,
    },
  }
  const inventory = parseImageInventory({ ...content, imageBuildId: deriveImageBuildId(content) })
  await preparePersistentLayout(paths)
  await resetRuntimeLayout(paths)
  const manager = new DeploymentManager({ paths, seedRoot, inventory })
  const image = recordsFromImageInventory(inventory).deployment
  await manager.initialize(image)
  return { root, paths, seedRoot, manager, image, environmentRoot }
}

async function managedRecord(
  context,
  suffix,
  sequence = 2,
  authority = 'stable',
  dshVersion = `0.1.0-rc.${String(sequence)}`,
  receiptTokens = [],
) {
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
    authority,
    targetSequence: sequence,
    dshVersion,
    environmentVersion: '1.0.0',
    environment: references.environment,
    pristine: references.pristine,
    runtime: references.runtime,
    systemPlugins: references['system-plugins'],
    receiptTokens,
    snapshotId: null,
  }
  return parseDeploymentRecord({ ...content, id: deriveRecordId('deployment-record', content) })
}

async function experimentalRecord(context, from, suffix, dshVersion, receiptTokens = []) {
  const built = await managedRecord(context, suffix, from.targetSequence, 'experimental', dshVersion, receiptTokens)
  const content = {
    ...built,
    environmentVersion: from.environmentVersion,
    environment: from.environment,
    systemPlugins: from.systemPlugins,
  }
  delete content.id
  return parseDeploymentRecord({ ...content, id: deriveRecordId('deployment-record', content) })
}

test('initializes an Image Deployment through one atomic runtime view', async () => {
  const context = await fixture()
  const state = await context.manager.initialize(context.image)
  assert.equal(state.current, context.image.id)
  assert.equal(state.previous, null)
  assert.equal(await readFile(join(context.paths.viewsRoot, 'runtime', 'sentinel'), 'utf8'), 'runtime:image')
  assert.match(await readlink(context.paths.deploymentView), new RegExp(`${context.image.id}$`))
  assert.equal(
    await readlink(join(context.paths.viewsRoot, 'system-plugins')),
    join('..', 'system-plugin-views', 'current'),
  )
  assert.equal(
    await readlink(join(context.paths.systemPluginViewsRoot, 'current')),
    join(context.paths.deploymentView, 'system-plugins'),
  )
  assert.equal((await context.manager.selected()).record.id, context.image.id)
  const status = await context.manager.publishStatus()
  assert.equal(status.platformLayout, 1)
  assert.equal(status.imageBaseline.imageBuildId, context.inventory.imageBuildId)
  assert.equal(status.current.recordId, context.image.id)
  assert.equal(status.current.source, 'image')
  assert.equal(status.recoveryMode, null)
})

test('rebuilds image and managed Runtime bytes without changing versions or previous Deployment', async () => {
  const context = await repairableFixture()
  let pauses = 0
  let restarts = 0
  const reset = () => context.manager.resetCurrentRuntime({
    pauseDsh: async () => { pauses += 1 },
    restartDsh: async () => {
      restarts += 1
      assert.equal(await readFile(join(context.paths.viewsRoot, 'runtime', 'package', 'patched.txt'), 'utf8'), 'patched\n')
    },
  })
  const first = await reset()
  assert.notEqual(first.recordId, context.image.id)
  assert.equal(first.slots.previous, null)
  const repaired = await context.manager.record(first.recordId)
  assert.equal(repaired.runtime.storage, 'store')
  assert.equal(repaired.dshVersion, context.image.dshVersion)
  assert.equal(repaired.environmentVersion, context.image.environmentVersion)
  assert.deepEqual(await readdir(context.paths.runtimesRoot), [repaired.runtime.id])

  const materialized = await context.manager.materializeCurrent()
  assert.equal(materialized.runtime.storage, 'store')
  assert.notEqual(materialized.id, repaired.id)
  assert.equal(materialized.runtime.id, repaired.runtime.id)
  assert.equal((await context.manager.state()).previous, null)
  const managedRuntime = join(context.paths.runtimesRoot, materialized.runtime.id)
  await writeFile(join(managedRuntime, 'package', 'patched.txt'), 'corrupt-again\n')
  const second = await reset()
  assert.equal(second.recordId, materialized.id)
  assert.equal(second.slots.previous, null)
  assert.equal(await hashTree(managedRuntime), materialized.runtime.sha256)
  assert.equal(pauses, 2)
  assert.equal(restarts, 2)

  await writeFile(join(managedRuntime, 'package', 'patched.txt'), 'runtime-before-failed-reset\n')
  let failedResetRestarts = 0
  await assert.rejects(context.manager.resetCurrentRuntime({
    pauseDsh: async () => { pauses += 1 },
    restartDsh: async () => {
      failedResetRestarts += 1
      const content = await readFile(join(context.paths.viewsRoot, 'runtime', 'package', 'patched.txt'), 'utf8')
      if (failedResetRestarts === 1) {
        assert.equal(content, 'patched\n')
        throw new Error('repaired Runtime failed to start')
      }
      assert.equal(content, 'runtime-before-failed-reset\n')
    },
  }), /repaired Runtime failed to start/)
  assert.equal(failedResetRestarts, 2)
  assert.equal(await readFile(join(managedRuntime, 'package', 'patched.txt'), 'utf8'), 'runtime-before-failed-reset\n')
  assert.deepEqual(await context.manager.state(), second.slots)

  await writeFile(join(context.paths.environmentsRoot, materialized.environment.id, 'artifacts', 'runtime-patch'), 'corrupt artifact\n')
  await assert.rejects(reset(), /differs from (?:its Record|the Environment Manifest)/)
  assert.equal(pauses, 3)
  assert.equal(restarts, 2)
})

test('updates a runtime operation without replacing deployment identity fields', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const before = await context.manager.publishStatus({ recoveryMode: 'diagnostic-state' })
  const restarting = await context.manager.setOperation('restarting')
  assert.deepEqual(restarting, { ...before, operation: 'restarting' })
  const ready = await context.manager.setOperation(null)
  assert.deepEqual(ready, before)
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

test('materializes an Image Deployment as a complete Managed previous state', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const materialized = await context.manager.materializeCurrent()
  assert.notEqual(materialized.id, context.image.id)
  assert.equal(materialized.dshVersion, context.image.dshVersion)
  for (const field of ['environment', 'pristine', 'runtime', 'systemPlugins']) {
    assert.equal(materialized[field].storage, 'store')
    const resolved = await context.manager.resolveReference(materialized[field])
    assert.equal((await lstat(resolved)).isDirectory(), true)
  }
  assert.equal((await context.manager.state()).current, materialized.id)
})

test('advances to a newer image only after startup acceptance', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const nextContent = {
    ...context.inventory.document,
    platformRevision: 'deployment-fixture-next',
    targetSequence: 2,
  }
  delete nextContent.imageBuildId
  const nextInventory = parseImageInventory({ ...nextContent, imageBuildId: deriveImageBuildId(nextContent) })
  const nextRecord = recordsFromImageInventory(nextInventory).deployment
  const restarted = new DeploymentManager({ paths: context.paths, seedRoot: context.seedRoot, inventory: nextInventory })
  const plan = await restarted.prepareImage(nextRecord)
  assert.equal(plan.action, 'image-forward')
  assert.equal((await restarted.state()).current, context.image.id)
  const state = await restarted.acceptImage(plan)
  assert.equal(state.current, nextRecord.id)
  assert.equal(state.previous, context.image.id)
})

test('does not advertise a rollback to assets owned by another Docker image', async () => {
  const first = await fixture({ targetSequence: 1, marker: 'rollback-first' })
  await first.manager.initialize(first.image)
  const second = await fixture({
    root: first.root,
    paths: first.paths,
    targetSequence: 2,
    marker: 'rollback-second',
  })
  const plan = await second.manager.prepareImage(second.image)
  await second.manager.acceptImage(plan)

  const rollback = await second.manager.rollbackPlan()
  assert.equal(rollback.current.id, second.image.id)
  assert.equal(rollback.previous, null)
})

test('selects the prior Deployment directly after an explicit Docker image rollback', async () => {
  const first = await fixture({ targetSequence: 1, marker: 'docker-rollback-first' })
  await first.manager.initialize(first.image)
  const second = await fixture({
    root: first.root,
    paths: first.paths,
    targetSequence: 2,
    marker: 'docker-rollback-second',
  })
  await second.manager.acceptImage(await second.manager.prepareImage(second.image))

  const rolledBack = new DeploymentManager({
    paths: first.paths,
    seedRoot: first.seedRoot,
    inventory: first.inventory,
  })
  const rollback = await rolledBack.prepareImage(first.image)
  assert.equal(rollback.action, 'image-rollback')
  assert.equal(rollback.target, first.image.id)
  await rolledBack.acceptImage(rollback)
  assert.equal((await rolledBack.state()).current, first.image.id)
})

test('rejects an unresolvable newer image candidate and keeps the valid current Deployment', async () => {
  const current = await fixture({ targetSequence: 1, marker: 'current' })
  await current.manager.initialize(current.image)
  const managed = await current.manager.materializeCurrent()
  const candidateContent = {
    ...current.inventory.document,
    platformRevision: 'deployment-fixture-candidate-missing',
    targetSequence: 2,
  }
  delete candidateContent.imageBuildId
  const inventory = parseImageInventory({
    ...candidateContent,
    imageBuildId: deriveImageBuildId(candidateContent),
  })
  const candidate = recordsFromImageInventory(inventory).deployment
  await rm(join(current.seedRoot, 'runtimes', inventory.deployment.runtime.id), { recursive: true })
  const manager = new DeploymentManager({ paths: current.paths, seedRoot: current.seedRoot, inventory })
  const plan = await manager.prepareImage(candidate)
  assert.equal(plan.action, 'image-rejected')
  assert.equal(plan.target, managed.id)
  assert.match(plan.candidateError, /ENOENT/)
  assert.equal((await manager.selected()).record.id, managed.id)
  assert.equal((await manager.state()).current, managed.id)
})

test('commits previous only after an invalid current resolves and previous receipts activate', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const previous = await managedRecord(context, 'previous-valid', 2, 'stable', '0.1.0-rc.2', ['receipt-previous'])
  const current = await managedRecord(context, 'current-invalid', 3, 'stable', '0.1.0-rc.3', ['receipt-current'])
  await context.manager.activateManaged(previous, { healthCheck: async () => {}, activateReceipts: async () => {} })
  await context.manager.activateManaged(current, { healthCheck: async () => {}, activateReceipts: async () => {} })
  await rm(join(context.paths.runtimesRoot, current.runtime.id), { recursive: true })

  const manager = new DeploymentManager({ paths: context.paths, seedRoot: context.seedRoot, inventory: context.inventory })
  await assert.rejects(manager.prepareImage(context.image), DeploymentResolutionError)
  const plan = await manager.preparePreviousRecovery()
  assert.equal((await manager.selected()).record.id, previous.id)
  assert.deepEqual(await manager.state(), { schema: 1, generation: 4, current: current.id, previous: previous.id })
  const activations = []
  await manager.acceptPreviousRecovery(plan, async tokens => { activations.push(tokens) })
  assert.deepEqual(activations, [['receipt-previous']])
  assert.deepEqual(await manager.state(), { schema: 1, generation: 5, current: previous.id, previous: current.id })
})

test('finishes automatic previous recovery after interruption between receipts and slots', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const previous = await managedRecord(context, 'recovery-interrupted-previous', 2, 'stable', '0.1.0-rc.2', ['receipt-previous'])
  const current = await managedRecord(context, 'recovery-interrupted-current', 3, 'stable', '0.1.0-rc.3', ['receipt-current'])
  await context.manager.activateManaged(previous, { healthCheck: async () => {}, activateReceipts: async () => {} })
  await context.manager.activateManaged(current, { healthCheck: async () => {}, activateReceipts: async () => {} })

  const manager = new DeploymentManager({ paths: context.paths, seedRoot: context.seedRoot, inventory: context.inventory })
  const plan = await manager.preparePreviousRecovery()
  manager.commit = async () => { throw new Error('simulated interruption before slots commit') }
  await assert.rejects(
    manager.acceptPreviousRecovery(plan, async tokens => assert.deepEqual(tokens, ['receipt-previous'])),
    /simulated interruption/,
  )
  assert.equal((await manager.activation()).phase, 'receipts-active')
  assert.equal((await manager.state()).current, current.id)

  const restarted = new DeploymentManager({ paths: context.paths, seedRoot: context.seedRoot, inventory: context.inventory })
  const recovered = await restarted.recoverActivation({
    activeReceipts: async () => ({ receipts: [{ token: 'receipt-previous' }] }),
    activate: async () => { throw new Error('active previous must be completed') },
  })
  assert.deepEqual(recovered, { action: 'committed', recordId: previous.id })
  assert.deepEqual(await restarted.state(), { schema: 1, generation: 5, current: previous.id, previous: current.id })
  assert.equal(await restarted.activation(), undefined)
})

test('does not automatically downgrade an unparseable current Deployment Record', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const previous = await managedRecord(context, 'record-valid-previous', 2)
  const current = await managedRecord(context, 'record-corrupt-current', 3)
  await context.manager.activateManaged(previous, { healthCheck: async () => {}, activateReceipts: async () => {} })
  await context.manager.activateManaged(current, { healthCheck: async () => {}, activateReceipts: async () => {} })
  await writeFile(context.manager.recordPath(current.id), '{invalid')

  const manager = new DeploymentManager({ paths: context.paths, seedRoot: context.seedRoot, inventory: context.inventory })
  await assert.rejects(manager.prepareImage(context.image), error => {
    assert.equal(error instanceof DeploymentResolutionError, false)
    assert.match(error.message, /valid JSON/)
    return true
  })
  await assert.rejects(manager.preparePreviousRecovery(), /valid JSON/)
  assert.deepEqual(await manager.state(), { schema: 1, generation: 4, current: current.id, previous: previous.id })
})

test('keeps a newer managed Deployment when the image is behind', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const managed = await context.manager.writeRecord(await managedRecord(context, 'ahead', 3))
  await context.manager.activate(managed.id, async () => {})
  const plan = await context.manager.prepareImage(context.image)
  assert.equal(plan.action, 'retain')
  assert.equal(plan.imageBehindCurrent, true)
  assert.equal(plan.target, managed.id)
})

test('rejects same-sequence Stable content conflicts', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const conflicting = await context.manager.writeRecord(await managedRecord(context, 'conflict', 1))
  await context.manager.activate(conflicting.id, async () => {})
  await assert.rejects(context.manager.prepareImage(context.image), /same targetSequence/)
})

test('replaces a rebuilt development image without retaining stale image slots', async () => {
  const first = await fixture({ authority: 'development', targetSequence: 0, marker: 'development-one' })
  await first.manager.initialize(first.image)
  const rebuilt = await fixture({
    root: first.root,
    paths: first.paths,
    authority: 'development',
    targetSequence: 0,
    marker: 'development-two',
  })
  const plan = await rebuilt.manager.prepareImage(rebuilt.image)
  assert.equal(plan.action, 'development-refresh')
  assert.equal(plan.fallback, null)
  assert.equal(await readFile(join(rebuilt.paths.viewsRoot, 'runtime', 'sentinel'), 'utf8'), 'runtime:development-two')
  const state = await rebuilt.manager.acceptImage(plan)
  assert.equal(state.current, rebuilt.image.id)
  assert.equal(state.previous, null)
})

test('replaces stale formal Image Deployment slots when starting a development image', async () => {
  const formal = await fixture({ authority: 'stable', targetSequence: 11, marker: 'formal-eleven' })
  await formal.manager.initialize(formal.image)
  const development = await fixture({
    root: formal.root,
    paths: formal.paths,
    authority: 'development',
    targetSequence: 0,
    marker: 'local-rebuild',
  })
  const plan = await development.manager.prepareImage(development.image)
  assert.equal(plan.action, 'development-refresh')
  assert.equal(plan.fallback, null)
  const state = await development.manager.acceptImage(plan)
  assert.equal(state.current, development.image.id)
  assert.equal(state.previous, null)
  assert.equal(await readFile(join(development.paths.viewsRoot, 'runtime', 'sentinel'), 'utf8'), 'runtime:local-rebuild')
})

test('replaces stale Managed Deployment assets when starting a compatible development image', async () => {
  const formal = await fixture({ authority: 'stable', targetSequence: 11, marker: 'formal-eleven' })
  await formal.manager.initialize(formal.image)
  const managed = await formal.manager.writeRecord(await managedRecord(
    formal,
    'managed-eleven',
    11,
    'stable',
    '0.1.0-rc.1',
  ))
  await formal.manager.activate(managed.id, async () => {})
  const development = await fixture({
    root: formal.root,
    paths: formal.paths,
    authority: 'development',
    targetSequence: 0,
    marker: 'local-managed-refresh',
  })
  const plan = await development.manager.prepareImage(development.image)
  assert.equal(plan.action, 'development-refresh')
  assert.equal(plan.fallback, null)
  const state = await development.manager.acceptImage(plan)
  assert.equal(state.current, development.image.id)
  assert.equal(state.previous, null)
  assert.equal(
    await readFile(join(development.paths.viewsRoot, 'system-plugins', 'sentinel'), 'utf8'),
    'system-plugins:local-managed-refresh',
  )
})

test('preserves Experimental DSH until a Stable image catches up', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const experimental = await context.manager.writeRecord(await managedRecord(
    context,
    'experimental',
    1,
    'experimental',
    '0.1.0-rc.3',
  ))
  await context.manager.activate(experimental.id, async () => {})

  const behindDshContent = {
    ...context.inventory.document,
    platformRevision: 'stable-environment-forward',
    targetSequence: 2,
  }
  delete behindDshContent.imageBuildId
  const behindDshInventory = parseImageInventory({
    ...behindDshContent,
    imageBuildId: deriveImageBuildId(behindDshContent),
  })
  const environmentForward = new DeploymentManager({
    paths: context.paths,
    seedRoot: context.seedRoot,
    inventory: behindDshInventory,
  })
  const retained = await environmentForward.prepareImage(recordsFromImageInventory(behindDshInventory).deployment)
  assert.equal(retained.target, experimental.id)
  assert.equal(retained.requiresExperimentalRebuild, true)

  const caughtUpContent = structuredClone(behindDshContent)
  caughtUpContent.platformRevision = 'stable-caught-up'
  caughtUpContent.deployment.dshVersion = '0.1.0-rc.3'
  const caughtUpInventory = parseImageInventory({
    ...caughtUpContent,
    imageBuildId: deriveImageBuildId(caughtUpContent),
  })
  const caughtUpManager = new DeploymentManager({
    paths: context.paths,
    seedRoot: context.seedRoot,
    inventory: caughtUpInventory,
  })
  const caughtUp = await caughtUpManager.prepareImage(recordsFromImageInventory(caughtUpInventory).deployment)
  assert.equal(caughtUp.action, 'stable-caught-up')
  assert.notEqual(caughtUp.target, experimental.id)
})

test('activates receipts and commits one complete Managed Deployment transaction', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const candidate = await managedRecord(context, 'transaction', 2, 'stable', '0.1.0-rc.2', ['candidate-receipt'])
  let active = []
  const trust = {
    activate: async tokens => { active = [...tokens] },
    activeReceipts: async () => ({ receipts: active.map(token => ({ token })) }),
  }
  const slots = await context.manager.activateManaged(candidate, {
    healthCheck: async () => {
      assert.equal(await readFile(join(context.paths.viewsRoot, 'runtime', 'sentinel'), 'utf8'), 'runtime:transaction')
    },
    activateReceipts: tokens => trust.activate(tokens),
  })
  assert.equal(slots.current, candidate.id)
  assert.deepEqual(active, ['candidate-receipt'])
  const previous = await context.manager.record(slots.previous)
  assert.equal(previous.runtime.storage, 'store')
  assert.equal(await context.manager.activation(), undefined)
})

test('rolls back only the exact previous Deployment with receipts and health checks', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const candidate = await managedRecord(context, 'rollback-target', 2, 'stable', '0.1.0-rc.2', ['candidate-receipt'])
  const active = []
  await context.manager.activateManaged(candidate, {
    healthCheck: async () => {},
    activateReceipts: async tokens => active.push([...tokens]),
  })
  const before = await context.manager.state()
  const previous = await context.manager.record(before.previous)
  let healthChecks = 0
  const rolledBack = await context.manager.rollback({
    healthCheck: async () => {
      healthChecks += 1
      assert.equal(JSON.parse(await readFile(context.paths.deploymentStatusPath, 'utf8')).operation, 'recovering')
    },
    activateReceipts: async tokens => active.push([...tokens]),
  })
  assert.equal(rolledBack.current, previous.id)
  assert.equal(rolledBack.previous, candidate.id)
  assert.deepEqual(active.at(-1), previous.receiptTokens)
  assert.equal(healthChecks, 1)
  assert.equal(await context.manager.activation(), undefined)
  const status = await context.manager.publishStatus()
  assert.equal(status.current.recordId, previous.id)
  assert.equal(status.operation, null)
})

test('reports an image behind a newly activated Managed Deployment immediately', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const candidate = await managedRecord(context, 'status-ahead', 2, 'stable', '0.1.0-rc.2')
  await context.manager.activateManaged(candidate, {
    healthCheck: async () => {},
    activateReceipts: async () => {},
  })
  const status = await context.manager.publishStatus()
  assert.equal(status.current.recordId, candidate.id)
  assert.equal(status.imageBehindCurrent, true)
})

test('restores the materialized previous Deployment when receipt activation fails', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const candidate = await managedRecord(context, 'receipt-failure', 2, 'stable', '0.1.0-rc.2', ['candidate-receipt'])
  await assert.rejects(context.manager.activateManaged(candidate, {
    healthCheck: async () => {},
    activateReceipts: async () => { throw new Error('receipt activation failed') },
  }), /receipt activation failed/)
  const state = await context.manager.state()
  assert.notEqual(state.current, context.image.id)
  assert.equal((await context.manager.record(state.current)).runtime.storage, 'store')
  assert.equal(await readFile(join(context.paths.viewsRoot, 'runtime', 'sentinel'), 'utf8'), 'runtime:image')
  assert.equal(await context.manager.activation(), undefined)
})

test('publishes switching and recovering states around a failed atomic activation', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  await context.manager.publishStatus()
  const candidate = await managedRecord(context, 'operation-status', 2, 'stable', '0.1.0-rc.2')
  const observed = []
  await assert.rejects(context.manager.activateManaged(candidate, {
    healthCheck: async () => {
      observed.push(JSON.parse(await readFile(context.paths.deploymentStatusPath, 'utf8')).operation)
      if (observed.length === 1) throw new Error('candidate failed')
    },
    activateReceipts: async () => {},
  }), /candidate failed/)
  assert.deepEqual(observed, ['switching', 'recovering'])
  assert.equal(JSON.parse(await readFile(context.paths.deploymentStatusPath, 'utf8')).operation, null)
})

test('turns a failed image recovery operation into an explicit recovery failure', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  await context.manager.publishStatus({ recoveryMode: 'current deployment failed' })
  let operation
  await assert.rejects(context.manager.recoverImageBaseline(context.image, {
    healthCheck: async () => {
      const status = JSON.parse(await readFile(context.paths.deploymentStatusPath, 'utf8'))
      operation = status.operation
      assert.equal(status.recoveryMode, 'current deployment failed')
      throw new Error('image recovery health failed')
    },
    activateReceipts: async () => {},
  }), /image recovery health failed/)
  assert.equal(operation, 'recovering')
  const failed = JSON.parse(await readFile(context.paths.deploymentStatusPath, 'utf8'))
  assert.equal(failed.operation, null)
  assert.equal(failed.recoveryMode, 'image recovery health failed')
})

test('finishes a journaled activation after receipts became active before restart', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const from = await context.manager.materializeCurrent()
  const candidate = await context.manager.writeRecord(await managedRecord(
    context,
    'resume',
    2,
    'stable',
    '0.1.0-rc.2',
    ['candidate-receipt'],
  ))
  await context.manager.writeActivation({ phase: 'healthy', from: from.id, to: candidate.id })
  const recovered = await context.manager.recoverActivation({
    activeReceipts: async () => ({ receipts: [{ token: 'candidate-receipt' }] }),
    activate: async () => { throw new Error('active candidate must be completed') },
  })
  assert.deepEqual(recovered, { action: 'committed', recordId: candidate.id })
  assert.equal((await context.manager.state()).current, candidate.id)
  assert.equal(await context.manager.activation(), undefined)
})

test('keeps Experimental candidate slots uncommitted through probation and supports cancellation', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const candidate = await experimentalRecord(
    context,
    context.image,
    'probation',
    '0.1.0-rc.2',
    ['experimental-receipt'],
  )
  await context.manager.stageCandidate(candidate, async () => {
    assert.equal(await readFile(join(context.paths.viewsRoot, 'runtime', 'sentinel'), 'utf8'), 'runtime:probation')
  })
  const during = await context.manager.state()
  assert.notEqual(during.current, candidate.id)
  assert.equal((await context.manager.activation()).phase, 'probation')
  const cancelled = await context.manager.cancelCandidate()
  assert.equal(cancelled.cancelled, true)
  assert.equal(await readFile(join(context.paths.viewsRoot, 'runtime', 'sentinel'), 'utf8'), 'runtime:image')
  assert.equal(await context.manager.activation(), undefined)
})

test('rejects rollback and cross-authority candidates at the Bootstrap boundary', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const advanced = await managedRecord(context, 'advanced', 3)
  await context.manager.activateManaged(advanced, { healthCheck: async () => {}, activateReceipts: async () => {} })
  const rollback = await managedRecord(context, 'rollback', 2)
  await assert.rejects(context.manager.activateManaged(rollback, {
    healthCheck: async () => {}, activateReceipts: async () => {},
  }), /roll back/)
  const wrongExperimental = await managedRecord(context, 'wrong-environment', 3, 'experimental', '0.1.0-rc.4')
  await assert.rejects(context.manager.stageCandidate(wrongExperimental, async () => {}), /retain the current Environment/)
})

test('does not restart previous DSH before snapshot recovery after candidate health failure', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const candidate = await experimentalRecord(context, context.image, 'health-failure', '0.1.0-rc.2')
  let healthCalls = 0
  await assert.rejects(context.manager.stageCandidate(candidate, async () => {
    healthCalls += 1
    throw new Error('candidate failed health')
  }), /candidate failed health/)
  assert.equal(healthCalls, 1)
  assert.equal(await readFile(join(context.paths.viewsRoot, 'runtime', 'sentinel'), 'utf8'), 'runtime:image')
})

test('collects only Store assets and records outside slots, transactions, Holds, and snapshots', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const current = await context.manager.writeRecord(await managedRecord(context, 'current', 2))
  await context.manager.activateManaged(current, {
    healthCheck: async () => {},
    activateReceipts: async () => {},
  })
  const orphan = await context.manager.writeRecord(await managedRecord(context, 'orphan', 3))
  const held = await context.manager.writeRecord(await managedRecord(
    context,
    'held',
    4,
    'experimental',
    '0.1.0-rc.held',
  ))
  await writeFile(join(context.paths.updaterStateRoot, 'channel.json'), JSON.stringify({
    schema: 1,
    updateChannel: 'experimental',
    holds: [{
      id: 'hold', type: 'version', dshVersion: held.dshVersion, environmentVersion: null,
      reason: 'fixture', createdAt: '2026-08-19T00:00:00.000Z',
    }],
    experimentalBlocked: null,
  }))
  await mkdir(join(context.paths.snapshotsRoot, 'versions', 'snapshot-kept'), { recursive: true })
  await mkdir(join(context.paths.snapshotsRoot, 'versions', 'snapshot-orphan'), { recursive: true })
  await writeFile(join(context.paths.updaterStateRoot, 'transaction.json'), JSON.stringify({
    from: { runtime: current.id }, to: { runtime: current.id }, snapshotId: 'snapshot-kept',
  }))
  await writeFile(join(context.paths.downloadsRoot, 'disposable'), 'cache')

  const result = await new PlatformGarbageCollector({ paths: context.paths, deployments: context.manager }).collect()
  assert.equal(result.deployments.records.includes(orphan.id), true)
  assert.equal(result.deployments.records.includes(held.id), false)
  await assert.rejects(lstat(context.manager.recordPath(orphan.id)), { code: 'ENOENT' })
  assert.equal((await lstat(context.manager.recordPath(held.id))).isFile(), true)
  await assert.rejects(lstat(join(context.paths.runtimesRoot, orphan.runtime.id)), { code: 'ENOENT' })
  assert.equal((await lstat(join(context.paths.runtimesRoot, held.runtime.id))).isDirectory(), true)
  assert.equal((await lstat(join(context.paths.snapshotsRoot, 'versions', 'snapshot-kept'))).isDirectory(), true)
  await assert.rejects(lstat(join(context.paths.snapshotsRoot, 'versions', 'snapshot-orphan')), { code: 'ENOENT' })
  await assert.rejects(lstat(join(context.paths.downloadsRoot, 'disposable')), { code: 'ENOENT' })
})

test('explicit recovery replaces an invalid Managed current with the exact Image Baseline', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const managed = await managedRecord(context, 'invalid-managed', 3)
  await context.manager.activateManaged(managed, { healthCheck: async () => {}, activateReceipts: async () => {} })
  let activated
  const state = await context.manager.recoverImageBaseline(context.image, {
    healthCheck: async () => {
      assert.equal(await readFile(join(context.paths.viewsRoot, 'runtime', 'sentinel'), 'utf8'), 'runtime:image')
    },
    activateReceipts: async tokens => { activated = tokens },
  })
  assert.equal(state.current, context.image.id)
  assert.equal(state.previous, managed.id)
  assert.deepEqual(activated, [])
})

test('explicit recovery repairs only the exact image Record after its persisted bytes are damaged', async () => {
  const context = await fixture()
  await context.manager.initialize(context.image)
  const managed = await managedRecord(context, 'managed-before-repair', 3)
  await context.manager.activateManaged(managed, { healthCheck: async () => {}, activateReceipts: async () => {} })
  await writeFile(context.manager.recordPath(context.image.id), '{"damaged":true}\n')
  const state = await context.manager.recoverImageBaseline(context.image, {
    healthCheck: async () => {},
    activateReceipts: async () => {},
  })
  assert.equal(state.current, context.image.id)
  assert.deepEqual(await context.manager.record(context.image.id), context.image)
  await assert.rejects(context.manager.repairImageRecord(managed), /differs from the current image inventory/)
})
