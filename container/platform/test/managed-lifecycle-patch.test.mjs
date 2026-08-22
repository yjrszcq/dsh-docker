import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import {
  applyPatch,
  MANAGED_LIFECYCLE_MODULE,
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
  assert.throws(() => applyPatch(root), /already applied/)
})

test('fails closed when upstream Profile anchors are missing or ambiguous', async () => {
  await assert.rejects(Promise.resolve().then(async () => applyPatch(await fixture({ duplicateImport: true }))), /found 2/)
  await assert.rejects(Promise.resolve().then(async () => applyPatch(await fixture({ wrapper: false }))), /found 0/)
  await assert.rejects(Promise.resolve().then(async () => applyPatch(await fixture({ sigterm: false }))), /SIGTERM handler.*found 0/)
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
