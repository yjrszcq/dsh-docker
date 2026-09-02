import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AccessStateStore } from '../../control-plane/services/access-manager/lib/store.mjs'
import {
  createCredential,
  normalizePassword,
  normalizeUsername,
  verifyCredential,
} from '../../control-plane/services/access-manager/lib/credentials.mjs'
import { AuthenticationLimiter } from '../../control-plane/services/access-manager/lib/rate-limiter.mjs'
import { AccessService, createAccessHttpServer } from '../../control-plane/services/access-manager/lib/server.mjs'
import { consumeInternalCapability } from '../lib/access-capability.mjs'
import { BrowserSessionStore } from '../../control-plane/services/access-manager/lib/sessions.mjs'
import { LocalApiClient } from '../../control-plane/modules/updater/lib/client.mjs'
import { collectAccessEvidence, parseAccessEvidence } from '../lib/access-evidence.mjs'
import { PlatformPaths } from '../lib/paths.mjs'
import { CapabilityStore } from '../../control-plane/services/access-manager/lib/capabilities.mjs'
import { ManagementTransitionStore } from '../../control-plane/services/access-manager/lib/transitions.mjs'
import { detectRuntimeCapabilities } from '../../control-plane/services/access-manager/lib/runtime-capabilities.mjs'

const fastVerifier = (password, options = {}) => createCredential(password, {
  ...options,
  policy: { N: 16, r: 1, p: 1, keyLength: 32, maxmem: 2 * 1024 * 1024 },
})

test('derives Root capability from actual init groups and reports shared-process isolation honestly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-access-capabilities-'))
  try {
    const groupPath = join(root, 'group')
    const statusPath = join(root, 'status')
    const mountsPath = join(root, 'mounts')
    const ptracePath = join(root, 'ptrace_scope')
    await writeFile(groupPath, 'dsh-sudo-true:x:993:\ndsh-sudo-false:x:994:\n')
    await writeFile(statusPath, 'Name:\ttini\nGroups:\t1000 993\n')
    await writeFile(mountsPath, 'proc /proc proc rw,nosuid,nodev,noexec,relatime,hidepid=2 0 0\n')
    await writeFile(ptracePath, '1\n')
    assert.deepEqual(await detectRuntimeCapabilities({
      groupPath, initStatusPath: statusPath, mountsPath, ptraceScopePath: ptracePath,
    }), {
      dshRootCapabilityEffective: true,
      agentIsolationEffective: false,
      details: {
        sudoSelection: 'enabled', ptraceScope: 1, procHidepid: 2,
        agentIsolationReason: 'shared-node-process-identity',
      },
    })
    await writeFile(statusPath, 'Name:\ttini\nGroups:\t1000 994\n')
    assert.equal((await detectRuntimeCapabilities({
      groupPath, initStatusPath: statusPath, mountsPath, ptraceScopePath: ptracePath,
    })).dshRootCapabilityEffective, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('privileged capabilities are single-use and bound to execution details', () => {
  let now = 1_000
  const store = new CapabilityStore({ now: () => now, random: size => Buffer.alloc(size, 7), ttlMs: 100 })
  const account = {
    accountId: 'account',
    mainCredential: { version: 2 },
    managementAdditionalCredential: { enabled: false, version: 1 },
    managementAccess: { version: 3 },
  }
  const issued = store.issue({ sessionId: 'session' }, account, {
    audience: 'management', method: 'POST', target: '/_dsh_platform/api/v1/restart-dsh',
  })
  assert.equal(store.consume(issued.token, account, {
    audience: 'management', method: 'POST', target: '/_dsh_platform/api/v1/restart-dsh',
  })?.sessionId, 'session')
  assert.equal(store.consume(issued.token, account, {
    audience: 'management', method: 'POST', target: '/_dsh_platform/api/v1/restart-dsh',
  }), undefined)
  const second = store.issue({ sessionId: 'session' }, account, {
    audience: 'maintenance', method: 'GET', target: '/_dsh_platform/api/v1/files/list?path=%2Fworkspace',
  })
  assert.equal(store.consume(second.token, account, {
    audience: 'maintenance', method: 'GET', target: '/_dsh_platform/api/v1/files/list?path=%2Fdata',
  }), undefined)
  const third = store.issue({ sessionId: 'session' }, account, {
    audience: 'management', method: 'GET', target: '/_dsh_platform/api/v1/status',
  })
  now += 101
  assert.equal(store.consume(third.token, account, {
    audience: 'management', method: 'GET', target: '/_dsh_platform/api/v1/status',
  }), undefined)
})

test('DSH sessions issue only single-use Plugin API capabilities', async () => {
  const { service } = await fixture()
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  const initialized = await service.initializeDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })
  const issued = await service.issuePluginCapability({
    dshToken: initialized.session.token,
    origin: 'https://dsh.example',
    csrfToken: initialized.session.csrfToken,
    requireCsrf: true,
    method: 'POST',
    target: '/_dsh_platform/api/v1/restart-dsh',
  })
  assert.equal((await service.consumeCapability({
    token: issued.capability.token,
    audience: 'plugin',
    method: 'POST',
    target: '/_dsh_platform/api/v1/restart-dsh',
  })).authorized, true)
  await assert.rejects(service.consumeCapability({
    token: issued.capability.token,
    audience: 'plugin',
    method: 'POST',
    target: '/_dsh_platform/api/v1/restart-dsh',
  }), error => error.code === 'CAPABILITY_INVALID')
  await assert.rejects(service.issuePluginCapability({
    dshToken: initialized.session.token,
    origin: 'https://dsh.example',
    csrfToken: initialized.session.csrfToken,
    requireCsrf: true,
    method: 'POST',
    target: '/_dsh_platform/api/v1/restart-dsh',
  }).then(async value => service.consumeCapability({
    token: value.capability.token,
    audience: 'management',
    method: 'POST',
    target: '/_dsh_platform/api/v1/restart-dsh',
  })), error => error.code === 'CAPABILITY_INVALID')
})

test('final execution capability checks distinguish denial from Access Manager failure', async () => {
  const calls = []
  const access = {
    async request(method, path, body) {
      calls.push({ method, path, body })
      return { authorized: true }
    },
  }
  assert.equal(await consumeInternalCapability(access, {
    token: 'token', audience: 'management', method: 'POST', target: '/target',
  }), true)
  assert.deepEqual(calls, [{
    method: 'POST', path: '/v1/capabilities/consume',
    body: { token: 'token', audience: 'management', method: 'POST', target: '/target' },
  }])

  for (const statusCode of [401, 409, 500]) {
    const failingAccess = {
      async request() { throw Object.assign(new Error(`access ${statusCode}`), { statusCode }) },
    }
    if (statusCode === 401) {
      assert.equal(await consumeInternalCapability(failingAccess, {
        token: 'token', audience: 'maintenance', method: 'GET', target: '/target',
      }), false)
    } else {
      await assert.rejects(consumeInternalCapability(failingAccess, {
        token: 'token', audience: 'maintenance', method: 'GET', target: '/target',
      }), error => error.statusCode === (statusCode === 500 ? 503 : statusCode))
    }
  }
  await assert.rejects(consumeInternalCapability({
    async request() { throw Object.assign(new Error('socket unavailable'), { code: 'ECONNREFUSED' }) },
  }, {
    token: 'token', audience: 'management', method: 'GET', target: '/target',
  }), error => error.statusCode === 503 && error.code === 'ECONNREFUSED')
})

test('Management origin transitions and continuations expire without changing authority', () => {
  let now = 1_000
  const transitions = new ManagementTransitionStore({ now: () => now, ttlMs: 100 })
  const account = {
    accountId: 'account', revision: 'revision',
    managementAccess: { version: 3 },
  }
  const created = transitions.create({
    account, instanceId: 'instance', sessionId: 'session',
    sourceOrigin: 'https://dsh.example', sourceDshOrigin: 'https://dsh.example',
    sourceDshSessionId: 'dsh-session',
    mode: 'isolated',
    isolatedEntry: { kind: 'public', managementPublicOrigin: 'https://manage.example' },
    candidateOrigin: 'https://manage.example',
  })
  now += 101
  assert.equal(transitions.probe({
    transitionId: created.transitionId, nonce: created.nonce,
    sourceOrigin: 'https://dsh.example', candidateOrigin: 'https://manage.example',
    instanceId: 'instance',
  }), undefined)

  const continuation = transitions.createContinuation({
    account, targetOrigin: 'https://manage.example', sourceDshOrigin: 'https://dsh.example',
    sourceDshSessionId: 'dsh-session',
  })
  now += 101
  assert.equal(transitions.consumeContinuation({
    token: continuation.token, account, targetOrigin: 'https://manage.example',
  }), undefined)
})

