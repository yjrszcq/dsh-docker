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
    limiter: new AuthenticationLimiter({ globalLimit: 10, accountLimit: 3, maxConcurrent: 2 }),
    now: () => now.getTime(),
    ...options,
  })
  return { root, store, service, setNow: value => { now = new Date(value) } }
}

async function loginManagement(service, {
  dshOrigin = 'http://dsh.example:3080',
  targetOrigin = dshOrigin,
} = {}) {
  const dsh = await service.loginDsh({
    username: 'admin', password: 'correct horse battery staple', origin: dshOrigin,
  })
  const handoff = await service.createManagementHandoff({
    dshToken: dsh.session.token, dshOrigin, targetOrigin,
  })
  const management = await service.consumeManagementHandoff({
    token: handoff.handoff.token, origin: targetOrigin,
  })
  return { dsh, management }
}

test('normalizes administrator usernames and preserves password whitespace', () => {
  assert.equal(normalizeUsername('  a\u0301dmin  '), 'ádmin')
  assert.equal(normalizePassword('  password  '), '  password  ')
  assert.throws(() => normalizeUsername('admin\nroot'), error => error.code === 'USERNAME_INVALID')
  assert.throws(() => normalizeUsername(`admin\u202eroot`), error => error.code === 'USERNAME_INVALID')
  assert.throws(() => normalizePassword('short'), error => error.code === 'PASSWORD_POLICY_VIOLATION')
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
  assert.equal((await fresh.store.classify({ dshProfile: false, legacyAuthenticationConfigured: false })).initialization.state, 'never-initialized')
  assert.equal((await fresh.store.classify({ dshProfile: true, legacyAuthenticationConfigured: true })).initialization.state, 'never-initialized')

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

test('migrates a legacy deployment with one expiring single-use setup key', async () => {
  const current = await fixture()
  await current.service.classify({ token: 'classification-token', evidence: { dshProfile: true } })
  const first = await current.service.beginMigration()
  const second = await current.service.beginMigration()
  assert.match(second.key, /^dshmk_/)
  assert.notEqual(first.key, second.key)
  await assert.rejects(current.service.migrateDsh({
    setupKey: first.key, username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  }), error => error.code === 'MIGRATION_KEY_INVALID' && error.statusCode === 401)
  const migrated = await current.service.migrateDsh({
    setupKey: second.key, username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })
  assert.equal(migrated.state, 'initialized')
  assert.equal(migrated.account.username, 'admin')
  assert.match(migrated.session.token, /^dshs_/)
  await assert.rejects(current.service.beginMigration(), error => error.code === 'MIGRATION_UNAVAILABLE')
})

test('keeps a valid migration key usable while new account fields are corrected', async () => {
  const current = await fixture()
  await current.service.classify({ token: 'classification-token', evidence: { dshProfile: true } })
  const setup = await current.service.beginMigration()
  await assert.rejects(current.service.migrateDsh({
    setupKey: setup.key, username: 'operator', password: 'four', origin: 'https://dsh.example',
  }), error => error.code === 'PASSWORD_POLICY_VIOLATION')
  const migrated = await current.service.migrateDsh({
    setupKey: setup.key, username: 'operator', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })
  assert.equal(migrated.account.username, 'operator')
  await assert.rejects(current.service.migrateDsh({
    setupKey: setup.key, username: 'operator', password: 'correct horse battery staple', origin: 'https://dsh.example',
  }), error => error.code === 'MIGRATION_KEY_INVALID')
})

test('rejects expired and malformed migration keys without exposing an internal error', async () => {
  const current = await fixture()
  await current.service.classify({ token: 'classification-token', evidence: { dshProfile: true } })
  const expired = await current.service.beginMigration()
  current.setNow('2026-08-28T00:10:00.001Z')
  await assert.rejects(current.service.migrateDsh({
    setupKey: expired.key, username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  }), error => error.code === 'MIGRATION_KEY_INVALID' && error.statusCode === 401)
  await current.service.beginMigration()
  await assert.rejects(current.service.migrateDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  }), error => error.code === 'MIGRATION_KEY_INVALID' && error.statusCode === 401)
})

