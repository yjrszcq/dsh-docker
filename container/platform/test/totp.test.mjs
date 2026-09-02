import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TotpFlowStore,
  TotpRetryLimiter,
  generateTotpSecret,
  totpCode,
  totpUri,
  validTotpSecret,
  verifyTotpCode,
} from '../../control-plane/services/access-manager/lib/totp.mjs'

test('generates interoperable TOTP secrets, codes, and enrollment URIs', () => {
  const secret = generateTotpSecret(size => Buffer.alloc(size, 7))
  assert.equal(secret.length, 32)
  assert.equal(validTotpSecret(secret), true)
  const code = totpCode(secret, { now: 59_000 })
  assert.equal(code.length, 6)
  assert.equal(verifyTotpCode(code, secret, { now: 59_000 }), true)
  assert.equal(verifyTotpCode(code, secret, { now: 89_000 }), true)
  assert.equal(verifyTotpCode('not-six-digits', secret, { now: 59_000 }), false)
  assert.match(totpUri({ secret, username: '管理 员' }), /^otpauth:\/\/totp\/DSH%20Docker%3A%E7%AE%A1%E7%90%86%20%E5%91%98\?secret=/)
})

test('binds one-time TOTP enrollment and login challenges to account state and sessions', () => {
  let now = 1_000
  let fill = 1
  const flows = new TotpFlowStore({
    now: () => now,
    random: size => Buffer.alloc(size, fill++),
    enrollmentTtlMs: 100,
    loginTtlMs: 100,
  })
  const account = { accountId: 'account-a', revision: 'revision-a' }
  const enrollment = flows.createEnrollment(account, 'management-a')
  assert.equal(flows.enrollment(enrollment.token, account, 'management-a')?.value.secret, enrollment.secret)
  assert.equal(flows.enrollment(enrollment.token, account, 'management-b'), undefined)
  assert.equal(flows.enrollment(enrollment.token, { ...account, revision: 'revision-b' }, 'management-a'), undefined)
  assert.equal(flows.cancelEnrollment(enrollment.token, account, 'management-a'), true)
  assert.equal(flows.enrollment(enrollment.token, account, 'management-a'), undefined)

  const login = flows.createLogin(account, { origin: 'https://dsh.example', authenticationSource: 'browser:a' })
  assert.equal(flows.login(login.token, account)?.value.origin, 'https://dsh.example')
  now += 101
  assert.equal(flows.login(login.token, account), undefined)
})

test('applies fixed TOTP retry and separate source and global daily windows', () => {
  let now = 1_000
  assert.equal(new TotpRetryLimiter().sourceDailyLimit, 25)
  assert.equal(new TotpRetryLimiter().globalDailyLimit, 50)
  const limiter = new TotpRetryLimiter({
    now: () => now,
    threshold: 3,
    retryMs: 10_000,
    sourceDailyLimit: 4,
    globalDailyLimit: 6,
    dailyWindowMs: 100_000,
  })
  assert.equal(limiter.fail('account', 'browser:a').kind, null)
  assert.equal(limiter.fail('account', 'browser:a').kind, null)
  assert.deepEqual(limiter.fail('account', 'browser:a'), { kind: 'retry', retryAfterSeconds: 10 })
  assert.equal(limiter.clearDailyLimits('account').cleared, 2)
  assert.deepEqual(limiter.retry('account', 'browser:a'), { kind: 'retry', retryAfterSeconds: 10 })

  now += 10_000
  assert.deepEqual(limiter.fail('account', 'browser:a'), { kind: 'retry', retryAfterSeconds: 10 })
  now += 10_000
  limiter.succeed('account', 'browser:a')
  assert.deepEqual(limiter.retry('account', 'browser:a'), { kind: null, retryAfterSeconds: 0 })

  for (let index = 0; index < 3; index += 1) limiter.fail('account', 'browser:b')
  now += 10_000
  assert.equal(limiter.fail('account', 'browser:b').kind, 'rate')
  limiter.clearDailyLimits('account')
  assert.equal(limiter.retry('account', 'browser:b').kind, 'retry')
  now += 10_000
  assert.equal(limiter.retry('account', 'browser:b').kind, null)

  for (let index = 0; index < 3; index += 1) {
    limiter.succeed('account', 'browser:a')
    limiter.fail('account', 'browser:a')
    limiter.succeed('account', 'browser:b')
    limiter.fail('account', 'browser:b')
  }
  assert.equal(limiter.retry('account', 'browser:a').kind, 'rate')
  assert.equal(limiter.clearDailyLimits('account', { globalOnly: true }).cleared, 1)
  assert.equal(limiter.retry('account', 'browser:a').kind, null)
})