async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-access-state-'))
  let now = new Date('2026-08-28T00:00:00.000Z')
  const store = new AccessStateStore({
    root,
    now: () => now,
    createVerifier: fastVerifier,
  })
  const service = new AccessService({
    store,
    classificationToken: 'classification-token',
    limiter: new AuthenticationLimiter({ globalLimit: 10, maxConcurrent: 2 }),
    sessions: new BrowserSessionStore({ now: () => now.getTime() }),
    now: () => now.getTime(),
    ...options,
  })
  return { root, store, service, setNow: value => { now = new Date(value) } }
}

async function persistIsolatedManagementAccess(store) {
  const current = await store.state()
  assert.equal(current.state, 'initialized')
  const account = {
    ...current.account,
    managementAccess: {
      mode: 'isolated',
      version: current.account.managementAccess.version + 1,
      isolatedEntry: { kind: 'public', managementPublicOrigin: 'https://manage.example' },
      dshPublicOrigin: 'https://dsh.example',
      changedAt: '2026-08-28T00:00:00.000Z',
    },
  }
  await store.replaceAccount(account, current.account.revision)
  return account
}

async function loginManagement(service, {
  dshOrigin = 'http://dsh.example:3080',
  targetOrigin = dshOrigin,
  managementPassword,
} = {}) {
  const dsh = await service.loginDsh({
    username: 'admin', password: 'correct horse battery staple', origin: dshOrigin,
  })
  const handoff = await service.createManagementHandoff({
    dshToken: dsh.session.token, dshOrigin, targetOrigin,
  })
  let management = await service.consumeManagementHandoff({
    token: handoff.handoff.token, origin: targetOrigin,
  })
  if (management.pending !== undefined && managementPassword !== undefined) {
    management = await service.completeManagementLogin({
      pendingToken: management.pending.token,
      origin: targetOrigin,
      password: managementPassword,
    })
  }
  return { dsh, management }
}

test('normalizes administrator usernames and preserves password whitespace', () => {
  assert.equal(normalizeUsername('  a\u0301dmin  '), 'ádmin')
  assert.equal(normalizePassword('  password  '), '  password  ')
  assert.throws(() => normalizeUsername('admin\nroot'), error => error.code === 'USERNAME_INVALID')
  assert.throws(() => normalizeUsername(`admin\u202eroot`), error => error.code === 'USERNAME_INVALID')
  assert.throws(() => normalizePassword('short'), error => error.code === 'PASSWORD_POLICY_VIOLATION')
  assert.throws(() => normalizePassword('password\nvalue'), error => error.code === 'PASSWORD_POLICY_VIOLATION')
  assert.throws(() => normalizePassword(`password\u202evalue`), error => error.code === 'PASSWORD_POLICY_VIOLATION')
})

test('creates salted scrypt credentials and verifies them in constant-length form', async () => {
  const left = await fastVerifier('correct horse battery staple')
  const right = await fastVerifier('correct horse battery staple')
  assert.equal(left.algorithm, 'scrypt')
  assert.notEqual(left.salt, right.salt)
  assert.notEqual(left.hash, right.hash)
  assert.equal(await verifyCredential('correct horse battery staple', left), true)
  assert.equal(await verifyCredential('incorrect password', left), false)
})

test('classifies fresh and legacy installations exactly once', async () => {
  const fresh = await fixture()
  assert.equal((await fresh.store.state()).state, 'classification-pending')
  assert.equal((await fresh.store.classify({ dshProfile: false, legacyAuthenticationConfigured: false })).initialization.state, 'never-initialized')
  assert.equal((await fresh.store.classify({ dshProfile: true, legacyAuthenticationConfigured: true })).initialization.state, 'never-initialized')

  const emptyWithLegacyEnvironment = await fixture()
  assert.equal((await emptyWithLegacyEnvironment.store.classify({
    dshProfile: false,
    legacyAuthenticationConfigured: true,
  })).initialization.state, 'never-initialized')

  const legacy = await fixture()
  const classified = await legacy.store.classify({ dshProfile: true, legacyAuthenticationConfigured: false })
  assert.equal(classified.initialization.state, 'migration-required')
  assert.equal(Buffer.from(classified.initialization.instanceId, 'base64url').byteLength, 32)
})

test('publishes an account before converging initialization and rejects a second registration', async () => {
  const { root, service } = await fixture()
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  const initialized = await service.initialize({ username: ' admin ', password: 'correct horse battery staple' })
  assert.equal(initialized.state, 'initialized')
  assert.equal(initialized.account.username, 'admin')
  assert.equal(JSON.parse(await readFile(join(root, 'initialization.json'), 'utf8')).state, 'initialized')
  assert.equal(JSON.parse(await readFile(join(root, 'account.json'), 'utf8')).mainCredential.algorithm, 'scrypt')
  assert.equal((await stat(root)).mode & 0o777, 0o700)
  assert.equal((await stat(join(root, 'initialization.json'))).mode & 0o777, 0o600)
  assert.equal((await stat(join(root, 'account.json'))).mode & 0o777, 0o600)
  await assert.rejects(
    service.initialize({ username: 'other', password: 'another strong password' }),
    error => error.code === 'ALREADY_INITIALIZED',
  )
})

test('migrates a legacy deployment with one expiring single-use authentication reset key', async () => {
  const current = await fixture()
  await current.service.classify({ token: 'classification-token', evidence: { dshProfile: true } })
  const first = await current.service.generateAuthenticationResetKey()
  const second = await current.service.generateAuthenticationResetKey()
  assert.match(second.key, /^dshak_/)
  assert.notEqual(first.key, second.key)
  await assert.rejects(current.service.resetDshAuthentication({
    setupKey: first.key, username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  }), error => error.code === 'AUTHENTICATION_RESET_KEY_INVALID' && error.statusCode === 401)
  const migrated = await current.service.resetDshAuthentication({
    setupKey: second.key, username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })
  assert.equal(migrated.state, 'initialized')
  assert.equal(migrated.account.username, 'admin')
  assert.match(migrated.session.token, /^dshs_/)
  await assert.rejects(current.service.generateAuthenticationResetKey(), error => error.code === 'AUTHENTICATION_RESET_UNAVAILABLE')
})

test('keeps a valid authentication reset key usable while new account fields are corrected', async () => {
  const current = await fixture()
  await current.service.classify({ token: 'classification-token', evidence: { dshProfile: true } })
  const setup = await current.service.generateAuthenticationResetKey()
  await assert.rejects(current.service.resetDshAuthentication({
    setupKey: setup.key, username: 'operator', password: 'four', origin: 'https://dsh.example',
  }), error => error.code === 'PASSWORD_POLICY_VIOLATION')
  const migrated = await current.service.resetDshAuthentication({
    setupKey: setup.key, username: 'operator', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })
  assert.equal(migrated.account.username, 'operator')
  await assert.rejects(current.service.resetDshAuthentication({
    setupKey: setup.key, username: 'operator', password: 'correct horse battery staple', origin: 'https://dsh.example',
  }), error => error.code === 'AUTHENTICATION_RESET_KEY_INVALID')
})

test('rejects expired and malformed authentication reset keys without exposing an internal error', async () => {
  const current = await fixture()
  await current.service.classify({ token: 'classification-token', evidence: { dshProfile: true } })
  const expired = await current.service.generateAuthenticationResetKey()
  current.setNow('2026-08-28T00:10:00.001Z')
  await assert.rejects(current.service.resetDshAuthentication({
    setupKey: expired.key, username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  }), error => error.code === 'AUTHENTICATION_RESET_KEY_INVALID' && error.statusCode === 401)
  await current.service.generateAuthenticationResetKey()
  await assert.rejects(current.service.resetDshAuthentication({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  }), error => error.code === 'AUTHENTICATION_RESET_KEY_INVALID' && error.statusCode === 401)
})

test('recreates a damaged administrator account with a root-issued authentication reset key', async () => {
  const current = await fixture()
  await current.store.prepare()
  await writeFile(join(current.root, 'initialization.json'), JSON.stringify({
    schema: 1,
    instanceId: Buffer.alloc(32, 7).toString('base64url'),
    state: 'recovery-required',
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  }))
  const setup = await current.service.generateAuthenticationResetKey()
  const recovered = await current.service.resetDshAuthentication({
    setupKey: setup.key,
    username: 'recovered-admin',
    password: 'correct horse battery staple',
    origin: 'https://dsh.example',
  })
  assert.equal(recovered.state, 'initialized')
  assert.equal(recovered.account.username, 'recovered-admin')
  assert.equal((await current.store.state()).state, 'initialized')
})

