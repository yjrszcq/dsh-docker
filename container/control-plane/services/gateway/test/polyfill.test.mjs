import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { injectRandomUuidPolyfill, PLUGIN_RECOVERY_GUARD, RANDOM_UUID_POLYFILL } from '../lib/polyfill.mjs'

async function simulateFailedBoot(bundlePath) {
  let notifyMutation
  let replacement
  const events = []
  const storage = new Map()
  const context = {
    URL,
    crypto: globalThis.crypto,
    document: {
      documentElement: {},
      querySelectorAll: () => [{
        children: [],
        textContent: 'Failed to load plugins',
        parentElement: { textContent: `Failed to load plugins failed to import ${bundlePath}` },
      }],
    },
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
    MutationObserver: class {
      constructor(callback) { notifyMutation = callback }
      observe() {}
      disconnect() {}
    },
    addEventListener() {},
    fetch: async (input, init) => {
      if (input === '/_dsh_gateway/readiness') return { json: async () => ({ state: 'ready' }) }
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
  notifyMutation()
  await new Promise(resolve => setImmediate(resolve))
  return { events, replacement }
}

test('polyfill is inserted immediately after the head tag', () => {
  assert.equal(
    injectRandomUuidPolyfill('<html><head data-x="1"><title>x</title></head></html>'),
    `<html><head data-x="1">${RANDOM_UUID_POLYFILL}${PLUGIN_RECOVERY_GUARD}<title>x</title></head></html>`,
  )
})

test('polyfill falls back to the start when no head exists', () => {
  assert.equal(injectRandomUuidPolyfill('<main>x</main>'), `${RANDOM_UUID_POLYFILL}${PLUGIN_RECOVERY_GUARD}<main>x</main>`)
})

test('plugin recovery guard runs before DSH modules and permits only one lifecycle recovery', () => {
  assert.doesNotThrow(() => new Function(PLUGIN_RECOVERY_GUARD.slice('<script>'.length, -'</script>'.length)))
  assert.match(PLUGIN_RECOVERY_GUARD, /globalThis\.fetch=function/)
  assert.match(PLUGIN_RECOVERY_GUARD, /\/_dsh_gateway\/client-event/)
  assert.match(PLUGIN_RECOVERY_GUARD, /\/_dsh_gateway\/wait/)
  assert.match(PLUGIN_RECOVERY_GUARD, /previous&&previous\.identity===identity/)
  assert.match(PLUGIN_RECOVERY_GUARD, /browser\.plugin-load\.recovery\.completed/)
  assert.match(PLUGIN_RECOVERY_GUARD, /MutationObserver/)
  assert.match(PLUGIN_RECOVERY_GUARD, /Failed to load plugins/)
  assert.match(PLUGIN_RECOVERY_GUARD, /DSH plugin loader failed/)
  assert.doesNotMatch(PLUGIN_RECOVERY_GUARD, /localStorage/)
})

test('plugin recovery guard catches official and third-party dynamic import failures', async () => {
  for (const [path, pluginId] of [
    ['/plugins/@deepseek-ai/dsh-client-ui-input-trigger/client.js?rev=abc123', '@deepseek-ai/dsh-client-ui-input-trigger'],
    ['/plugins/community-plugin/client.js?rev=def456', 'community-plugin'],
  ]) {
    const result = await simulateFailedBoot(path)
    assert.match(result.replacement, /^\/_dsh_gateway\/wait\?return=/)
    assert.deepEqual(result.events.map(value => [value.event, value.pluginId]), [
      ['browser.plugin-load.failed', pluginId],
      ['browser.plugin-load.recovery.started', pluginId],
    ])
  }
})

test('polyfill is feature guarded and uses no weak random source', () => {
  assert.match(RANDOM_UUID_POLYFILL, /typeof c\.randomUUID!=="function"/)
  assert.match(RANDOM_UUID_POLYFILL, /c\.getRandomValues/)
  assert.doesNotMatch(RANDOM_UUID_POLYFILL, /Math\.random/)
})
