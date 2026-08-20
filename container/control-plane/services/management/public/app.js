const API = '/_dsh_platform/api/v1'
const TERMINAL = new Set(['idle', 'success', 'failed'])
const STATUS_LABELS = Object.freeze({
  idle: 'statusIdle',
  checking: 'statusChecking',
  planning: 'statusPlanning',
  'checking-upstream': 'statusCheckingUpstream',
  downloading: 'statusDownloading',
  validating: 'statusValidating',
  'building-candidate': 'statusBuildingCandidate',
  'snapshotting-data': 'statusSnapshottingData',
  switching: 'statusSwitching',
  probation: 'statusProbation',
  'restoring-data': 'statusRestoringData',
  success: 'statusSuccess',
  failed: 'statusFailed',
})
const NOTICE_PREFIX = 'dsh-platform:console-update-notice'
const PLUGIN_DRAFT_KEY = 'dsh-platform:system-plugin-draft'
const LOG_CLEAR_CUTOFF_KEY = 'dsh-platform:log-clear-cutoff'
const LOG_DISPLAY_LIMIT_KEY = 'dsh-platform:log-display-limit'
const LOG_DISPLAY_LIMITS = Object.freeze([100, 250, 500, 1_000])
const DEFAULT_LOG_DISPLAY_LIMIT = 1_000
const LOG_STREAM_LIMIT = 5_000
const COPY = Object.freeze({
  zh: Object.freeze({
    title: '平台管理', consoleLabel: '独立管理控制台', intro: 'DSH Docker 运行、更新与恢复',
    managementSections: '平台管理功能', updatesTab: '更新管理', maintenanceTab: '运行维护', pluginsTab: '系统插件',
    channel: '更新通道', channelDetail: '实验通道仅更新 DSH，平台环境仍使用正式支持版本。',
    stable: '稳定', experimental: '实验', current: '当前版本', supported: '正式支持版本', upstream: '上游版本', officialNpm: 'npm 官方源',
    actions: '更新操作', lastChecked: '上次检查', notChecked: '尚未检查', check: '检查更新', checking: '检查中',
    updateSupported: '更新到最新支持版本', updateUpstream: '更新到最新上游版本', rollback: '回滚到上一版本', returnStable: '立即返回稳定通道', retry: '重试', progress: '更新进度',
    statusIdle: '等待操作', statusChecking: '正在检查更新', statusPlanning: '正在准备更新', statusCheckingUpstream: '正在检查上游版本',
    statusDownloading: '正在下载', statusValidating: '正在验证', statusBuildingCandidate: '正在构建候选版本', statusSnapshottingData: '正在备份数据',
    statusSwitching: '正在切换版本', statusProbation: '正在观察运行状态', statusRestoringData: '正在恢复数据', statusSuccess: '操作完成', statusFailed: '操作失败', statusUnknown: '正在处理',
    outcomeNone: '当前已是最新版本', outcomeFrozen: '等待正式支持版本追上当前版本', outcomeHeld: '此版本已暂停更新',
    outcomeBlocked: '当前版本组合不可用', outcomeStable: '已切换到稳定版本', outcomeExperimental: '已切换到实验版本',
    requestError: '请求失败', operationError: '操作失败，请查看容器日志。', holdVersion: '此版本更新失败，已暂停自动重试。',
    holdCombination: '此版本与正式环境组合不可用，已暂停自动重试。', metadataUnavailable: '正式更新信息暂未发布，请稍后再试。',
    aheadOfStable: '当前版本领先正式支持版本，已暂停完整运行组合更新。', experimentalBlocked: '实验 DSH 与正式环境组合不可用。',
    returnStableTitle: '恢复稳定状态', returnStableWarning: '将恢复以下时间的数据快照，此后产生的数据会丢失：',
    confirmDataLoss: '我了解并确认丢弃更新后的数据', cancel: '取消', confirm: '确认恢复',
    automaticChecks: '自动检查', automaticChecksDetail: '仅检查可用版本，不会自动下载或更新。', enabled: '已开启', disabled: '已关闭',
    checkInterval: '检查频率', updateNotifications: '网页更新提醒', updateNotificationsDetail: '仅在此页面中，于自动检查发现新版本时提醒。',
    interval3600: '每 1 小时', interval10800: '每 3 小时', interval21600: '每 6 小时', interval43200: '每 12 小时', interval86400: '每 24 小时',
    maintenance: '运行维护', maintenanceDetail: '仅重新启动 DSH，容器和平台管理服务保持运行。', restartDsh: '重新启动 DSH',
    restarting: '正在重新启动 DSH', restartComplete: 'DSH 已重新启动', restartFailed: 'DSH 重启失败',
    restartTitle: '确认重新启动 DSH', restartWarning: '当前 DSH 连接会暂时中断，此独立控制台保持可用。', confirmRestart: '确认重启',
    logs: '实时日志', logsDetail: '查看 DSH 与平台各模块的运行日志。', searchLogs: '搜索日志', logSource: '日志模块',
    logLevel: '日志级别', logDisplayLimit: '显示条数', logDisplayLimitValue: '最近 {count} 条', allSources: '全部模块', levelAll: '全部级别', levelDebug: '调试', levelInfo: '信息', levelWarning: '警告', levelError: '错误',
    logsLive: '实时', logsConnecting: '连接中', logsDisconnected: '已断开', pauseAutoScroll: '暂停自动滚动', resumeAutoScroll: '继续自动滚动',
    clearLogView: '清空显示', logCount: '显示 {shown} / {total} 条', noLogs: '暂无日志', noMatchingLogs: '没有符合筛选条件的日志',
    systemPlugins: '系统插件', systemPluginsConsoleDetail: '管理当前环境提供的所有系统插件，也可恢复 DSH 中的平台管理集成。',
    noSystemPlugins: '当前环境没有提供系统插件。', managementIntegration: '平台管理集成，可从此独立页面恢复。',
    notInstalled: '未安装', pluginEnabled: '已安装并启用', pluginDisabled: '已安装但已禁用', pluginPendingRestart: '待重启',
    installPlugin: '安装', uninstallPlugin: '卸载', pluginActionWorking: '正在应用插件设置',
    pluginActionInstall: '正在安装', pluginActionUninstall: '正在卸载',
    pluginActionEnable: '正在启用', pluginActionDisable: '正在禁用', pluginActionComplete: '插件设置已保存',
    pluginRestartRequired: '需要重新启动 DSH', pluginRestartRequiredDetail: '插件设置已保存，重新启动 DSH 后生效。可以继续修改其他插件，最后只需重启一次。',
    stableNoticeTitle: '正式版本可更新', stableNoticeBody: '最新支持版本 {version} 已可用。',
    upstreamNoticeTitle: '上游版本可更新', upstreamNoticeBody: 'DSH 官方版本 {version} 已可用。',
    later: '稍后提醒', dismissVersion: '不再提醒此版本',
    online: '已连接', connecting: '正在重连', offline: '连接中断',
  }),
  en: Object.freeze({
    title: 'Platform Management', consoleLabel: 'Standalone console', intro: 'DSH Docker runtime, updates, and recovery',
    managementSections: 'Platform management sections', updatesTab: 'Updates', maintenanceTab: 'Maintenance', pluginsTab: 'System plugins',
    channel: 'Update channel', channelDetail: 'Experimental updates DSH only; the platform Environment remains on the supported release.',
    stable: 'Stable', experimental: 'Experimental', current: 'Current', supported: 'Supported', upstream: 'Upstream', officialNpm: 'Official npm',
    actions: 'Update actions', lastChecked: 'Last checked', notChecked: 'Not checked yet', check: 'Check for updates', checking: 'Checking',
    updateSupported: 'Update to latest supported', updateUpstream: 'Update to latest upstream', rollback: 'Roll back previous', returnStable: 'Return to Stable now', retry: 'Retry', progress: 'Update progress',
    statusIdle: 'Ready', statusChecking: 'Checking for updates', statusPlanning: 'Preparing update', statusCheckingUpstream: 'Checking upstream',
    statusDownloading: 'Downloading', statusValidating: 'Verifying', statusBuildingCandidate: 'Building candidate', statusSnapshottingData: 'Backing up data',
    statusSwitching: 'Switching version', statusProbation: 'Observing runtime health', statusRestoringData: 'Restoring data', statusSuccess: 'Completed', statusFailed: 'Failed', statusUnknown: 'Working',
    outcomeNone: 'Already up to date', outcomeFrozen: 'Waiting for the supported release to catch up', outcomeHeld: 'This version is on hold',
    outcomeBlocked: 'This version combination is unavailable', outcomeStable: 'Switched to the Stable release', outcomeExperimental: 'Switched to the Experimental release',
    requestError: 'Request failed', operationError: 'The operation failed. Check the container logs.', holdVersion: 'This version failed and automatic retries are on hold.',
    holdCombination: 'This version is incompatible with the production Environment and automatic retries are on hold.', metadataUnavailable: 'Signed update metadata has not been published yet. Try again later.',
    aheadOfStable: 'The current version is ahead of Latest Supported; the complete deployment is frozen.', experimentalBlocked: 'The Experimental DSH and production Environment combination is unavailable.',
    returnStableTitle: 'Restore Stable state', returnStableWarning: 'The following data snapshot will be restored and newer data will be lost:',
    confirmDataLoss: 'I understand and confirm the loss of newer data', cancel: 'Cancel', confirm: 'Restore',
    automaticChecks: 'Automatic checks', automaticChecksDetail: 'Checks for available versions without downloading or updating.', enabled: 'On', disabled: 'Off',
    checkInterval: 'Check frequency', updateNotifications: 'Web update notifications', updateNotificationsDetail: 'Shown only on this page when an automatic check finds a new version.',
    interval3600: 'Every hour', interval10800: 'Every 3 hours', interval21600: 'Every 6 hours', interval43200: 'Every 12 hours', interval86400: 'Every 24 hours',
    maintenance: 'Runtime maintenance', maintenanceDetail: 'Restart DSH only. The container and platform management services remain running.', restartDsh: 'Restart DSH',
    restarting: 'Restarting DSH', restartComplete: 'DSH restarted', restartFailed: 'DSH restart failed',
    restartTitle: 'Restart DSH?', restartWarning: 'The current DSH connection will be interrupted briefly. This standalone console remains available.', confirmRestart: 'Restart',
    logs: 'Live logs', logsDetail: 'View runtime logs from DSH and platform modules.', searchLogs: 'Search logs', logSource: 'Log module',
    logLevel: 'Log level', logDisplayLimit: 'Entries shown', logDisplayLimitValue: 'Latest {count}', allSources: 'All modules', levelAll: 'All levels', levelDebug: 'Debug', levelInfo: 'Info', levelWarning: 'Warning', levelError: 'Error',
    logsLive: 'Live', logsConnecting: 'Connecting', logsDisconnected: 'Disconnected', pauseAutoScroll: 'Pause auto-scroll', resumeAutoScroll: 'Resume auto-scroll',
    clearLogView: 'Clear view', logCount: 'Showing {shown} / {total}', noLogs: 'No logs yet', noMatchingLogs: 'No logs match these filters',
    systemPlugins: 'System plugins', systemPluginsConsoleDetail: 'Manage every bundled System Plugin, including recovery of the DSH Platform Management integration.',
    noSystemPlugins: 'The current Environment provides no System Plugins.', managementIntegration: 'Platform Management integration, recoverable from this standalone page.',
    notInstalled: 'Not installed', pluginEnabled: 'Installed and enabled', pluginDisabled: 'Installed but disabled', pluginPendingRestart: 'Pending restart',
    installPlugin: 'Install', uninstallPlugin: 'Uninstall', pluginActionWorking: 'Applying plugin settings',
    pluginActionInstall: 'Installing', pluginActionUninstall: 'Uninstalling',
    pluginActionEnable: 'Enabling', pluginActionDisable: 'Disabling', pluginActionComplete: 'Plugin settings saved',
    pluginRestartRequired: 'Restart DSH required', pluginRestartRequiredDetail: 'Plugin settings are saved and take effect after DSH restarts. You can make more changes and restart only once when finished.',
    stableNoticeTitle: 'Supported update available', stableNoticeBody: 'Supported version {version} is now available.',
    upstreamNoticeTitle: 'Upstream update available', upstreamNoticeBody: 'Official DSH version {version} is now available.',
    later: 'Remind me later', dismissVersion: 'Do not remind for this version',
    online: 'Connected', connecting: 'Reconnecting', offline: 'Disconnected',
  }),
})