test('normal and recovery sockets expose distinct bounded protocols without verifier material', async () => {
  const { root, service } = await fixture({
    limiter: new AuthenticationLimiter({
      globalLimit: 100, backoffThreshold: 1, initialBackoffMs: 1_000,
    }),
  })
  const accessPath = join(root, 'access.sock')
  const recoveryPath = join(root, 'recovery.sock')
  const accessServer = createAccessHttpServer({ service })
  const recoveryServer = createAccessHttpServer({ service, surface: 'recovery' })
  await Promise.all([
    new Promise((resolve, reject) => { accessServer.once('error', reject); accessServer.listen(accessPath, resolve) }),
    new Promise((resolve, reject) => { recoveryServer.once('error', reject); recoveryServer.listen(recoveryPath, resolve) }),
  ])
  const access = new LocalApiClient(accessPath)
  const recovery = new LocalApiClient(recoveryPath)
  try {
    await assert.rejects(
      access.request('POST', '/v1/classify', { token: 'wrong', evidence: { dshProfile: false } }),
      error => error.statusCode === 403,
    )
    await access.request('POST', '/v1/classify', {
      token: 'classification-token', evidence: { dshProfile: false },
    })
    const initialized = await access.request('POST', '/v1/initialize', {
      username: 'admin', password: 'correct horse battery staple',
    })
    assert.doesNotMatch(JSON.stringify(initialized), /salt|hash|password|verifier/i)
    const authenticated = await access.request('POST', '/v1/authenticate', {
      username: 'admin', password: 'correct horse battery staple',
    })
    assert.equal(authenticated.authenticated, true)
    assert.doesNotMatch(JSON.stringify(authenticated), /salt|hash|password|verifier/i)
    await assert.rejects(access.request('POST', '/v1/authenticate', {
      username: 'admin', password: 'incorrect password', authenticationSource: 'browser:test',
    }), error => error.statusCode === 429
      && error.code === 'AUTHENTICATION_RETRY_REQUIRED'
      && error.retryAfterSeconds === 1)
    await assert.rejects(access.request('POST', '/v1/authenticate', {
      username: 'admin', password: 'correct horse battery staple', authenticationSource: 'browser:test',
    }), error => error.statusCode === 429
      && error.code === 'AUTHENTICATION_RETRY_REQUIRED'
      && error.retryAfterSeconds === 1)
    const recoveryStatus = await recovery.request('GET', '/v1/recovery/status')
    assert.deepEqual(recoveryStatus.authenticationRetry, {
      activeSources: 1, consecutiveFailures: 1, retryAfterSeconds: 1,
      sourceRetryAfterSeconds: 0, globalFailures: 1, globalRetryAfterSeconds: 0,
    })
    const cleared = await recovery.request('POST', '/v1/recovery/clear-retry')
    assert.deepEqual(cleared, {
      status: 'cleared', scope: 'all', cleared: true, activeSources: 1,
      consecutiveFailures: 1, retryAfterSeconds: 1,
      sourceRetryAfterSeconds: 0, globalFailures: 1, globalRetryAfterSeconds: 0,
    })
    assert.equal((await access.request('POST', '/v1/authenticate', {
      username: 'admin', password: 'correct horse battery staple', authenticationSource: 'browser:test',
    })).authenticated, true)
    await assert.rejects(access.request('POST', '/v1/authenticate', {
      username: 'admin', password: 'incorrect password', authenticationSource: 'browser:global-only',
    }), error => error.statusCode === 429
      && error.code === 'AUTHENTICATION_RETRY_REQUIRED'
      && error.retryAfterSeconds === 1)
    const globalCleared = await recovery.request('POST', '/v1/recovery/clear-retry', { scope: 'global' })
    assert.deepEqual(globalCleared, {
      status: 'cleared', scope: 'global', cleared: true,
      globalFailures: 1, globalRetryAfterSeconds: 0,
    })
    assert.equal((await recovery.request('GET', '/v1/recovery/status'))
      .authenticationRetry.consecutiveFailures, 1)
    await assert.rejects(
      recovery.request('POST', '/v1/recovery/clear-retry', { scope: 'browser' }),
      error => error.statusCode === 400 && error.code === 'REQUEST_INVALID',
    )
    const reset = await recovery.request('POST', '/v1/recovery/reset-access', {
      revision: recoveryStatus.account.revision,
      password: 'replacement administrator password',
      managementPasswordAction: 'preserve',
    })
    assert.equal(reset.account.mainCredentialVersion, 2)
    assert.doesNotMatch(JSON.stringify(reset), /salt|hash|password|verifier/i)
    await assert.rejects(
      recovery.request('POST', '/v1/initialize', { username: 'other', password: 'another password' }),
      error => error.statusCode === 404,
    )
    await assert.rejects(
      access.request('POST', '/v1/recovery/clear-retry'),
      error => error.statusCode === 404,
    )
  } finally {
    await Promise.all([
      new Promise(resolve => accessServer.close(resolve)),
      new Promise(resolve => recoveryServer.close(resolve)),
    ])
  }
})

test('atomically resets administrator access with an explicit additional-password action', async () => {
  const { service, store } = await fixture()
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  const initialized = await service.initializeDsh({
    username: 'admin', password: 'original administrator password', origin: 'https://dsh.example',
  })
  const additional = await service.resetRecoveryManagementPassword({
    revision: initialized.account.revision,
    password: 'original management password',
  })

  const preserved = await service.resetRecoveryAccess({
    revision: additional.account.revision,
    username: 'operator',
    password: 'replacement administrator password',
    managementPasswordAction: 'preserve',
  })
  let state = await store.state()
  assert.equal(preserved.account.username, 'operator')
  assert.equal(preserved.account.mainCredentialVersion, 2)
  assert.equal(preserved.account.managementAdditionalCredential.version, 2)
  assert.equal(await verifyCredential('replacement administrator password', state.account.mainCredential), true)
  assert.equal(await verifyCredential('original management password', state.account.managementAdditionalCredential.verifier), true)
  assert.equal((await service.validateSession({
    kind: 'dsh', token: initialized.session.token, origin: 'https://dsh.example',
  })).authenticated, false)

  const disabled = await service.resetRecoveryAccess({
    revision: preserved.account.revision,
    managementPasswordAction: 'disable',
  })
  assert.deepEqual(disabled.account.managementAdditionalCredential, { enabled: false, version: 3 })

  const reset = await service.resetRecoveryAccess({
    revision: disabled.account.revision,
    managementPasswordAction: 'reset',
    managementPassword: 'replacement management password',
  })
  state = await store.state()
  assert.deepEqual(reset.account.managementAdditionalCredential, { enabled: true, version: 4 })
  assert.equal(await verifyCredential('replacement management password', state.account.managementAdditionalCredential.verifier), true)

  const revision = reset.account.revision
  await assert.rejects(service.resetRecoveryAccess({
    revision,
    managementPasswordAction: 'reset',
    managementPassword: 'replacement administrator password',
  }), error => error.code === 'PASSWORDS_MUST_DIFFER')
  assert.equal((await service.recoveryStatus()).account.revision, revision)
  await assert.rejects(service.resetRecoveryAccess({
    revision,
    password: 'another administrator password',
    managementPasswordAction: 'unknown',
  }), error => error.code === 'REQUEST_INVALID')
  assert.equal((await service.recoveryStatus()).account.revision, revision)
  await assert.rejects(service.resetRecoveryAccess({
    revision,
    managementPasswordAction: 'preserve',
  }), error => error.code === 'REQUEST_INVALID')
  assert.equal((await service.recoveryStatus()).account.revision, revision)
})

test('authenticates normalized usernames without exposing which credential failed', async () => {
  const { service } = await fixture()
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  await service.initialize({ username: 'a\u0301dmin', password: 'correct horse battery staple' })
  assert.equal((await service.authenticate({ username: '  ádmin ', password: 'correct horse battery staple' })).authenticated, true)
  await assert.rejects(
    service.authenticate({ username: 'missing', password: 'correct horse battery staple' }),
    error => error.code === 'AUTHENTICATION_FAILED' && error.statusCode === 401,
  )
  await assert.rejects(
    service.authenticate({ username: 'ádmin', password: 'incorrect password' }),
    error => error.code === 'AUTHENTICATION_FAILED' && error.statusCode === 401,
  )
})

test('limits failed authentication before admitting more KDF work', () => {
  let now = 1_000
  const limiter = new AuthenticationLimiter({ globalLimit: 2, maxConcurrent: 1, clock: () => now })
  const first = limiter.enter('account')
  assert.throws(
    () => limiter.enter('account'),
    error => error.code === 'AUTHENTICATION_RATE_LIMITED'
      && error.details.retryAfterSeconds === 1,
  )
  first.release(false)
  const second = limiter.enter('account')
  second.release(false)
  assert.throws(() => limiter.enter('account'), error => error.code === 'AUTHENTICATION_RATE_LIMITED')
  now += 60_001
  limiter.enter('account').release(true)
})