test('normal and recovery sockets expose distinct bounded protocols without verifier material', async () => {
  const { root, service } = await fixture()
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
    const recoveryStatus = await recovery.request('GET', '/v1/recovery/status')
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
  const limiter = new AuthenticationLimiter({ globalLimit: 2, accountLimit: 2, maxConcurrent: 1, clock: () => now })
  const first = limiter.enter('account')
  assert.throws(() => limiter.enter('account'), error => error.code === 'AUTHENTICATION_RATE_LIMITED')
  first.release(false)
  const second = limiter.enter('account')
  assert.equal(second.delayMs > 0, true)
  second.release(false)
  assert.throws(() => limiter.enter('account'), error => error.code === 'AUTHENTICATION_RATE_LIMITED')
  now += 60_001
  limiter.enter('account').release(true)
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
  await service.initialize({ username: 'admin', password: 'correct horse battery staple' })
  const login = await loginManagement(service)
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
    currentPassword: 'correct horse battery staple',
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
    mode: 'isolated', isolatedEntry: { kind: 'local-only' }, candidateOrigin: 'http://127.20.30.40:3081',
  })
  const proof = await service.probeManagementTransition({
    transitionId: created.transition.transitionId, nonce: created.transition.nonce,
    sourceOrigin: 'http://dsh.example:3080', candidateOrigin: 'http://127.20.30.40:3081',
  })
  const changed = await service.commitManagementTransition({
    internalCapability: await capability('/_dsh_platform/api/v1/management-origin/transitions/commit'),
    method: 'POST', target: '/_dsh_platform/api/v1/management-origin/transitions/commit',
    transitionId: created.transition.transitionId, proof: proof.proof,
    currentPassword: 'correct horse battery staple',
  })
  assert.deepEqual(changed.account.managementAccess.isolatedEntry, { kind: 'local-only' })
  assert.equal(changed.targetOrigin, null)
  assert.equal(changed.continuation, null)
  assert.equal(changed.loginOrigin, 'http://127.20.30.40:3081')
})

test('consumes a Management transition when fresh authentication fails', async () => {
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
  const attempt = async currentPassword => service.commitManagementTransition({
    internalCapability: await capability('/_dsh_platform/api/v1/management-origin/transitions/commit'),
    method: 'POST', target: '/_dsh_platform/api/v1/management-origin/transitions/commit',
    transitionId: created.transition.transitionId, proof: proof.proof, currentPassword,
  })
  await assert.rejects(attempt('wrong password'), error => error.code === 'FRESH_AUTH_FAILED')
  await assert.rejects(attempt('correct horse battery staple'), error => error.code === 'TRANSITION_INVALID')
  assert.equal((await service.status()).account.managementAccess.mode, 'compat')
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

  await assert.rejects(service.updateAuthenticationSettings({
    internalCapability: await capability('/_dsh_platform/api/v1/auth-settings'),
    method: 'PUT', target: '/_dsh_platform/api/v1/auth-settings', username: 'operator',
  }), error => error.code === 'FRESH_AUTH_FAILED')

  const renamed = await service.updateAuthenticationSettings({
    internalCapability: await capability('/_dsh_platform/api/v1/auth-settings'),
    method: 'PUT', target: '/_dsh_platform/api/v1/auth-settings',
    username: 'operator', currentPassword: 'correct horse battery staple',
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
  assert.equal((await service.validateSession({
    kind: 'management', token: management.session.token, origin: 'https://dsh.example',
  })).authenticated, false)
  assert.equal((await service.validateSession({
    kind: 'dsh', token: initialized.session.token, origin: 'https://dsh.example',
  })).authenticated, false)
})

test('lists and independently revokes DSH and Management browser sessions', async () => {
  const { service } = await fixture()
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  const firstDsh = await service.initializeDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
  })
  const secondDsh = await service.loginDsh({
    username: 'admin', password: 'correct horse battery staple', origin: 'https://dsh.example',
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
  assert.equal(settings.sessions.filter(value => value.kind === 'dsh').length, 2)
  assert.equal(settings.sessions.filter(value => value.kind === 'management').length, 1)

  const result = await service.revokeBrowserSessions({
    internalCapability: await issue('POST', '/_dsh_platform/api/v1/auth-sessions/revoke'),
    method: 'POST', target: '/_dsh_platform/api/v1/auth-sessions/revoke',
    kind: 'dsh', scope: 'others',
  })
  assert.equal(result.revoked, 1)
  assert.equal((await service.validateSession({
    kind: 'dsh', token: firstDsh.session.token, origin: 'https://dsh.example',
  })).authenticated, true)
  assert.equal((await service.validateSession({
    kind: 'dsh', token: secondDsh.session.token, origin: 'https://dsh.example',
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
