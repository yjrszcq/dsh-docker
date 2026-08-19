import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../system-plugins/update-console-entry/package/', import.meta.url)

test('Update Console entry declares an rc.7 web client and a platform-namespaced overlay row', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root)))
  const patch = JSON.parse(await readFile(new URL('cordis.patch.json', root)))
  assert.equal(packageJson.dsh.client.platform, 'web')
  assert.equal(packageJson.exports['./client'], './lib/client.js')
  assert.equal(await readFile(new URL('lib/style.module.css', root), 'utf8').then(value => value.includes('@media (max-width: 640px)')), true)
  assert.equal(patch[0].id, 'dsh-docker.update-console-entry.plugin')
})

test('Update Console entry registers the official settings.section slot without update authority', async () => {
  const source = await readFile(new URL('lib/client.js', root), 'utf8')
  assert.match(source, /settings\.section/)
  assert.match(source, /\/_dsh_platform\/ui\//)
  assert.match(source, /打开更新控制台/)
  assert.doesNotMatch(source, /fetch\(|EventSource|confirmDataLoss/)
  assert.doesNotMatch(source, /trust\/reset/)
})