test('applies fixed tiered instance windows without global exponential growth', () => {
  const defaults = new AuthenticationLimiter()
  assert.equal(defaults.initialBackoffMs, 30_000)
  assert.equal(defaults.maxBackoffMs, 15 * 60_000)
  assert.equal(defaults.consecutiveResetMs, 24 * 60 * 60_000)
  assert.deepEqual(defaults.globalWindows, [
    { limit: 20, windowMs: 60_000 },
    { limit: 60, windowMs: 60 * 60_000 },
    { limit: 120, windowMs: 24 * 60 * 60_000 },
  ])
  assert.deepEqual(defaults.sourceWindows, [
    { limit: 12, windowMs: 60 * 60_000 },
    { limit: 24, windowMs: 24 * 60 * 60_000 },
  ])

  for (let attempt = 0; attempt < 5; attempt += 1) {
    defaults.enter('account', 'default-browser').release(false)
  }
  assert.deepEqual(defaults.sourceStatus('account', 'default-browser'), {
    consecutiveFailures: 5, retryAfterSeconds: 30,
  })
  assert.doesNotThrow(() => defaults.enter('account', 'other-browser').release(true))

  let now = 0
  const limiter = new AuthenticationLimiter({
    globalLimit: 100,
    globalWindows: [
      { limit: 2, windowMs: 1_000 },
      { limit: 3, windowMs: 10_000 },
    ],
    clock: () => now,
  })
  limiter.enter('account', 'browser-a').release(false)
  limiter.enter('account', 'browser-b').release(false)
  assert.throws(
    () => limiter.enter('account', 'browser-c'),
    error => error.code === 'AUTHENTICATION_RATE_LIMITED'
      && error.details.retryAfterSeconds === 1,
  )
  now += 1_001
  limiter.enter('account', 'browser-c').release(false)
  assert.throws(
    () => limiter.enter('account', 'browser-d'),
    error => error.code === 'AUTHENTICATION_RATE_LIMITED'
      && error.details.retryAfterSeconds === 9,
  )
})

test('applies tiered source windows and clears only that source after success', () => {
  let now = 0
  const limiter = new AuthenticationLimiter({
    backoffThreshold: 100,
    sourceWindows: [
      { limit: 2, windowMs: 1_000 },
      { limit: 3, windowMs: 10_000 },
    ],
    globalWindows: [{ limit: 100, windowMs: 10_000 }],
    clock: () => now,
  })
  limiter.enter('account', 'browser-a').release(false)
  limiter.enter('account', 'browser-a').release(false)
  assert.throws(
    () => limiter.enter('account', 'browser-a'),
    error => error.code === 'AUTHENTICATION_RATE_LIMITED'
      && error.details.retryAfterSeconds === 1,
  )
  assert.doesNotThrow(() => limiter.enter('account', 'browser-b').release(true))
  now += 1_001
  limiter.enter('account', 'browser-a').release(false)
  assert.throws(
    () => limiter.enter('account', 'browser-a'),
    error => error.code === 'AUTHENTICATION_RATE_LIMITED'
      && error.details.retryAfterSeconds === 9,
  )
  now += 9_000
  limiter.enter('account', 'browser-a').release(true)
  assert.equal(limiter.status('account').globalFailures, 1)
  assert.equal(limiter.status('account').sourceRetryAfterSeconds, 0)
})

test('backs off exponentially after five consecutive failures and can clear one account', () => {
  let now = 1_000
  const limiter = new AuthenticationLimiter({
    globalLimit: 100,
    backoffThreshold: 5,
    initialBackoffMs: 1_000,
    maxBackoffMs: 4_000,
    sourceWindows: [{ limit: 100, windowMs: 60_000 }],
    clock: () => now,
  })
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    limiter.enter('account').release(false)
    assert.deepEqual(limiter.sourceStatus('account'), { consecutiveFailures: attempt, retryAfterSeconds: 0 })
  }
  limiter.enter('account').release(false)
  assert.deepEqual(limiter.sourceStatus('account'), { consecutiveFailures: 5, retryAfterSeconds: 1 })
  assert.throws(
    () => limiter.enter('account'),
    error => error.code === 'AUTHENTICATION_RETRY_REQUIRED'
      && error.statusCode === 429
      && error.details.retryAfterSeconds === 1,
  )
  assert.doesNotThrow(() => limiter.enter('account', 'other-browser').release(true))
  assert.equal(limiter.sourceStatus('account').retryAfterSeconds, 1)
  assert.doesNotThrow(() => limiter.enter('other').release(true))

  now += 1_000
  limiter.enter('account').release(false)
  assert.equal(limiter.sourceStatus('account').retryAfterSeconds, 2)
  now += 2_000
  limiter.enter('account').release(false)
  assert.equal(limiter.sourceStatus('account').retryAfterSeconds, 4)
  now += 4_000
  limiter.enter('account').release(false)
  assert.equal(limiter.sourceStatus('account').retryAfterSeconds, 4)

  assert.deepEqual(limiter.clear('account'), {
    cleared: true, activeSources: 1, consecutiveFailures: 8, retryAfterSeconds: 4,
    sourceRetryAfterSeconds: 0, globalFailures: 8, globalRetryAfterSeconds: 0,
  })
  assert.deepEqual(limiter.status('account'), {
    activeSources: 0, consecutiveFailures: 0, retryAfterSeconds: 0,
    sourceRetryAfterSeconds: 0, globalFailures: 0, globalRetryAfterSeconds: 0,
  })
  assert.doesNotThrow(() => limiter.enter('account').release(true))
})

test('can clear instance flood windows without clearing browser retry state', () => {
  const limiter = new AuthenticationLimiter({ globalLimit: 100 })
  for (let attempt = 0; attempt < 5; attempt += 1) {
    limiter.enter('account', 'browser').release(false)
  }
  assert.deepEqual(limiter.clearGlobal(), {
    cleared: true,
    globalFailures: 5,
    globalRetryAfterSeconds: 0,
  })
  assert.throws(
    () => limiter.enter('account', 'browser'),
    error => error.code === 'AUTHENTICATION_RETRY_REQUIRED'
      && error.details.retryAfterSeconds === 30,
  )
  assert.equal(limiter.status('account').globalFailures, 0)
})

test('successful authentication clears consecutive failures', () => {
  const limiter = new AuthenticationLimiter({ globalLimit: 100 })
  for (let attempt = 0; attempt < 4; attempt += 1) limiter.enter('account').release(false)
  limiter.enter('account').release(true)
  assert.deepEqual(limiter.status('account'), {
    activeSources: 0, consecutiveFailures: 0, retryAfterSeconds: 0,
    sourceRetryAfterSeconds: 0, globalFailures: 4, globalRetryAfterSeconds: 0,
  })
})

test('consecutive source failures expire after one quiet day', () => {
  let now = 0
  const limiter = new AuthenticationLimiter({
    globalWindows: [{ limit: 100, windowMs: 48 * 60 * 60_000 }],
    sourceWindows: [{ limit: 100, windowMs: 48 * 60 * 60_000 }],
    clock: () => now,
  })
  for (let attempt = 0; attempt < 4; attempt += 1) limiter.enter('account', 'browser').release(false)
  now += 24 * 60 * 60_000 + 1
  limiter.enter('account', 'browser').release(false)
  assert.deepEqual(limiter.sourceStatus('account', 'browser'), {
    consecutiveFailures: 1, retryAfterSeconds: 0,
  })
})

test('prunes expired browser source histories during later authentication', () => {
  let now = 0
  const limiter = new AuthenticationLimiter({ clock: () => now })
  limiter.enter('account', 'expired-browser').release(false)
  assert.equal(limiter.sources.size, 1)
  assert.equal(limiter.consecutiveFailures.size, 1)

  now += 24 * 60 * 60_000 + 1
  limiter.enter('account', 'current-browser').release(true)
  assert.equal(limiter.sources.has(limiter.retryKey('account', 'expired-browser')), false)
  assert.equal(limiter.consecutiveFailures.has(limiter.retryKey('account', 'expired-browser')), false)
})

test('main login and fresh authentication share backend retry state', async () => {
  let now = 1_000
  const limiter = new AuthenticationLimiter({
    globalLimit: 100, clock: () => now,
  })
  const { service } = await fixture({ limiter })
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  const initialized = await service.initialize({
    username: 'admin', password: 'correct horse battery staple',
  })
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(
      service.authenticate({ username: 'admin', password: 'incorrect password' }),
      error => error.code === 'AUTHENTICATION_FAILED',
    )
  }
  const account = (await service.store.state()).account
  await assert.rejects(
    service.verifyFreshAuthentication(account, 'incorrect password'),
    error => error.code === 'AUTHENTICATION_RETRY_REQUIRED'
      && error.details.retryAfterSeconds === 30,
  )
  await assert.rejects(
    service.authenticate({ username: 'admin', password: 'correct horse battery staple' }),
    error => error.code === 'AUTHENTICATION_RETRY_REQUIRED'
      && error.details.retryAfterSeconds === 30,
  )
  assert.equal((await service.recoveryStatus()).authenticationRetry.consecutiveFailures, 5)
  now += 30_000
  await assert.rejects(
    service.authenticate({ username: 'admin', password: 'incorrect password' }),
    error => error.code === 'AUTHENTICATION_RETRY_REQUIRED'
      && error.details.retryAfterSeconds === 60,
  )
  assert.equal((await service.clearAuthenticationRetry()).cleared, true)
  assert.equal((await service.authenticate({
    username: initialized.account.username,
    password: 'correct horse battery staple',
  })).authenticated, true)
})