function cookieLocale() {
  for (const part of document.cookie.split(';')) {
    const [name, value] = part.trim().split('=', 2)
    if (name === 'dsh_locale' && (value === 'zh' || value === 'en')) return value
  }
  for (const value of navigator.languages ?? [navigator.language]) {
    const primary = String(value).split('-', 1)[0].toLowerCase()
    if (primary === 'zh' || primary === 'en') return primary
  }
  return 'en'
}

const locale = cookieLocale()
const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map(element => [element.id, element]))
const channelButtons = [...document.querySelectorAll('[data-channel]')]
const tabButtons = [...document.querySelectorAll('[data-tab]')]
let status
let plugins = []
let rollbackPlan
let loading = false
let checking = false
let acting = false
let eventSource
let logSource
let autoScroll = true
let reminder
const logEntries = []
let logDisplayLimit = (() => {
  const value = Number(storageValue(LOG_DISPLAY_LIMIT_KEY))
  return LOG_DISPLAY_LIMITS.includes(value) ? value : DEFAULT_LOG_DISPLAY_LIMIT
})()
let logClearCutoff = (() => {
  try {
    const value = window.sessionStorage.getItem(LOG_CLEAR_CUTOFF_KEY)
    return Number.isFinite(Date.parse(value)) ? value : null
  } catch { return null }
})()

