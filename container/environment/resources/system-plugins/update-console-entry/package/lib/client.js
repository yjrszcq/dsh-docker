import React, { useCallback, useEffect, useRef, useState } from 'react'
import css from './style.module.css'

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

export const inject = ['slots', 'locale']

function display(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value)
}

function localTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString()
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

function UpdateConsoleEntry({ t }) {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [connection, setConnection] = useState('connecting')
  const [acting, setActing] = useState(false)
  const [confirmStable, setConfirmStable] = useState(false)
  const [dataLossAccepted, setDataLossAccepted] = useState(false)
  const loading = useRef(false)

  const refresh = useCallback(async () => {
    if (loading.current) return
    loading.current = true
    try {
      setStatus(await request('status'))
      setError('')
      setConnection('online')
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

  useEffect(() => {
    void refresh()
    const stateEvents = new EventSource(`${API}/events`)
    stateEvents.addEventListener('state', () => { void refresh() })
    stateEvents.onopen = () => setConnection('online')
    stateEvents.onerror = () => setConnection('connecting')

    const timer = window.setInterval(() => { void refresh() }, 15_000)
    return () => {
      window.clearInterval(timer)
      stateEvents.close()
    }
  }, [refresh])

  const update = status?.update ?? {}
  const rollbackPlan = status?.rollbackPlan
  const busy = acting || !TERMINAL.has(update.status ?? 'idle')
  const updateActive = !TERMINAL.has(update.status ?? 'idle')
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
      h('div', null,
        h('h2', { className: css.title }, t('title')),
        h('p', { className: css.intro }, t('intro'))),
      h('span', { className: `${css.connection} ${css[connection]}`, role: 'status' },
        h('span', { 'aria-hidden': 'true' }),
        t(connection))),

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
            onClick: () => { void act('channel', { method: 'PUT', body: { channel } }) },
          }, channel === 'stable' ? 'Stable' : 'Experimental')))),
      h('div', { className: `${css.versions} ${status?.updateChannel === 'experimental' ? css.experimentalVersions : ''}` },
        h(VersionCell, { label: t('current'), version: status?.current?.dsh, detail: status?.current?.environment }),
        h(VersionCell, { label: t('supported'), version: status?.supported?.dsh, detail: status?.supported?.environment }),
        status?.updateChannel === 'experimental'
          ? h(VersionCell, { label: t('upstream'), version: status?.upstream?.version, detail: t('officialNpm') })
          : null),
      notices.length > 0 ? h('p', { className: css.notice }, notices.join(' ')) : null,
      error ? h('p', { className: css.error, role: 'alert' }, error) : null),

    h('section', { className: css.section, 'aria-labelledby': 'platform-actions-title' },
      h('div', { className: `${css.sectionHeading} ${css.actionHeading}` },
        h('div', null,
          h('h3', { id: 'platform-actions-title' }, t('actions')),
          h('p', null, update.checkedAt ? `${t('lastChecked')} ${localTime(update.checkedAt)}` : t('notChecked'))),
        h('div', { className: css.actions },
          h('button', { type: 'button', className: css.secondaryButton, disabled: busy, onClick: () => { void act('check', { method: 'POST' }) } }, t('check')),
          h('button', { type: 'button', className: css.primaryButton, disabled: busy, onClick: () => { void act('update', { method: 'POST' }) } }, status?.updateChannel === 'experimental' ? t('updateUpstream') : t('updateSupported')),
          rollbackPlan ? h('button', { type: 'button', className: css.secondaryButton, disabled: busy, onClick: () => { void act('rollback', { method: 'POST', body: { planId: rollbackPlan.planId } }) } }, t('rollback')) : null,
          rollbackPlan?.returnStableAvailable ? h('button', { type: 'button', className: css.dangerButton, disabled: busy, onClick: () => setConfirmStable(true) }, t('returnStable')) : null)),
      h('div', { className: css.updateState, 'aria-live': 'polite' },
        h('div', { className: css.statusLine },
          h('span', { className: `${css.statusLabel} ${updateStatusClass}` },
            h('span', { className: css.statusDot, 'aria-hidden': 'true' }),
            t(updateStatus)),
          updateActive ? h('output', null, `${String(progress)}%`) : null),
        update.error || update.outcome ? h('p', null, display(update.error ?? update.outcome)) : null,
        updateActive ? h('div', { className: css.progress, role: 'progressbar', 'aria-label': t('progress'), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': progress },
          h('span', { style: { width: `${String(progress)}%` } })) : null),
      holds.length > 0 ? h('div', { className: css.holds },
        holds.map(hold => h('div', { className: css.hold, key: hold.id },
          h('div', null,
            h('strong', null, `${display(hold.dshVersion)}${hold.environmentVersion ? ` + ${hold.environmentVersion}` : ''}`),
            h('span', null, display(hold.reason))),
          h('button', { type: 'button', className: css.smallButton, disabled: busy, onClick: () => { void act('holds/retry', { method: 'POST', body: { id: hold.id } }) } }, t('retry'))))) : null,
      confirmStable ? h('div', { className: css.confirmation, role: 'alertdialog', 'aria-labelledby': 'return-stable-title' },
        h('h4', { id: 'return-stable-title' }, t('returnStableTitle')),
        h('p', null, `${t('returnStableWarning')} ${localTime(rollbackPlan?.snapshot?.createdAt)}`),
        h('label', null,
          h('input', { type: 'checkbox', checked: dataLossAccepted, onChange: event => setDataLossAccepted(event.target.checked) }),
          h('span', null, t('confirmDataLoss'))),
        h('div', { className: css.confirmActions },
          h('button', { type: 'button', className: css.secondaryButton, onClick: () => { setConfirmStable(false); setDataLossAccepted(false) } }, t('cancel')),
          h('button', { type: 'button', className: css.dangerFilledButton, disabled: !dataLossAccepted || busy, onClick: () => { void returnStable() } }, t('confirm')))) : null))
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register('settings.dshPlatformUpdate', {
    zh: {
      nav: '平台更新', title: '平台更新', intro: 'DSH Docker 运行与更新状态',
      channel: '更新通道', channelDetail: '正式环境保持不变，实验通道仅跟进上游 DSH。',
      stable: 'Stable', experimental: 'Experimental', current: '当前版本', supported: '正式支持', upstream: '上游版本', officialNpm: '官方 npm',
      actions: '更新操作', lastChecked: '上次检查', notChecked: '尚未检查', check: '检查更新', updateSupported: '更新到最新支持版本', updateUpstream: '更新到最新上游版本', rollback: '回滚 previous', returnStable: '立即回 Stable', retry: '重试', progress: '更新进度',
      statusIdle: '等待操作', statusChecking: '正在检查更新', statusPlanning: '正在准备更新', statusCheckingUpstream: '正在检查上游版本', statusDownloading: '正在下载', statusValidating: '正在验证', statusBuildingCandidate: '正在构建候选版本', statusSnapshottingData: '正在备份数据', statusSwitching: '正在切换版本', statusProbation: '正在观察运行状态', statusRestoringData: '正在恢复数据', statusSuccess: '操作完成', statusFailed: '操作失败', statusUnknown: '正在处理',
      aheadOfStable: '当前版本领先正式支持版本，已冻结完整运行组合。', experimentalBlocked: '实验 DSH 与正式 Environment 组合不可用。',
      returnStableTitle: '恢复 Stable 状态', returnStableWarning: '将恢复以下时间的数据快照，此后产生的数据会丢失：', confirmDataLoss: '我了解并确认丢弃更新后的数据', cancel: '取消', confirm: '确认恢复',
      online: '已连接', connecting: '正在重连', offline: '连接中断',
    },
    en: {
      nav: 'Platform Update', title: 'Platform Update', intro: 'DSH Docker runtime and update status',
      channel: 'Update channel', channelDetail: 'The production Environment stays fixed; Experimental follows upstream DSH only.',
      stable: 'Stable', experimental: 'Experimental', current: 'Current', supported: 'Supported', upstream: 'Upstream', officialNpm: 'Official npm',
      actions: 'Update actions', lastChecked: 'Last checked', notChecked: 'Not checked yet', check: 'Check for updates', updateSupported: 'Update to latest supported', updateUpstream: 'Update to latest upstream', rollback: 'Roll back previous', returnStable: 'Return to Stable now', retry: 'Retry', progress: 'Update progress',
      statusIdle: 'Ready', statusChecking: 'Checking for updates', statusPlanning: 'Preparing update', statusCheckingUpstream: 'Checking upstream', statusDownloading: 'Downloading', statusValidating: 'Verifying', statusBuildingCandidate: 'Building candidate', statusSnapshottingData: 'Backing up data', statusSwitching: 'Switching version', statusProbation: 'Observing runtime health', statusRestoringData: 'Restoring data', statusSuccess: 'Completed', statusFailed: 'Failed', statusUnknown: 'Working',
      aheadOfStable: 'The current version is ahead of Latest Supported; the complete deployment is frozen.', experimentalBlocked: 'The Experimental DSH and production Environment combination is unavailable.',
      returnStableTitle: 'Restore Stable state', returnStableWarning: 'The following data snapshot will be restored and newer data will be lost:', confirmDataLoss: 'I understand and confirm the loss of newer data', cancel: 'Cancel', confirm: 'Restore',
      online: 'Connected', connecting: 'Reconnecting', offline: 'Disconnected',
    },
  }), 'dsh-platform-update: locale')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'dsh-platform-update',
    order: 90,
    label: () => ctx.locale.bind('settings.dshPlatformUpdate')('nav'),
    locale: 'settings.dshPlatformUpdate',
  }, UpdateConsoleEntry))
}
