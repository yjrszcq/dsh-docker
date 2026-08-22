import assert from 'node:assert/strict'
import test from 'node:test'
import { injectRandomUuidPolyfill, PLUGIN_RECOVERY_GUARD, RANDOM_UUID_POLYFILL } from '../lib/polyfill.mjs'

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
  assert.doesNotMatch(PLUGIN_RECOVERY_GUARD, /localStorage/)
})

test('polyfill is feature guarded and uses no weak random source', () => {
  assert.match(RANDOM_UUID_POLYFILL, /typeof c\.randomUUID!=="function"/)
  assert.match(RANDOM_UUID_POLYFILL, /c\.getRandomValues/)
  assert.doesNotMatch(RANDOM_UUID_POLYFILL, /Math\.random/)
})