test('management password failures use the shared backend retry state', async () => {
  const limiter = new AuthenticationLimiter({
    globalLimit: 100, initialBackoffMs: 1_000,
  })
  const { service } = await fixture({ limiter })
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  const initialized = await service.initializeDsh({
    username: 'admin', password: 'correct horse battery staple',
    origin: 'https://dsh.example',
  })
  await service.resetRecoveryManagementPassword({
    revision: initialized.account.revision,
    password: 'separate management password',
  })
  const account = (await service.store.state()).account
  const pending = (await service.managementResult(account, {
    origin: 'https://manage.example',
    sourceDshOrigin: 'https://dsh.example',
    sourceDshSessionId: initialized.session.sessionId,
  })).pending
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(service.completeManagementLogin({
      pendingToken: pending.token,
      origin: 'https://manage.example',
      password: 'incorrect management password',
    }), error => error.code === 'AUTHENTICATION_FAILED')
  }
  await assert.rejects(service.completeManagementLogin({
    pendingToken: pending.token,
    origin: 'https://manage.example',
    password: 'incorrect management password',
  }), error => error.code === 'AUTHENTICATION_RETRY_REQUIRED'
    && error.details.retryAfterSeconds === 1)
  await assert.rejects(service.completeManagementLogin({
    pendingToken: pending.token,
    origin: 'https://manage.example',
    password: 'separate management password',
  }), error => error.code === 'AUTHENTICATION_RETRY_REQUIRED')
  await service.clearAuthenticationRetry()
  assert.match((await service.completeManagementLogin({
    pendingToken: pending.token,
    origin: 'https://manage.example',
    password: 'separate management password',
  })).session.token, /^dshms_/)
})

test('stores only digests for origin-bound DSH sessions with absolute and idle expiry', async () => {
  let now = 1_000
  const sessions = new BrowserSessionStore({
    now: () => now,
    dshAbsoluteMs: 1_000,
    dshIdleMs: 100,
  })
  const account = {
    accountId: 'account',
    mainCredential: { version: 2 },
    managementAdditionalCredential: { enabled: false, version: 1 },
    managementAccess: { version: 3 },
  }
  const issued = sessions.issue('dsh', account, { origin: 'https://dsh.example' })
  assert.match(issued.token, /^dshs_/)
  assert.match(issued.csrfToken, /^dshc_/)
  assert.doesNotMatch(JSON.stringify([...sessions.sessions.values()]), new RegExp(issued.token))
  assert.equal(sessions.validate(issued.token, 'dsh', account, {
    origin: 'https://dsh.example', csrfToken: issued.csrfToken, requireCsrf: true,
  })?.kind, 'dsh')
  assert.equal(sessions.validate(issued.token, 'dsh', account, { origin: 'https://other.example' }), undefined)
  assert.equal(sessions.validate(issued.token, 'management', account, { origin: 'https://dsh.example' }), undefined)
  assert.equal(sessions.validate(issued.token, 'dsh', account, {
    origin: 'https://dsh.example', csrfToken: 'wrong', requireCsrf: true,
  }), undefined)
  now += 101
  assert.equal(sessions.validate(issued.token, 'dsh', account, { origin: 'https://dsh.example' }), undefined)
})

test('probes the current instance before atomically changing Management origin', async () => {
  const { service } = await fixture()
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  const initialized = await service.initialize({ username: 'admin', password: 'correct horse battery staple' })
  await service.resetRecoveryManagementPassword({
    revision: initialized.account.revision,
    password: 'separate management password',
  })
  const login = await loginManagement(service, { managementPassword: 'separate management password' })
  const issued = await service.issueCapability({
    managementToken: login.management.session.token,
    origin: 'http://dsh.example:3080',
    csrfToken: login.management.session.csrfToken,
    requireCsrf: true,
    audience: 'management',
    method: 'POST',
    target: '/_dsh_platform/api/v1/management-origin/transitions',
  })
  const created = await service.createManagementTransition({
    internalCapability: issued.capability.token,
    method: 'POST',
    target: '/_dsh_platform/api/v1/management-origin/transitions',
    mode: 'isolated',
    isolatedEntry: { kind: 'public', managementPublicOrigin: 'https://manage.example' },
  })
  const proof = await service.probeManagementTransition({
    transitionId: created.transition.transitionId,
    nonce: created.transition.nonce,
    sourceOrigin: 'http://dsh.example:3080',
    candidateOrigin: 'https://manage.example',
  })
  const commitCapability = await service.issueCapability({
    managementToken: login.management.session.token,
    origin: 'http://dsh.example:3080',
    csrfToken: login.management.session.csrfToken,
    requireCsrf: true,
    audience: 'management',
    method: 'POST',
    target: '/_dsh_platform/api/v1/management-origin/transitions/commit',
  })
  const changed = await service.commitManagementTransition({
    internalCapability: commitCapability.capability.token,
    method: 'POST', target: '/_dsh_platform/api/v1/management-origin/transitions/commit',
    transitionId: created.transition.transitionId, proof: proof.proof,
  })
  assert.equal(changed.account.managementAccess.mode, 'isolated')
  assert.equal(changed.account.managementAccess.version, 2)
  assert.equal(changed.targetOrigin, 'https://manage.example')
  assert.equal(changed.loginOrigin, 'https://manage.example')
  assert.equal((await service.validateSession({
    token: login.management.session.token, kind: 'management', origin: 'http://dsh.example:3080',
  })).authenticated, false)
  const continued = await service.consumeManagementContinuation({
    token: changed.continuation.token, origin: 'https://manage.example',
  })
  assert.match(continued.session.token, /^dshms_/)
  await assert.rejects(service.consumeManagementContinuation({
    token: changed.continuation.token, origin: 'https://manage.example',
  }), error => error.code === 'CONTINUATION_INVALID')

  const nextCapability = async target => (await service.issueCapability({
    managementToken: continued.session.token,
    origin: 'https://manage.example',
    csrfToken: continued.session.csrfToken,
    requireCsrf: true,
    audience: 'management',
    method: 'POST',
    target,
  })).capability.token
  const moved = await service.createManagementTransition({
    internalCapability: await nextCapability('/_dsh_platform/api/v1/management-origin/transitions'),
    method: 'POST', target: '/_dsh_platform/api/v1/management-origin/transitions',
    mode: 'isolated',
    isolatedEntry: { kind: 'public', managementPublicOrigin: 'https://manage-two.example' },
  })
  const movedProof = await service.probeManagementTransition({
    transitionId: moved.transition.transitionId,
    nonce: moved.transition.nonce,
    sourceOrigin: 'https://manage.example',
    candidateOrigin: 'https://manage-two.example',
  })
  const relocated = await service.commitManagementTransition({
    internalCapability: await nextCapability('/_dsh_platform/api/v1/management-origin/transitions/commit'),
    method: 'POST', target: '/_dsh_platform/api/v1/management-origin/transitions/commit',
    transitionId: moved.transition.transitionId,
    proof: movedProof.proof,
  })
  assert.equal(relocated.account.managementAccess.version, 3)
  assert.equal(relocated.targetOrigin, 'https://manage-two.example')
})

test('verifies a loopback candidate without persisting it for local-only Management', async () => {
  const { service } = await fixture()
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  await service.initialize({ username: 'admin', password: 'correct horse battery staple' })
  const login = await loginManagement(service)
  const capability = async target => (await service.issueCapability({
    managementToken: login.management.session.token, origin: 'http://dsh.example:3080',
    csrfToken: login.management.session.csrfToken, requireCsrf: true,
    audience: 'management', method: 'POST', target,
  })).capability.token
  const created = await service.createManagementTransition({
    internalCapability: await capability('/_dsh_platform/api/v1/management-origin/transitions'),
    method: 'POST', target: '/_dsh_platform/api/v1/management-origin/transitions',
    mode: 'isolated', isolatedEntry: { kind: 'local-only' }, candidateOrigin: 'http://127.20.30.40:45678',
  })
  const proof = await service.probeManagementTransition({
    transitionId: created.transition.transitionId, nonce: created.transition.nonce,
    sourceOrigin: 'http://dsh.example:3080', candidateOrigin: 'http://127.20.30.40:45678',
  })
  const changed = await service.commitManagementTransition({
    internalCapability: await capability('/_dsh_platform/api/v1/management-origin/transitions/commit'),
    method: 'POST', target: '/_dsh_platform/api/v1/management-origin/transitions/commit',
    transitionId: created.transition.transitionId, proof: proof.proof,
  })
  assert.deepEqual(changed.account.managementAccess.isolatedEntry, {
    kind: 'local-only', managementLocalOrigin: 'http://127.20.30.40:45678',
  })
  assert.equal(changed.targetOrigin, null)
  assert.equal(changed.continuation, null)
  assert.equal(changed.loginOrigin, 'http://127.20.30.40:45678')
})

