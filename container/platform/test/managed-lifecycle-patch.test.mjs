import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import {
  applyPatch,
  MANAGED_LIFECYCLE_MODULE,
  PROFILE_PACKAGE_STORAGE_MODULE,
  verifyPatch,
} from '../../environment/resources/patches/managed-lifecycle.mjs'

async function fixture({ duplicateImport = false, sigterm = true, wrapper = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-managed-lifecycle-patch-'))
  await mkdir(join(root, 'lib'))
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n')
  const dynamicImport = 'const { runProfile } = await import("./profile-boot-wrapper_42.js");'
  await writeFile(join(root, 'lib/bin.js'), `#!/usr/bin/env node
const invocation = parseDshArgs(process.argv.slice(2), readVersion());
switch (invocation.mode) {
  case "profile": {
    ${dynamicImport}
    ${duplicateImport ? dynamicImport : ''}
  }
}
`)
  await writeFile(join(root, 'lib/profile-boot-wrapper_42.js'), wrapper
    ? 'import { x as runProfile } from "./profile-boot-anyHash.js";\nexport { runProfile };\n'
    : 'export const unrelated = true;\n')
  await writeFile(join(root, 'lib/profile-boot-anyHash.js'), `async function runProfile(options) {
${sigterm ? '\tprocess.on("SIGTERM", () => {\n\t\tinterrupt(0);\n\t});' : '\tprocess.on("SIGHUP", () => interrupt(0));'}
\tprocess.on("SIGINT", () => { interrupt(130); });
\tconst ctx = await boot(NAME, rootConfig, patches, (hostCtx) => {
\t\thostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment);
\t});
}
export { runProfile as x };
`)
  return root
}

async function listen(socketPath, handler) {
  const server = createServer(handler)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  await chmod(socketPath, 0o600)
  return server
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

test('patches a hash-independent Profile import chain exactly once', async () => {
  const root = await fixture()
  applyPatch(root)
  verifyPatch(root)
  assert.match(await readFile(join(root, 'lib/bin.js'), 'utf8'), /prepareManagedInvocation/)
  assert.match(await readFile(join(root, 'lib/profile-boot-anyHash.js'), 'utf8'), /managedSigtermHandler/)
  assert.match(await readFile(join(root, MANAGED_LIFECYCLE_MODULE), 'utf8'), /dshPlatformLifecycle/)
  assert.match(await readFile(join(root, PROFILE_PACKAGE_STORAGE_MODULE), 'utf8'), /prepareProfilePackageStorage/)
  assert.throws(() => applyPatch(root), /already applied/)
})

test('fails closed when upstream Profile anchors are missing or ambiguous', async () => {
  await assert.rejects(Promise.resolve().then(async () => applyPatch(await fixture({ duplicateImport: true }))), /found 2/)
  await assert.rejects(Promise.resolve().then(async () => applyPatch(await fixture({ wrapper: false }))), /found 0/)
  await assert.rejects(Promise.resolve().then(async () => applyPatch(await fixture({ sigterm: false }))), /SIGTERM handler.*found 0/)
})

async function fakePnpm(root) {
  const bin = join(root, 'bin')
  await mkdir(bin, { recursive: true })
  const executable = join(bin, 'pnpm')
  await writeFile(executable, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
if (process.env.DSH_TEST_PNPM_FAIL === '1') {
  process.stderr.write('fixture pnpm failed\\n')
  process.exit(1)
}
const workspace = await import('node:fs').then(({ readFileSync }) => readFileSync('pnpm-workspace.yaml', 'utf8'))
const match = /^storeDir:\\s*(.+)$/m.exec(workspace)
if (match === null) process.exit(2)
const storeRoot = JSON.parse(match[1])
mkdirSync('node_modules', { recursive: true })
writeFileSync(join('node_modules', '.modules.yaml'), JSON.stringify({ storeDir: join(storeRoot, 'v11') }))
writeFileSync(join('node_modules', 'migration-marker'), 'rebuilt\\n')
`)
  await chmod(executable, 0o755)
  return bin
}

test('pins compatible Profiles to their custom DSH_HOME store', async () => {
  const root = await fixture()
  applyPatch(root)
  const storage = await import(`${pathToFileURL(join(root, PROFILE_PACKAGE_STORAGE_MODULE)).href}?storage`)
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-profile-storage-home-'))
  const profileDir = join(dshHome, 'profiles', 'web')
  const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
  const modulesRoot = join(profileDir, 'node_modules')
  await mkdir(modulesRoot, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), '{"name":"dsh-profile-web"}\n')
  await writeFile(workspacePath, 'packages:\n  - .\n\nnodeLinker: hoisted\n')
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dshHome
  try {
    assert.deepEqual(storage.prepareProfilePackageStorage('web'), {
      status: 'ready',
      currentStore: null,
      storeRoot: join(dshHome, '.pnpm-store'),
    })
    assert.match(await readFile(workspacePath, 'utf8'), new RegExp(
      `storeDir: ${JSON.stringify(join(dshHome, '.pnpm-store')).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    ))

    await writeFile(join(modulesRoot, '.modules.yaml'), JSON.stringify({
      storeDir: join(dshHome, '.pnpm-store', 'v11'),
    }))
    assert.equal(storage.prepareProfilePackageStorage('web').status, 'ready')
    assert.equal((await readFile(workspacePath, 'utf8')).match(/^storeDir:/gm)?.length, 1)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
})

test('migrates a legacy Profile store and recovers a failed or interrupted rebuild', async () => {
  const root = await fixture()
  applyPatch(root)
  const storage = await import(`${pathToFileURL(join(root, PROFILE_PACKAGE_STORAGE_MODULE)).href}?migration`)
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-profile-migration-home-'))
  const profileDir = join(dshHome, 'profiles', 'web')
  const modulesRoot = join(profileDir, 'node_modules')
  const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
  const legacyStore = join(root, 'workspace', '.pnpm-store', 'v11')
  const originalWorkspace = `packages:\n  - .\n\nstoreDir: ${JSON.stringify(dirname(legacyStore))}\n`
  await mkdir(modulesRoot, { recursive: true })
  await mkdir(legacyStore, { recursive: true })
  await writeFile(join(legacyStore, 'store-marker'), 'cached\n')
  await writeFile(join(modulesRoot, '.modules.yaml'), JSON.stringify({ storeDir: legacyStore }))
  await writeFile(join(modulesRoot, 'original-marker'), 'original\n')
  await writeFile(join(profileDir, 'package.json'), '{"name":"dsh-profile-web","private":true}\n')
  await writeFile(join(profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  await writeFile(workspacePath, originalWorkspace)
  const bin = await fakePnpm(root)
  const previous = {
    DSH_HOME: process.env.DSH_HOME,
    PATH: process.env.PATH,
    DSH_TEST_PNPM_FAIL: process.env.DSH_TEST_PNPM_FAIL,
  }
  process.env.DSH_HOME = dshHome
  process.env.PATH = `${bin}:${process.env.PATH}`
  try {
    assert.deepEqual(storage.prepareProfilePackageStorage('web'), {
      status: 'migrated',
      currentStore: join(dshHome, '.pnpm-store', 'v11'),
      storeRoot: join(dshHome, '.pnpm-store'),
    })
    assert.equal(await readFile(join(dshHome, '.pnpm-store', 'v11', 'store-marker'), 'utf8'), 'cached\n')
    assert.equal(await readFile(join(modulesRoot, 'migration-marker'), 'utf8'), 'rebuilt\n')
    await assert.rejects(readFile(join(profileDir, '.dsh-platform-node_modules.previous')), { code: 'ENOENT' })
    await assert.rejects(readFile(join(profileDir, '.dsh-platform-pnpm-workspace.previous')), { code: 'ENOENT' })

    await rm(modulesRoot, { recursive: true })
    await mkdir(modulesRoot)
    await writeFile(join(modulesRoot, '.modules.yaml'), JSON.stringify({ storeDir: legacyStore }))
    await writeFile(join(modulesRoot, 'original-marker'), 'restored\n')
    await writeFile(workspacePath, originalWorkspace)
    process.env.DSH_TEST_PNPM_FAIL = '1'
    assert.throws(() => storage.prepareProfilePackageStorage('web'), /fixture pnpm failed/)
    assert.equal(await readFile(join(modulesRoot, 'original-marker'), 'utf8'), 'restored\n')
    assert.equal(await readFile(workspacePath, 'utf8'), originalWorkspace)

    delete process.env.DSH_TEST_PNPM_FAIL
    await writeFile(join(profileDir, '.dsh-platform-pnpm-workspace.previous'), originalWorkspace)
    await writeFile(workspacePath, `packages:\n  - .\n\nstoreDir: ${JSON.stringify(join(dshHome, '.pnpm-store'))}\n`)
    assert.equal(storage.prepareProfilePackageStorage('web').status, 'migrated')
    assert.equal(await readFile(join(modulesRoot, 'migration-marker'), 'utf8'), 'rebuilt\n')

    await rm(modulesRoot, { recursive: true })
    await mkdir(modulesRoot)
    await writeFile(join(modulesRoot, '.modules.yaml'), JSON.stringify({ storeDir: legacyStore }))
    await writeFile(join(modulesRoot, 'original-marker'), 'interrupted\n')
    await writeFile(workspacePath, originalWorkspace)
    await writeFile(join(profileDir, '.dsh-platform-pnpm-workspace.previous'), originalWorkspace)
    await rename(modulesRoot, join(profileDir, '.dsh-platform-node_modules.previous'))
    await writeFile(workspacePath, `packages:\n  - .\n\nstoreDir: ${JSON.stringify(join(dshHome, '.pnpm-store'))}\n`)
    assert.equal(storage.prepareProfilePackageStorage('web').status, 'migrated')
    assert.equal(await readFile(join(modulesRoot, 'migration-marker'), 'utf8'), 'rebuilt\n')
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('gates only managed Web launches and routes restart through Management', async t => {
  const root = await fixture()
  applyPatch(root)
  const runRoot = await mkdtemp(join(tmpdir(), 'dsh-managed-lifecycle-run-'))
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-managed-lifecycle-home-'))
  const profileDir = join(dshHome, 'profiles', 'web')
  await mkdir(profileDir, { recursive: true })
  await mkdir(join(root, 'node_modules', 'built-in-bundle'), { recursive: true })
  await writeFile(join(root, 'node_modules', 'built-in-bundle', 'package.json'), '{"name":"built-in-bundle"}\n')
  const profileManifest = join(profileDir, 'package.json')
  await writeFile(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\n')
  await writeFile(profileManifest, JSON.stringify({
    dependencies: { 'missing-dependency': '1.0.0' },
    dsh: { profile: { bundles: ['built-in-bundle', 'removed-plugin', '../../outside', 'missing-dependency'] } },
  }, null, 2))
  const calls = []
  let claimStatus = 200
  let disposition = 'request-restart'
  let lifecycleState = 'running'
  let signalDelayMs = 0
  const broker = await listen(join(runRoot, 'dsh-lifecycle.sock'), async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    calls.push({ socket: 'broker', path: request.url, body: JSON.parse(Buffer.concat(chunks)) })
    if (claimStatus !== 200) json(response, claimStatus, { error: 'launch already claimed' })
    else if (request.url === '/v1/runtime/claim') json(response, 200, { sessionId: 'session-1' })
    else {
      if (signalDelayMs > 0) await new Promise(resolve => setTimeout(resolve, signalDelayMs))
      json(response, 200, { disposition })
    }
  })
  const management = await listen(join(runRoot, 'management.sock'), (request, response) => {
    calls.push({ socket: 'management', path: request.url })
    if (request.url?.endsWith('/status')) json(response, 200, { dshLifecycle: { state: lifecycleState }, recoveryMode: null })
    else json(response, 202, { taskId: request.url?.endsWith('/start-dsh') ? 'start-task' : 'restart-task' })
  })
  t.after(() => { broker.close(); management.close() })
  const previous = Object.fromEntries(['DSH_HOME', 'DSH_PLATFORM_MANAGED', 'DSH_PLATFORM_RUN', 'DSH_PLATFORM_LAUNCH_TOKEN']
    .map(name => [name, process.env[name]]))
  process.env.DSH_HOME = dshHome
  process.env.DSH_PLATFORM_MANAGED = '1'
  process.env.DSH_PLATFORM_RUN = runRoot
  process.env.DSH_PLATFORM_LAUNCH_TOKEN = 'launch-token'
  try {
    const adapter = await import(`${pathToFileURL(join(root, MANAGED_LIFECYCLE_MODULE)).href}?authorized`)
    assert.equal(await adapter.prepareManagedInvocation({ mode: 'plugin', profile: 'web' }), null)
    assert.equal(calls.length, 0)
    assert.match(await readFile(join(profileDir, 'pnpm-workspace.yaml'), 'utf8'), new RegExp(
      `storeDir: ${JSON.stringify(join(dshHome, '.pnpm-store')).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    ))
    assert.equal(await adapter.prepareManagedInvocation({ mode: 'profile', profile: 'web' }), null)
    assert.equal(process.env.DSH_PLATFORM_LAUNCH_TOKEN, undefined)
    assert.deepEqual(
      JSON.parse(await readFile(profileManifest, 'utf8')).dsh.profile.bundles,
      ['built-in-bundle', 'missing-dependency'],
    )
    let provided
    adapter.provideManagedLifecycle({ provide: (name, value) => { provided = { name, value } } })
    assert.equal(provided.name, 'dshPlatformLifecycle')
    assert.deepEqual(await provided.value.restart(), { taskId: 'restart-task' })
    let interrupts = 0
    const onSigterm = adapter.managedSigtermHandler(() => { interrupts += 1 })
    onSigterm()
    for (let attempt = 0; attempt < 50 && !calls.some(value => value.path === '/v1/runtime/signal'); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal(calls.some(value => value.socket === 'broker' && value.path === '/v1/runtime/signal'), true)
    assert.equal(calls.some(value => value.socket === 'management' && value.path?.endsWith('/restart-dsh')), true)
    assert.equal(interrupts, 0)
    onSigterm()
    assert.equal(interrupts, 1)

    const restartCallsBeforeCancellation = calls.filter(value => value.path?.endsWith('/restart-dsh')).length
    signalDelayMs = 30
    let cancellationInterrupts = 0
    const cancelSigterm = adapter.managedSigtermHandler(() => { cancellationInterrupts += 1 })
    cancelSigterm()
    cancelSigterm()
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(cancellationInterrupts, 1)
    assert.equal(calls.filter(value => value.path?.endsWith('/restart-dsh')).length, restartCallsBeforeCancellation)
    signalDelayMs = 0

    disposition = 'terminate'
    let terminationInterrupts = 0
    const managementCalls = calls.filter(value => value.path?.endsWith('/restart-dsh')).length
    adapter.managedSigtermHandler(() => { terminationInterrupts += 1 })()
    for (let attempt = 0; attempt < 50 && terminationInterrupts === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal(terminationInterrupts, 1)
    assert.equal(calls.filter(value => value.path?.endsWith('/restart-dsh')).length, managementCalls)

    claimStatus = 409
    disposition = 'request-restart'
    const duplicate = await import(`${pathToFileURL(join(root, MANAGED_LIFECYCLE_MODULE)).href}?duplicate`)
    assert.equal(await duplicate.prepareManagedInvocation({ mode: 'profile', profile: 'web' }), 0)
    lifecycleState = 'stopped'
    const stopped = await import(`${pathToFileURL(join(root, MANAGED_LIFECYCLE_MODULE)).href}?stopped`)
    assert.equal(await stopped.prepareManagedInvocation({ mode: 'profile', profile: 'web' }), 0)
    assert.equal(calls.some(value => value.path?.endsWith('/start-dsh')), true)
    lifecycleState = 'failed'
    const failed = await import(`${pathToFileURL(join(root, MANAGED_LIFECYCLE_MODULE)).href}?failed`)
    assert.equal(await failed.prepareManagedInvocation({ mode: 'profile', profile: 'web' }), 1)
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('keeps native behavior without the image marker and fails closed without the Broker', async () => {
  const root = await fixture()
  applyPatch(root)
  const adapter = await import(`${pathToFileURL(join(root, MANAGED_LIFECYCLE_MODULE)).href}?fail-closed`)
  const previous = Object.fromEntries(['DSH_PLATFORM_MANAGED', 'DSH_PLATFORM_RUN']
    .map(name => [name, process.env[name]]))
  try {
    delete process.env.DSH_PLATFORM_MANAGED
    assert.equal(await adapter.prepareManagedInvocation({ mode: 'profile', profile: 'web' }), null)
    process.env.DSH_PLATFORM_MANAGED = '1'
    process.env.DSH_PLATFORM_RUN = await mkdtemp(join(tmpdir(), 'dsh-no-broker-'))
    assert.equal(await adapter.prepareManagedInvocation({ mode: 'profile', profile: 'web' }), 1)
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})
