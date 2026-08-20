import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('container smoke targets ephemeral views and the separated persistent layout', async () => {
  const script = await readFile(new URL('../../test/container-smoke.sh', import.meta.url), 'utf8')
  assert.match(script, /\/run\/dsh-platform\/views\/runtime/)
  assert.match(script, /\/run\/dsh-platform\/bootstrap\.sock/)
  assert.match(script, /\/data\/platform\/state\/updater\/transaction\.json/)
  assert.match(script, /\/data\/platform\/store\/snapshots/)
  assert.match(script, /recovery\.sock/)
  assert.match(script, /dsh-platform restart/)
  assert.match(script, /\.dshRestart\.taskId == \$task and \.dshRestart\.status == "success"/)
  assert.match(script, /stage0_pid/)
  assert.match(script, /dsh_pid/)
  assert.match(script, /platform readiness exceeded 10 seconds/)
  assert.match(script, /clear only \/data\/platform/)
  assert.match(script, /Do not delete \/data\/dsh/)
  assert.doesNotMatch(script, /\/data\/platform\/(?:runtime|environments|system-plugins|bootstrap|run)\//)
})

test('Docker health reports DSH readiness instead of control-plane liveness', async () => {
  const dockerfile = await readFile(new URL('../../../Dockerfile', import.meta.url), 'utf8')
  const healthcheck = dockerfile.split('HEALTHCHECK')[1]?.split('\n\n')[0] ?? ''
  assert.match(healthcheck, /--start-period=60s/)
  assert.match(healthcheck, /127\.0\.0\.1:3079\//)
  assert.doesNotMatch(healthcheck, /_dsh_gateway\/health|stage0-trust\.sock/)
})