test('commits a Management transition without fresh authentication and rejects replay', async () => {
  const { service } = await fixture()
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  await service.initialize({ username: 'admin', password: 'correct horse battery staple' })
  const login = await loginManagement(service)
  const capability = async target => (await service.issueCapability({
    managementToken: login.management.session.token, origin: 'http://dsh.example:3080',
    csrfToken: login.management.session.csrfToken, requireCsrf: true,
    audience: 'management', method: 'POST', target,
  })).capability.token
  const created = await service.createManagementTransition({
    internalCapability: await capability('/_dsh_platform/api/v1/management-origin/transitions'),
    method: 'POST', target: '/_dsh_platform/api/v1/management-origin/transitions',
    mode: 'isolated', isolatedEntry: { kind: 'public', managementPublicOrigin: 'https://manage.example' },
  })
  const proof = await service.probeManagementTransition({
    transitionId: created.transition.transitionId, nonce: created.transition.nonce,
    sourceOrigin: 'http://dsh.example:3080', candidateOrigin: 'https://manage.example',
  })
  const firstCapability = await capability('/_dsh_platform/api/v1/management-origin/transitions/commit')
  const attempt = internalCapability => service.commitManagementTransition({
    internalCapability,
    method: 'POST', target: '/_dsh_platform/api/v1/management-origin/transitions/commit',
    transitionId: created.transition.transitionId, proof: proof.proof,
  })
  const changed = await attempt(firstCapability)
  assert.equal(changed.account.managementAccess.mode, 'isolated')
  const continued = await service.consumeManagementContinuation({
    token: changed.continuation.token, origin: 'https://manage.example',
  })
  const replayCapability = (await service.issueCapability({
    managementToken: continued.session.token, origin: 'https://manage.example',
    csrfToken: continued.session.csrfToken, requireCsrf: true,
    audience: 'management', method: 'POST',
    target: '/_dsh_platform/api/v1/management-origin/transitions/commit',
  })).capability.token
  await assert.rejects(attempt(replayCapability), error => error.code === 'TRANSITION_INVALID')
})

test('all six Management entry directions switch without a password', async t => {
  const directions = [
    ['compat', 'public'], ['compat', 'local'],
    ['public', 'compat'], ['public', 'local'],
    ['local', 'compat'], ['local', 'public'],
  ]
  for (const [sourceKind, targetKind] of directions) await t.test(`${sourceKind} -> ${targetKind}`, async () => {
    const { service } = await fixture()
    await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
    const dshOrigin = 'http://dsh.example:3080'
    const dsh = await service.initializeDsh({
      username: 'admin', password: 'correct horse battery staple', origin: dshOrigin,
    })
    const initialHandoff = await service.createManagementHandoff({
      dshToken: dsh.session.token, dshOrigin, targetOrigin: dshOrigin,
    })
    let managementOrigin = dshOrigin
    let management = await service.consumeManagementHandoff({
      token: initialHandoff.handoff.token, origin: managementOrigin,
    })
    const commits = []

    const capability = async target => (await service.issueCapability({
      managementToken: management.session.token, origin: managementOrigin,
      csrfToken: management.session.csrfToken, requireCsrf: true,
      audience: 'management', method: 'POST', target,
    })).capability.token
    const switchTo = async kind => {
      const candidateOrigin = kind === 'public'
        ? 'https://manage.example'
        : kind === 'local' ? 'http://127.0.0.1:33081' : null
      const request = kind === 'compat'
        ? { mode: 'compat', isolatedEntry: null, candidateOrigin: null }
        : kind === 'public'
          ? { mode: 'isolated', isolatedEntry: { kind: 'public', managementPublicOrigin: candidateOrigin }, candidateOrigin }
          : { mode: 'isolated', isolatedEntry: { kind: 'local-only' }, candidateOrigin }
      const created = await service.createManagementTransition({
        internalCapability: await capability('/_dsh_platform/api/v1/management-origin/transitions'),
        method: 'POST', target: '/_dsh_platform/api/v1/management-origin/transitions', ...request,
      })
      const proof = candidateOrigin === null ? null : (await service.probeManagementTransition({
        transitionId: created.transition.transitionId, nonce: created.transition.nonce,
        sourceOrigin: managementOrigin, candidateOrigin,
      })).proof
      const commit = {
        internalCapability: await capability('/_dsh_platform/api/v1/management-origin/transitions/commit'),
        method: 'POST', target: '/_dsh_platform/api/v1/management-origin/transitions/commit',
        transitionId: created.transition.transitionId, proof,
      }
      assert.equal(Object.hasOwn(commit, 'currentPassword'), false)
      const changed = await service.commitManagementTransition(commit)
      commits.push(changed)
      managementOrigin = candidateOrigin ?? dshOrigin
      if (changed.continuation !== null) {
        management = await service.consumeManagementContinuation({
          token: changed.continuation.token, origin: managementOrigin,
        })
      } else {
        const handoff = await service.createManagementHandoff({
          dshToken: dsh.session.token, dshOrigin, targetOrigin: managementOrigin,
        })
        management = await service.consumeManagementHandoff({ token: handoff.handoff.token, origin: managementOrigin })
      }
      return changed
    }

    if (sourceKind !== 'compat') await switchTo(sourceKind)
    const changed = await switchTo(targetKind)
    assert.equal(changed.account.managementAccess.mode, targetKind === 'compat' ? 'compat' : 'isolated')
    assert.equal(commits.length, sourceKind === 'compat' ? 1 : 2)
  })
})

test('requires Management origin changes to use the verified transition protocol', async () => {
  const { service } = await fixture()
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  await service.initialize({ username: 'admin', password: 'correct horse battery staple' })
  const login = await loginManagement(service)
  const issued = await service.issueCapability({
    managementToken: login.management.session.token, origin: 'http://dsh.example:3080',
    csrfToken: login.management.session.csrfToken, requireCsrf: true,
    audience: 'management', method: 'PUT', target: '/_dsh_platform/api/v1/auth-settings',
  })
  await assert.rejects(service.updateAuthenticationSettings({
    internalCapability: issued.capability.token,
    method: 'PUT', target: '/_dsh_platform/api/v1/auth-settings',
    currentPassword: 'correct horse battery staple',
    username: 'operator', password: 'a different secure password',
    mode: 'isolated', isolatedEntry: { kind: 'public', managementPublicOrigin: 'https://manage.example' },
  }), error => error.code === 'TRANSITION_REQUIRED')
})

test('requires fresh authentication and applies credential-specific session revocation', async () => {
  const { service } = await fixture()
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  const initialized = await service.initializeDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })
  const handoff = await service.createManagementHandoff({
    dshToken: initialized.session.token,
    dshOrigin: 'https://dsh.example',
    targetOrigin: 'https://dsh.example',
  })
  const management = await service.consumeManagementHandoff({
    token: handoff.handoff.token, origin: 'https://dsh.example',
  })
  const capability = async target => (await service.issueCapability({
    managementToken: management.session.token,
    origin: 'https://dsh.example',
    csrfToken: management.session.csrfToken,
    requireCsrf: true,
    audience: 'management', method: 'PUT', target,
  })).capability.token

  const unchangedRevision = (await service.status()).account.revision
  const unchanged = await service.updateAuthenticationSettings({
    internalCapability: await capability('/_dsh_platform/api/v1/auth-settings'),
    method: 'PUT', target: '/_dsh_platform/api/v1/auth-settings', username: 'admin',
  })
  assert.equal(unchanged.changed, false)
  assert.equal(unchanged.account.revision, unchangedRevision)
  assert.equal(unchanged.currentManagementSessionRevoked, false)

  const renamed = await service.updateAuthenticationSettings({
    internalCapability: await capability('/_dsh_platform/api/v1/auth-settings'),
    method: 'PUT', target: '/_dsh_platform/api/v1/auth-settings', username: 'operator',
  })
  assert.equal(renamed.currentManagementSessionRevoked, false)
  assert.equal((await service.validateSession({
    kind: 'management', token: management.session.token, origin: 'https://dsh.example',
  })).authenticated, true)
  assert.equal((await service.validateSession({
    kind: 'dsh', token: initialized.session.token, origin: 'https://dsh.example',
  })).authenticated, true)

  const changed = await service.updateAuthenticationSettings({
    internalCapability: await capability('/_dsh_platform/api/v1/auth-settings'),
    method: 'PUT', target: '/_dsh_platform/api/v1/auth-settings',
    password: 'a different secure password', currentPassword: 'correct horse battery staple',
  })
  assert.equal(changed.currentManagementSessionRevoked, true)
  assert.equal(changed.changed, true)
  assert.equal(changed.allSessionsRevoked, true)
  assert.equal(changed.managementSessionsRevoked, 2)
  assert.equal((await service.validateSession({
    kind: 'management', token: management.session.token, origin: 'https://dsh.example',
  })).authenticated, false)
  assert.equal((await service.validateSession({
    kind: 'dsh', token: initialized.session.token, origin: 'https://dsh.example',
  })).authenticated, false)
})

