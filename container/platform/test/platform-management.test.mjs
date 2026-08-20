import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildSystemPluginClient } from '../tools/build-system-plugin-client.mjs'

const root = new URL('../../environment/resources/system-plugins/platform-management/package/', import.meta.url)

test('Platform Management declares an rc.7 web client and a platform-namespaced overlay row', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root)))
  const patch = JSON.parse(await readFile(new URL('cordis.patch.json', root)))
  assert.equal(packageJson.dsh.client.platform, 'web')
  assert.equal(packageJson.exports['./client'], './lib/client.bundle.js')
  assert.equal(packageJson.exports['./package.json'], './package.json')
  assert.equal(await readFile(new URL('lib/style.module.css', root), 'utf8').then(value => value.includes('@media (max-width: 640px)')), true)
  assert.equal(packageJson.name, '@dsh-docker/platform-management')
  assert.equal(patch[0].insert[0].id, 'dsh-docker.platform-management.plugin')
})

test('Platform Management checked-in client bundle matches its source and DSH loader protocol', async () => {
  const bundle = await readFile(new URL('lib/client.bundle.js', root), 'utf8')
  const rebuilt = await buildSystemPluginClient({
    pluginId: '@dsh-docker/platform-management',
    sourcePath: new URL('lib/client.js', root),
    stylePath: new URL('lib/style.module.css', root),
  })
  assert.equal(bundle, rebuilt)
  assert.doesNotThrow(() => new Function(bundle))
  assert.match(bundle, /^window\.__ModuleLoader__\.load\(/)
  assert.doesNotMatch(bundle, /^import /m)
})

test('Platform Management is embedded in the official settings.section slot', async () => {
  const source = await readFile(new URL('lib/client.js', root), 'utf8')
  assert.match(source, /settings\.section/)
  assert.match(source, /settings\.dshPlatformManagement/)
  assert.match(source, /id: 'dsh-platform-management'/)
  assert.doesNotMatch(source, /dshPlatformUpdate|dsh-platform-update/)
  assert.doesNotMatch(source, /\/_dsh_platform\/ui\//)
  assert.doesNotMatch(source, /href:/)
  assert.match(source, /fetch\(`/)
  assert.match(source, /new EventSource/)
  assert.match(source, /refresh\(\)\.then\(value => \{[\s\S]*void checkUpdates\('page-open'\)/)
  assert.match(source, /className: css\.checkSpinner/)
  assert.match(source, /changeChannel[\s\S]*void checkUpdates\('channel-change'\)/)
  assert.match(source, /ctx\.locale\.getLocale\(\)/)
  assert.match(source, /ctx\.on\('locale\/change'/)
  assert.match(source, /dsh_locale/)
  assert.match(source, /localizedError\(update\.error, t\)/)
  assert.match(source, /localizedHoldReason\(hold, t\)/)
  assert.match(source, /metadataUnavailable/)
  assert.match(source, /hasSupportedTarget/)
  assert.match(source, /update\.updateAvailable !== true/)
  assert.match(source, /className: css\.titleRow[\s\S]*className: css\.title[\s\S]*className: `\$\{css\.connection\}/)
  assert.doesNotMatch(source, /logs\/stream|运行详情|平台日志/)
  for (const route of ['status', 'check', 'update', 'channel', 'automatic-check', 'holds\\/retry', 'rollback', 'return-stable', 'restart-dsh']) {
    assert.match(source, new RegExp(`['"]${route}['"]`))
  }
  assert.match(source, /confirmDataLoss: true/)
  assert.match(source, /requestedRestart\.current = task\.taskId/)
  assert.match(source, /status\?\.dshRestart/)
  assert.match(source, /window\.location\.reload\(\)/)
  assert.match(source, /setConfirmRestart\(true\)/)
  assert.match(source, /restartWarning: '当前 DSH 连接会暂时中断/)
  assert.match(source, /restartWarning: 'The current DSH connection will be interrupted briefly/)
  assert.doesNotMatch(source, /trust\/reset/)
  assert.match(source, /status\?\.updateChannel === 'experimental'\s*\? h\(VersionCell, \{ label: t\('upstream'\)/)
  assert.match(source, /`env-\$\{String\(value\)\}`/)
  assert.equal((source.match(/detail: displayEnvironment/g) ?? []).length, 2)
  assert.doesNotMatch(source, /display\(update\.status\)/)
  assert.match(source, /stable: '稳定', experimental: '实验'/)
  assert.match(source, /}, t\(channel\)\)\)\)\)/)
  assert.doesNotMatch(source, /回滚 previous|正式 Environment|恢复 Stable|立即回 Stable/)
  assert.match(source, /shell\.overlay/)
  assert.match(source, /latestAutomatic/)
  assert.match(source, /notificationsEnabled/)
  assert.match(source, /不再提醒此版本/)
  assert.match(source, /Do not remind for this version/)
  assert.match(source, /source = 'manual'/)
  for (const status of ['idle', 'checking', 'planning', 'downloading', 'validating', 'switching', 'probation', 'success', 'failed']) {
    assert.match(source, new RegExp(`${status.replace('-', '\\-')}: ['"]status`))
  }
})

test('Platform Management follows DSH settings tokens and responsive layout', async () => {
  const style = await readFile(new URL('lib/style.module.css', root), 'utf8')
  assert.match(style, /--dsw-alias-label-primary/)
  assert.match(style, /--dsw-alias-button-primary-fill/)
  assert.match(style, /--dsw-alias-border-l2/)
  assert.match(style, /@media \(max-width: 640px\)/)
  assert.match(style, /\.versions \{[\s\S]*grid-template-columns: repeat\(2,/)
  assert.match(style, /\.experimentalVersions \{ grid-template-columns: repeat\(3,/)
  assert.match(style, /@media \(max-width: 640px\)[\s\S]*\.actionHeading \{ align-items: flex-start; \}/)
  assert.match(style, /@media \(max-width: 640px\)[\s\S]*\.actions \{ width: 100%; justify-content: flex-start; \}/)
  assert.match(style, /@media \(max-width: 640px\)[\s\S]*\.maintenanceButton \{ width: 100%; \}/)
  assert.match(style, /\.updateReminder/)
  assert.match(style, /\.settingRows/)
  assert.doesNotMatch(style, /#[0-9a-f]{3,8}\b/i)
})
