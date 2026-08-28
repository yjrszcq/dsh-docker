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
import { BrowserSessionStore } from '../../control-plane/services/access-manager/lib/sessions.mjs'
import { LocalApiClient } from '../../control-plane/modules/updater/lib/client.mjs'
import { collectAccessEvidence } from '../bootstrap/lib/access-evidence.mjs'
import { PlatformPaths } from '../lib/paths.mjs'
import { CapabilityStore } from '../../control-plane/services/access-manager/lib/capabilities.mjs'

const fastVerifier = (password, options = {}) => createCredential(password, {
  ...options,
  policy: { N: 16, r: 1, p: 1, keyLength: 32, maxmem: 2 * 1024 * 1024 },
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

async function fixture() {
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
  })
  return { root, store, service, setNow: value => { now = new Date(value) } }
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

test('changes Management origin mode and invalidates the previous session', async () => {
  const { service } = await fixture()
  await service.classify({ token: 'classification-token', evidence: { dshProfile: false } })
  await service.initialize({ username: 'admin', password: 'correct horse battery staple' })
  const login = await service.loginManagement({ username: 'admin', password: 'correct horse battery staple', origin: 'http://dsh.example:3080' })
  const changed = await service.setManagementAccess({
    managementToken: login.session.token,
    origin: 'http://dsh.example:3080',
    csrfToken: login.session.csrfToken,
    mode: 'isolated',
    isolatedEntry: { kind: 'local-only' },
  })
  assert.equal(changed.account.managementAccess.mode, 'isolated')
  assert.equal((await service.validateSession({
    token: login.session.token, kind: 'management', origin: 'http://dsh.example:3080',
  })).authenticated, false)
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
})