test('changes the Management console password using only the current main password', async () => {
  const { service } = await fixture()
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  await service.initialize({ username: 'admin', password: 'correct horse battery staple' })
  const target = '/_dsh_platform/api/v1/auth-settings'
  const update = async (managementPassword, body) => {
    const login = await loginManagement(service, { managementPassword })
    const capability = await service.issueCapability({
      managementToken: login.management.session.token,
      origin: 'http://dsh.example:3080',
      csrfToken: login.management.session.csrfToken,
      requireCsrf: true,
      audience: 'management', method: 'PUT', target,
    })
    return service.updateAuthenticationSettings({
      internalCapability: capability.capability.token,
      method: 'PUT', target,
      currentPassword: 'correct horse battery staple',
      ...body,
    })
  }

  const enabled = await update(undefined, {
    additionalEnabled: true,
    additionalPassword: 'first management console password',
  })
  assert.equal(enabled.account.managementAdditionalCredential.enabled, true)
  assert.equal(enabled.currentManagementSessionRevoked, true)
  assert.equal(enabled.allSessionsRevoked, false)
  assert.equal(enabled.managementSessionsRevoked, 1)

  const reset = await update('first management console password', {
    additionalEnabled: true,
    additionalPassword: 'replacement management password',
  })
  assert.equal(reset.account.managementAdditionalCredential.enabled, true)
  assert.equal(reset.currentManagementSessionRevoked, true)

  const disabled = await update('replacement management password', { additionalEnabled: false })
  assert.equal(disabled.account.managementAdditionalCredential.enabled, false)
  assert.equal(disabled.currentManagementSessionRevoked, true)
})

test('Root recovery password changes revoke the matching browser sessions', async () => {
  const { service } = await fixture()
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  const initialized = await service.initializeDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })
  const enabled = await service.resetRecoveryManagementPassword({
    revision: initialized.account.revision,
    password: 'original management password',
  })
  const loggedIn = await loginManagement(service, { managementPassword: 'original management password' })
  const changed = await service.resetRecoveryManagementPassword({
    revision: enabled.account.revision,
    password: 'replacement management password',
  })
  assert.equal(changed.allSessionsRevoked, false)
  assert.equal(changed.managementSessionsRevoked, 1)
  assert.equal((await service.validateSession({
    kind: 'management', token: loggedIn.management.session.token, origin: 'http://dsh.example:3080',
  })).authenticated, false)
  assert.equal((await service.validateSession({
    kind: 'dsh', token: loggedIn.dsh.session.token, origin: 'http://dsh.example:3080',
  })).authenticated, true)
})

test('lists login devices and revokes each DSH session with its linked Management session', async () => {
  const { service } = await fixture()
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  const firstDsh = await service.initializeDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
    client: { ip: '192.0.2.10', userAgent: 'Browser One' },
  })
  const secondDsh = await service.loginDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
    client: { ip: '192.0.2.11', userAgent: 'Browser Two' },
  })
  const handoff = await service.createManagementHandoff({
    dshToken: firstDsh.session.token, dshOrigin: 'https://dsh.example', targetOrigin: 'https://dsh.example',
  })
  const management = await service.consumeManagementHandoff({ token: handoff.handoff.token, origin: 'https://dsh.example' })
  const issue = async (method, target) => (await service.issueCapability({
    managementToken: management.session.token, origin: 'https://dsh.example',
    csrfToken: management.session.csrfToken, requireCsrf: true,
    audience: 'management', method, target,
  })).capability.token
  const settings = await service.authenticationSettings({
    internalCapability: await issue('GET', '/_dsh_platform/api/v1/auth-settings'),
    method: 'GET', target: '/_dsh_platform/api/v1/auth-settings',
  })
  assert.equal(typeof settings.dshRootCapabilityEffective, 'boolean')
  assert.equal(settings.agentIsolationEffective, false)
  assert.equal(settings.details.agentIsolationReason, 'shared-node-process-identity')
  assert.equal(settings.sessions.length, 2)
  assert.deepEqual(settings.sessions.find(value => value.current), {
    sessionId: firstDsh.session.sessionId,
    origin: 'https://dsh.example',
    current: true,
    managementActive: true,
    ip: '192.0.2.10',
    userAgent: 'Browser One',
    createdAt: '2026-08-28T00:00:00.000Z',
    lastSeenAt: '2026-08-28T00:00:00.000Z',
    expiresAt: '2026-08-28T12:00:00.000Z',
  })
  assert.equal(settings.sessions.find(value => value.sessionId === secondDsh.session.sessionId)?.managementActive, false)

  const result = await service.revokeBrowserSessions({
    internalCapability: await issue('POST', '/_dsh_platform/api/v1/auth-sessions/revoke'),
    method: 'POST', target: '/_dsh_platform/api/v1/auth-sessions/revoke',
    sessionId: secondDsh.session.sessionId,
  })
  assert.equal(result.revoked, 1)
  assert.equal(result.currentSessionRevoked, false)
  assert.equal((await service.validateSession({
    kind: 'dsh', token: firstDsh.session.token, origin: 'https://dsh.example',
  })).authenticated, true)
  assert.equal((await service.validateSession({
    kind: 'dsh', token: secondDsh.session.token, origin: 'https://dsh.example',
  })).authenticated, false)

  const current = await service.revokeBrowserSessions({
    internalCapability: await issue('POST', '/_dsh_platform/api/v1/auth-sessions/revoke'),
    method: 'POST', target: '/_dsh_platform/api/v1/auth-sessions/revoke',
    sessionId: firstDsh.session.sessionId,
  })
  assert.equal(current.currentSessionRevoked, true)
  assert.equal((await service.validateSession({
    kind: 'management', token: management.session.token, origin: 'https://dsh.example',
  })).authenticated, false)
})

test('rejects equal administrator passwords and non-origin Management entries', async () => {
  const { service } = await fixture()
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  await service.initialize({ username: 'admin', password: 'correct horse battery staple' })
  const capability = async (method = 'PUT', target = '/_dsh_platform/api/v1/auth-settings') => {
    const login = await loginManagement(service)
    return (await service.issueCapability({
      managementToken: login.management.session.token, origin: 'http://dsh.example:3080',
      csrfToken: login.management.session.csrfToken, requireCsrf: true,
      audience: 'management', method, target,
    })).capability.token
  }
  await assert.rejects(service.updateAuthenticationSettings({
    internalCapability: await capability(), method: 'PUT', target: '/_dsh_platform/api/v1/auth-settings',
    currentPassword: 'correct horse battery staple',
    additionalEnabled: true, additionalPassword: 'correct horse battery staple',
  }), error => error.code === 'PASSWORDS_MUST_DIFFER')
  await assert.rejects(service.createManagementTransition({
    internalCapability: await capability('POST', '/_dsh_platform/api/v1/management-origin/transitions'),
    method: 'POST', target: '/_dsh_platform/api/v1/management-origin/transitions',
    mode: 'isolated', isolatedEntry: { kind: 'public', managementPublicOrigin: 'https://manage.example/path' },
  }), error => error.code === 'ACCESS_ENTRY_INVALID')
})

test('locks Management mode changes at the final execution point when DSH can become Root', async () => {
  const { service } = await fixture({
    runtimeCapabilities: async () => ({
      dshRootCapabilityEffective: true,
      agentIsolationEffective: false,
      details: { sudoSelection: 'enabled', agentIsolationReason: 'shared-node-process-identity' },
    }),
  })
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  const initialized = await service.initializeDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })
  const handoff = await service.createManagementHandoff({
    dshToken: initialized.session.token, dshOrigin: 'https://dsh.example', targetOrigin: 'https://dsh.example',
  })
  const management = await service.consumeManagementHandoff({ token: handoff.handoff.token, origin: 'https://dsh.example' })
  const capability = (await service.issueCapability({
    managementToken: management.session.token, origin: 'https://dsh.example',
    csrfToken: management.session.csrfToken, requireCsrf: true,
    audience: 'management', method: 'POST', target: '/_dsh_platform/api/v1/management-origin/transitions',
  })).capability.token
  await assert.rejects(service.createManagementTransition({
    internalCapability: capability,
    method: 'POST', target: '/_dsh_platform/api/v1/management-origin/transitions',
    mode: 'isolated', isolatedEntry: { kind: 'public', managementPublicOrigin: 'https://manage.example' },
  }), error => error.code === 'ACCESS_MODE_LOCKED')
})

