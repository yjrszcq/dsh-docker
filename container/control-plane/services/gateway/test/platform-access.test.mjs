import assert from 'node:assert/strict'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { LocalApiClient } from '../../../modules/updater/lib/client.mjs'
import {
  createPlatformAccessControlServer,
  listenPlatformAccessControl,
  PlatformAccess,
} from '../lib/platform-access.mjs'

function request(cookie) {
  return { headers: cookie === undefined ? {} : { cookie } }
}

test('platform password creates an idle-bounded browser session', () => {
  let now = 1_000
  const access = new PlatformAccess({
    password: 'platform secret',
    now: () => now,
    sessionIdleMs: 100,
    sessionTtlMs: 1_000,
  })
  assert.equal(access.signIn('wrong'), undefined)
  const session = access.signIn('platform secret')
  assert.match(session, /^dshps_[A-Za-z0-9_-]+$/)
  assert.equal(access.isAuthenticated(request(`dsh_platform_session=${session}`)), true)
  now += 101
  assert.equal(access.isAuthenticated(request(`dsh_platform_session=${session}`)), false)
})

test('temporary platform access key supports repeated login until it expires', () => {
  let now = 2_000
  const access = new PlatformAccess({ now: () => now, temporaryKeyTtlMs: 100 })
  const first = access.createTemporaryKey()
  assert.match(first.key, /^dshp_[A-Za-z0-9_-]+$/)
  const firstSession = access.signIn(first.key)
  const secondSession = access.signIn(first.key)
  assert.match(firstSession, /^dshps_/)
  assert.match(secondSession, /^dshps_/)
  assert.equal(access.isAuthenticated(request(`dsh_platform_session=${firstSession}`)), true)
  assert.equal(access.isAuthenticated(request(`dsh_platform_session=${secondSession}`)), true)

  const replaced = access.createTemporaryKey()
  assert.notEqual(replaced.key, first.key)
  assert.equal(access.signIn(first.key), undefined)
  assert.equal(access.isAuthenticated(request(`dsh_platform_session=${firstSession}`)), true)
  assert.equal(access.isAuthenticated(request(`dsh_platform_session=${secondSession}`)), true)
  assert.match(access.signIn(replaced.key), /^dshps_/)
  const expired = access.createTemporaryKey()
  now += 101
  assert.equal(access.signIn(expired.key), undefined)
})

test('platform logout invalidates only the supplied session', () => {
  const access = new PlatformAccess({ password: 'secret' })
  const first = access.signIn('secret')
  const second = access.signIn('secret')
  access.logout(request(`other=value; dsh_platform_session=${first}`))
  assert.equal(access.isAuthenticated(request(`dsh_platform_session=${first}`)), false)
  assert.equal(access.isAuthenticated(request(`dsh_platform_session=${second}`)), true)
})

test('local gateway control socket creates only the latest temporary key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-platform-access-'))
  const socketPath = join(root, 'gateway-access.sock')
  const access = new PlatformAccess()
  const server = createPlatformAccessControlServer(access)
  await listenPlatformAccessControl(server, socketPath)
  try {
    assert.equal((await stat(socketPath)).mode & 0o777, 0o600)
    const client = new LocalApiClient(socketPath)
    const first = await client.request('POST', '/v1/keys')
    const second = await client.request('POST', '/v1/keys')
    assert.notEqual(first.key, second.key)
    assert.equal(access.signIn(first.key), undefined)
    const session = access.signIn(second.key)
    assert.match(session, /^dshps_/)
    assert.deepEqual(await client.request('POST', '/v1/sessions/validate', {
      cookie: `dsh_platform_session=${session}`,
    }), { authenticated: true })
    assert.deepEqual(await client.request('POST', '/v1/sessions/validate', {
      cookie: 'dsh_platform_session=invalid',
    }), { authenticated: false })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
