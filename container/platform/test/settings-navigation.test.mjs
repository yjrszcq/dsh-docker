import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildSystemPluginClient } from '../tools/build-system-plugin-client.mjs'

const root = new URL('../../environment/resources/plugins/settings-navigation/package/', import.meta.url)

test('Settings Navigation is a browser-only optional System Plugin', async () => {
  const metadata = JSON.parse(await readFile(new URL('package.json', root)))
  const patch = JSON.parse(await readFile(new URL('cordis.patch.json', root)))
  assert.equal(metadata.name, '@dsh-docker/settings-navigation')
  assert.equal(metadata.dshDocker.description.zh, '优化 DSH 设置目录滚动和窄屏分级导航。')
  assert.equal(metadata.dsh.client.platform, 'web')
  assert.equal(metadata.exports['./client'], './lib/client.bundle.js')
  assert.equal(patch[0].insert[0].id, 'dsh-docker.settings-navigation.plugin')
  assert.equal(patch[0].insert[0].name, metadata.name)
})

test('Settings Navigation checked-in bundle matches its source', async () => {
  const bundle = await readFile(new URL('lib/client.bundle.js', root), 'utf8')
  const rebuilt = await buildSystemPluginClient({
    pluginId: '@dsh-docker/settings-navigation',
    sourcePath: new URL('lib/client.js', root),
    stylePath: new URL('lib/style.module.css', root),
  })
  assert.equal(bundle, rebuilt)
  assert.doesNotThrow(() => new Function(bundle))
  assert.match(bundle, /^window\.__ModuleLoader__\.load\(/)
})

test('Settings Navigation recognizes the Settings shell without text or generated classes', async () => {
  const source = await readFile(new URL('lib/client.js', root), 'utf8')
  const matcher = source.slice(source.indexOf('function directChildren'), source.indexOf('\nfunction findSettingsDialog'))
  const matchSettingsDialog = new Function(`${matcher}; return matchSettingsDialog`)()

  class Element {
    constructor(tagName, ownerDocument) {
      this.tagName = tagName.toUpperCase()
      this.ownerDocument = ownerDocument
      this.children = []
      this.attributes = new Map()
    }
    append(...children) { this.children.push(...children) }
    contains(target) { return this === target || this.children.some(child => child.contains(target)) }
    getAttribute(name) { return this.attributes.get(name) ?? null }
    setAttribute(name, value) { this.attributes.set(name, value) }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null
    }
    querySelectorAll(selector) {
      const result = []
      for (const child of this.children) {
        if (selector === 'button' && child.tagName === 'BUTTON') result.push(child)
        result.push(...child.querySelectorAll(selector))
      }
      return result
    }
  }
  const ids = new Map()
  const document = { getElementById: id => ids.get(id) ?? null }
  const dialog = new Element('div', document)
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'settings-title')
  const nav = new Element('nav', document)
  const title = new Element('div', document)
  ids.set('settings-title', title)
  const list = new Element('div', document)
  const selected = new Element('button', document)
  selected.setAttribute('aria-current', 'true')
  list.append(selected)
  nav.append(title, list)
  const content = new Element('div', document)
  const header = new Element('div', document)
  header.append(new Element('button', document))
  content.append(header, new Element('div', document))
  dialog.append(nav, content)

  assert.equal(matchSettingsDialog(dialog)?.current, selected)
  dialog.append(new Element('aside', document))
  assert.equal(matchSettingsDialog(dialog), null)
  dialog.children.pop()
  dialog.setAttribute('aria-labelledby', 'unknown')
  assert.equal(matchSettingsDialog(dialog), null)
})

test('Settings Navigation owns compact navigation without moving native nodes', async () => {
  const source = await readFile(new URL('lib/client.js', root), 'utf8')
  const style = await readFile(new URL('lib/style.module.css', root), 'utf8')
  assert.match(source, /const COMPACT_WIDTH = 640/)
  assert.match(source, /shell\.overlay/)
  assert.match(source, /IconChevronLeftOutline14/)
  assert.match(source, /MutationObserverImpl/)
  assert.match(source, /ResizeObserverImpl/)
  assert.match(source, /attributeFilter: \['aria-current', 'aria-labelledby'\]/)
  assert.match(source, /\['dialog', 'nav', 'navTitle', 'navList', 'content', 'header', 'options'\]/)
  assert.match(source, /\.every\(key => next\[key\] === this\.match\[key\]\)/)
  assert.match(source, /this\.view = match\.buttons\.indexOf\(match\.current\) > 0 \? 'detail' : 'directory'/)
  assert.match(source, /this\.modeInitialized && compact && !this\.compact/)
  assert.match(source, /this\.directoryScrollTop = this\.match\.navList\.scrollTop/)
  assert.match(source, /current\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(source, /this\.requestFrame\(\(\) => \{ navList\.scrollTop = scrollTop \}\)/)
  assert.match(source, /delete this\.match\.dialog\.dataset\.dshSettingsNavigationMode/)
  assert.match(source, /delete this\.match\.dialog\.dataset\.dshSettingsNavigationView/)
  assert.match(source, /node\.classList\.remove\(className\)/)
  assert.doesNotMatch(source, /textContent|innerHTML|appendChild\(match\.|replaceChild/)
  assert.match(style, /scrollbar-gutter: stable/)
  assert.match(style, /data-dsh-settings-navigation-view='directory'/)
  assert.match(style, /data-dsh-settings-navigation-view='detail'/)
  assert.match(style, /--dsw-alias-label-primary/)
  assert.doesNotMatch(style, /#[0-9a-f]{3,8}\b/i)
})