function t(key, values = {}) {
  let result = COPY[locale][key] ?? COPY.en[key] ?? key
  for (const [name, value] of Object.entries(values)) result = result.replaceAll(`{${name}}`, String(value))
  return result
}

function applyTranslations() {
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  document.title = t('title')
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n)
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder)
  for (const node of document.querySelectorAll('[data-i18n-aria-label]')) node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel))
  for (const node of document.querySelectorAll('[data-log-limit]')) node.textContent = t('logDisplayLimitValue', { count: node.dataset.logLimit })
}

function display(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value)
}

function displayEnvironment(value) {
  return value === undefined || value === null || value === '' ? '-' : `env-${String(value)}`
}

function localTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
}

function updateOutcome(value) {
  const key = {
    none: 'outcomeNone', frozen: 'outcomeFrozen', held: 'outcomeHeld', blocked: 'outcomeBlocked',
    stable: 'outcomeStable', experimental: 'outcomeExperimental',
  }[value]
  return key === undefined ? display(value) : t(key)
}

function localizedError(value) {
  const message = value instanceof Error ? value.message : String(value)
  if (locale === 'en') return message
  const httpStatus = message.match(/HTTP\s+(\d{3})/i)?.[1]
  return httpStatus === undefined ? t('operationError') : `${t('requestError')}（HTTP ${httpStatus}）`
}

