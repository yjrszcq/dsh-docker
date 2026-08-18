import assert from 'node:assert/strict'
import test from 'node:test'
import { injectRandomUuidPolyfill, RANDOM_UUID_POLYFILL } from '../lib/polyfill.mjs'

test('polyfill is inserted immediately after the head tag', () => {
  assert.equal(
    injectRandomUuidPolyfill('<html><head data-x="1"><title>x</title></head></html>'),
    `<html><head data-x="1">${RANDOM_UUID_POLYFILL}<title>x</title></head></html>`,
  )
})

test('polyfill falls back to the start when no head exists', () => {
  assert.equal(injectRandomUuidPolyfill('<main>x</main>'), `${RANDOM_UUID_POLYFILL}<main>x</main>`)
})

test('polyfill is feature guarded and uses no weak random source', () => {
  assert.match(RANDOM_UUID_POLYFILL, /typeof c\.randomUUID!=="function"/)
  assert.match(RANDOM_UUID_POLYFILL, /c\.getRandomValues/)
  assert.doesNotMatch(RANDOM_UUID_POLYFILL, /Math\.random/)
})
