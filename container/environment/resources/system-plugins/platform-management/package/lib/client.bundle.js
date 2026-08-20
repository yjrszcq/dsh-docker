window.__ModuleLoader__.load({ id: "@dsh-docker/platform-management", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
const css = Object.freeze({"actionHeading":"dshPlatform_actionHeading","actions":"dshPlatform_actions","caption":"dshPlatform_caption","checkSpinner":"dshPlatform_checkSpinner","confirmActions":"dshPlatform_confirmActions","confirmation":"dshPlatform_confirmation","connection":"dshPlatform_connection","dangerButton":"dshPlatform_dangerButton","dangerFilledButton":"dshPlatform_dangerFilledButton","detail":"dshPlatform_detail","error":"dshPlatform_error","experimentalVersions":"dshPlatform_experimentalVersions","hold":"dshPlatform_hold","holds":"dshPlatform_holds","intro":"dshPlatform_intro","maintenanceButton":"dshPlatform_maintenanceButton","maintenanceSection":"dshPlatform_maintenanceSection","maintenanceStatus":"dshPlatform_maintenanceStatus","notice":"dshPlatform_notice","offline":"dshPlatform_offline","online":"dshPlatform_online","primaryButton":"dshPlatform_primaryButton","progress":"dshPlatform_progress","reminderActions":"dshPlatform_reminderActions","restartConfirmation":"dshPlatform_restartConfirmation","root":"dshPlatform_root","secondaryButton":"dshPlatform_secondaryButton","section":"dshPlatform_section","sectionHeading":"dshPlatform_sectionHeading","segmented":"dshPlatform_segmented","settingRow":"dshPlatform_settingRow","settingRows":"dshPlatform_settingRows","smallButton":"dshPlatform_smallButton","statusActive":"dshPlatform_statusActive","statusDot":"dshPlatform_statusDot","statusFailed":"dshPlatform_statusFailed","statusLabel":"dshPlatform_statusLabel","statusLine":"dshPlatform_statusLine","statusSuccess":"dshPlatform_statusSuccess","title":"dshPlatform_title","titleRow":"dshPlatform_titleRow","toggle":"dshPlatform_toggle","updateReminder":"dshPlatform_updateReminder","updateState":"dshPlatform_updateState","version":"dshPlatform_version","versionCell":"dshPlatform_versionCell","versions":"dshPlatform_versions"});
const styleId = "@dsh-docker/platform-management/style.module.css";
if (typeof document !== 'undefined' && ![...document.querySelectorAll('style[data-plugin-css]')].some(tag => tag.dataset.pluginCss === styleId)) {
  const tag = document.createElement('style');
  tag.dataset.plugin = "@dsh-docker/platform-management";
  tag.dataset.pluginCss = styleId;
  tag.textContent = ".dshPlatform_root {\n  display: flex;\n  flex-direction: column;\n  gap: 20px;\n  width: 100%;\n  max-width: 720px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshPlatform_sectionHeading {\n  display: flex;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: 16px;\n}\n\n.dshPlatform_titleRow {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n}\n\n.dshPlatform_title {\n  margin: 0;\n  font-size: 18px;\n  line-height: 26px;\n  font-weight: 600;\n}\n\n.dshPlatform_intro,\n.dshPlatform_sectionHeading p {\n  margin: 2px 0 0;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dshPlatform_connection {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  padding: 3px 9px;\n  border-radius: 12px;\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-module-platform);\n}\n\n.dshPlatform_connection > span {\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  background: var(--dsw-alias-state-warn-label);\n}\n\n.dshPlatform_connection.dshPlatform_online > span { background: var(--dsw-alias-state-success-primary); }\n.dshPlatform_connection.dshPlatform_offline > span { background: var(--dsw-alias-state-error-primary); }\n\n.dshPlatform_section {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  padding-bottom: 20px;\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\n}\n\n.dshPlatform_sectionHeading h3 {\n  margin: 0;\n  font-size: 16px;\n  line-height: 24px;\n  font-weight: 500;\n}\n\n.dshPlatform_segmented {\n  flex: none;\n  display: inline-flex;\n  padding: 2px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n}\n\n.dshPlatform_segmented button {\n  box-sizing: border-box;\n  height: 28px;\n  padding: 0 10px;\n  border: none;\n  border-radius: 6px;\n  background: transparent;\n  color: var(--dsw-alias-label-secondary);\n  font: inherit;\n  font-size: 12px;\n  cursor: pointer;\n}\n\n.dshPlatform_segmented button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }\n.dshPlatform_segmented button[aria-pressed='true'] {\n  background: var(--dsw-specific-sidebar-nav-item-active);\n  color: var(--dsw-alias-label-primary);\n  font-weight: 500;\n}\n\n.dshPlatform_versions {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  overflow: hidden;\n}\n\n.dshPlatform_experimentalVersions { grid-template-columns: repeat(3, minmax(0, 1fr)); }\n\n.dshPlatform_versionCell {\n  min-width: 0;\n  padding: 12px 14px;\n}\n\n.dshPlatform_versionCell + .dshPlatform_versionCell { border-left: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_caption, .dshPlatform_version, .dshPlatform_detail { display: block; overflow-wrap: anywhere; }\n.dshPlatform_caption, .dshPlatform_detail { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }\n.dshPlatform_version { margin: 3px 0; font-size: 15px; line-height: 22px; font-weight: 600; }\n\n.dshPlatform_notice,\n.dshPlatform_error {\n  margin: 0;\n  padding: 8px 10px;\n  border-left: 3px solid var(--dsw-alias-state-warn-label);\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-state-warn-label);\n  background: var(--dsw-alias-bg-module-platform);\n}\n\n.dshPlatform_error {\n  border-left-color: var(--dsw-alias-state-error-primary);\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.dshPlatform_actions {\n  display: flex;\n  flex-wrap: wrap;\n  justify-content: flex-end;\n  gap: 8px;\n}\n\n.dshPlatform_primaryButton,\n.dshPlatform_secondaryButton,\n.dshPlatform_dangerButton,\n.dshPlatform_dangerFilledButton,\n.dshPlatform_smallButton {\n  box-sizing: border-box;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  height: 36px;\n  padding: 0 14px;\n  border: none;\n  border-radius: 18px;\n  font: inherit;\n  font-size: 14px;\n  line-height: 22px;\n  cursor: pointer;\n}\n\n.dshPlatform_primaryButton {\n  background: var(--dsw-alias-button-primary-fill);\n  color: var(--dsw-alias-label-primary-foreground);\n}\n.dshPlatform_primaryButton:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }\n\n.dshPlatform_secondaryButton,\n.dshPlatform_smallButton {\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n}\n.dshPlatform_secondaryButton:hover:not(:disabled),\n.dshPlatform_smallButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }\n\n.dshPlatform_checkSpinner {\n  box-sizing: border-box;\n  width: 14px;\n  height: 14px;\n  margin-right: 7px;\n  border: 2px solid currentColor;\n  border-right-color: transparent;\n  border-radius: 50%;\n  animation: checkSpin .75s linear infinite;\n}\n\n@keyframes checkSpin { to { transform: rotate(360deg); } }\n\n@media (prefers-reduced-motion: reduce) {\n  .dshPlatform_checkSpinner { animation-duration: 1.5s; }\n}\n\n.dshPlatform_dangerButton {\n  background: transparent;\n  color: var(--dsw-alias-state-error-primary);\n}\n.dshPlatform_dangerButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }\n.dshPlatform_dangerFilledButton { background: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-label-primary-foreground); }\n\n.dshPlatform_smallButton {\n  height: 28px;\n  padding: 0 10px;\n  border-radius: 14px;\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.dshPlatform_primaryButton:disabled,\n.dshPlatform_secondaryButton:disabled,\n.dshPlatform_dangerButton:disabled,\n.dshPlatform_dangerFilledButton:disabled,\n.dshPlatform_smallButton:disabled,\n.dshPlatform_segmented button:disabled { opacity: .4; cursor: default; }\n\n.dshPlatform_primaryButton:focus-visible,\n.dshPlatform_secondaryButton:focus-visible,\n.dshPlatform_dangerButton:focus-visible,\n.dshPlatform_dangerFilledButton:focus-visible,\n.dshPlatform_smallButton:focus-visible,\n.dshPlatform_segmented button:focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 2px;\n}\n\n.dshPlatform_actionHeading { align-items: center; }\n.dshPlatform_updateState { display: flex; flex-direction: column; gap: 6px; }\n.dshPlatform_statusLine { display: flex; align-items: center; justify-content: space-between; gap: 12px; }\n.dshPlatform_statusLine output { font-size: 12px; color: var(--dsw-alias-label-secondary); }\n.dshPlatform_statusLabel { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }\n.dshPlatform_statusDot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--dsw-alias-border-l2); }\n.dshPlatform_statusActive .dshPlatform_statusDot { background: var(--dsw-alias-brand-primary); }\n.dshPlatform_statusSuccess .dshPlatform_statusDot { background: var(--dsw-alias-state-success-primary); }\n.dshPlatform_statusFailed { color: var(--dsw-alias-state-error-primary); }\n.dshPlatform_statusFailed .dshPlatform_statusDot { background: var(--dsw-alias-state-error-primary); }\n.dshPlatform_updateState > p { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }\n.dshPlatform_progress { height: 6px; overflow: hidden; border-radius: 3px; background: var(--dsw-alias-border-l2); }\n.dshPlatform_progress span { display: block; height: 100%; background: var(--dsw-alias-state-success-primary); transition: width .2s ease; }\n\n.dshPlatform_holds { display: flex; flex-direction: column; border-top: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_hold { display: flex; align-items: center; gap: 12px; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_hold div { min-width: 0; }\n.dshPlatform_hold strong, .dshPlatform_hold span { display: block; overflow-wrap: anywhere; }\n.dshPlatform_hold strong { font-size: 13px; line-height: 20px; }\n.dshPlatform_hold span { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }\n\n.dshPlatform_confirmation {\n  padding: 14px;\n  border: 1px solid var(--dsw-alias-state-error-primary);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-module-platform);\n}\n.dshPlatform_confirmation h4 { margin: 0; font-size: 14px; line-height: 22px; }\n.dshPlatform_confirmation p { margin: 4px 0 12px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }\n.dshPlatform_confirmation label { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 20px; }\n.dshPlatform_confirmation input { margin: 3px 0 0; accent-color: var(--dsw-alias-brand-primary); }\n.dshPlatform_confirmActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }\n\n.dshPlatform_maintenanceSection { border-bottom: 0; }\n.dshPlatform_maintenanceButton { flex: none; }\n.dshPlatform_maintenanceStatus {\n  margin: 0;\n  font-size: 13px;\n  line-height: 20px;\n  color: var(--dsw-alias-label-secondary);\n}\n.dshPlatform_restartConfirmation { border-color: var(--dsw-alias-border-l2); }\n\n.dshPlatform_toggle {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 12px;\n  cursor: pointer;\n}\n.dshPlatform_toggle input { position: absolute; opacity: 0; pointer-events: none; }\n.dshPlatform_toggle > span {\n  box-sizing: border-box;\n  width: 34px;\n  height: 20px;\n  padding: 2px;\n  border-radius: 10px;\n  background: var(--dsw-alias-border-l2);\n  transition: background .15s ease;\n}\n.dshPlatform_toggle > span::after {\n  display: block;\n  width: 16px;\n  height: 16px;\n  border-radius: 50%;\n  background: var(--dsw-alias-label-primary-foreground);\n  content: '';\n  transition: transform .15s ease;\n}\n.dshPlatform_toggle input:checked + span { background: var(--dsw-alias-state-success-primary); }\n.dshPlatform_toggle input:checked + span::after { transform: translateX(14px); }\n.dshPlatform_toggle input:focus-visible + span { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }\n.dshPlatform_toggle input:disabled ~ * { opacity: .5; cursor: default; }\n.dshPlatform_toggle b { font-weight: 500; }\n\n.dshPlatform_settingRows { border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; overflow: hidden; }\n.dshPlatform_settingRow { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 44px; padding: 8px 12px; font-size: 13px; }\n.dshPlatform_settingRow + .dshPlatform_settingRow { border-top: 1px solid var(--dsw-alias-border-l2); }\n.dshPlatform_settingRow > span { min-width: 0; }\n.dshPlatform_settingRow b, .dshPlatform_settingRow small { display: block; }\n.dshPlatform_settingRow b { font-weight: 500; }\n.dshPlatform_settingRow small { margin-top: 2px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }\n.dshPlatform_settingRow select {\n  min-width: 120px;\n  height: 32px;\n  padding: 0 30px 0 10px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-module-platform);\n  font: inherit;\n}\n.dshPlatform_settingRow input[type='checkbox'] { width: 16px; height: 16px; flex: none; accent-color: var(--dsw-alias-brand-primary); }\n\n.dshPlatform_updateReminder {\n  position: fixed;\n  right: 20px;\n  bottom: 20px;\n  z-index: 1000;\n  box-sizing: border-box;\n  width: min(360px, calc(100vw - 32px));\n  padding: 14px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  color: var(--dsw-alias-label-primary);\n  background: var(--dsw-alias-bg-module-platform);\n  box-shadow: 0 8px 24px rgb(0 0 0 / 24%);\n  pointer-events: auto;\n}\n.dshPlatform_updateReminder strong { display: block; font-size: 14px; line-height: 22px; }\n.dshPlatform_updateReminder p { margin: 4px 0 12px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }\n.dshPlatform_reminderActions { display: flex; justify-content: flex-end; gap: 8px; }\n.dshPlatform_reminderActions button {\n  min-height: 30px;\n  padding: 4px 10px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 15px;\n  color: var(--dsw-alias-label-primary);\n  background: transparent;\n  font: inherit;\n  font-size: 12px;\n  cursor: pointer;\n}\n.dshPlatform_reminderActions button:hover { background: var(--dsw-alias-interactive-bg-hover); }\n\n@media (max-width: 640px) {\n  .dshPlatform_root { gap: 16px; }\n  .dshPlatform_sectionHeading { flex-direction: column; gap: 10px; }\n  .dshPlatform_actionHeading { align-items: flex-start; }\n  .dshPlatform_versions { grid-template-columns: 1fr; }\n  .dshPlatform_versionCell + .dshPlatform_versionCell { border-left: 0; border-top: 1px solid var(--dsw-alias-border-l2); }\n  .dshPlatform_segmented { width: 100%; }\n  .dshPlatform_segmented button { flex: 1; }\n  .dshPlatform_actions > button { flex: 1 1 calc(50% - 8px); }\n  .dshPlatform_actions { width: 100%; justify-content: flex-start; }\n  .dshPlatform_maintenanceButton { width: 100%; }\n  .dshPlatform_toggle { width: 100%; justify-content: space-between; }\n  .dshPlatform_settingRow { align-items: flex-start; }\n  .dshPlatform_updateReminder { right: 16px; bottom: 16px; }\n}\n\n@media (max-width: 480px) {\n  [role='dialog']:has(.dshPlatform_root) > nav { display: none; }\n  [role='dialog']:has(.dshPlatform_root) > div { min-width: 0; }\n  .dshPlatform_actions > button { flex-basis: 100%; }\n}\n";
  document.head.appendChild(tag);
}
const React = require('react')
const { useCallback, useEffect, useRef, useState } = React

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
const h = React.createElement
const LOCALE_COOKIE = 'dsh_locale'
const NOTICE_OWNER_KEY = 'dsh-platform:update-notice-owner'
const NOTICE_SNOOZE_KEY = 'dsh-platform:update-notice-snooze'
const NOTICE_OWNER_TTL = 20_000

const inject = ['slots', 'locale']

function display(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value)
}

function displayEnvironment(value) {
  return value === undefined || value === null || value === '' ? '-' : `env-${String(value)}`
}

function localTime(value, locale) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? String(value)
    : date.toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN')
}

