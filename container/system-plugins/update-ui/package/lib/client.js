import React, { useCallback, useEffect, useState } from 'react'
import css from './style.module.css'

export const inject = ['slots', 'locale']

const API = '/_dsh_platform/api/v1'
const TERMINAL = new Set(['idle', 'success', 'failed'])

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API}/${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`)
  return value
}

function valueOrDash(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value)
}

function VersionRow({ label, version, detail }) {
  return React.createElement('div', { className: css.version },
    React.createElement('span', null, label),
    React.createElement('strong', null, valueOrDash(version)),
    detail && React.createElement('small', null, detail))
}

export function UpdateSection() {
  const [status, setStatus] = useState()
  const [logs, setLogs] = useState([])
  const [error, setError] = useState('')
  const [confirmStable, setConfirmStable] = useState(false)
  const busy = status?.update && !TERMINAL.has(status.update.status)
  const load = useCallback(async () => {
    try {
      const [nextStatus, nextLogs] = await Promise.all([
        request('status'),
        request('logs?source=audit&source=updater&limit=100'),
      ])
      setStatus(nextStatus)
      setLogs(nextLogs.entries)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Request failed')
    }
  }, [])
  useEffect(() => {
    void load()
    const events = new EventSource(`${API}/events`)
    events.addEventListener('state', load)
    events.onerror = () => { void load() }
    return () => events.close()
  }, [load])

  const act = async operation => {
    setError('')
    try { await operation(); await load() } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Request failed')
    }
  }
  const setChannel = channel => act(() => request('channel', { method: 'PUT', body: { channel } }))
  const rollbackPlan = status?.rollbackPlan
  const updateState = status?.update ?? {}
  const holds = [...(status?.holds ?? []), ...(status?.experimentalBlocked ? [status.experimentalBlocked] : [])]
  const uniqueHolds = [...new Map(holds.map(hold => [hold.id, hold])).values()]
  const updateLabel = status?.updateChannel === 'experimental' ? '更新到最新上游版本' : '更新到最新支持版本'

  return React.createElement('section', { className: css.root },
    React.createElement('header', { className: css.header },
      React.createElement('h2', null, '平台更新'),
      React.createElement('div', { className: css.channel, role: 'group', 'aria-label': '更新通道' },
        ['stable', 'experimental'].map(channel => React.createElement('button', {
          type: 'button', key: channel, disabled: busy,
          'aria-pressed': status?.updateChannel === channel,
          onClick: () => setChannel(channel),
        }, channel === 'stable' ? 'Stable' : 'Experimental')))),
    error && React.createElement('p', { className: css.error, role: 'alert' }, error),
    React.createElement('div', { className: css.versions },
      React.createElement(VersionRow, { label: 'Current', version: status?.current?.dsh, detail: status?.current?.environment }),
      React.createElement(VersionRow, { label: 'Latest Supported', version: status?.supported?.dsh, detail: status?.supported?.environment }),
      React.createElement(VersionRow, { label: 'Latest Upstream', version: status?.upstream?.version })),
    status?.aheadOfStable && React.createElement('p', { className: css.notice }, '当前版本领先 Latest Supported，已冻结 Runtime 与 Environment 组合。'),
    status?.experimentalBlocked && React.createElement('p', { className: css.error }, '当前 Experimental DSH 与正式 Environment 组合不可用。'),
    React.createElement('div', { className: css.toolbar },
      React.createElement('button', { type: 'button', onClick: () => act(() => request('check', { method: 'POST' })), disabled: busy }, '检查更新'),
      React.createElement('button', { type: 'button', className: css.primary, onClick: () => act(() => request('update', { method: 'POST' })), disabled: busy }, updateLabel),
      rollbackPlan && React.createElement('button', {
        type: 'button', disabled: busy,
        onClick: () => act(() => request('rollback', { method: 'POST', body: { planId: rollbackPlan.planId } })),
      }, '回滚 previous'),
      rollbackPlan?.returnStableAvailable && React.createElement('button', {
        type: 'button', className: css.danger, disabled: busy, onClick: () => setConfirmStable(true),
      }, '立即回 Stable')),
    uniqueHolds.length > 0 && React.createElement('div', { className: css.holds },
      uniqueHolds.map(hold => React.createElement('div', { key: hold.id },
        React.createElement('span', null, `${hold.dshVersion}${hold.environmentVersion ? ` + ${hold.environmentVersion}` : ''}`),
        React.createElement('small', null, hold.reason),
        React.createElement('button', {
          type: 'button', disabled: busy,
          onClick: () => act(() => request('holds/retry', { method: 'POST', body: { id: hold.id } })),
        }, '重试')))),
    React.createElement('dl', { className: css.state },
      React.createElement('dt', null, '上次检查'), React.createElement('dd', null, valueOrDash(updateState.checkedAt)),
      React.createElement('dt', null, '状态'), React.createElement('dd', null, valueOrDash(updateState.status)),
      React.createElement('dt', null, '进度'), React.createElement('dd', null, `${valueOrDash(updateState.progress)}%`),
      React.createElement('dt', null, '观察期'), React.createElement('dd', null, valueOrDash(status?.probation?.until)),
      React.createElement('dt', null, '结果'), React.createElement('dd', null, valueOrDash(updateState.error ?? updateState.outcome ?? updateState.status))),
    React.createElement('pre', { className: css.logs, 'aria-label': '更新日志' }, logs.map(entry =>
      `${entry.timestamp} ${entry.source} ${entry.message}`).join('\n')),
    confirmStable && React.createElement('div', { className: css.backdrop },
      React.createElement('div', { className: css.dialog, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dsh-return-stable-title' },
        React.createElement('h3', { id: 'dsh-return-stable-title' }, '恢复 Stable 状态'),
        React.createElement('p', null, `将恢复 ${valueOrDash(rollbackPlan?.snapshot?.createdAt)} 的数据快照，之后产生的数据会丢失。`),
        React.createElement('div', null,
          React.createElement('button', { type: 'button', onClick: () => setConfirmStable(false) }, '取消'),
          React.createElement('button', {
            type: 'button', className: css.danger, onClick: () => {
              setConfirmStable(false)
              void act(() => request('return-stable', {
                method: 'POST', body: { planId: rollbackPlan.planId, confirmDataLoss: true },
              }))
            },
          }, '确认恢复并丢弃新数据')))))
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register('settings.dshPlatformUpdate', {
    zh: { nav: '平台更新' },
    en: { nav: 'Platform Update' },
  }), 'dsh-platform-update: locale')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'dsh-platform-update',
    order: 90,
    label: () => ctx.locale.bind('settings.dshPlatformUpdate')('nav'),
    locale: 'settings.dshPlatformUpdate',
  }, UpdateSection))
}