function setText(id, value) {
  elements[id].textContent = display(value)
}

function setConnection(state) {
  elements.connection.dataset.state = state
  elements.connection.querySelector('strong').textContent = t(state)
}

function showError(error) {
  elements.error.textContent = localizedError(error)
  elements.error.hidden = false
}

function clearError() {
  elements.error.hidden = true
  elements.error.textContent = ''
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API}/${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? `HTTP ${String(response.status)}`)
  return value
}

function runtimeBusy(next = status) {
  const update = next?.update ?? {}
  return (acting && !checking)
    || (!TERMINAL.has(update.status ?? 'idle') && update.status !== 'checking')
    || next?.systemPluginOperation?.status === 'running'
    || next?.dshRestart?.status === 'restarting'
}

function holdReason(hold) {
  return locale === 'en' ? display(hold.reason) : t(hold.type === 'combination' ? 'holdCombination' : 'holdVersion')
}

function renderHolds(values, busy) {
  elements.holds.replaceChildren()
  elements.holds.hidden = values.length === 0
  for (const hold of values) {
    const row = document.createElement('div')
    row.className = 'hold'
    const copy = document.createElement('div')
    const identity = document.createElement('strong')
    identity.textContent = `${display(hold.dshVersion)}${hold.environmentVersion ? ` + ${displayEnvironment(hold.environmentVersion)}` : ''}`
    const reason = document.createElement('span')
    reason.textContent = holdReason(hold)
    copy.append(identity, reason)
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.className = 'compact'
    retry.textContent = t('retry')
    retry.disabled = busy
    retry.addEventListener('click', () => { void act('holds/retry', { method: 'POST', body: { id: hold.id } }) })
    row.append(copy, retry)
    elements.holds.append(row)
  }
}

function pluginDescription(plugin) {
  return plugin.description?.[locale] ?? plugin.id
}

function pluginButton(label, plugin, action, busy, className = 'secondary') {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = label
  button.disabled = busy
  button.addEventListener('click', () => {
    const path = plugin.protected ? 'bundled-plugins/recovery-action' : 'bundled-plugins/action'
    window.sessionStorage.setItem(PLUGIN_DRAFT_KEY, '1')
    void act(path, { method: 'POST', body: { id: plugin.id, action } }).then(changed => {
      if (!changed) window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
    })
  })
  return button
}

function renderBundledPlugins(values, busy) {
  elements['bundled-plugins'].replaceChildren()
  elements['empty-plugins'].hidden = values.length !== 0
  elements['bundled-plugins'].hidden = values.length === 0
  const operation = status?.systemPluginOperation ?? {}
  for (const plugin of values) {
    const row = document.createElement('article')
    row.className = 'plugin-row'
    const identity = document.createElement('div')
    identity.className = 'plugin-identity'
    const name = document.createElement('strong')
    name.textContent = `@dsh-docker/${plugin.id}`
    const state = document.createElement('span')
    state.textContent = pluginDescription(plugin)
    identity.append(name, state)
    if (plugin.pendingRestart) {
      const badge = document.createElement('span')
      badge.className = 'plugin-pending'
      badge.textContent = t('pluginPendingRestart')
      identity.append(badge)
    }
    const controls = document.createElement('div')
    controls.className = 'plugin-actions'
    if (!plugin.installed) {
      controls.append(pluginButton(t('installPlugin'), plugin, 'install', busy, 'primary'))
    } else {
      const toggle = document.createElement('label')
      toggle.className = 'toggle'
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = plugin.enabled
      checkbox.disabled = busy
      checkbox.addEventListener('change', event => {
        const path = plugin.protected ? 'bundled-plugins/recovery-action' : 'bundled-plugins/action'
        window.sessionStorage.setItem(PLUGIN_DRAFT_KEY, '1')
        void act(path, { method: 'POST', body: { id: plugin.id, action: event.target.checked ? 'enable' : 'disable' } }).then(changed => {
          if (!changed) window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
        })
      })
      const track = document.createElement('span')
      track.setAttribute('aria-hidden', 'true')
      const label = document.createElement('strong')
      label.textContent = plugin.enabled ? t('enabled') : t('disabled')
      toggle.append(checkbox, track, label)
      controls.append(toggle, pluginButton(t('uninstallPlugin'), plugin, 'uninstall', busy, 'danger-text'))
    }
    row.append(identity, controls)
    if (operation.status === 'running' && operation.pluginId === plugin.id) {
      const state = document.createElement('p')
      state.className = 'plugin-action-state'
      state.textContent = t({
        install: 'pluginActionInstall', uninstall: 'pluginActionUninstall',
        enable: 'pluginActionEnable', disable: 'pluginActionDisable',
      }[operation.action] ?? 'pluginActionWorking')
      row.append(state)
    }
    elements['bundled-plugins'].append(row)
  }
}