function updateOutcome(value, t) {
  const key = {
    none: 'outcomeNone', frozen: 'outcomeFrozen', held: 'outcomeHeld', blocked: 'outcomeBlocked',
    stable: 'outcomeStable', experimental: 'outcomeExperimental',
  }[value]
  return key === undefined ? display(value) : t(key)
}

function localizedError(value, t) {
  const message = value instanceof Error ? value.message : String(value)
  if (t('localeCode') === 'en') return message
  const httpStatus = message.match(/HTTP\s+(\d{3})/i)?.[1]
  return httpStatus === undefined ? t('operationError') : `${t('requestError')}（HTTP ${httpStatus}）`
}

function localizedHoldReason(hold, t) {
  if (t('localeCode') === 'en') return display(hold.reason)
  return t(hold.type === 'combination' ? 'holdCombination' : 'holdVersion')
}

function persistLocale(locale) {
  if (typeof document === 'undefined') return
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`
}

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API}/${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? `HTTP ${String(response.status)}`)
  return value
}

function VersionCell({ label, version, detail }) {
  return h('div', { className: css.versionCell },
    h('span', { className: css.caption }, label),
    h('strong', { className: css.version }, display(version)),
    h('span', { className: css.detail }, display(detail)))
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
  return candidate.kind === 'stable'
    ? `stable:${String(candidate.targetSequence)}`
    : `upstream:${candidate.version}`
}

function eligibleCandidates(status) {
  if (status?.automaticCheck?.notificationsEnabled !== true) return []
  const candidates = []
  if (status?.latestAutomatic?.stable !== null && status?.latestAutomatic?.stable !== undefined) {
    candidates.push({ kind: 'stable', ...status.latestAutomatic.stable })
  }
  const upstream = status?.latestAutomatic?.upstream
  const held = upstream !== null && upstream !== undefined && (status?.holds ?? []).some(hold => hold.dshVersion === upstream.version)
  if (status?.updateChannel === 'experimental' && upstream !== null && upstream !== undefined && !held) {
    candidates.push({ kind: 'upstream', ...upstream })
  }
  return candidates.filter(candidate => storageValue(`dsh-platform:update-notice-dismissed:${candidate.kind}`) !== candidateIdentity(candidate))
}

function clearSatisfiedDismissals(status) {
  if (status?.update?.status !== 'success') return
  const completion = status.update.taskId ?? status.update.updatedAt
  if (completion === undefined || completion === null || storageValue('dsh-platform:update-notice-cleared-completion') === completion) return
  writeStorage('dsh-platform:update-notice-dismissed:stable', null)
  writeStorage('dsh-platform:update-notice-dismissed:upstream', null)
  writeStorage('dsh-platform:update-notice-cleared-completion', completion)
}

function UpdateReminder({ t }) {
  const [status, setStatus] = useState(null)
  const [tick, setTick] = useState(0)
  const [ownsNotice, setOwnsNotice] = useState(false)
  const ownerId = useRef(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)

  const refresh = useCallback(async () => {
    try {
      const value = await request('status')
      clearSatisfiedDismissals(value)
      setStatus(value)
    } catch {}
  }, [])

  useEffect(() => {
    void refresh()
    const events = new EventSource(`${API}/events`)
    events.addEventListener('state', () => { void refresh() })
    const timer = window.setInterval(() => { void refresh() }, 30_000)
    const changed = () => setTick(value => value + 1)
    const visibilityChanged = () => {
      if (document.visibilityState !== 'visible' && parsedStorage(NOTICE_OWNER_KEY)?.id === ownerId.current) {
        writeStorage(NOTICE_OWNER_KEY, null)
      }
      changed()
    }
    const leaseTimer = window.setInterval(changed, NOTICE_OWNER_TTL / 2)
    window.addEventListener('storage', changed)
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => {
      events.close()
      window.clearInterval(timer)
      window.clearInterval(leaseTimer)
      window.removeEventListener('storage', changed)
      document.removeEventListener('visibilitychange', visibilityChanged)
      const owner = parsedStorage(NOTICE_OWNER_KEY)
      if (owner?.id === ownerId.current) writeStorage(NOTICE_OWNER_KEY, null)
    }
  }, [refresh])

  const candidate = eligibleCandidates(status)[0]
  const identity = candidate === undefined ? null : candidateIdentity(candidate)

  useEffect(() => {
    if (identity === null || document.visibilityState !== 'visible') {
      setOwnsNotice(false)
      return
    }
    const now = Date.now()
    const snooze = parsedStorage(NOTICE_SNOOZE_KEY)
    const owner = parsedStorage(NOTICE_OWNER_KEY)
    const available = !(snooze?.identity === identity && snooze.until > now)
      && (owner?.id === ownerId.current || owner?.expiresAt <= now || owner === null)
    if (available) writeStorage(NOTICE_OWNER_KEY, JSON.stringify({ id: ownerId.current, expiresAt: now + NOTICE_OWNER_TTL }))
    setOwnsNotice(available)
  }, [identity, tick])

  useEffect(() => {
    if (!ownsNotice) return undefined
    const timer = window.setInterval(() => {
      writeStorage(NOTICE_OWNER_KEY, JSON.stringify({ id: ownerId.current, expiresAt: Date.now() + NOTICE_OWNER_TTL }))
    }, NOTICE_OWNER_TTL / 2)
    return () => window.clearInterval(timer)
  }, [identity, ownsNotice])

  if (!ownsNotice || candidate === undefined) return null
  const dismiss = permanent => {
    if (permanent) writeStorage(`dsh-platform:update-notice-dismissed:${candidate.kind}`, identity)
    else writeStorage(NOTICE_SNOOZE_KEY, JSON.stringify({ identity, until: Date.now() + 3_600_000 }))
    writeStorage(NOTICE_OWNER_KEY, null)
    setTick(tick + 1)
  }
  return h('aside', { className: css.updateReminder, role: 'status', 'aria-live': 'polite' },
    h('strong', null, candidate.kind === 'stable' ? t('stableNoticeTitle') : t('upstreamNoticeTitle')),
    h('p', null, candidate.kind === 'stable'
      ? t('stableNoticeBody').replace('{version}', candidate.dsh)
      : t('upstreamNoticeBody').replace('{version}', candidate.version)),
    h('div', { className: css.reminderActions },
      h('button', { type: 'button', onClick: () => dismiss(false) }, t('later')),
      h('button', { type: 'button', onClick: () => dismiss(true) }, t('dismissVersion'))))
}

function PlatformManagement({ t }) {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [connection, setConnection] = useState('connecting')
  const [acting, setActing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [confirmStable, setConfirmStable] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [dataLossAccepted, setDataLossAccepted] = useState(false)
  const loading = useRef(false)
  const requestedRestart = useRef(null)

  const refresh = useCallback(async () => {
    if (loading.current) return
    loading.current = true
    try {
      const value = await request('status')
      setStatus(value)
      setError('')
      setConnection('online')
      return value
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
      setConnection('offline')
    } finally {
      loading.current = false
    }
  }, [])

  const act = useCallback(async (path, options) => {
    setActing(true)
    setError('')
    try {
      await request(path, options)
      await refresh()
      return true
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
      return false
    } finally {
      setActing(false)
    }
  }, [refresh])

  const checkUpdates = useCallback(async (source = 'manual') => {
    setChecking(true)
    try {
      return await act('check', { method: 'POST', body: { source } })
    } finally {
      setChecking(false)
    }
  }, [act])

  const changeChannel = useCallback(async channel => {
    if (await act('channel', { method: 'PUT', body: { channel } })) void checkUpdates('channel-change')
  }, [act, checkUpdates])

  const restartDsh = useCallback(async () => {
    setActing(true)
    setError('')
    try {
      const task = await request('restart-dsh', { method: 'POST' })
      requestedRestart.current = task.taskId
      setConfirmRestart(false)
      await refresh()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setActing(false)
    }
  }, [refresh])

  useEffect(() => {
    const stateEvents = new EventSource(`${API}/events`)
    stateEvents.addEventListener('state', () => { void refresh() })
    stateEvents.onopen = () => setConnection('online')
    stateEvents.onerror = () => setConnection('connecting')

    void refresh().then(value => {
      if (TERMINAL.has(value?.update?.status ?? 'idle')) void checkUpdates('page-open')
    })

    const timer = window.setInterval(() => { void refresh() }, 15_000)
    return () => {
      window.clearInterval(timer)
      stateEvents.close()
    }
  }, [checkUpdates, refresh])

  useEffect(() => {
    const restart = status?.dshRestart
    if (restart?.taskId !== requestedRestart.current) return
    if (restart.status === 'success') {
      requestedRestart.current = null
      window.location.reload()
    } else if (restart.status === 'failed') {
      requestedRestart.current = null
    }
  }, [status?.dshRestart])

  const update = status?.update ?? {}
  const restart = status?.dshRestart ?? {}
  const checkingUpdates = checking || update.status === 'checking'
  const rollbackPlan = status?.rollbackPlan
  const restartBusy = restart.status === 'restarting'
  const busy = acting || restartBusy || !TERMINAL.has(update.status ?? 'idle')
  const updateActive = !TERMINAL.has(update.status ?? 'idle')
  const hasSupportedTarget = status?.supported !== null && status?.supported !== undefined
  const updateStatus = STATUS_LABELS[update.status ?? 'idle'] ?? 'statusUnknown'
  const updateStatusClass = update.status === 'failed'
    ? css.statusFailed
    : update.status === 'success'
      ? css.statusSuccess
      : updateActive ? css.statusActive : ''
  const progress = Math.max(0, Math.min(100, Number(update.progress) || 0))
  const holds = [...new Map([
    ...(status?.holds ?? []),
    ...(status?.experimentalBlocked ? [status.experimentalBlocked] : []),
  ].map(hold => [hold.id, hold])).values()]
  const notices = []
  if (status?.aheadOfStable) notices.push(t('aheadOfStable'))
  if (status?.experimentalBlocked) notices.push(t('experimentalBlocked'))
  const automaticCheck = status?.automaticCheck ?? { enabled: true, intervalSeconds: 21_600, notificationsEnabled: true }

  const saveAutomaticCheck = async change => {
    await act('automatic-check', {
      method: 'PUT',
      body: { ...automaticCheck, ...change },
    })
  }

  const returnStable = async () => {
    const restored = await act('return-stable', {
      method: 'POST',
      body: { planId: rollbackPlan?.planId, confirmDataLoss: true },
    })
    if (!restored) return
    setConfirmStable(false)
    setDataLossAccepted(false)
  }

  return h('div', { className: css.root },
    h('div', { className: css.heading },
      h('div', { className: css.titleRow },
        h('h2', { className: css.title }, t('title')),
        h('span', { className: `${css.connection} ${css[connection]}`, role: 'status' },
          h('span', { 'aria-hidden': 'true' }),
          t(connection))),
      h('p', { className: css.intro }, t('intro'))),

    h('section', { className: css.section, 'aria-labelledby': 'platform-channel-title' },
      h('div', { className: css.sectionHeading },
        h('div', null,
          h('h3', { id: 'platform-channel-title' }, t('channel')),
          h('p', null, t('channelDetail'))),
        h('div', { className: css.segmented, role: 'group', 'aria-label': t('channel') },
          ['stable', 'experimental'].map(channel => h('button', {
            key: channel,
            type: 'button',
            'aria-pressed': status?.updateChannel === channel,
            disabled: busy,
            onClick: () => { void changeChannel(channel) },
          }, t(channel))))),
      h('div', { className: `${css.versions} ${status?.updateChannel === 'experimental' ? css.experimentalVersions : ''}` },
        h(VersionCell, { label: t('current'), version: status?.current?.dsh, detail: displayEnvironment(status?.current?.environment) }),
        h(VersionCell, { label: t('supported'), version: status?.supported?.dsh, detail: displayEnvironment(status?.supported?.environment) }),
        status?.updateChannel === 'experimental'
          ? h(VersionCell, { label: t('upstream'), version: status?.upstream?.version, detail: t('officialNpm') })
          : null),
      notices.length > 0 ? h('p', { className: css.notice }, notices.join(' ')) : null,
      error ? h('p', { className: css.error, role: 'alert' }, localizedError(error, t)) : null),

    h('section', { className: css.section, 'aria-labelledby': 'platform-actions-title' },
      h('div', { className: `${css.sectionHeading} ${css.actionHeading}` },
        h('div', null,
          h('h3', { id: 'platform-actions-title' }, t('actions')),
          h('p', null, update.checkedAt ? `${t('lastChecked')} ${localTime(update.checkedAt, t('localeCode'))}` : t('notChecked'))),
        h('div', { className: css.actions },
          h('button', { type: 'button', className: css.secondaryButton, disabled: busy, onClick: () => { void checkUpdates('manual') } },
            checkingUpdates ? h('span', { className: css.checkSpinner, 'aria-hidden': 'true' }) : null,
            checkingUpdates ? t('checking') : t('check')),
          h('button', { type: 'button', className: css.primaryButton, disabled: busy || update.metadataUnavailable || !hasSupportedTarget || update.updateAvailable !== true, onClick: () => { void act('update', { method: 'POST' }) } }, status?.updateChannel === 'experimental' ? t('updateUpstream') : t('updateSupported')),
          rollbackPlan ? h('button', { type: 'button', className: css.secondaryButton, disabled: busy, onClick: () => { void act('rollback', { method: 'POST', body: { planId: rollbackPlan.planId } }) } }, t('rollback')) : null,
          rollbackPlan?.returnStableAvailable ? h('button', { type: 'button', className: css.dangerButton, disabled: busy, onClick: () => setConfirmStable(true) }, t('returnStable')) : null)),
      h('div', { className: css.updateState, 'aria-live': 'polite' },
        h('div', { className: css.statusLine },
          h('span', { className: `${css.statusLabel} ${updateStatusClass}` },
            h('span', { className: css.statusDot, 'aria-hidden': 'true' }),
            t(updateStatus)),
          updateActive ? h('output', null, `${String(progress)}%`) : null),
        update.error || update.outcome ? h('p', null, update.error ? localizedError(update.error, t) : updateOutcome(update.outcome, t)) : null,
        updateActive ? h('div', { className: css.progress, role: 'progressbar', 'aria-label': t('progress'), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': progress },
          h('span', { style: { width: `${String(progress)}%` } })) : null),
      update.metadataUnavailable ? h('p', { className: css.notice }, t('metadataUnavailable')) : null,
      holds.length > 0 ? h('div', { className: css.holds },
        holds.map(hold => h('div', { className: css.hold, key: hold.id },
          h('div', null,
            h('strong', null, `${display(hold.dshVersion)}${hold.environmentVersion ? ` + ${displayEnvironment(hold.environmentVersion)}` : ''}`),
            h('span', null, localizedHoldReason(hold, t))),
          h('button', { type: 'button', className: css.smallButton, disabled: busy, onClick: () => { void act('holds/retry', { method: 'POST', body: { id: hold.id } }) } }, t('retry'))))) : null,
      confirmStable ? h('div', { className: css.confirmation, role: 'alertdialog', 'aria-labelledby': 'return-stable-title' },
        h('h4', { id: 'return-stable-title' }, t('returnStableTitle')),
        h('p', null, `${t('returnStableWarning')} ${localTime(rollbackPlan?.snapshot?.createdAt, t('localeCode'))}`),
        h('label', null,
          h('input', { type: 'checkbox', checked: dataLossAccepted, onChange: event => setDataLossAccepted(event.target.checked) }),
          h('span', null, t('confirmDataLoss'))),
        h('div', { className: css.confirmActions },
          h('button', { type: 'button', className: css.secondaryButton, onClick: () => { setConfirmStable(false); setDataLossAccepted(false) } }, t('cancel')),
          h('button', { type: 'button', className: css.dangerFilledButton, disabled: !dataLossAccepted || busy, onClick: () => { void returnStable() } }, t('confirm')))) : null),

    h('section', { className: css.section, 'aria-labelledby': 'automatic-check-title' },
      h('div', { className: css.sectionHeading },
        h('div', null,
          h('h3', { id: 'automatic-check-title' }, t('automaticChecks')),
          h('p', null, t('automaticChecksDetail'))),
        h('label', { className: css.toggle },
          h('input', { type: 'checkbox', checked: automaticCheck.enabled, disabled: acting, onChange: event => { void saveAutomaticCheck({ enabled: event.target.checked }) } }),
          h('span', { 'aria-hidden': 'true' }),
          h('b', null, automaticCheck.enabled ? t('enabled') : t('disabled')))),
      h('div', { className: css.settingRows },
        h('label', { className: css.settingRow },
          h('span', null, t('checkInterval')),
          h('select', { value: automaticCheck.intervalSeconds, disabled: acting || !automaticCheck.enabled, onChange: event => { void saveAutomaticCheck({ intervalSeconds: Number(event.target.value) }) } },
            [3_600, 10_800, 21_600, 43_200, 86_400].map(seconds => h('option', { key: seconds, value: seconds }, t(`interval${String(seconds)}`))))),
        h('label', { className: css.settingRow },
          h('span', null,
            h('b', null, t('updateNotifications')),
            h('small', null, t('updateNotificationsDetail'))),
          h('input', { type: 'checkbox', checked: automaticCheck.notificationsEnabled, disabled: acting, onChange: event => { void saveAutomaticCheck({ notificationsEnabled: event.target.checked }) } })))),

    h('section', { className: `${css.section} ${css.maintenanceSection}`, 'aria-labelledby': 'platform-maintenance-title' },
      h('div', { className: css.sectionHeading },
        h('div', null,
          h('h3', { id: 'platform-maintenance-title' }, t('maintenance')),
          h('p', null, t('maintenanceDetail'))),
        h('button', {
          type: 'button',
          className: `${css.secondaryButton} ${css.maintenanceButton}`,
          disabled: busy,
          onClick: () => setConfirmRestart(true),
        }, restartBusy ? t('restarting') : t('restartDsh'))),
      restart.status === 'failed'
        ? h('p', { className: css.error, role: 'alert' }, `${t('restartFailed')}: ${localizedError(restart.error, t)}`)
        : restartBusy
          ? h('p', { className: css.maintenanceStatus, 'aria-live': 'polite' }, t('restarting'))
          : null,
      confirmRestart ? h('div', { className: `${css.confirmation} ${css.restartConfirmation}`, role: 'alertdialog', 'aria-labelledby': 'restart-dsh-title' },
        h('h4', { id: 'restart-dsh-title' }, t('restartTitle')),
        h('p', null, t('restartWarning')),
        h('div', { className: css.confirmActions },
          h('button', { type: 'button', className: css.secondaryButton, onClick: () => setConfirmRestart(false) }, t('cancel')),
          h('button', { type: 'button', className: css.primaryButton, disabled: busy, onClick: () => { void restartDsh() } }, t('confirmRestart')))) : null))
}

function apply(ctx) {
  const syncLocaleCookie = snapshot => { persistLocale(snapshot.active) }
  syncLocaleCookie(ctx.locale.getLocale())
  ctx.on('locale/change', syncLocaleCookie)
  ctx.effect(() => ctx.locale.register('settings.dshPlatformManagement', {
    zh: {
      localeCode: 'zh',
      nav: '平台管理', title: '平台管理', intro: 'DSH Docker 运行、更新与恢复',
      channel: '更新通道', channelDetail: '实验通道仅更新 DSH，平台环境仍使用正式支持版本。',
      stable: '稳定', experimental: '实验', current: '当前版本', supported: '正式支持版本', upstream: '上游版本', officialNpm: 'npm 官方源',
      actions: '更新操作', lastChecked: '上次检查', notChecked: '尚未检查', check: '检查更新', checking: '检查中', updateSupported: '更新到最新支持版本', updateUpstream: '更新到最新上游版本', rollback: '回滚到上一版本', returnStable: '立即返回稳定通道', retry: '重试', progress: '更新进度',
      statusIdle: '等待操作', statusChecking: '正在检查更新', statusPlanning: '正在准备更新', statusCheckingUpstream: '正在检查上游版本', statusDownloading: '正在下载', statusValidating: '正在验证', statusBuildingCandidate: '正在构建候选版本', statusSnapshottingData: '正在备份数据', statusSwitching: '正在切换版本', statusProbation: '正在观察运行状态', statusRestoringData: '正在恢复数据', statusSuccess: '操作完成', statusFailed: '操作失败', statusUnknown: '正在处理',
      outcomeNone: '当前已是最新版本', outcomeFrozen: '等待正式支持版本追上当前版本', outcomeHeld: '此版本已暂停更新', outcomeBlocked: '当前版本组合不可用', outcomeStable: '已切换到稳定版本', outcomeExperimental: '已切换到实验版本',
      requestError: '请求失败', operationError: '操作失败，请查看容器日志。', holdVersion: '此版本更新失败，已暂停自动重试。', holdCombination: '此版本与正式环境组合不可用，已暂停自动重试。',
      metadataUnavailable: '正式更新信息暂未发布，请稍后再试。',
      aheadOfStable: '当前版本领先正式支持版本，已暂停完整运行组合更新。', experimentalBlocked: '实验 DSH 与正式环境组合不可用。',
      returnStableTitle: '恢复稳定状态', returnStableWarning: '将恢复以下时间的数据快照，此后产生的数据会丢失：', confirmDataLoss: '我了解并确认丢弃更新后的数据', cancel: '取消', confirm: '确认恢复',
      maintenance: '运行维护', maintenanceDetail: '仅重新启动 DSH，容器和平台管理服务保持运行。', restartDsh: '重新启动 DSH', restarting: '正在重新启动 DSH', restartFailed: 'DSH 重启失败', restartTitle: '确认重新启动 DSH', restartWarning: '当前 DSH 连接会暂时中断，重启完成后页面将自动刷新。', confirmRestart: '确认重启',
      automaticChecks: '自动检查', automaticChecksDetail: '仅检查可用版本，不会自动下载或更新。', enabled: '已开启', disabled: '已关闭', checkInterval: '检查频率', updateNotifications: '网页更新提醒', updateNotificationsDetail: '仅自动检查发现新版本时提醒。',
      interval3600: '每 1 小时', interval10800: '每 3 小时', interval21600: '每 6 小时', interval43200: '每 12 小时', interval86400: '每 24 小时',
      stableNoticeTitle: '正式版本可更新', stableNoticeBody: '最新支持版本 {version} 已可用。', upstreamNoticeTitle: '上游版本可更新', upstreamNoticeBody: 'DSH 官方版本 {version} 已可用。', later: '稍后提醒', dismissVersion: '不再提醒此版本',
      online: '已连接', connecting: '正在重连', offline: '连接中断',
    },
    en: {
      localeCode: 'en',
      nav: 'Platform Management', title: 'Platform Management', intro: 'DSH Docker runtime, updates, and recovery',
      channel: 'Update channel', channelDetail: 'Experimental updates DSH only; the platform Environment remains on the supported release.',
      stable: 'Stable', experimental: 'Experimental', current: 'Current', supported: 'Supported', upstream: 'Upstream', officialNpm: 'Official npm',
      actions: 'Update actions', lastChecked: 'Last checked', notChecked: 'Not checked yet', check: 'Check for updates', checking: 'Checking', updateSupported: 'Update to latest supported', updateUpstream: 'Update to latest upstream', rollback: 'Roll back previous', returnStable: 'Return to Stable now', retry: 'Retry', progress: 'Update progress',
      statusIdle: 'Ready', statusChecking: 'Checking for updates', statusPlanning: 'Preparing update', statusCheckingUpstream: 'Checking upstream', statusDownloading: 'Downloading', statusValidating: 'Verifying', statusBuildingCandidate: 'Building candidate', statusSnapshottingData: 'Backing up data', statusSwitching: 'Switching version', statusProbation: 'Observing runtime health', statusRestoringData: 'Restoring data', statusSuccess: 'Completed', statusFailed: 'Failed', statusUnknown: 'Working',
      outcomeNone: 'Already up to date', outcomeFrozen: 'Waiting for the supported release to catch up', outcomeHeld: 'This version is on hold', outcomeBlocked: 'This version combination is unavailable', outcomeStable: 'Switched to the Stable release', outcomeExperimental: 'Switched to the Experimental release',
      requestError: 'Request failed', operationError: 'The operation failed. Check the container logs.', holdVersion: 'This version failed and automatic retries are on hold.', holdCombination: 'This version is incompatible with the production Environment and automatic retries are on hold.',
      metadataUnavailable: 'Signed update metadata has not been published yet. Try again later.',
      aheadOfStable: 'The current version is ahead of Latest Supported; the complete deployment is frozen.', experimentalBlocked: 'The Experimental DSH and production Environment combination is unavailable.',
      returnStableTitle: 'Restore Stable state', returnStableWarning: 'The following data snapshot will be restored and newer data will be lost:', confirmDataLoss: 'I understand and confirm the loss of newer data', cancel: 'Cancel', confirm: 'Restore',
      maintenance: 'Runtime maintenance', maintenanceDetail: 'Restart DSH only. The container and platform management services remain running.', restartDsh: 'Restart DSH', restarting: 'Restarting DSH', restartFailed: 'DSH restart failed', restartTitle: 'Restart DSH?', restartWarning: 'The current DSH connection will be interrupted briefly. This page reloads when DSH is ready.', confirmRestart: 'Restart',
      automaticChecks: 'Automatic checks', automaticChecksDetail: 'Checks for available versions without downloading or updating.', enabled: 'On', disabled: 'Off', checkInterval: 'Check frequency', updateNotifications: 'Web update notifications', updateNotificationsDetail: 'Shown only when an automatic check finds a new version.',
      interval3600: 'Every hour', interval10800: 'Every 3 hours', interval21600: 'Every 6 hours', interval43200: 'Every 12 hours', interval86400: 'Every 24 hours',
      stableNoticeTitle: 'Supported update available', stableNoticeBody: 'Supported version {version} is now available.', upstreamNoticeTitle: 'Upstream update available', upstreamNoticeBody: 'Official DSH version {version} is now available.', later: 'Remind me later', dismissVersion: 'Do not remind for this version',
      online: 'Connected', connecting: 'Reconnecting', offline: 'Disconnected',
    },
  }), 'dsh-platform-management: locale')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'dsh-platform-management',
    order: 90,
    label: () => ctx.locale.bind('settings.dshPlatformManagement')('nav'),
    locale: 'settings.dshPlatformManagement',
  }, PlatformManagement))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-platform-management-reminder',
    order: 90,
    locale: 'settings.dshPlatformManagement',
  }, UpdateReminder))
}
exports.inject = inject;
exports.apply = apply;
return module.exports; } });
