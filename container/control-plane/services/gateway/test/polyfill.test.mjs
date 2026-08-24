import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { injectRandomUuidPolyfill, LIFECYCLE_TRANSITION_GUARD, PLUGIN_RECOVERY_GUARD, RANDOM_UUID_POLYFILL } from '../lib/polyfill.mjs'

async function simulatePluginError(bundlePath, { eventType = 'error', storage = new Map() } = {}) {
  let replacement
  const events = []
  const listeners = new Map()
  const context = {
    URL,
    crypto: globalThis.crypto,
    location: {
      href: 'http://gateway.local/sessions/current',
      pathname: '/sessions/current',
      search: '',
      hash: '',
      replace: value => { replacement = value },
    },
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    addEventListener: (name, callback) => listeners.set(name, callback),
    fetch: async (input, init) => {
      if (input === '/_dsh_gateway/readiness') return { json: async () => ({ state: 'ready', pluginRecoveryEligible: true }) }
      if (input === '/_dsh_platform/plugin-api/v1/status') return {
        json: async () => ({
          dshLifecycle: {
            state: 'running',
            taskId: 'lifecycle-task',
            updatedAt: new Date().toISOString(),
          },
        }),
      }
      if (input === '/_dsh_gateway/client-event') {
        events.push(JSON.parse(init.body))
        return { json: async () => ({}) }
      }
      return { ok: true, json: async () => ({}) }
    },
  }
  vm.runInNewContext(PLUGIN_RECOVERY_GUARD.slice('<script>'.length, -'</script>'.length), context)
  if (eventType === 'error') listeners.get('error')?.({ filename: `http://gateway.local${bundlePath}` })
  else if (eventType === 'unhandledrejection') listeners.get('unhandledrejection')?.({
    reason: { stack: `TypeError: failed to import http://gateway.local${bundlePath}` },
  })
  await new Promise(resolve => setImmediate(resolve))
  return { events, replacement, storage }
}

test('polyfill is inserted immediately after the head tag', () => {
  assert.equal(
    injectRandomUuidPolyfill('<html><head data-x="1"><title>x</title></head></html>'),
    `<html><head data-x="1">${RANDOM_UUID_POLYFILL}${LIFECYCLE_TRANSITION_GUARD}${PLUGIN_RECOVERY_GUARD}<title>x</title></head></html>`,
  )
})

test('polyfill falls back to the start when no head exists', () => {
  assert.equal(injectRandomUuidPolyfill('<main>x</main>'), `${RANDOM_UUID_POLYFILL}${LIFECYCLE_TRANSITION_GUARD}${PLUGIN_RECOVERY_GUARD}<main>x</main>`)
})

test('gateway lifecycle guard moves an already-open DSH page into the holding flow', async () => {
  let inspect
  let replacement
  const context = {
    EventSource: class {
      addEventListener(name, callback) { if (name === 'state') inspect = callback }
    },
    URL,
    fetch: async () => ({ json: async () => ({ dshLifecycle: { state: 'restarting' } }) }),
    location: {
      pathname: '/sessions/current', search: '?view=chat', hash: '#latest',
      replace: value => { replacement = value },
    },
  }
  vm.runInNewContext(LIFECYCLE_TRANSITION_GUARD.slice('<script>'.length, -'</script>'.length), context)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(replacement, '/_dsh_gateway/wait?return=%2Fsessions%2Fcurrent%3Fview%3Dchat%23latest')
  replacement = undefined
  await inspect()
  assert.equal(replacement, undefined)
})

test('plugin recovery guard runs before DSH modules and bounds lifecycle recovery', () => {
  assert.doesNotThrow(() => new Function(PLUGIN_RECOVERY_GUARD.slice('<script>'.length, -'</script>'.length)))
  assert.match(PLUGIN_RECOVERY_GUARD, /globalThis\.fetch=function/)
  assert.match(PLUGIN_RECOVERY_GUARD, /\/_dsh_gateway\/client-event/)
  assert.match(PLUGIN_RECOVERY_GUARD, /\/_dsh_gateway\/wait/)
  assert.match(PLUGIN_RECOVERY_GUARD, /attempt>=3/)
  assert.match(PLUGIN_RECOVERY_GUARD, /\/_dsh_gateway\/plugin-failure/)
  assert.match(PLUGIN_RECOVERY_GUARD, /browser\.plugin-load\.recovery\.completed/)
  assert.match(PLUGIN_RECOVERY_GUARD, /addEventListener\("error"/)
  assert.match(PLUGIN_RECOVERY_GUARD, /unhandledrejection/)
  assert.doesNotMatch(PLUGIN_RECOVERY_GUARD, /Failed to load plugins/)
  assert.doesNotMatch(PLUGIN_RECOVERY_GUARD, /localStorage/)
})

test('plugin recovery guard catches official and third-party dynamic import failures', async () => {
  for (const [path, pluginId] of [
    ['/plugins/@deepseek-ai/dsh-client-ui-input-trigger/client.js?rev=abc123', '@deepseek-ai/dsh-client-ui-input-trigger'],
    ['/plugins/community-plugin/client.js?rev=def456', 'community-plugin'],
  ]) {
    const result = await simulatePluginError(path)
    assert.match(result.replacement, /^\/_dsh_gateway\/wait\?return=/)
    assert.deepEqual(result.events.map(value => [value.event, value.pluginId]), [
      ['browser.plugin-load.failed', pluginId],
      ['browser.plugin-load.recovery.started', pluginId],
    ])
  }
})

test('plugin recovery guard retries twice and opens the Gateway failure page after the third failure', async () => {
  const path = '/plugins/@deepseek-ai/dsh-client-ui-input-trigger/client.js?rev=abc123'
  const storage = new Map()
  const first = await simulatePluginError(path, { storage })
  const second = await simulatePluginError(path, { storage })
  const third = await simulatePluginError(path, { storage })

  assert.match(first.replacement, /^\/_dsh_gateway\/wait\?return=/)
  assert.match(second.replacement, /^\/_dsh_gateway\/wait\?return=/)
  assert.equal(third.replacement, '/_dsh_gateway/plugin-failure')
  assert.equal(first.events.at(-1).recoveryAttempt, 1)
  assert.equal(second.events.at(-1).recoveryAttempt, 2)
  assert.deepEqual(third.events.map(value => [value.event, value.recoveryAttempt]), [
    ['browser.plugin-load.recovery.failed', 3],
  ])
})

test('plugin recovery guard does not inspect page text', async () => {
  const result = await simulatePluginError('/plugins/example/client.js?rev=abc123', { eventType: 'none' })
  assert.equal(result.replacement, undefined)
  assert.deepEqual(result.events, [])
})

test('polyfill is feature guarded and uses no weak random source', () => {
  assert.match(RANDOM_UUID_POLYFILL, /typeof c\.randomUUID!=="function"/)
  assert.match(RANDOM_UUID_POLYFILL, /c\.getRandomValues/)
  assert.doesNotMatch(RANDOM_UUID_POLYFILL, /Math\.random/)
})