function render(next) {
  status = next
  rollbackPlan = next.rollbackPlan
  const update = next.update ?? {}
  const restart = next.dshRestart ?? {}
  const pluginOperation = next.systemPluginOperation ?? {}
  const busy = runtimeBusy(next)
  const updateActive = !TERMINAL.has(update.status ?? 'idle')
  const checkingUpdates = checking || update.status === 'checking'
  if (restart.status === 'success' && !plugins.some(plugin => plugin.pendingRestart)) {
    window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
  }
  const hasSupportedTarget = next.supported !== null && next.supported !== undefined

  setText('current-dsh', next.current?.dsh)
  setText('current-env', displayEnvironment(next.current?.environment))
  setText('supported-dsh', next.supported?.dsh)
  setText('supported-env', displayEnvironment(next.supported?.environment))
  setText('upstream-dsh', next.upstream?.version)
  const experimental = next.updateChannel === 'experimental'
  elements.versions.classList.toggle('experimental', experimental)
  elements['upstream-version'].hidden = !experimental
  for (const button of channelButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.channel === next.updateChannel))
    button.disabled = busy
  }

  elements['checked-at'].textContent = update.checkedAt ? `${t('lastChecked')} ${localTime(update.checkedAt)}` : t('notChecked')
  elements['check-spinner'].hidden = !checkingUpdates
  elements['check-label'].textContent = checkingUpdates ? t('checking') : t('check')
  elements.check.disabled = busy
  elements.update.textContent = experimental ? t('updateUpstream') : t('updateSupported')
  elements.update.disabled = busy || update.metadataUnavailable || !hasSupportedTarget || update.updateAvailable !== true
  elements.rollback.hidden = rollbackPlan === null || rollbackPlan === undefined
  elements.rollback.disabled = busy
  elements['return-stable'].hidden = !rollbackPlan?.returnStableAvailable
  elements['return-stable'].disabled = busy

  const updateStatusKey = STATUS_LABELS[update.status ?? 'idle'] ?? 'statusUnknown'
  elements['update-status'].querySelector('strong').textContent = t(updateStatusKey)
  elements['update-status'].className = `status-label ${update.status === 'failed' ? 'failed' : update.status === 'success' ? 'success' : updateActive ? 'active' : ''}`
  const progress = Math.max(0, Math.min(100, Number(update.progress) || 0))
  elements.progress.hidden = !updateActive
  elements['progress-value'].hidden = !updateActive
  elements['progress-value'].value = `${String(progress)}%`
  elements['progress-value'].textContent = `${String(progress)}%`
  elements.progress.setAttribute('aria-valuenow', String(progress))
  elements['progress-bar'].style.width = `${String(progress)}%`
  const result = update.error ? localizedError(update.error) : update.outcome ? updateOutcome(update.outcome) : ''
  elements['update-result'].textContent = result
  elements['update-result'].hidden = result === ''
  elements['metadata-notice'].hidden = !update.metadataUnavailable

  const holds = [...new Map([
    ...(next.holds ?? []),
    ...(next.experimentalBlocked ? [next.experimentalBlocked] : []),
  ].map(hold => [hold.id, hold])).values()]
  renderHolds(holds, busy)
  const notices = []
  if (next.aheadOfStable) notices.push(t('aheadOfStable'))
  if (next.experimentalBlocked) notices.push(t('experimentalBlocked'))
  elements.notice.textContent = notices.join(' ')
  elements.notice.hidden = notices.length === 0

  const automatic = next.automaticCheck ?? { enabled: true, intervalSeconds: 21_600, notificationsEnabled: true }
  elements['automatic-enabled'].checked = automatic.enabled
  elements['automatic-enabled'].disabled = acting
  elements['automatic-enabled-label'].textContent = automatic.enabled ? t('enabled') : t('disabled')
  elements['automatic-interval'].value = String(automatic.intervalSeconds)
  elements['automatic-interval'].disabled = acting || !automatic.enabled
  elements['notifications-enabled'].checked = automatic.notificationsEnabled
  elements['notifications-enabled'].disabled = acting || !automatic.enabled

  elements['restart-dsh'].disabled = busy
  elements['restart-state'].hidden = restart.status === 'idle'
  elements['restart-state'].textContent = restart.status === 'restarting'
    ? t('restarting') : restart.status === 'success' ? t('restartComplete') : restart.status === 'failed' ? t('restartFailed') : ''
  elements['plugin-operation'].hidden = !['running', 'failed'].includes(pluginOperation.status)
  elements['plugin-operation'].textContent = pluginOperation.status === 'running'
    ? t('pluginActionWorking') : pluginOperation.status === 'failed' ? localizedError(pluginOperation.error ?? '') : ''
  elements['plugin-restart-required'].hidden = !plugins.some(plugin => plugin.pendingRestart)
  elements['plugin-restart-dsh'].disabled = busy
  elements['plugin-restart-dsh'].textContent = restart.status === 'restarting' ? t('restarting') : t('restartDsh')
  renderBundledPlugins(plugins, busy)
  renderReminder(next)
}