test('reconciles a persisted isolated Management entry when DSH Root capability becomes effective', async () => {
  const reports = []
  const { service, store } = await fixture({
    runtimeCapabilities: async () => ({
      dshRootCapabilityEffective: true,
      agentIsolationEffective: false,
      details: { sudoSelection: 'enabled', agentIsolationReason: 'shared-node-process-identity' },
    }),
    report: async (message, fields) => reports.push({ message, fields }),
  })
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  await service.initializeDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })
  const isolated = await persistIsolatedManagementAccess(store)
  const session = await service.loginDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })

  const result = await service.reconcileRuntimePolicy()
  const current = await store.state()
  assert.equal(result.changed, true)
  assert.notEqual(current.account.revision, isolated.revision)
  assert.deepEqual(current.account.managementAccess, {
    mode: 'compat',
    version: isolated.managementAccess.version + 1,
    isolatedEntry: null,
    dshPublicOrigin: null,
    changedAt: '2026-08-28T00:00:00.000Z',
  })
  assert.equal((await service.validateSession({
    kind: 'dsh', token: session.session.token, origin: 'https://dsh.example',
  })).authenticated, false)
  assert.deepEqual(reports.at(-1), {
    message: 'access.management-origin.reconciled',
    fields: { mode: 'compat', reason: 'dsh-root-capability', revokedSessions: 2 },
  })
})

test('preserves a persisted isolated Management entry without DSH Root capability', async () => {
  const { service, store } = await fixture({
    runtimeCapabilities: async () => ({
      dshRootCapabilityEffective: false,
      agentIsolationEffective: false,
      details: { sudoSelection: 'disabled', agentIsolationReason: 'shared-node-process-identity' },
    }),
  })
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  await service.initializeDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })
  const isolated = await persistIsolatedManagementAccess(store)

  const result = await service.reconcileRuntimePolicy()
  const current = await store.state()
  assert.equal(result.changed, false)
  assert.equal(current.account.revision, isolated.revision)
  assert.deepEqual(current.account.managementAccess, isolated.managementAccess)
})

test('initializes and logs into DSH with separately revocable browser sessions', async () => {
  const current = await fixture()
  await current.service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  const initialized = await current.service.initializeDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })
  assert.equal(initialized.state, 'initialized')
  assert.match(initialized.session.token, /^dshs_/)
  assert.equal((await current.service.validateSession({
    kind: 'dsh', token: initialized.session.token, origin: 'https://dsh.example',
  })).authenticated, true)
  await current.service.logout({ kind: 'dsh', token: initialized.session.token })
  assert.equal((await current.service.validateSession({
    kind: 'dsh', token: initialized.session.token, origin: 'https://dsh.example',
  })).authenticated, false)

  const loggedIn = await current.service.loginDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })
  assert.match(loggedIn.session.token, /^dshs_/)
  assert.doesNotMatch(JSON.stringify(loggedIn), /salt|hash|verifier/i)
})

test('exchanges one DSH session for one origin-bound Management session', async () => {
  const current = await fixture()
  await current.service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  const initialized = await current.service.initializeDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })
  const created = await current.service.createManagementHandoff({
    dshToken: initialized.session.token,
    dshOrigin: 'https://dsh.example',
    targetOrigin: 'https://dsh.example',
  })
  assert.match(created.handoff.token, /^dshh_/)
  const consumed = await current.service.consumeManagementHandoff({
    token: created.handoff.token, origin: 'https://dsh.example',
  })
  assert.match(consumed.session.token, /^dshms_/)
  assert.notEqual(consumed.session.token, initialized.session.token)
  assert.equal((await current.service.validateSession({
    kind: 'management', token: consumed.session.token, origin: 'https://dsh.example',
  })).authenticated, true)
  assert.equal((await current.service.validateSession({
    kind: 'dsh', token: consumed.session.token, origin: 'https://dsh.example',
  })).authenticated, false)
  await assert.rejects(
    current.service.consumeManagementHandoff({ token: created.handoff.token, origin: 'https://dsh.example' }),
    error => error.code === 'HANDOFF_INVALID',
  )
})

test('rejects an additional Management password after its source DSH session ends', async () => {
  const current = await fixture()
  await current.service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  const initialized = await current.service.initializeDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })
  await current.service.resetRecoveryManagementPassword({
    revision: initialized.account.revision,
    password: 'separate management password',
  })
  const dsh = await current.service.loginDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })
  const handoff = await current.service.createManagementHandoff({
    dshToken: dsh.session.token,
    dshOrigin: 'https://dsh.example',
    targetOrigin: 'https://manage.example',
  })
  const pending = await current.service.consumeManagementHandoff({
    token: handoff.handoff.token, origin: 'https://manage.example',
  })
  assert.match(pending.pending.token, /^dshmp_/)
  await current.service.logout({ kind: 'dsh', token: dsh.session.token })
  await assert.rejects(current.service.completeManagementLogin({
    pendingToken: pending.pending.token,
    origin: 'https://manage.example',
    password: 'separate management password',
  }), error => error.code === 'PENDING_LOGIN_INVALID')
})

test('revokes Management sessions linked to the current DSH browser without widening access', async () => {
  const current = await fixture()
  await current.service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  const firstDsh = await current.service.initializeDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })
  const secondDsh = await current.service.loginDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://other.example',
  })
  const exchange = async (dsh, dshOrigin, targetOrigin) => {
    const created = await current.service.createManagementHandoff({
      dshToken: dsh.session.token, dshOrigin, targetOrigin,
    })
    return current.service.consumeManagementHandoff({ token: created.handoff.token, origin: targetOrigin })
  }
  const firstManagement = await exchange(firstDsh, 'https://dsh.example', 'https://manage.example')
  const otherManagement = await exchange(secondDsh, 'https://other.example', 'https://other-manage.example')

  const managementOnly = await current.service.logoutDshBrowser({
    scope: 'management', dshToken: firstDsh.session.token, dshOrigin: 'https://dsh.example',
  })
  assert.deepEqual(managementOnly, { authenticated: true, dshRevoked: false, managementRevoked: 1 })
  assert.equal((await current.service.validateSession({
    kind: 'dsh', token: firstDsh.session.token, origin: 'https://dsh.example',
  })).authenticated, true)
  assert.equal((await current.service.validateSession({
    kind: 'management', token: firstManagement.session.token, origin: 'https://manage.example',
  })).authenticated, false)
  assert.equal((await current.service.validateSession({
    kind: 'management', token: otherManagement.session.token, origin: 'https://other-manage.example',
  })).authenticated, true)

  const replacement = await exchange(firstDsh, 'https://dsh.example', 'https://manage.example')
  const all = await current.service.logoutDshBrowser({
    scope: 'all', dshToken: firstDsh.session.token, dshOrigin: 'https://dsh.example',
  })
  assert.deepEqual(all, { authenticated: false, dshRevoked: true, managementRevoked: 1 })
  assert.equal((await current.service.validateSession({
    kind: 'dsh', token: firstDsh.session.token, origin: 'https://dsh.example',
  })).authenticated, false)
  assert.equal((await current.service.validateSession({
    kind: 'management', token: replacement.session.token, origin: 'https://manage.example',
  })).authenticated, false)
})

test('moves initialized installations with missing or damaged accounts to recovery-required', async () => {
  const { root, store } = await fixture()
  await store.classify({ dshProfile: false })
  await store.initialize({ username: 'admin', password: 'correct horse battery staple' })
  await rm(join(root, 'account.json'))
  const recovered = await store.classify({ dshProfile: false })
  assert.equal(recovered.initialization.state, 'recovery-required')

  const damaged = await fixture()
  await damaged.store.prepare()
  await writeFile(join(damaged.root, 'initialization.json'), '{broken')
  assert.equal((await damaged.store.classify({ dshProfile: true })).initialization.state, 'recovery-required')
})

test('collects only fixed boolean legacy evidence before DSH starts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-access-evidence-'))
  const dshHome = join(root, 'dsh')
  const paths = new PlatformPaths(join(root, 'platform'), join(root, 'run'))
  await mkdir(join(dshHome, 'profiles', 'web'), { recursive: true })
  await mkdir(paths.managementStateRoot, { recursive: true })
  await writeFile(join(dshHome, 'profiles', 'web', 'package.json'), '{}')
  const evidence = await collectAccessEvidence({ dshHome, paths, legacyAuthenticationConfigured: true })
  assert.equal(evidence.webProfile, true)
  assert.equal(evidence.legacyAuthenticationConfigured, true)
  assert.equal(Object.values(evidence).every(value => typeof value === 'boolean'), true)
  assert.deepEqual(parseAccessEvidence(JSON.stringify(evidence)), evidence)
  assert.throws(() => parseAccessEvidence('{"webProfile":false}'), /evidence is invalid/)
})

test('captures fresh-install evidence before Stage-0 creates platform records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-access-fresh-evidence-'))
  const dshHome = join(root, 'dsh')
  const paths = new PlatformPaths(join(root, 'platform'), join(root, 'run'))
  const evidence = await collectAccessEvidence({ dshHome, paths })
  await mkdir(paths.deploymentStateRoot, { recursive: true })
  await writeFile(join(paths.deploymentStateRoot, 'slots.json'), '{}')
  assert.equal(evidence.deploymentState, false)
  assert.equal(Object.values(evidence).some(Boolean), false)
})
