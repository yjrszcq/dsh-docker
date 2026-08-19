import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildSystemPluginClient } from '../tools/build-system-plugin-client.mjs'

const root = new URL('../../environment/resources/system-plugins/update-console-entry/package/', import.meta.url)

test('Update Console entry declares an rc.7 web client and a platform-namespaced overlay row', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root)))
  const patch = JSON.parse(await readFile(new URL('cordis.patch.json', root)))
  assert.equal(packageJson.dsh.client.platform, 'web')
  assert.equal(packageJson.exports['./client'], './lib/client.bundle.js')
  assert.equal(packageJson.exports['./package.json'], './package.json')
  assert.equal(await readFile(new URL('lib/style.module.css', root), 'utf8').then(value => value.includes('@media (max-width: 640px)')), true)
  assert.equal(patch[0].insert[0].id, 'dsh-docker.update-console-entry.plugin')
})

test('Update Console checked-in client bundle matches its source and DSH loader protocol', async () => {
  const bundle = await readFile(new URL('lib/client.bundle.js', root), 'utf8')
  const rebuilt = await buildSystemPluginClient({
    pluginId: '@dsh-docker/update-console-entry',
    sourcePath: new URL('lib/client.js', root),
    stylePath: new URL('lib/style.module.css', root),
  })
  assert.equal(bundle, rebuilt)
  assert.match(bundle, /^window\.__ModuleLoader__\.load\(/)
  assert.doesNotMatch(bundle, /^import /m)
})

test('Update Console is embedded in the official settings.section slot', async () => {
  const source = await readFile(new URL('lib/client.js', root), 'utf8')
  assert.match(source, /settings\.section/)
  assert.doesNotMatch(source, /\/_dsh_platform\/ui\//)
  assert.doesNotMatch(source, /打开更新控制台|href:/)
  assert.match(source, /fetch\(`/)
  assert.match(source, /new EventSource/)
  for (const route of ['status', 'check', 'update', 'channel', 'holds\\/retry', 'rollback', 'return-stable']) {
    assert.match(source, new RegExp(`['"]${route}['"]`))
  }
  assert.match(source, /confirmDataLoss: true/)
  assert.doesNotMatch(source, /trust\/reset/)
})

test('Update Console follows DSH settings tokens and responsive layout', async () => {
  const style = await readFile(new URL('lib/style.module.css', root), 'utf8')
  assert.match(style, /--dsw-alias-label-primary/)
  assert.match(style, /--dsw-alias-button-primary-fill/)
  assert.match(style, /--dsw-alias-border-l2/)
  assert.match(style, /@media \(max-width: 640px\)/)
  assert.doesNotMatch(style, /#[0-9a-f]{3,8}\b/i)
})