async function loadStatus() {
  if (loading) return status
  loading = true
  try {
    const [next, bundled] = await Promise.all([api('status'), api('bundled-plugins')])
    plugins = bundled.plugins ?? []
    render(next)
    clearError()
    setConnection('online')
    return next
  } catch (error) {
    showError(error)
    setConnection('offline')
    return undefined
  } finally {
    loading = false
  }
}

async function act(path, options) {
  acting = true
  clearError()
  try {
    await api(path, options)
    await loadStatus()
    return true
  } catch (error) {
    showError(error)
    return false
  } finally {
    acting = false
    if (status !== undefined) render(status)
  }
}

async function checkUpdates(source = 'manual') {
  checking = true
  if (status !== undefined) render(status)
  try {
    return await act('check', { method: 'POST', body: { source } })
  } finally {
    checking = false
    if (status !== undefined) render(status)
  }
}

async function saveAutomaticCheck(change) {
  const current = status?.automaticCheck ?? { enabled: true, intervalSeconds: 21_600, notificationsEnabled: true }
  await act('automatic-check', { method: 'PUT', body: { ...current, ...change } })
}

function storageValue(key) {
  try { return window.localStorage.getItem(key) } catch { return null }
}

function writeStorage(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {}
}

function parsedStorage(key) {
  try { return JSON.parse(storageValue(key) ?? 'null') } catch { return null }
}

function candidateIdentity(candidate) {
  return candidate.kind === 'stable' ? `stable:${String(candidate.targetSequence)}` : `upstream:${candidate.version}`
}

function notificationCandidates(next) {
  if (next?.automaticCheck?.notificationsEnabled !== true) return []
  const candidates = []
  if (next.latestAutomatic?.stable) candidates.push({ kind: 'stable', ...next.latestAutomatic.stable })
  const upstream = next.latestAutomatic?.upstream
  const held = upstream && (next.holds ?? []).some(hold => hold.dshVersion === upstream.version)
  if (next.updateChannel === 'experimental' && upstream && !held) candidates.push({ kind: 'upstream', ...upstream })
  return candidates
}

function clearSatisfiedDismissals(next) {
  if (next?.update?.status !== 'success') return
  const completion = next.update.taskId ?? next.update.updatedAt
  if (!completion || storageValue(`${NOTICE_PREFIX}:cleared-completion`) === completion) return
  writeStorage(`${NOTICE_PREFIX}:dismissed:stable`, null)
  writeStorage(`${NOTICE_PREFIX}:dismissed:upstream`, null)
  writeStorage(`${NOTICE_PREFIX}:cleared-completion`, completion)
}

function renderReminder(next) {
  clearSatisfiedDismissals(next)
  const now = Date.now()
  reminder = notificationCandidates(next).find(candidate => {
    const identity = candidateIdentity(candidate)
    const snooze = parsedStorage(`${NOTICE_PREFIX}:snooze`)
    return storageValue(`${NOTICE_PREFIX}:dismissed:${candidate.kind}`) !== identity
      && !(snooze?.identity === identity && snooze.until > now)
  })
  elements['update-reminder'].hidden = reminder === undefined
  if (reminder === undefined) return
  elements['reminder-title'].textContent = t(reminder.kind === 'stable' ? 'stableNoticeTitle' : 'upstreamNoticeTitle')
  elements['reminder-body'].textContent = t(reminder.kind === 'stable' ? 'stableNoticeBody' : 'upstreamNoticeBody', {
    version: reminder.kind === 'stable' ? reminder.dsh : reminder.version,
  })
}

function logLevel(entry) {
  if (['debug', 'info', 'warning', 'error'].includes(entry?.level)) return entry.level
  if (entry?.stream === 'stderr') return 'error'
  return /^\s*(warn(?:ing)?)[\s:]/i.test(entry?.message ?? '') ? 'warning' : 'info'
}

function isJsonFragment(message) {
  return /^(?:[{}\[\]],?|"(?:[^"\\]|\\.)+"\s*:\s*.*)$/.test(message.trim())
}

