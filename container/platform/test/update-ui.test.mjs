import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../update-ui/package/', import.meta.url)

test('Update UI declares an rc.7 web client and a platform-namespaced overlay row', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root)))
  const patch = JSON.parse(await readFile(new URL('cordis.patch.json', root)))
  assert.equal(packageJson.dsh.client.platform, 'web')
  assert.equal(packageJson.exports['./client'], './lib/client.js')
  assert.equal(await readFile(new URL('lib/style.css', root), 'utf8').then(value => value.includes('@media (max-width: 640px)')), true)
  assert.equal(patch[0].id, 'dsh-docker.update-ui.plugin')
})

test('Update UI registers the official settings.section slot and Experimental recovery controls', async () => {
  const source = await readFile(new URL('lib/client.js', root), 'utf8')
  assert.match(source, /settings\.section/)
  assert.match(source, /更新到最新支持版本/)
  assert.match(source, /更新到最新上游版本/)
  assert.match(source, /request\('check'/)
  assert.match(source, /request\('update'/)
  assert.match(source, /request\('channel'/)
  assert.match(source, /request\('holds\/retry'/)
  assert.match(source, /request\('rollback'/)
  assert.match(source, /confirmDataLoss: true/)
  assert.doesNotMatch(source, /trust\/reset/)
})
