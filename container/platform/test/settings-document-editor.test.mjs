import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildSystemPluginClient } from '../tools/build-system-plugin-client.mjs'

const root = new URL('../../environment/resources/plugins/settings-document-editor/package/', import.meta.url)

test('Settings Document Editor is an optional DSH web System Plugin', async () => {
  const metadata = JSON.parse(await readFile(new URL('package.json', root)))
  const patch = JSON.parse(await readFile(new URL('cordis.patch.json', root)))
  assert.equal(metadata.name, '@dsh-docker/settings-document-editor')
  assert.equal(metadata.dshDocker.description.zh, '在浏览器中查看和编辑 DSH 配置文件。')
  assert.equal(metadata.dsh.client.platform, 'web')
  assert.ok(metadata.dsh.client.inject.includes('@deepseek-ai/dsh-api-remotes'))
  assert.equal(metadata.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'), false)
  assert.equal(metadata.peerDependencies['@deepseek-ai/dsh-client-runtime'], undefined)
  assert.equal(metadata.exports['./client'], './lib/client.bundle.js')
  assert.equal(patch[0].insert[0].id, 'dsh-docker.settings-document-editor.plugin')
})

test('Settings Document Editor checked-in bundle matches its source', async () => {
  const bundle = await readFile(new URL('lib/client.bundle.js', root), 'utf8')
  const rebuilt = await buildSystemPluginClient({
    pluginId: '@dsh-docker/settings-document-editor',
    sourcePath: new URL('lib/client.js', root),
    stylePath: new URL('lib/style.module.css', root),
  })
  assert.equal(bundle, rebuilt)
  assert.doesNotThrow(() => new Function(bundle))
  assert.match(bundle, /^window\.__ModuleLoader__\.load\(/)
})

test('Settings Document Editor replaces and restores both pathless DSH open actions', async () => {
  const source = await readFile(new URL('lib/client.js', root), 'utf8')
  assert.match(source, /\/_dsh_platform\/plugin-api\/v1\/settings-document/)
  assert.doesNotMatch(source, /\/_dsh_platform\/api\/v1\/settings-document/)
  assert.match(source, /interceptDocumentOpen\([\s\S]*connection\.api\.settings,[\s\S]*'openDocument'/)
  assert.match(source, /interceptDocumentOpen\([\s\S]*child\.remote\.settings,[\s\S]*'openSettingsDocument'/)
  assert.match(source, /ctx\.inject\(\['remote\.settings'\]/)
  assert.match(source, /\{ ok: true, value: \{ opened: true \} \}/)
  assert.match(source, /\{ result: \{ ok: true, value: \{ opened: true \} \} \}/)
  assert.doesNotMatch(source, /openDocument\(.*path|body:.*path/s)
  assert.match(source, /settings\.dshDocumentEditor/)
  assert.match(source, /shell\.overlay/)
  assert.match(source, /createPortal\([\s\S]*document\.body\)/)
  assert.match(source, /zh: \{[\s\S]*en: \{/)
  assert.match(source, /error\.status === 409/)
  assert.match(source, /event\.key\.toLowerCase\(\) === 's'/)
  assert.match(source, /className: css\.lineNumbers/)
  assert.match(source, /lineNumbers\.current\.scrollTop = event\.currentTarget\.scrollTop/)
  assert.match(source, /wrap: 'off'/)
})

test('Settings Document Editor intercepts old and getter-backed open methods with their native result shapes', async () => {
  const source = await readFile(new URL('lib/client.js', root), 'utf8')
  const definition = source.slice(source.indexOf('function interceptDocumentOpen'), source.indexOf('\n\nexport function apply'))
  const interceptDocumentOpen = new Function(`${definition}; return interceptDocumentOpen`)()
  let opens = 0
  const controller = { open: async () => { opens += 1 } }

  for (const [method, result, getterBacked] of [
    ['openDocument', { result: { ok: true, value: { opened: true } } }, false],
    ['openSettingsDocument', { ok: true, value: { opened: true } }, true],
  ]) {
    const original = async () => ({ original: true })
    const target = getterBacked ? {} : { [method]: original }
    if (getterBacked) Object.defineProperty(target, method, {
      configurable: true,
      enumerable: true,
      get: () => original,
    })
    const restore = interceptDocumentOpen(target, method, controller, result)
    assert.deepEqual(await target[method](), result)
    restore()
    assert.equal(target[method], original)
  }
  assert.equal(opens, 2)
})

test('Settings Document Editor follows DSH tokens and has a mobile layout', async () => {
  const style = await readFile(new URL('lib/style.module.css', root), 'utf8')
  assert.match(style, /--dsw-alias-label-primary/)
  assert.match(style, /--dsw-alias-border-l2/)
  assert.match(style, /@media \(max-width: 640px\)/)
  assert.match(style, /height: 100dvh/)
  assert.match(style, /\.editorFrame \{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\)/)
  assert.match(style, /\.lineNumbers \{[\s\S]*text-align: right/)
  assert.match(style, /\.editorFrame:focus-within \{ border-color: var\(--dsw-alias-border-l2\); \}/)
  assert.match(style, /\.lineNumbers \{[\s\S]*background: color-mix\(in srgb, var\(--dsw-alias-bg-base\) 72%, var\(--dsw-alias-bg-module-platform\)\)/)
  assert.match(style, /\.overlay,[\s\S]*?\.overlay \*::after \{[^}]*corner-shape: round;/)
  assert.doesNotMatch(style, /--dsw-alias-state-business-primary/)
  assert.equal((style.match(/ui-monospace/g) ?? []).length, 2)
  assert.doesNotMatch(style, /#[0-9a-f]{3,8}\b/i)
})

test('Settings Document Editor state discards stale loads and rejects stale saves', async () => {
  const source = await readFile(new URL('lib/client.js', root), 'utf8')
  const definition = source.slice(source.indexOf('class DocumentController'), source.indexOf('function Editor('))
  const calls = []
  const responses = [
    { content: 'language: zh\n', revision: 'a'.repeat(64), exists: true },
    { content: 'language: en\n', revision: 'b'.repeat(64), exists: true },
  ]
  const DocumentController = new Function('request', `${definition}; return DocumentController`)(async (method, body) => {
    calls.push([method, body])
    return responses.shift()
  })
  const controller = new DocumentController()
  await controller.open()
  assert.equal(controller.state.content, 'language: zh\n')
  controller.edit('language: en\n')
  await controller.save()
  assert.equal(controller.state.content, 'language: en\n')
  assert.equal(controller.state.savedContent, 'language: en\n')
  assert.deepEqual(calls.map(call => call[0]), ['GET', 'PUT'])

  controller.close()
  controller.state.content = 'stale'
  const conflict = Object.assign(new Error('changed'), { status: 409 })
  const FailingController = new Function('request', `${definition}; return DocumentController`)(async () => { throw conflict })
  const failing = new FailingController()
  failing.state.content = 'old content'
  failing.state.savedContent = 'old content'
  failing.state.revision = 'c'.repeat(64)
  await failing.open()
  assert.equal(failing.state.content, '')
  assert.equal(failing.state.revision, null)
  assert.equal(failing.state.error, 'changed')

  let conflictCall = 0
  const ConflictController = new Function('request', `${definition}; return DocumentController`)(async () => {
    conflictCall += 1
    if (conflictCall === 1) return { content: 'one: 1\n', revision: 'd'.repeat(64), exists: true }
    throw conflict
  })
  const stale = new ConflictController()
  await stale.open()
  stale.edit('one: 2\n')
  await stale.save()
  assert.equal(stale.state.conflict, true)
  assert.equal(stale.state.savedContent, 'one: 1\n')
  assert.equal(stale.state.content, 'one: 2\n')
})