function compactLogEntries(entries) {
  const compacted = []
  for (let index = 0; index < entries.length; index += 1) {
    const first = entries[index]
    const opening = first.value.message?.trim()
    if (opening !== '{' && opening !== '[') {
      if (!isJsonFragment(first.value.message ?? '')) compacted.push(first)
      continue
    }
    const lines = [first.value.message]
    const startedAt = Date.parse(first.value.timestamp)
    let merged = false
    for (let end = index + 1; end < entries.length; end += 1) {
      const next = entries[end]
      if (next.value.source !== first.value.source || next.value.stream !== first.value.stream
        || logLevel(next.value) !== logLevel(first.value) || Date.parse(next.value.timestamp) - startedAt > 2_000) break
      lines.push(next.value.message)
      try {
        const value = JSON.parse(lines.join('\n'))
        compacted.push({ identity: entries.slice(index, end + 1).map(item => item.identity).join('|'), value: { ...first.value, message: JSON.stringify(value) } })
        index = end
        merged = true
        break
      } catch {}
    }
    if (!merged && !isJsonFragment(first.value.message)) compacted.push(first)
  }
  return compacted
}

function limitProcessedLogEntries(entries, limit) {
  return compactLogEntries(entries).slice(-limit)
}

function updateLogSources(entries) {
  const selected = elements['log-source'].value
  const values = [...new Set(entries.map(item => item.value.source).filter(Boolean))].sort()
  elements['log-source'].replaceChildren()
  const all = document.createElement('option')
  all.value = 'all'
  all.textContent = t('allSources')
  elements['log-source'].append(all)
  for (const value of values) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value
    elements['log-source'].append(option)
  }
  elements['log-source'].value = values.includes(selected) ? selected : 'all'
}

function renderLogs() {
  const entries = limitProcessedLogEntries(logEntries, logDisplayLimit)
  updateLogSources(entries)
  const query = elements['log-search'].value.trim().toLocaleLowerCase(locale === 'zh' ? 'zh-CN' : 'en-US')
  const source = elements['log-source'].value
  const level = elements['log-level'].value
  const filtered = entries.filter(item => (source === 'all' || item.value.source === source)
    && (level === 'all' || logLevel(item.value) === level)
    && (query === '' || JSON.stringify(item.value).toLocaleLowerCase().includes(query)))
  elements['log-summary'].textContent = t('logCount', { shown: filtered.length, total: entries.length })
  elements['log-list'].replaceChildren()
  elements['log-list'].hidden = filtered.length === 0
  elements['empty-logs'].hidden = filtered.length !== 0
  elements['empty-logs'].textContent = entries.length === 0 ? t('noLogs') : t('noMatchingLogs')
  for (const item of filtered) {
    const entry = item.value
    const levelValue = logLevel(entry)
    const article = document.createElement('article')
    article.className = 'log-entry'
    const meta = document.createElement('div')
    meta.className = 'log-meta'
    const levelLabel = document.createElement('strong')
    levelLabel.className = `log-level ${levelValue}`
    levelLabel.textContent = t(`level${levelValue[0].toUpperCase()}${levelValue.slice(1)}`)
    const sourceLabel = document.createElement('span')
    sourceLabel.className = 'log-source'
    sourceLabel.textContent = display(entry.source)
    const time = document.createElement('time')
    time.dateTime = entry.timestamp
    time.textContent = localTime(entry.timestamp)
    const message = document.createElement('pre')
    message.textContent = display(entry.message)
    meta.append(levelLabel, sourceLabel, time)
    article.append(meta, message)
    elements['log-list'].append(article)
  }
  if (autoScroll) elements['log-list'].scrollTop = elements['log-list'].scrollHeight
}

function appendLog(entry) {
  const identity = JSON.stringify(entry)
  const timestamp = Date.parse(entry.timestamp)
  if ((logClearCutoff !== null && Number.isFinite(timestamp) && timestamp <= Date.parse(logClearCutoff))
    || logEntries.some(item => item.identity === identity)) return
  logEntries.push({ identity, value: entry })
  if (logEntries.length > LOG_STREAM_LIMIT) logEntries.splice(0, logEntries.length - LOG_STREAM_LIMIT)
  renderLogs()
}

function selectTab(tab) {
  for (const button of tabButtons) {
    const active = button.dataset.tab === tab
    button.setAttribute('aria-selected', String(active))
    button.tabIndex = active ? 0 : -1
    elements[`panel-${button.dataset.tab}`].hidden = !active
  }
}

function connectEvents() {
  eventSource?.close()
  eventSource = new EventSource(`${API}/events`)
  eventSource.addEventListener('state', () => { void loadStatus() })
  eventSource.onopen = () => setConnection('online')
  eventSource.onerror = () => setConnection('connecting')

  logSource?.close()
  logSource = new EventSource(`${API}/logs/stream?limit=${String(LOG_STREAM_LIMIT)}`)
  logSource.addEventListener('log', event => {
    try { appendLog(JSON.parse(event.data)) } catch {}
  })
  logSource.onopen = () => {
    elements['log-connection'].dataset.state = 'live'
    elements['log-connection'].querySelector('strong').textContent = t('logsLive')
  }
  logSource.onerror = () => {
    elements['log-connection'].dataset.state = 'disconnected'
    elements['log-connection'].querySelector('strong').textContent = t('logsDisconnected')
  }
}

