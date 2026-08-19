import React, { useCallback, useEffect, useState } from 'react'

export const inject = ['slots', 'locale']

const API = '/_dsh_platform/api/v1'

async function request(path, options) {
  const response = await fetch(`${API}/${path}`, options)
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`)
  return value
}

function valueOrDash(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value)
}

export function UpdateSection() {
  const [status, setStatus] = useState()
  const [logs, setLogs] = useState([])
  const [error, setError] = useState('')
  const busy = status?.update && !['idle', 'success', 'failed'].includes(status.update.status)
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
  const check = async () => { await request('check', { method: 'POST' }); await load() }
  const update = async () => { await request('update', { method: 'POST' }); await load() }
  const updateState = status?.update ?? {}
  return React.createElement('section', { className: 'dsh-platform-update' },
    React.createElement('div', { className: 'dsh-platform-update__toolbar' },
      React.createElement('button', { type: 'button', onClick: check, disabled: busy }, '检查更新'),
      React.createElement('button', { type: 'button', onClick: update, disabled: busy }, '更新到最新支持版本')),
    error && React.createElement('p', { role: 'alert' }, error),
    React.createElement('dl', null,
      React.createElement('dt', null, '当前版本'), React.createElement('dd', null, valueOrDash(status?.runtime?.dsh)),
      React.createElement('dt', null, '目标版本'), React.createElement('dd', null, valueOrDash(updateState.available?.dsh)),
      React.createElement('dt', null, '上次检查'), React.createElement('dd', null, valueOrDash(updateState.checkedAt)),
      React.createElement('dt', null, '状态'), React.createElement('dd', null, valueOrDash(updateState.status)),
      React.createElement('dt', null, '进度'), React.createElement('dd', null, `${valueOrDash(updateState.progress)}%`),
      React.createElement('dt', null, '结果'), React.createElement('dd', null, valueOrDash(updateState.error ?? updateState.status))),
    React.createElement('pre', { className: 'dsh-platform-update__logs' }, logs.map(entry =>
      `${entry.timestamp} ${entry.source} ${entry.message}`).join('\n')))
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
