import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildSystemPluginClient } from '../tools/build-system-plugin-client.mjs'

const root = new URL('../../environment/resources/system-plugins/platform-management/package/', import.meta.url)

test('Platform Management declares a DSH web client and a platform-namespaced overlay row', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root)))
  const patch = JSON.parse(await readFile(new URL('cordis.patch.json', root)))
  assert.equal(packageJson.dsh.client.platform, 'web')
  assert.equal(packageJson.exports['./client'], './lib/client.bundle.js')
  assert.equal(packageJson.exports['./package.json'], './package.json')
  assert.equal(await readFile(new URL('lib/style.module.css', root), 'utf8').then(value => value.includes('@media (max-width: 640px)')), true)
  assert.equal(packageJson.name, '@dsh-docker/platform-management')
  assert.equal(packageJson.dshDocker.description.zh, '管理 DSH Docker 更新、运行维护、系统插件与系统技能。')
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
  assert.match(source, /fetch\(`/)
  assert.match(source, /new EventSource/)
  assert.match(source, /const value = await refresh\(\)[\s\S]*checkedOnOpen[\s\S]*void checkUpdates\('page-open'\)/)
  assert.match(source, /setConnection\('offline'\)/)
  assert.doesNotMatch(source, /locked: '需要验证'|locked: 'Sign-in required'/)
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
  assert.match(source, /className: css\.tabs, role: 'tablist'/)
  const tabs = source.slice(source.indexOf("h('div', { className: css.tabs"), source.indexOf("\n\n    h('div', {\n      id: 'platform-tab-updates'"))
  assert.doesNotMatch(tabs, /disabled:/)
  assert.match(source, /role: 'tabpanel'/)
  assert.match(source, /updatesTab: '更新管理', maintenanceTab: '运行维护', pluginsTab: '系统插件', skillsTab: '系统技能'/)
  assert.match(source, /updatesTab: 'Updates', maintenanceTab: 'Maintenance', pluginsTab: 'System plugins', skillsTab: 'System skills'/)
  assert.match(source, /\['updates', 'maintenance', 'plugins', 'skills'\]\.map/)
  assert.doesNotMatch(source, /platform-tab-(?:automatic|logs)(?:-button)?/)
  assert.match(source, /h\(LogViewer, \{ active: activeTab === 'maintenance', t \}\)/)
  assert.match(source, /LOG_STREAM_LIMIT = 5_000/)
  assert.match(source, /logs\/stream\?limit=\$\{String\(LOG_STREAM_LIMIT\)\}/)
  assert.match(source, /const logIdentities = useRef\(new Set\(\)\)/)
  assert.match(source, /const pendingEntries = useRef\(\[\]\)/)
  assert.match(source, /requestAnimationFrame\(commitPendingEntries\)/)
  assert.match(source, /logIdentities\.current\.has\(identity\)/)
  assert.doesNotMatch(source, /previous\.some\(item => item\.identity === identity\)/)
  assert.match(source, /function compactLogEntries\(entries\)/)
  assert.match(source, /const \[expanded, setExpanded\] = useState/)
  assert.match(source, /JSON\.stringify\(entry, null, 2\)/)
  assert.match(source, /'aria-expanded': isExpanded/)
  assert.match(source, /className: css\.logChevron/)
  assert.match(source, /JSON\.parse\(lines\.join\('\\n'\)\)/)
  assert.match(source, /message: JSON\.stringify\(value\)/)
  assert.match(source, /if \(!isJsonFragment\(first\.value\.message \?\? ''\)\) compacted\.push\(first\)/)
  assert.match(source, /const visibleEntries = limitProcessedLogEntries\(entries, displayLimit\)/)
  assert.match(source, /replace\('\{total\}', String\(displayLimit\)\)/)
  assert.match(source, /DEFAULT_LOG_DISPLAY_LIMIT = 500/)
  assert.match(source, /LOG_DISPLAY_LIMITS = Object\.freeze\(\[100, 250, 500, 1_000\]\)/)
  assert.match(source, /localStorage\.setItem\(LOG_DISPLAY_LIMIT_KEY, String\(value\)\)/)
  assert.match(source, /logDisplayLimit: '显示条数'/)
  assert.match(source, /searchLogs: '搜索日志'/)
  assert.match(source, /allSources: '全部模块'/)
  assert.match(source, /levelWarning: '警告'/)
  assert.match(source, /autoScroll: '自动滚动'/)
  assert.match(source, /clearLogView: '清空显示'/)
  assert.match(source, /refreshLogs: '刷新日志'/)
  assert.match(source, /refreshLogs: 'Refresh logs'/)
  assert.match(source, /exportLogs: '导出日志'/)
  assert.match(source, /exportLogs: 'Export logs'/)
  assert.match(source, /application\/x-ndjson;charset=utf-8/)
  assert.match(source, /downloadLogJsonl\(exportEntries\)/)
  assert.match(source, /addEventListener\('heartbeat'/)
  assert.match(source, /setStreamRevision\(value => value \+ 1\)/)
  assert.match(source, /LOG_CLEAR_CUTOFF_KEY = 'dsh-platform:log-clear-cutoff'/)
  assert.match(source, /sessionStorage\.setItem\(LOG_CLEAR_CUTOFF_KEY, clearCutoff\.current\)/)
  assert.match(source, /isClearedLog\(entry, clearCutoff\.current\)/)
  assert.match(source, /listRef\.current\.scrollTop = listRef\.current\.scrollHeight/)
  assert.match(source, /requestAnimationFrame[\s\S]*requestAnimationFrame/)
  assert.match(source, /\[active, autoScroll, displayLimit, entries, level, query, source\]/)
  assert.match(source, /checked: autoScroll/)
  const checkUpdates = source.slice(source.indexOf('const checkUpdates = useCallback'), source.indexOf('const changeChannel = useCallback'))
  assert.match(checkUpdates, /await request\('check'/)
  assert.doesNotMatch(checkUpdates, /await act\(/)
  assert.doesNotMatch(source, /运行详情|平台日志/)
  for (const route of ['status', 'check', 'update', 'channel', 'automatic-check', 'holds\\/retry', 'rollback', 'return-stable', 'restart-dsh', 'bundled-plugins', 'bundled-plugins\\/action', 'bundled-plugins\\/recovery-action', 'bundled-plugins\\/toggle', 'bundled-plugins\\/discard', 'system-skills', 'system-skills\\/action']) {
    assert.match(source, new RegExp(`['"]${route}['"]`))
  }
  assert.match(source, /confirmDataLoss: true/)
  assert.match(source, /requestedRestart\.current = task\.taskId/)
  assert.match(source, /status\?\.dshRestart/)
  assert.match(source, /restart\.status === 'success'[\s\S]*sessionStorage\.removeItem\(PLUGIN_DRAFT_KEY\)[\s\S]*window\.location\.reload/)
  assert.doesNotMatch(source, /if \(hadDraft\) sessionStorage\.removeItem\(PLUGIN_DRAFT_KEY\)/)
  assert.match(source, /window\.location\.reload\(\)/)
  assert.match(source, /const \[confirmRestart, setConfirmRestart\] = useState\(false\)/)
  assert.match(source, /setConfirmRestart\(value => !value\)/)
  assert.match(source, /'aria-controls': 'restart-dsh-confirmation'/)
  assert.match(source, /'aria-expanded': confirmRestart/)
  assert.match(source, /t\(confirmRestart \? 'cancelRestartDsh' : 'restartDsh'\)/)
  assert.match(source, /const API = '\/_dsh_platform\/plugin-api\/v1'/)
  assert.doesNotMatch(source, /platformAuthRequired|platformSignIn|authRequired/)
  assert.match(source, /href: '\/_dsh_platform\/console'[\s\S]*target: '_blank'[\s\S]*t\('openPlatformManagement'\)/)
  assert.match(source, /nav: '平台管理', title: '平台管理'/)
  assert.match(source, /nav: 'Platform Management', title: 'Platform Management'/)
  assert.match(source, /standaloneManagement: 'DSH 管理中心'/)
  assert.match(source, /standaloneManagement: 'DSH Management Console'/)
  assert.match(source, /restartDshSection: '重启 DSH'/)
  assert.match(source, /restartDshSection: 'Restart DSH'/)
  assert.match(source, /cancelRestartDsh: '取消重启 DSH'/)
  assert.match(source, /cancelRestartDsh: 'Cancel DSH restart'/)
  assert.match(source, /restartWarning: '当前 DSH 连接会暂时中断/)
  assert.match(source, /restartWarning: 'The current DSH connection will be interrupted briefly/)
  assert.match(source, /plugin\.protected/)
  assert.match(source, /platformManaged: '平台核心组件，始终保持安装和启用。'/)
  assert.match(source, /systemPluginsDetail: '管理 DSH Docker 提供的系统插件。'/)
  assert.match(source, /plugins\.some\(plugin => plugin\.pendingRestart\)/)
  assert.match(source, /visiblePlugins = plugins/)
  assert.doesNotMatch(source, /pluginInstallHint|missingPluginsPrefix|platformManagementPage|missingPluginsSuffix/)
  assert.match(source, /pluginPendingRestart: '待重启'/)
  assert.match(source, /pluginRestartRequired: '需要重新启动 DSH'/)
  assert.match(source, /pluginRestartRequired: 'Restart DSH required'/)
  assert.match(source, /plugin\.description\?\.\[t\('localeCode'\)\]/)
  assert.match(source, /onRestart: \(\) => \{ void restartDsh\(\) \}/)
  assert.match(source, /PLUGIN_DRAFT_KEY = 'dsh-platform:system-plugin-draft'/)
  assert.match(source, /action === 'install'[\s\S]*bundled-plugins\/recovery-action[\s\S]*bundled-plugins\/action[\s\S]*bundled-plugins\/toggle/)
  assert.match(source, /sessionStorage\.setItem\(PLUGIN_DRAFT_KEY, '1'\)/)
  assert.match(source, /bundled-plugins\/discard[\s\S]*sessionStorage\.removeItem\(PLUGIN_DRAFT_KEY\)/)
  assert.match(source, /\(acting && !checking\)/)
  assert.doesNotMatch(source, /插件设置并重启 DSH|settings and restarting DSH/)
  for (const action of ['enable', 'disable']) assert.match(source, new RegExp(`'${action}'`))
  const systemPluginManager = source.slice(source.indexOf('function SystemPluginManager('), source.indexOf('function PlatformManagement('))
  assert.match(systemPluginManager, /!plugin\.installed[\s\S]*onAction\(plugin, 'install'\)/)
  assert.doesNotMatch(systemPluginManager, /onAction\([^\n]+, 'uninstall'\)|t\('uninstallPlugin'\)/)
  const systemSkillManager = source.slice(source.indexOf('function SystemSkillManager('), source.indexOf('function PlatformManagement('))
  assert.match(systemSkillManager, /!skill\.installed[\s\S]*onAction\(skill, 'install'\)/)
  assert.match(systemSkillManager, /event\.target\.checked \? 'enable' : 'disable'/)
  assert.doesNotMatch(systemSkillManager, /onAction\([^\n]+, 'uninstall'\)|t\('uninstallPlugin'\)/)
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
  assert.match(source, /updateNotifications: '更新提醒'/)
  assert.match(source, /updateNotificationsDetail: '自动检查发现新版本时，弹窗提醒更新。'/)
  assert.match(source, /updateNotifications: 'Update notifications'/)
  assert.match(source, /不再提醒此版本/)
  assert.match(source, /Do not remind for this version/)
  assert.match(source, /source = 'manual'/)
  for (const status of ['idle', 'checking', 'planning', 'downloading', 'validating', 'switching', 'probation', 'success', 'failed']) {
    assert.match(source, new RegExp(`${status.replace('-', '\\-')}: ['"]status`))
  }
})

test('Platform Management compacts multiline JSON only in the log presentation', async () => {
  const source = await readFile(new URL('lib/client.js', root), 'utf8')
  const helpers = source.slice(source.indexOf('function logLevel('), source.indexOf('function LogViewer('))
  const compactLogEntries = new Function(`${helpers}; return compactLogEntries`)()
  const status = {
    platformLayout: 1,
    recoveryMode: null,
    trust: { keyringGeneration: 1, targetSequence: null, officialDshVersion: null },
    dshRestart: { status: 'idle', taskId: null, error: null, updatedAt: null },
  }
  let index = 0
  const entry = message => ({
    identity: `entry-${String(index)}`,
    value: {
      timestamp: new Date(Date.UTC(2026, 7, 20, 0, 0, 0, index++)).toISOString(),
      source: 'platform-management',
      stream: 'stdout',
      level: 'info',
      message,
    },
  })
  const visible = compactLogEntries([
    entry('"orphanedAtBoundary": null,'),
    ...JSON.stringify(status, null, 2).split('\n').map(entry),
    entry('ordinary output'),
    entry('{"already":"compact"}'),
  ])
  assert.deepEqual(visible.map(item => item.value.message), [
    JSON.stringify(status),
    'ordinary output',
    '{"already":"compact"}',
  ])
})

test('Platform Management does not present ordinary DSH stderr as an error', async () => {
  const source = await readFile(new URL('lib/client.js', root), 'utf8')
  const helpers = source.slice(source.indexOf('function logLevel('), source.indexOf('function LogViewer('))
  const logLevel = new Function(`${helpers}; return logLevel`)()
  assert.equal(logLevel({
    source: 'dsh-runtime', stream: 'stderr', level: 'error', message: '[net-proxy] 已启用代理 http://172.17.0.1:7890',
  }), 'info')
  assert.equal(logLevel({ source: 'dsh-runtime', stream: 'stderr', level: 'error', message: 'Error: startup failed' }), 'error')
  assert.equal(logLevel({ source: 'dsh-runtime', stream: 'stderr', level: 'error', message: 'warning: retrying' }), 'warning')
})

test('Platform Management limits the processed log entries instead of raw fragments', async () => {
  const source = await readFile(new URL('lib/client.js', root), 'utf8')
  const helpers = source.slice(source.indexOf('function logLevel('), source.indexOf('function LogViewer('))
  const limitProcessedLogEntries = new Function(`${helpers}; return limitProcessedLogEntries`)()
  let index = 0
  const entry = message => ({
    identity: `entry-${String(index)}`,
    value: {
      timestamp: new Date(Date.UTC(2026, 7, 20, 0, 0, 0, index++)).toISOString(),
      source: 'platform-management', stream: 'stdout', level: 'info', message,
    },
  })
  const raw = [
    ...JSON.stringify({ first: true }, null, 2).split('\n').map(entry),
    ...Array.from({ length: 1_000 }, (_, value) => entry(`line-${String(value)}`)),
  ]
  const visible = limitProcessedLogEntries(raw, 1_000)
  assert.equal(visible.length, 1_000)
  assert.equal(visible[0].value.message, 'line-0')
  assert.equal(visible.at(-1).value.message, 'line-999')
})

test('Platform Management keeps a browser-tab log clear cutoff across refreshes', async () => {
  const source = await readFile(new URL('lib/client.js', root), 'utf8')
  const helpers = source.slice(source.indexOf('function logLevel('), source.indexOf('function LogViewer('))
  const values = new Function(`${helpers}; return { latestLogCutoff, isClearedLog }`)()
  const now = Date.parse('2026-08-20T12:00:00.000Z')
  const cutoff = values.latestLogCutoff([
    { value: { timestamp: '2026-08-20T11:59:59.000Z' } },
    { value: { timestamp: '2026-08-20T12:00:01.000Z' } },
  ], now)
  assert.equal(cutoff, '2026-08-20T12:00:01.000Z')
  assert.equal(values.isClearedLog({ timestamp: cutoff }, cutoff), true)
  assert.equal(values.isClearedLog({ timestamp: '2026-08-20T12:00:01.001Z' }, cutoff), false)
  assert.equal(values.isClearedLog({ timestamp: 'invalid' }, cutoff), false)
})

test('Platform Management follows DSH settings tokens and responsive layout', async () => {
  const source = await readFile(new URL('lib/client.js', root), 'utf8')
  const style = await readFile(new URL('lib/style.module.css', root), 'utf8')
  assert.match(style, /--dsw-alias-label-primary/)
  assert.match(style, /--dsw-alias-button-primary-fill/)
  assert.match(style, /--dsw-alias-border-l2/)
  assert.match(style, /@media \(max-width: 640px\)/)
  assert.match(style, /\.pluginRestartNotice \{[\s\S]*justify-content: space-between/)
  assert.match(style, /\.pluginActions \.toggle \{ width: auto; \}/)
  assert.match(style, /\.tabs \{[\s\S]*width: 100%;[\s\S]*overflow-x: auto/)
  assert.match(style, /\.tabs \{[\s\S]*touch-action: pan-x;[\s\S]*white-space: nowrap/)
  assert.match(style, /\.root \{[\s\S]*gap: 12px;[\s\S]*max-width: 760px/)
  assert.match(style, /\.heading \{[\s\S]*gap: 12px/)
  assert.match(style, /\.tabs \{[\s\S]*gap: 22px;[\s\S]*margin-top: 2px/)
  assert.match(style, /padding: 7px 1px 9px/)
  assert.match(style, /\.tabs button:focus-visible/)
  assert.match(style, /\.tabs button \{[\s\S]*scroll-snap-align: start/)
  assert.match(style, /\.tabs button\[aria-selected='true'\]::after/)
  assert.match(style, /\.tabPanel\[hidden\] \{ display: none; \}/)
  assert.match(style, /\.versions \{[\s\S]*grid-template-columns: repeat\(2,/)
  assert.match(style, /\.experimentalVersions \{ grid-template-columns: repeat\(3,/)
  assert.match(style, /@media \(max-width: 640px\)[\s\S]*\.actionHeading \{ align-items: flex-start; \}/)
  assert.match(style, /@media \(max-width: 640px\)[\s\S]*\.actions \{ width: 100%; justify-content: flex-start; \}/)
  assert.match(style, /@media \(max-width: 640px\)[\s\S]*\.maintenanceButton \{ width: 100%; \}/)
  assert.match(style, /\.updateReminder/)
  assert.match(style, /\.settingRows/)
  assert.match(style, /\.logFilters/)
  assert.match(style, /\.logAutoScroll \{[^}]*margin-left: auto;/)
  assert.match(source, /className: css\.logSummaryRow[\s\S]*className: css\.logSummary[\s\S]*className: css\.logAutoScroll/)
  assert.match(style, /\.logList \{[\s\S]*max-height: min\(320px, 42dvh\)/)
  assert.match(style, /\.logDetails \{/)
  assert.match(style, /\.logEntry\[aria-expanded='true'\] \.logChevron/)
  assert.match(style, /\.logChevron::before \{[\s\S]*?width: 8px[\s\S]*?height: 5px[\s\S]*?clip-path: polygon[\s\S]*?transform-origin: center/)
  assert.match(style, /\.logChevron \{[^}]*top: 2px/)
  assert.doesNotMatch(style, /\.logChevron(?:::before)? \{[^}]*transition:/)
  assert.match(style, /\.logEntry\[aria-expanded='true'\] \.logChevron::before \{[^}]*transform: rotate\(180deg\)/)
  assert.match(source, /className: css\.logMeta[\s\S]*className: css\.logMessageRow[\s\S]*className: css\.logChevron/)
  assert.match(style, /@media \(max-width: 640px\)[\s\S]*\.logList \{ max-height: min\(260px, 36dvh\); \}/)
  assert.match(style, /\.logWarning/)
  assert.match(style, /\.autoScrollButton/)
  assert.match(style, /\.clearLogsButton/)
  assert.doesNotMatch(style, /#[0-9a-f]{3,8}\b/i)
})