for (const button of tabButtons) {
  button.addEventListener('click', () => selectTab(button.dataset.tab))
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const offset = event.key === 'ArrowRight' ? 1 : -1
    const target = tabButtons[(tabButtons.indexOf(button) + offset + tabButtons.length) % tabButtons.length]
    selectTab(target.dataset.tab)
    target.focus()
  })
}
for (const button of channelButtons) {
  button.addEventListener('click', async () => {
    if (await act('channel', { method: 'PUT', body: { channel: button.dataset.channel } })) await checkUpdates('channel-change')
  })
}
elements.check.addEventListener('click', () => { void checkUpdates('manual') })
elements.update.addEventListener('click', () => { void act('update', { method: 'POST' }) })
elements.rollback.addEventListener('click', () => { void act('rollback', { method: 'POST', body: { planId: rollbackPlan?.planId } }) })
elements['return-stable'].addEventListener('click', () => {
  elements['stable-snapshot'].textContent = localTime(rollbackPlan?.snapshot?.createdAt)
  elements['confirm-data-loss'].checked = false
  elements['confirm-stable'].disabled = true
  elements['stable-dialog'].showModal()
})
elements['confirm-data-loss'].addEventListener('change', event => { elements['confirm-stable'].disabled = !event.target.checked })
elements['confirm-stable'].addEventListener('click', async () => {
  const planId = rollbackPlan?.planId
  elements['stable-dialog'].close()
  await act('return-stable', { method: 'POST', body: { planId, confirmDataLoss: true } })
})
elements['automatic-enabled'].addEventListener('change', event => { void saveAutomaticCheck({ enabled: event.target.checked }) })
elements['automatic-interval'].addEventListener('change', event => { void saveAutomaticCheck({ intervalSeconds: Number(event.target.value) }) })
elements['notifications-enabled'].addEventListener('change', event => { void saveAutomaticCheck({ notificationsEnabled: event.target.checked }) })
elements['restart-dsh'].addEventListener('click', () => elements['restart-dialog'].showModal())
elements['plugin-restart-dsh'].addEventListener('click', () => elements['restart-dialog'].showModal())
elements['confirm-restart'].addEventListener('click', async () => {
  elements['restart-dialog'].close()
  await act('restart-dsh', { method: 'POST' })
})
elements['log-limit'].value = String(logDisplayLimit)
for (const element of [elements['log-search'], elements['log-source'], elements['log-level']]) {
  element.addEventListener(element.tagName === 'INPUT' ? 'input' : 'change', renderLogs)
}
elements['log-limit'].addEventListener('change', event => {
  const value = Number(event.target.value)
  if (!LOG_DISPLAY_LIMITS.includes(value)) return
  logDisplayLimit = value
  writeStorage(LOG_DISPLAY_LIMIT_KEY, String(value))
  renderLogs()
})
elements['auto-scroll'].addEventListener('click', () => {
  autoScroll = !autoScroll
  elements['auto-scroll'].setAttribute('aria-pressed', String(autoScroll))
  elements['auto-scroll'].textContent = t(autoScroll ? 'pauseAutoScroll' : 'resumeAutoScroll')
  if (autoScroll) elements['log-list'].scrollTop = elements['log-list'].scrollHeight
})
elements['clear-logs'].addEventListener('click', () => {
  const latest = logEntries.reduce((value, entry) => {
    const timestamp = Date.parse(entry.value.timestamp)
    return Number.isFinite(timestamp) ? Math.max(value, timestamp) : value
  }, Date.now())
  logClearCutoff = new Date(latest).toISOString()
  try { window.sessionStorage.setItem(LOG_CLEAR_CUTOFF_KEY, logClearCutoff) } catch {}
  logEntries.length = 0
  renderLogs()
})
elements['reminder-later'].addEventListener('click', () => {
  if (reminder === undefined) return
  writeStorage(`${NOTICE_PREFIX}:snooze`, JSON.stringify({ identity: candidateIdentity(reminder), until: Date.now() + 3_600_000 }))
  renderReminder(status)
})
elements['reminder-dismiss'].addEventListener('click', () => {
  if (reminder === undefined) return
  writeStorage(`${NOTICE_PREFIX}:dismissed:${reminder.kind}`, candidateIdentity(reminder))
  renderReminder(status)
})

window.addEventListener('beforeunload', () => {
  eventSource?.close()
  logSource?.close()
})

applyTranslations()
selectTab('updates')
renderLogs()
connectEvents()
if (window.sessionStorage.getItem(PLUGIN_DRAFT_KEY) === '1') {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await api('bundled-plugins/discard', { method: 'POST' })
      window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
      break
    } catch {
      await new Promise(resolve => window.setTimeout(resolve, 100))
    }
  }
}
const initial = await loadStatus()
if (TERMINAL.has(initial?.update?.status ?? 'idle')) void checkUpdates('page-open')
window.setInterval(() => { void loadStatus() }, 15_000)
