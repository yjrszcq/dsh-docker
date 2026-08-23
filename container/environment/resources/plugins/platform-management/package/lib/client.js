import React, { useCallback, useEffect, useRef, useState } from 'react'
import css from './style.module.css'

const API = '/_dsh_platform/plugin-api/v1'
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
const PLUGIN_DRAFT_KEY = 'dsh-platform:system-plugin-draft'
const LOG_CLEAR_CUTOFF_KEY = 'dsh-platform:log-clear-cutoff'
const LOG_DISPLAY_LIMIT_KEY = 'dsh-platform:log-display-limit'
const LOG_DISPLAY_LIMITS = Object.freeze([100, 250, 500, 1_000])
const DEFAULT_LOG_DISPLAY_LIMIT = 500
const LOG_STREAM_LIMIT = 5_000
const LIST_PAGE_SIZES = Object.freeze([5, 10, 20, 50])
const LIST_PAGE_SIZE_KEY_PREFIX = 'dsh-platform:plugin-page-size:'

export const inject = ['slots', 'locale', 'connection']

const LIFECYCLE_WAIT_PATH = '/_dsh_gateway/wait'
const LIFECYCLE_READINESS_PATH = '/_dsh_gateway/readiness'
const CONNECTION_LOSS_GRACE_MS = 1_000
const READINESS_RETRY_MS = 500

function requiresLifecycleHoldingPage(status) {
  if (['restarting', 'switching', 'recovering', 'restart-failed'].includes(status?.operation)) return true
  if (['snapshotting-data', 'switching', 'probation', 'restoring-data'].includes(status?.update?.status)) return true
  return ['starting', 'stopping', 'stopped', 'restarting', 'recovering', 'failed']
    .includes(status?.dshLifecycle?.state)
}

function lifecycleReturnPath(locationValue = window.location) {
  return `${locationValue.pathname}${locationValue.search}${locationValue.hash}`
}

function lifecycleWaitUrl(locationValue = window.location) {
  return `${LIFECYCLE_WAIT_PATH}?return=${encodeURIComponent(lifecycleReturnPath(locationValue))}`
}

function display(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value)
}

function displayEnvironment(value) {
  return value === undefined || value === null || value === '' ? '-' : `env-${String(value)}`
}

function makeHorizontalTabStripScrollable(tablist) {
  let pointerId
  let pointerStartX = 0
  let scrollStart = 0
  let dragged = false
  let dragTarget
  let suppressClickTarget

  const finishDrag = event => {
    if (pointerId === undefined || (event.pointerId !== undefined && event.pointerId !== pointerId)) return
    if (tablist.hasPointerCapture?.(pointerId)) tablist.releasePointerCapture(pointerId)
    suppressClickTarget = dragged ? dragTarget : undefined
    if (suppressClickTarget !== undefined) window.setTimeout(() => { suppressClickTarget = undefined }, 0)
    pointerId = undefined
    dragged = false
    dragTarget = undefined
  }
  const wheel = event => {
    if (tablist.scrollWidth <= tablist.clientWidth) return
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (delta === 0) return
    tablist.scrollLeft += delta
    event.preventDefault()
  }
  const pointerDown = event => {
    if (event.button !== 0 || event.pointerType === 'touch' || tablist.scrollWidth <= tablist.clientWidth) return
    pointerId = event.pointerId
    pointerStartX = event.clientX
    scrollStart = tablist.scrollLeft
    dragged = false
    dragTarget = event.target
    tablist.setPointerCapture?.(pointerId)
  }
  const pointerMove = event => {
    if (event.pointerId !== pointerId) return
    const distance = event.clientX - pointerStartX
    if (Math.abs(distance) >= 4) dragged = true
    if (!dragged) return
    tablist.scrollLeft = scrollStart - distance
    event.preventDefault()
  }
  const click = event => {
    if (event.target !== suppressClickTarget) return
    suppressClickTarget = undefined
    event.preventDefault()
    event.stopPropagation()
  }

  tablist.addEventListener('wheel', wheel, { passive: false })
  tablist.addEventListener('pointerdown', pointerDown)
  tablist.addEventListener('pointermove', pointerMove)
  tablist.addEventListener('pointerup', finishDrag)
  tablist.addEventListener('pointercancel', finishDrag)
  tablist.addEventListener('click', click, true)
  return () => {
    tablist.removeEventListener('wheel', wheel)
    tablist.removeEventListener('pointerdown', pointerDown)
    tablist.removeEventListener('pointermove', pointerMove)
    tablist.removeEventListener('pointerup', finishDrag)
    tablist.removeEventListener('pointercancel', finishDrag)
    tablist.removeEventListener('click', click, true)
  }
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

function usePaginatedItems(key, items) {
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(() => {
    const value = Number(storageValue(`${LIST_PAGE_SIZE_KEY_PREFIX}${key}`))
    return LIST_PAGE_SIZES.includes(value) ? value : 10
  })
  const lastPage = Math.max(0, Math.ceil(items.length / pageSize) - 1)
  const currentPage = Math.min(page, lastPage)
  useEffect(() => { if (page !== currentPage) setPage(currentPage) }, [currentPage, page])
  const start = currentPage * pageSize
  const changePageSize = value => {
    if (!LIST_PAGE_SIZES.includes(value)) return
    setPageSize(value)
    setPage(0)
    writeStorage(`${LIST_PAGE_SIZE_KEY_PREFIX}${key}`, String(value))
  }
  const goToPage = value => setPage(Math.min(lastPage, Math.max(0, value)))
  return {
    items: items.slice(start, start + pageSize), page: currentPage, pageSize, lastPage, start,
    setPage: goToPage, setPageSize: changePageSize,
  }
}

function ListPagination({ pagination, total, t }) {
  const [jumpValue, setJumpValue] = useState(String(pagination.page + 1))
  useEffect(() => { setJumpValue(String(pagination.page + 1)) }, [pagination.page])
  const commitJump = () => {
    const value = Number(jumpValue)
    const page = Number.isSafeInteger(value)
      ? Math.min(pagination.lastPage, Math.max(0, value - 1))
      : pagination.page
    pagination.setPage(page)
    setJumpValue(String(page + 1))
  }
  return h('div', { className: css.listPagination },
    h('span', null, t('totalItems').replace('{total}', String(total))),
    h('label', null,
      h('select', {
        'aria-label': t('itemsPerPage'),
        value: pagination.pageSize,
        onChange: event => pagination.setPageSize(Number(event.target.value)),
      }, LIST_PAGE_SIZES.map(value => h('option', { key: value, value }, String(value)))),
      h('span', null, t('itemsPerPageSuffix'))),
    h('div', { className: css.pageNavigation },
      h('button', { type: 'button', className: `${css.smallButton} ${css.pageArrow}`, 'aria-label': t('previousPage'), disabled: pagination.page === 0, onClick: () => pagination.setPage(pagination.page - 1) }),
      h('strong', null, String(pagination.page + 1)),
      h('button', { type: 'button', className: `${css.smallButton} ${css.pageArrow}`, 'aria-label': t('nextPage'), disabled: pagination.page === pagination.lastPage, onClick: () => pagination.setPage(pagination.page + 1) })),
    h('label', { className: css.pageJump },
      h('span', null, t('goToPage')),
      h('input', {
        type: 'number', min: 1, max: pagination.lastPage + 1, value: jumpValue,
        onChange: event => setJumpValue(event.target.value), onBlur: commitJump,
        onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); commitJump() } },
      }),
      h('span', null, t('pageUnit'))))
}

function ExpandableDescription({ text, identity }) {
  const element = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [expandable, setExpandable] = useState(false)
  useEffect(() => {
    const node = element.current
    if (node !== null && !expanded) setExpandable(node.scrollWidth > node.clientWidth)
  }, [expanded, identity, text])
  return h('button', {
    ref: element,
    type: 'button',
    className: `${css.resourceDescription}${expandable ? ` ${css.expandable}` : ''}${expanded ? ` ${css.expanded}` : ''}`,
    title: text,
    'aria-expanded': expanded,
    onClick: () => { if (expandable) setExpanded(value => !value) },
  }, text)
}

function matchesResourceSearch(query, values) {
  const normalized = query.trim().toLocaleLowerCase()
  return normalized === '' || values.some(value => String(value ?? '').toLocaleLowerCase().includes(normalized))
}

function ResourceStatusBadge({ label, enabled = false, pending = false }) {
  return h('span', {
    className: `${css.statusBadge}${enabled ? ` ${css.statusEnabled}` : ''}${pending ? ` ${css.statusPending}` : ''}`,
    'aria-live': pending ? 'polite' : undefined,
  }, label)
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
  if (!response.ok) {
    const error = new Error(value.error ?? `HTTP ${String(response.status)}`)
    error.statusCode = response.status
    throw error
  }
  return value
}

function VersionCell({ label, version, detail }) {
  return h('div', { className: css.versionCell },
    h('span', { className: css.caption }, label),
    h('strong', { className: css.version }, display(version)),
    h('span', { className: css.detail }, display(detail)))
}

function logLevel(entry) {
  if (entry?.stream === 'stderr') {
    const message = String(entry?.message ?? '').trim()
    if (/^(?:\s*at\s+|.*\b(?:error|fatal|failed|failure|exception|panic|unhandled)\b)|错误|失败|异常|致命/iu.test(message)) return 'error'
    if (/\b(?:warn|warning|deprecated|deprecation)\b|警告|已弃用/iu.test(message)) return 'warning'
    return 'info'
  }
  if (['debug', 'info', 'warning', 'error'].includes(entry?.level)) return entry.level
  return /^\s*(warn(?:ing)?)[\s:]/i.test(entry?.message ?? '') ? 'warning' : 'info'
}

function isJsonFragment(message) {
  const value = message.trim()
  return /^(?:[{}\[\]],?|"(?:[^"\\]|\\.)+"\s*:\s*.*)$/.test(value)
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
      if (
        next.value.source !== first.value.source
        || next.value.stream !== first.value.stream
        || logLevel(next.value) !== logLevel(first.value)
        || Date.parse(next.value.timestamp) - startedAt > 2_000
      ) break
      lines.push(next.value.message)
      try {
        const value = JSON.parse(lines.join('\n'))
        compacted.push({
          identity: entries.slice(index, end + 1).map(item => item.identity).join('|'),
          value: { ...first.value, message: JSON.stringify(value) },
        })
        index = end
        merged = true
        break
      } catch {}
    }
    if (!merged && !isJsonFragment(first.value.message)) compacted.push(first)
  }
  return compacted
}

function readLogDisplayLimit() {
  try {
    const value = Number(window.localStorage.getItem(LOG_DISPLAY_LIMIT_KEY))
    return LOG_DISPLAY_LIMITS.includes(value) ? value : DEFAULT_LOG_DISPLAY_LIMIT
  } catch { return DEFAULT_LOG_DISPLAY_LIMIT }
}

function limitProcessedLogEntries(entries, limit) {
  return compactLogEntries(entries).slice(-limit)
}

function readLogClearCutoff() {
  try {
    const value = window.sessionStorage.getItem(LOG_CLEAR_CUTOFF_KEY)
    return Number.isFinite(Date.parse(value)) ? value : null
  } catch { return null }
}

function latestLogCutoff(entries, now = Date.now()) {
  const latest = entries.reduce((value, entry) => {
    const timestamp = Date.parse(entry.value.timestamp)
    return Number.isFinite(timestamp) ? Math.max(value, timestamp) : value
  }, now)
  return new Date(latest).toISOString()
}

function isClearedLog(entry, cutoff) {
  const timestamp = Date.parse(entry.timestamp)
  return cutoff !== null && Number.isFinite(timestamp) && timestamp <= Date.parse(cutoff)
}

function downloadLogJsonl(entries) {
  if (entries.length === 0) return
  const content = `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`
  const url = URL.createObjectURL(new Blob([content], { type: 'application/x-ndjson;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `dsh-platform-logs-${new Date().toISOString().replace(/[:.]/gu, '-')}.jsonl`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function LogViewer({ active, t }) {
  const [entries, setEntries] = useState([])
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('all')
  const [level, setLevel] = useState('all')
  const [streamState, setStreamState] = useState('connecting')
  const [streamRevision, setStreamRevision] = useState(0)
  const [autoScroll, setAutoScroll] = useState(true)
  const [displayLimit, setDisplayLimit] = useState(readLogDisplayLimit)
  const [expanded, setExpanded] = useState(() => new Set())
  const listRef = useRef(null)
  const clearCutoff = useRef(readLogClearCutoff())
  const logIdentities = useRef(new Set())
  const pendingEntries = useRef([])
  const renderFrame = useRef()

  useEffect(() => {
    if (!active) return undefined
    setStreamState('connecting')
    const stream = new EventSource(`${API}/logs/stream?limit=${String(LOG_STREAM_LIMIT)}`)
    let lastActivity = Date.now()
    const commitPendingEntries = () => {
      renderFrame.current = undefined
      const pending = pendingEntries.current.splice(0)
      if (pending.length === 0) return
      setEntries(previous => {
        const combined = [...previous, ...pending]
        const removed = combined.slice(0, Math.max(0, combined.length - LOG_STREAM_LIMIT))
        for (const entry of removed) logIdentities.current.delete(entry.identity)
        return combined.slice(-LOG_STREAM_LIMIT)
      })
    }
    stream.addEventListener('log', event => {
      lastActivity = Date.now()
      try {
        const entry = JSON.parse(event.data)
        const identity = JSON.stringify(entry)
        if (isClearedLog(entry, clearCutoff.current) || logIdentities.current.has(identity)) return
        logIdentities.current.add(identity)
        pendingEntries.current.push({ identity, value: entry })
        if (renderFrame.current === undefined) {
          renderFrame.current = window.requestAnimationFrame(commitPendingEntries)
        }
      } catch {}
    })
    stream.addEventListener('heartbeat', () => { lastActivity = Date.now() })
    stream.onopen = () => {
      lastActivity = Date.now()
      setStreamState('live')
    }
    stream.onerror = () => setStreamState('disconnected')
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastActivity > 35_000) setStreamRevision(value => value + 1)
    }, 5_000)
    return () => {
      window.clearInterval(watchdog)
      stream.close()
      if (renderFrame.current !== undefined) window.cancelAnimationFrame(renderFrame.current)
      for (const entry of pendingEntries.current.splice(0)) logIdentities.current.delete(entry.identity)
      renderFrame.current = undefined
    }
  }, [active, streamRevision])

  const visibleEntries = limitProcessedLogEntries(entries, displayLimit)
  const sources = [...new Set(visibleEntries.map(item => item.value.source).filter(Boolean))].sort()
  const normalizedQuery = query.trim().toLocaleLowerCase(t('localeCode') === 'en' ? 'en-US' : 'zh-CN')
  const filtered = visibleEntries.filter(item => {
    const entry = item.value
    return (source === 'all' || entry.source === source)
      && (level === 'all' || logLevel(entry) === level)
      && (normalizedQuery === '' || JSON.stringify(entry).toLocaleLowerCase().includes(normalizedQuery))
  })
  const exportEntries = entries.slice(-displayLimit).map(item => item.value).filter(entry => (source === 'all' || entry.source === source)
    && (level === 'all' || logLevel(entry) === level)
    && (normalizedQuery === '' || JSON.stringify(entry).toLocaleLowerCase().includes(normalizedQuery)))

  useEffect(() => {
    if (!active || !autoScroll || listRef.current === null) return undefined
    let layoutFrame
    const visibilityFrame = window.requestAnimationFrame(() => {
      layoutFrame = window.requestAnimationFrame(() => {
        if (listRef.current !== null) listRef.current.scrollTop = listRef.current.scrollHeight
      })
    })
    return () => {
      window.cancelAnimationFrame(visibilityFrame)
      if (layoutFrame !== undefined) window.cancelAnimationFrame(layoutFrame)
    }
  }, [active, autoScroll, displayLimit, entries, level, query, source])

  const clearLogView = () => {
    clearCutoff.current = latestLogCutoff([...entries, ...pendingEntries.current])
    try { window.sessionStorage.setItem(LOG_CLEAR_CUTOFF_KEY, clearCutoff.current) } catch {}
    if (renderFrame.current !== undefined) window.cancelAnimationFrame(renderFrame.current)
    renderFrame.current = undefined
    pendingEntries.current.length = 0
    logIdentities.current.clear()
    setExpanded(new Set())
    setEntries([])
  }

  const changeDisplayLimit = event => {
    const value = Number(event.target.value)
    if (!LOG_DISPLAY_LIMITS.includes(value)) return
    setDisplayLimit(value)
    try { window.localStorage.setItem(LOG_DISPLAY_LIMIT_KEY, String(value)) } catch {}
  }

  return h('section', { className: `${css.section} ${css.logSection}`, 'aria-labelledby': 'platform-logs-title' },
    h('div', { className: css.sectionHeading },
      h('div', null,
        h('h3', { id: 'platform-logs-title' }, t('logs')),
        h('p', null, t('logsDetail'))),
      h('div', { className: css.logTools },
        h('span', { className: `${css.logConnection} ${css[streamState]}`, role: 'status' },
          h('span', { 'aria-hidden': 'true' }),
          t(`logs${streamState[0].toUpperCase()}${streamState.slice(1)}`)),
        h('button', {
          type: 'button',
          className: css.autoScrollButton,
          onClick: () => setStreamRevision(value => value + 1),
        }, t('refreshLogs')),
        h('button', {
          type: 'button',
          className: css.clearLogsButton,
          disabled: exportEntries.length === 0,
          onClick: () => downloadLogJsonl(exportEntries),
        }, t('exportLogs')),
        h('button', {
          type: 'button',
          className: css.clearLogsButton,
          disabled: entries.length === 0,
          onClick: clearLogView,
        }, t('clearLogView')))),
    h('div', { className: css.logFilters },
      h('input', {
        type: 'search',
        value: query,
        placeholder: t('searchLogs'),
        'aria-label': t('searchLogs'),
        onChange: event => setQuery(event.target.value),
      }),
      h('select', { value: source, 'aria-label': t('logSource'), onChange: event => setSource(event.target.value) },
        h('option', { value: 'all' }, t('allSources')),
        sources.map(value => h('option', { key: value, value }, value))),
      h('select', { value: level, 'aria-label': t('logLevel'), onChange: event => setLevel(event.target.value) },
        ['all', 'debug', 'info', 'warning', 'error'].map(value => h('option', { key: value, value }, t(`level${value[0].toUpperCase()}${value.slice(1)}`)))),
      h('select', { value: displayLimit, 'aria-label': t('logDisplayLimit'), onChange: changeDisplayLimit },
        LOG_DISPLAY_LIMITS.map(value => h('option', { key: value, value }, t('logDisplayLimitValue').replace('{count}', String(value))))),
    ),
    h('div', { className: css.logSummaryRow },
      h('div', { className: css.logSummary }, t('logCount').replace('{shown}', String(filtered.length)).replace('{total}', String(displayLimit))),
      h('label', { className: css.logAutoScroll },
        h('input', {
          type: 'checkbox',
          checked: autoScroll,
          'aria-label': t('autoScroll'),
          onChange: event => setAutoScroll(event.target.checked),
        }),
        h('span', { 'aria-hidden': 'true' }),
        h('b', null, t('autoScroll')))),
    filtered.length === 0
      ? h('p', { className: css.emptyLogs }, visibleEntries.length === 0 ? t('noLogs') : t('noMatchingLogs'))
      : h('div', { className: css.logList, ref: listRef }, filtered.map(item => {
          const entry = item.value
          const entryLevel = logLevel(entry)
          const isExpanded = expanded.has(item.identity)
          const toggle = () => setExpanded(value => {
            const next = new Set(value)
            if (next.has(item.identity)) next.delete(item.identity); else next.add(item.identity)
            return next
          })
          return h('article', {
            className: css.logEntry,
            key: item.identity,
            role: 'button',
            tabIndex: 0,
            'aria-expanded': isExpanded,
            onClick: toggle,
            onKeyDown: event => {
              if (!['Enter', ' '].includes(event.key)) return
              event.preventDefault()
              toggle()
          },
            },
            h('div', { className: css.logMeta },
              h('strong', { className: `${css.logLevel} ${css[`log${entryLevel[0].toUpperCase()}${entryLevel.slice(1)}`]}` }, t(`level${entryLevel[0].toUpperCase()}${entryLevel.slice(1)}`)),
              h('span', { className: css.logSource }, display(entry.source)),
              h('time', { dateTime: entry.timestamp }, localTime(entry.timestamp, t('localeCode')))),
            h('div', { className: css.logMessageRow },
              h('pre', null, display(entry.message)),
              h('span', { className: css.logChevron, 'aria-hidden': true })),
            isExpanded ? h('pre', { className: css.logDetails }, JSON.stringify(entry, null, 2)) : null)
        })))
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
      return value
    } catch {}
    return undefined
  }, [])

  useEffect(() => {
    let events
    let stopped = false
    const connect = () => {
      if (stopped || events !== undefined) return
      events = new EventSource(`${API}/events`)
      events.addEventListener('state', () => { void refresh() })
    }
    const refreshAndConnect = async () => {
      if (await refresh() !== undefined) connect()
    }
    void refreshAndConnect()
    const timer = window.setInterval(() => { void refreshAndConnect() }, 30_000)
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
      stopped = true
      events?.close()
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

function LifecycleGuard({ connection }) {
  useEffect(() => {
    let stopped = false
    let navigating = false
    let hadConnection = connection.hostDescription.getSnapshot() !== undefined
    let graceTimer
    let retryTimer
    let events

    const clearTimers = () => {
      window.clearTimeout(graceTimer)
      window.clearTimeout(retryTimer)
      graceTimer = undefined
      retryTimer = undefined
    }
    const navigate = () => {
      if (stopped || navigating || window.location.pathname === LIFECYCLE_WAIT_PATH) return
      navigating = true
      window.location.replace(lifecycleWaitUrl())
    }
    const scheduleReadiness = () => {
      if (stopped || retryTimer !== undefined) return
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined
        void verifyReadiness()
      }, READINESS_RETRY_MS)
    }
    const verifyReadiness = async () => {
      if (stopped || connection.hostDescription.getSnapshot() !== undefined) return
      try {
        const response = await fetch(LIFECYCLE_READINESS_PATH, {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        })
        if (response.status === 503) {
          const value = await response.json().catch(() => ({}))
          if (value.state !== undefined && value.state !== 'unknown') navigate()
          else scheduleReadiness()
          return
        }
      } catch {}
      scheduleReadiness()
    }
    const inspectPlatformState = async () => {
      try {
        if (requiresLifecycleHoldingPage(await request('status'))) navigate()
      } catch {}
    }
    const connectionChanged = () => {
      if (connection.hostDescription.getSnapshot() !== undefined) {
        hadConnection = true
        clearTimers()
        return
      }
      if (!hadConnection || graceTimer !== undefined) return
      graceTimer = window.setTimeout(() => {
        graceTimer = undefined
        void verifyReadiness()
      }, CONNECTION_LOSS_GRACE_MS)
    }

    const unsubscribe = connection.hostDescription.subscribe(connectionChanged)
    events = new EventSource(`${API}/events`)
    events.addEventListener('state', () => { void inspectPlatformState() })
    void inspectPlatformState()
    connectionChanged()
    return () => {
      stopped = true
      clearTimers()
      unsubscribe()
      events.close()
    }
  }, [connection])
  return null
}

function SystemPluginManager({ plugins, draft, applying, operation, busy, error, onAction, onCancel, onApply, t }) {
  const operationBusy = operation?.status === 'running'
  const [query, setQuery] = useState('')
  const filteredPlugins = plugins.filter(plugin => matchesResourceSearch(query, [plugin.id, plugin.description?.zh, plugin.description?.en]))
  const pagination = usePaginatedItems('system-plugins', filteredPlugins)
  const visiblePlugins = pagination.items
  const restartRequired = draft.size > 0 || plugins.some(plugin => plugin.pendingRestart)
  return h('section', { className: `${css.section} ${css.pluginSection}`, 'aria-labelledby': 'system-plugins-title' },
    h('div', { className: `${css.sectionHeading} ${css.resourceSectionHeading}` },
      h('h3', { id: 'system-plugins-title' }, t('systemPlugins')),
      h('div', { className: css.resourceHeadingDetail },
        h('p', null, t('systemPluginsDetail')),
        h('input', {
          type: 'search', className: css.resourceSearch, value: query, placeholder: t('searchSystemPlugins'), 'aria-label': t('searchSystemPlugins'),
          onChange: event => { setQuery(event.target.value); pagination.setPage(0) },
        }))),
    restartRequired ? h('div', { className: css.pluginRestartNotice, role: 'status' },
      h('div', null,
        h('strong', null, t('pluginChangesPending')),
        h('p', null, t('pluginChangesPendingDetail'))),
      h('div', { className: css.pluginDraftActions },
        h('button', { type: 'button', className: css.secondaryButton, disabled: busy, onClick: onCancel }, t('cancelChanges')),
        h('button', { type: 'button', className: css.primaryButton, disabled: busy, onClick: onApply }, t('applyPluginChanges')))) : null,
    h('div', { className: css.pluginList },
      visiblePlugins.length === 0
        ? h('p', { className: css.emptyPlugins }, plugins.length === 0 ? t('noSystemPlugins') : t('noMatchingResources'))
        : visiblePlugins.map(plugin => {
            const action = draft.get(plugin.id)
            const projected = action === 'install' ? { ...plugin, installed: true, enabled: true }
              : action === 'enable' ? { ...plugin, enabled: true }
                : action === 'disable' ? { ...plugin, enabled: false } : plugin
            const isActive = operationBusy && operation.pluginId === plugin.id
            const applyingAction = isActive
              ? operation.action
              : applying?.pluginId === plugin.id ? applying.action : undefined
            const description = plugin.description?.[t('localeCode')] ?? plugin.id
            const stateKey = applyingAction !== undefined
              ? { install: 'statusInstalling', uninstall: 'statusUninstalling', enable: 'statusEnabling', disable: 'statusDisabling' }[applyingAction]
              : plugin.installed ? (plugin.enabled ? 'resourceEnabled' : 'resourceDisabled') : 'notInstalled'
            return h('article', { className: css.pluginRow, key: plugin.id },
              h('div', { className: css.pluginIdentity },
                h('div', { className: css.resourceHeading },
                  h(ResourceStatusBadge, { label: t(stateKey ?? 'pluginActionWorking'), enabled: applyingAction === undefined && plugin.enabled, pending: applyingAction !== undefined }),
                  h('strong', null, `@dsh-docker/${plugin.id}`)),
                h(ExpandableDescription, { text: description, identity: plugin.id })),
              !projected.installed
                ? h('div', { className: css.pluginActions },
                    h('button', {
                      type: 'button',
                      className: css.primaryButton,
                      disabled: busy,
                      onClick: () => onAction(plugin, 'install'),
                    }, t('installPlugin')))
                : plugin.protected
                ? h('span', { className: css.managedBadge }, t('managed'))
                : h('div', { className: css.pluginActions },
                    h('label', { className: css.toggle },
                      h('input', {
                        type: 'checkbox',
                        checked: projected.enabled,
                        disabled: busy || action === 'install',
                        onChange: event => onAction(plugin, event.target.checked ? 'enable' : 'disable'),
                      }),
                      h('span', { 'aria-hidden': 'true' }))))
          })),
    h(ListPagination, { pagination, total: filteredPlugins.length, t }),
    operation?.status === 'failed'
      ? h('p', { className: css.error, role: 'alert' }, localizedError(operation.error, t))
      : error ? h('p', { className: css.error, role: 'alert' }, localizedError(error, t))
      : null)
}

function SystemSkillManager({ skills, operation, busy, error, onAction, t }) {
  const operationBusy = operation?.status === 'running'
  const [query, setQuery] = useState('')
  const filteredSkills = skills.filter(skill => matchesResourceSearch(query, [skill.id, skill.description?.zh, skill.description?.en]))
  const pagination = usePaginatedItems('system-skills', filteredSkills)
  return h('section', { className: `${css.section} ${css.pluginSection}`, 'aria-labelledby': 'system-skills-title' },
    h('div', { className: `${css.sectionHeading} ${css.resourceSectionHeading}` },
      h('h3', { id: 'system-skills-title' }, t('systemSkills')),
      h('div', { className: css.resourceHeadingDetail },
        h('p', null, t('systemSkillsDetail')),
        h('input', {
          type: 'search', className: css.resourceSearch, value: query, placeholder: t('searchSystemSkills'), 'aria-label': t('searchSystemSkills'),
          onChange: event => { setQuery(event.target.value); pagination.setPage(0) },
        }))),
    h('div', { className: css.pluginList },
      filteredSkills.length === 0
        ? h('p', { className: css.emptyPlugins }, skills.length === 0 ? t('noSystemSkills') : t('noMatchingResources'))
        : pagination.items.map(skill => {
            const isActive = operationBusy && operation.skillId === skill.id
            const stateKey = isActive
              ? { install: 'statusInstalling', enable: 'statusEnabling', disable: 'statusDisabling' }[operation.action]
              : skill.installed ? (skill.enabled ? 'resourceEnabled' : 'resourceDisabled') : 'notInstalled'
            return h('article', { className: css.pluginRow, key: skill.id },
              h('div', { className: css.pluginIdentity },
                h('div', { className: css.resourceHeading },
                  h(ResourceStatusBadge, { label: t(stateKey ?? 'skillActionWorking'), enabled: !isActive && skill.enabled, pending: isActive }),
                  h('strong', null, skill.id)),
                h(ExpandableDescription, { text: skill.description?.[t('localeCode')] ?? skill.id, identity: skill.id })),
              !skill.installed
                ? h('div', { className: css.pluginActions },
                    h('button', {
                      type: 'button', className: css.primaryButton, disabled: busy,
                      onClick: () => onAction(skill, 'install'),
                    }, t('installPlugin')))
                : h('div', { className: css.pluginActions },
                    h('label', { className: css.toggle },
                      h('input', {
                        type: 'checkbox', checked: skill.enabled, disabled: busy,
                        onChange: event => onAction(skill, event.target.checked ? 'enable' : 'disable'),
                      }),
                      h('span', { 'aria-hidden': 'true' }))))
          })),
    h(ListPagination, { pagination, total: filteredSkills.length, t }),
    operation?.status === 'failed'
      ? h('p', { className: css.error, role: 'alert' }, localizedError(operation.error, t))
      : error ? h('p', { className: css.error, role: 'alert' }, localizedError(error, t)) : null)
}

function PlatformManagement({ t }) {
  const [activeTab, setActiveTab] = useState('maintenance')
  const [status, setStatus] = useState(null)
  const [plugins, setPlugins] = useState([])
  const [systemPluginDraft, setSystemPluginDraft] = useState(() => new Map())
  const [systemPluginApplying, setSystemPluginApplying] = useState(null)
  const [skills, setSkills] = useState([])
  const [error, setError] = useState('')
  const [connection, setConnection] = useState('connecting')
  const [acting, setActing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [confirmStable, setConfirmStable] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [dataLossAccepted, setDataLossAccepted] = useState(false)
  const statusLoad = useRef()
  const statusLoadRevision = useRef(0)
  const inventoryLoads = useRef({ plugins: undefined, skills: undefined })
  const inventoryLoadRevisions = useRef({ plugins: 0, skills: 0 })
  const activeTabRef = useRef(activeTab)
  const tabsRef = useRef(null)
  activeTabRef.current = activeTab

  useEffect(() => makeHorizontalTabStripScrollable(tabsRef.current), [])

  const refresh = useCallback(() => {
    statusLoadRevision.current += 1
    if (statusLoad.current !== undefined) return statusLoad.current
    statusLoad.current = (async () => {
      let value
      let loadedRevision
      do {
        loadedRevision = statusLoadRevision.current
        try {
          const nextStatus = await request('status')
          value = nextStatus
          setStatus(nextStatus)
          setError('')
          setConnection('online')
        } catch (nextError) {
          setStatus(null)
          setError(nextError instanceof Error ? nextError.message : String(nextError))
          setConnection('offline')
          value = undefined
        }
      } while (loadedRevision !== statusLoadRevision.current)
      return value
    })().finally(() => { statusLoad.current = undefined })
    return statusLoad.current
  }, [])

  const refreshInventory = useCallback(key => {
    inventoryLoadRevisions.current[key] += 1
    if (inventoryLoads.current[key] !== undefined) return inventoryLoads.current[key]
    const loader = key === 'plugins'
      ? { path: 'bundled-plugins', apply: value => setPlugins(value.plugins ?? []) }
      : { path: 'system-skills', apply: value => setSkills(value.skills ?? []) }
    inventoryLoads.current[key] = (async () => {
      let loadedRevision
      do {
        loadedRevision = inventoryLoadRevisions.current[key]
        try {
          loader.apply(await request(loader.path))
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : String(nextError))
        }
      } while (loadedRevision !== inventoryLoadRevisions.current[key])
    })().finally(() => { inventoryLoads.current[key] = undefined })
    return inventoryLoads.current[key]
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
    setError('')
    try {
      await request('check', { method: 'POST', body: { source } })
      await refresh()
      return true
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
      return false
    } finally {
      setChecking(false)
    }
  }, [refresh])

  const changeChannel = useCallback(async channel => {
    if (await act('channel', { method: 'PUT', body: { channel } })) void checkUpdates('channel-change')
  }, [act, checkUpdates])

  const restartDsh = useCallback(async () => {
    setActing(true)
    setError('')
    try {
      await request('restart-dsh', { method: 'POST' })
      window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
      setConfirmRestart(false)
      await refresh()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setActing(false)
    }
  }, [refresh])

  const manageSystemPlugin = useCallback((plugin, action) => {
    setSystemPluginDraft(current => {
      const next = new Map(current)
      if ((action === 'install' && plugin.installed)
        || (action === 'enable' && plugin.enabled)
        || (action === 'disable' && !plugin.enabled)) next.delete(plugin.id)
      else next.set(plugin.id, action)
      return next
    })
  }, [])

  const waitForSystemPluginTask = useCallback(async taskId => {
    for (let attempt = 0; attempt < 2_400; attempt += 1) {
      const operation = await request(`bundled-plugins/task/${taskId}`)
      if (operation?.taskId === taskId && operation.status !== 'running') return operation
      await new Promise(resolve => window.setTimeout(resolve, 250))
    }
    throw new Error('System Plugin task timed out')
  }, [])

  const cancelSystemPluginChanges = useCallback(async () => {
    setSystemPluginDraft(new Map())
    if (plugins.some(plugin => plugin.pendingRestart)) {
      await act('bundled-plugins/discard', { method: 'POST' })
      await refreshInventory('plugins')
    }
    window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
  }, [act, plugins, refreshInventory])

  const applySystemPluginChanges = useCallback(async () => {
    if (systemPluginDraft.size === 0) {
      if (plugins.some(plugin => plugin.pendingRestart)) await restartDsh()
      return
    }
    setActing(true)
    setError('')
    let changed = false
    try {
      for (const [id, action] of systemPluginDraft) {
        const plugin = plugins.find(item => item.id === id)
        if (plugin === undefined) throw new Error(`System Plugin ${id} is no longer available`)
        setSystemPluginApplying({ pluginId: id, action })
        const path = plugin.protected ? 'bundled-plugins/recovery-action' : 'bundled-plugins/action'
        const task = await request(path, { method: 'POST', body: { id, action } })
        changed = true
        window.sessionStorage.setItem(PLUGIN_DRAFT_KEY, '1')
        const operation = await waitForSystemPluginTask(task.taskId)
        if (operation.status !== 'success') throw new Error(operation.error ?? 'System Plugin operation failed')
        setSystemPluginApplying(null)
      }
      setSystemPluginDraft(new Map())
      await request('restart-dsh', { method: 'POST' })
      window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
      await refresh()
    } catch (nextError) {
      if (changed) await request('bundled-plugins/discard', { method: 'POST' }).catch(() => {})
      window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setSystemPluginApplying(null)
      await refreshInventory('plugins')
      setActing(false)
    }
  }, [plugins, refresh, refreshInventory, restartDsh, systemPluginDraft, waitForSystemPluginTask])

  const manageSystemSkill = useCallback(async (skill, action) => {
    if (await act('system-skills/action', { method: 'POST', body: { skillId: skill.id, action } })) {
      await refreshInventory('skills')
    }
  }, [act, refreshInventory])

  useEffect(() => {
    if (activeTab === 'plugins' || activeTab === 'skills') void refreshInventory(activeTab)
  }, [activeTab, refreshInventory])

  useEffect(() => {
    let stateEvents
    let stopped = false
    let checkedOnOpen = false
    const connectEvents = () => {
      if (stopped || stateEvents !== undefined) return
      const events = new EventSource(`${API}/events`)
      stateEvents = events
      events.addEventListener('state', () => {
        void refresh()
        const inventoryKey = activeTabRef.current
        if (inventoryKey === 'plugins' || inventoryKey === 'skills') void refreshInventory(inventoryKey)
      })
      events.onopen = () => setConnection('online')
      events.onerror = () => {
        setConnection('connecting')
        void refresh().then(value => {
          if (value !== undefined || stateEvents !== events) return
          events.close()
          stateEvents = undefined
        })
      }
    }
    const refreshAndConnect = async () => {
      const value = await refresh()
      if (value !== undefined) {
        connectEvents()
        if (!checkedOnOpen && TERMINAL.has(value.update?.status ?? 'idle')) {
          checkedOnOpen = true
          void checkUpdates('page-open')
        }
      }
      return value
    }

    void (async () => {
      if (window.sessionStorage.getItem(PLUGIN_DRAFT_KEY) === '1') {
        for (let attempt = 0; attempt < 50; attempt += 1) {
          try {
            await request('bundled-plugins/discard', { method: 'POST' })
            window.sessionStorage.removeItem(PLUGIN_DRAFT_KEY)
            break
          } catch {
            await new Promise(resolve => window.setTimeout(resolve, 100))
          }
        }
      }
      await refreshAndConnect()
    })()

    const timer = window.setInterval(() => { void refreshAndConnect() }, 15_000)
    const focus = () => { void refreshAndConnect() }
    window.addEventListener('focus', focus)
    return () => {
      stopped = true
      window.clearInterval(timer)
      window.removeEventListener('focus', focus)
      stateEvents?.close()
    }
  }, [checkUpdates, refresh, refreshInventory])

  const update = status?.update ?? {}
  const restart = status?.dshLifecycle ?? {}
  const pluginOperation = status?.systemPluginOperation ?? {}
  const skillOperation = status?.systemSkillOperation ?? {}
  const checkingUpdates = checking || update.status === 'checking'
  const rollbackPlan = status?.rollbackPlan
  const restartBusy = restart.state === 'restarting'
  const busy = (acting && !checking) || restartBusy || pluginOperation.status === 'running' || skillOperation.status === 'running'
    || (!TERMINAL.has(update.status ?? 'idle') && update.status !== 'checking')
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
    h('div', { className: css.platformHeader },
      h('div', { className: css.heading },
        h('div', { className: css.titleRow },
          h('h2', { className: css.title }, t('title')),
          h('span', { className: `${css.connection} ${css[connection]}`, role: 'status' },
            h('span', { 'aria-hidden': 'true' }),
            t(connection))),
        h('p', { className: css.intro }, t('intro'))),

      h('div', { ref: tabsRef, className: css.tabs, role: 'tablist', 'aria-label': t('managementSections') },
        ['maintenance', 'plugins', 'skills', 'updates'].map(tab => h('button', {
          key: tab,
          id: `platform-tab-${tab}-button`,
          type: 'button',
          role: 'tab',
          'aria-selected': activeTab === tab,
          'aria-controls': `platform-tab-${tab}`,
          tabIndex: activeTab === tab ? 0 : -1,
          onClick: () => setActiveTab(tab),
        }, t(`${tab}Tab`))))),

    h('div', {
      id: 'platform-tab-updates',
      className: css.tabPanel,
      role: 'tabpanel',
      'aria-labelledby': 'platform-tab-updates-button',
      hidden: activeTab !== 'updates',
    },
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
          h('input', { type: 'checkbox', checked: automaticCheck.notificationsEnabled, disabled: acting, onChange: event => { void saveAutomaticCheck({ notificationsEnabled: event.target.checked }) } }))))),

    h('div', {
      id: 'platform-tab-maintenance',
      className: css.tabPanel,
      role: 'tabpanel',
      'aria-labelledby': 'platform-tab-maintenance-button',
      hidden: activeTab !== 'maintenance',
    },
    h('section', { className: css.section, 'aria-labelledby': 'platform-maintenance-title' },
      h('div', { className: css.sectionHeading },
        h('div', null,
          h('h3', { id: 'platform-maintenance-title' }, t('standaloneManagement')),
          h('p', null, t('standaloneManagementDetail'))),
        h('a', {
          className: `${css.secondaryButton} ${css.maintenanceButton}`,
          href: '/_dsh_platform/console',
          target: '_blank',
          rel: 'noopener noreferrer',
        }, t('openPlatformManagement')))),
    h('section', { className: css.section, 'aria-labelledby': 'platform-restart-title' },
      h('div', { className: css.sectionHeading },
        h('div', null,
          h('h3', { id: 'platform-restart-title' }, t('restartDshSection')),
          h('p', null, t('restartDshDetail'))),
        h('button', {
          type: 'button',
          className: `${css.secondaryButton} ${css.maintenanceButton}`,
          disabled: busy,
          'aria-controls': 'restart-dsh-confirmation',
          'aria-expanded': confirmRestart,
          onClick: () => setConfirmRestart(value => !value),
        }, restartBusy ? t('restarting') : t(confirmRestart ? 'cancelRestartDsh' : 'restartDsh'))),
      restart.state === 'failed'
        ? h('p', { className: css.error, role: 'alert' }, `${t('restartFailed')}: ${localizedError(restart.error, t)}`)
        : restartBusy
          ? h('p', { className: css.maintenanceStatus, 'aria-live': 'polite' }, t('restarting'))
          : null,
      confirmRestart ? h('div', { id: 'restart-dsh-confirmation', className: `${css.confirmation} ${css.restartConfirmation}`, role: 'alertdialog', 'aria-labelledby': 'restart-dsh-title' },
        h('h4', { id: 'restart-dsh-title' }, t('restartTitle')),
        h('p', null, t('restartWarning')),
        h('div', { className: css.confirmActions },
          h('button', { type: 'button', className: css.secondaryButton, onClick: () => setConfirmRestart(false) }, t('cancel')),
          h('button', { type: 'button', className: css.primaryButton, disabled: busy, onClick: () => { void restartDsh() } }, t('confirmRestart')))) : null),
    h(LogViewer, { active: activeTab === 'maintenance', t })),

    h('div', {
      id: 'platform-tab-plugins',
      className: css.tabPanel,
      role: 'tabpanel',
      'aria-labelledby': 'platform-tab-plugins-button',
      hidden: activeTab !== 'plugins',
    }, h(SystemPluginManager, {
      plugins,
      draft: systemPluginDraft,
      applying: systemPluginApplying,
      operation: pluginOperation,
      busy,
      error,
      onAction: (plugin, action) => { void manageSystemPlugin(plugin, action) },
      onCancel: () => { void cancelSystemPluginChanges() },
      onApply: () => { void applySystemPluginChanges() },
      t,
    })),

    h('div', {
      id: 'platform-tab-skills',
      className: css.tabPanel,
      role: 'tabpanel',
      'aria-labelledby': 'platform-tab-skills-button',
      hidden: activeTab !== 'skills',
    }, h(SystemSkillManager, {
      skills,
      operation: skillOperation,
      busy,
      error,
      onAction: (skill, action) => { void manageSystemSkill(skill, action) },
      t,
    })))
}

export function apply(ctx) {
  const syncLocaleCookie = snapshot => { persistLocale(snapshot.active) }
  syncLocaleCookie(ctx.locale.getLocale())
  ctx.on('locale/change', syncLocaleCookie)
  ctx.effect(() => ctx.locale.register('settings.dshPlatformManagement', {
    zh: {
      localeCode: 'zh',
      nav: '平台管理', title: '平台管理', intro: 'DSH Docker 运行、更新与恢复',
      managementSections: '平台管理功能', updatesTab: '更新管理', maintenanceTab: '运行维护', pluginsTab: '系统插件', skillsTab: '系统技能',
      channel: '更新通道', channelDetail: '实验通道仅更新 DSH，平台环境仍使用正式支持版本。',
      stable: '稳定', experimental: '实验', current: '当前版本', supported: '正式支持版本', upstream: '上游版本', officialNpm: 'npm 官方源',
      actions: '更新操作', lastChecked: '上次检查', notChecked: '尚未检查', check: '检查更新', checking: '检查中', updateSupported: '更新到最新支持版本', updateUpstream: '更新到最新上游版本', rollback: '回滚到上一版本', returnStable: '立即返回稳定通道', retry: '重试', progress: '更新进度',
      statusIdle: '等待操作', statusChecking: '正在检查更新', statusPlanning: '正在准备更新', statusCheckingUpstream: '正在检查上游版本', statusDownloading: '正在下载', statusValidating: '正在验证', statusBuildingCandidate: '正在构建候选版本', statusSnapshottingData: '正在备份数据', statusSwitching: '正在切换版本', statusProbation: '正在观察运行状态', statusRestoringData: '正在恢复数据', statusSuccess: '操作完成', statusFailed: '操作失败', statusUnknown: '正在处理',
      outcomeNone: '当前已是最新版本', outcomeFrozen: '等待正式支持版本追上当前版本', outcomeHeld: '此版本已暂停更新', outcomeBlocked: '当前版本组合不可用', outcomeStable: '已切换到稳定版本', outcomeExperimental: '已切换到实验版本',
      requestError: '请求失败', operationError: '操作失败，请查看容器日志。', holdVersion: '此版本更新失败，已暂停自动重试。', holdCombination: '此版本与正式环境组合不可用，已暂停自动重试。',
      metadataUnavailable: '正式更新信息暂未发布，请稍后再试。',
      aheadOfStable: '当前版本领先正式支持版本，已暂停完整运行组合更新。', experimentalBlocked: '实验 DSH 与正式环境组合不可用。',
      returnStableTitle: '恢复稳定状态', returnStableWarning: '将恢复以下时间的数据快照，此后产生的数据会丢失：', confirmDataLoss: '我了解并确认丢弃更新后的数据', cancel: '取消', confirm: '确认恢复',
      standaloneManagement: 'DSH 管理中心', standaloneManagementDetail: 'DSH 不可用时仍可进行更新、插件恢复、日志查看和终端操作。', openPlatformManagement: '打开 DSH 管理中心', restartDshSection: '重启 DSH', restartDshDetail: '仅重新启动 DSH，容器和管理中心服务保持运行。', restartDsh: '重新启动 DSH', cancelRestartDsh: '取消重启 DSH', restarting: '正在重新启动 DSH', restartFailed: 'DSH 重启失败', restartTitle: '确认重新启动 DSH', restartWarning: '当前 DSH 连接会暂时中断，重启完成后页面将自动刷新。', confirmRestart: '确认重启',
      automaticChecks: '自动检查', automaticChecksDetail: '仅检查可用版本，不会自动下载或更新。', enabled: '已开启', disabled: '已关闭', checkInterval: '检查频率', updateNotifications: '更新提醒', updateNotificationsDetail: '自动检查发现新版本时，弹窗提醒更新。',
      systemPlugins: '系统插件', systemPluginsDetail: '管理 DSH Docker 提供的系统插件。', noSystemPlugins: '当前环境没有提供系统插件。', platformManaged: '平台核心组件，始终保持安装和启用。', managed: '平台托管', notInstalled: '未安装', resourceEnabled: '已启用', resourceDisabled: '已禁用', statusInstalling: '安装中', statusUninstalling: '卸载中', statusEnabling: '启用中', statusDisabling: '禁用中', pluginEnabled: '已安装并启用', pluginDisabled: '已安装但已禁用', installPlugin: '安装', uninstallPlugin: '卸载', pluginActionWorking: '正在应用插件设置', pluginActionInstall: '正在安装', pluginActionUninstall: '正在卸载', pluginActionEnable: '正在启用', pluginActionDisable: '正在禁用', pluginChangesPending: '有待应用的修改', pluginChangesPendingDetail: '插件修改尚未应用。应用后将重新启动 DSH 并生效。', cancelChanges: '取消修改', applyPluginChanges: '应用并重新启动 DSH', searchSystemPlugins: '搜索系统插件',
      systemSkills: '系统技能', systemSkillsDetail: '管理 DSH Docker 提供的 Agent 操作指引；修改会立即生效。', noSystemSkills: '当前 Bootstrap 没有提供系统技能。', skillActionWorking: '正在应用技能设置', searchSystemSkills: '搜索系统技能', noMatchingResources: '没有符合搜索条件的项目。', itemsPerPage: '每页数量', itemsPerPageSuffix: '条/页', previousPage: '上一页', nextPage: '下一页', totalItems: '共 {total} 条', goToPage: '前往', pageUnit: '页',
      logs: '实时日志', logsDetail: '查看 DSH 与平台各模块的运行日志。', searchLogs: '搜索日志', logSource: '日志模块', logLevel: '日志级别', logDisplayLimit: '显示条数', logDisplayLimitValue: '最近 {count} 条', allSources: '全部模块', levelAll: '全部级别', levelDebug: '调试', levelInfo: '信息', levelWarning: '警告', levelError: '错误', logsLive: '实时', logsConnecting: '连接中', logsDisconnected: '已断开', refreshLogs: '刷新日志', exportLogs: '导出日志', autoScroll: '自动滚动', clearLogView: '清空显示', logCount: '显示 {shown} / {total} 条', noLogs: '暂无日志', noMatchingLogs: '没有符合筛选条件的日志',
      interval3600: '每 1 小时', interval10800: '每 3 小时', interval21600: '每 6 小时', interval43200: '每 12 小时', interval86400: '每 24 小时',
      stableNoticeTitle: '正式版本可更新', stableNoticeBody: '最新支持版本 {version} 已可用。', upstreamNoticeTitle: '上游版本可更新', upstreamNoticeBody: 'DSH 官方版本 {version} 已可用。', later: '稍后提醒', dismissVersion: '不再提醒此版本',
      online: '已连接', connecting: '正在重连', offline: '连接中断',
    },
    en: {
      localeCode: 'en',
      nav: 'Platform Management', title: 'Platform Management', intro: 'DSH Docker runtime, updates, and recovery',
      managementSections: 'Platform management sections', updatesTab: 'Updates', maintenanceTab: 'Maintenance', pluginsTab: 'System plugins', skillsTab: 'System skills',
      channel: 'Update channel', channelDetail: 'Experimental updates DSH only; the platform Environment remains on the supported release.',
      stable: 'Stable', experimental: 'Experimental', current: 'Current', supported: 'Supported', upstream: 'Upstream', officialNpm: 'Official npm',
      actions: 'Update actions', lastChecked: 'Last checked', notChecked: 'Not checked yet', check: 'Check for updates', checking: 'Checking', updateSupported: 'Update to latest supported', updateUpstream: 'Update to latest upstream', rollback: 'Roll back previous', returnStable: 'Return to Stable now', retry: 'Retry', progress: 'Update progress',
      statusIdle: 'Ready', statusChecking: 'Checking for updates', statusPlanning: 'Preparing update', statusCheckingUpstream: 'Checking upstream', statusDownloading: 'Downloading', statusValidating: 'Verifying', statusBuildingCandidate: 'Building candidate', statusSnapshottingData: 'Backing up data', statusSwitching: 'Switching version', statusProbation: 'Observing runtime health', statusRestoringData: 'Restoring data', statusSuccess: 'Completed', statusFailed: 'Failed', statusUnknown: 'Working',
      outcomeNone: 'Already up to date', outcomeFrozen: 'Waiting for the supported release to catch up', outcomeHeld: 'This version is on hold', outcomeBlocked: 'This version combination is unavailable', outcomeStable: 'Switched to the Stable release', outcomeExperimental: 'Switched to the Experimental release',
      requestError: 'Request failed', operationError: 'The operation failed. Check the container logs.', holdVersion: 'This version failed and automatic retries are on hold.', holdCombination: 'This version is incompatible with the production Environment and automatic retries are on hold.',
      metadataUnavailable: 'Signed update metadata has not been published yet. Try again later.',
      aheadOfStable: 'The current version is ahead of Latest Supported; the complete deployment is frozen.', experimentalBlocked: 'The Experimental DSH and production Environment combination is unavailable.',
      returnStableTitle: 'Restore Stable state', returnStableWarning: 'The following data snapshot will be restored and newer data will be lost:', confirmDataLoss: 'I understand and confirm the loss of newer data', cancel: 'Cancel', confirm: 'Restore',
      standaloneManagement: 'DSH Management Console', standaloneManagementDetail: 'Updates, plugin recovery, logs, and terminal tools remain available when DSH is unavailable.', openPlatformManagement: 'Open DSH Management Console', restartDshSection: 'Restart DSH', restartDshDetail: 'Restart DSH only. The container and management console services remain running.', restartDsh: 'Restart DSH', cancelRestartDsh: 'Cancel DSH restart', restarting: 'Restarting DSH', restartFailed: 'DSH restart failed', restartTitle: 'Restart DSH?', restartWarning: 'The current DSH connection will be interrupted briefly. This page reloads when DSH is ready.', confirmRestart: 'Restart',
      automaticChecks: 'Automatic checks', automaticChecksDetail: 'Checks for available versions without downloading or updating.', enabled: 'On', disabled: 'Off', checkInterval: 'Check frequency', updateNotifications: 'Update notifications', updateNotificationsDetail: 'Show an update notification popup when an automatic check finds a new version.',
      systemPlugins: 'System plugins', systemPluginsDetail: 'Manage the System Plugins provided by DSH Docker.', noSystemPlugins: 'No System Plugins are provided by the current Environment.', platformManaged: 'Core platform component. It is always installed and enabled.', managed: 'Platform managed', notInstalled: 'Not installed', resourceEnabled: 'Enabled', resourceDisabled: 'Disabled', statusInstalling: 'Installing', statusUninstalling: 'Uninstalling', statusEnabling: 'Enabling', statusDisabling: 'Disabling', pluginEnabled: 'Installed and enabled', pluginDisabled: 'Installed but disabled', installPlugin: 'Install', uninstallPlugin: 'Uninstall', pluginActionWorking: 'Applying plugin settings', pluginActionInstall: 'Installing', pluginActionUninstall: 'Uninstalling', pluginActionEnable: 'Enabling', pluginActionDisable: 'Disabling', pluginChangesPending: 'Changes pending', pluginChangesPendingDetail: 'Plugin changes have not been applied. Apply them to restart DSH and make them effective.', cancelChanges: 'Cancel changes', applyPluginChanges: 'Apply and restart DSH', searchSystemPlugins: 'Search System Plugins',
      systemSkills: 'System skills', systemSkillsDetail: 'Manage Agent guidance supplied by DSH Docker. Changes take effect immediately.', noSystemSkills: 'The current Bootstrap provides no System Skills.', skillActionWorking: 'Applying skill settings', searchSystemSkills: 'Search System Skills', noMatchingResources: 'No items match this search.', itemsPerPage: 'Items per page', itemsPerPageSuffix: '/ page', previousPage: 'Previous', nextPage: 'Next', totalItems: '{total} total', goToPage: 'Go to', pageUnit: 'page',
      logs: 'Live logs', logsDetail: 'View runtime logs from DSH and platform modules.', searchLogs: 'Search logs', logSource: 'Log module', logLevel: 'Log level', logDisplayLimit: 'Entries shown', logDisplayLimitValue: 'Latest {count}', allSources: 'All modules', levelAll: 'All levels', levelDebug: 'Debug', levelInfo: 'Info', levelWarning: 'Warning', levelError: 'Error', logsLive: 'Live', logsConnecting: 'Connecting', logsDisconnected: 'Disconnected', refreshLogs: 'Refresh logs', exportLogs: 'Export logs', autoScroll: 'Auto-scroll', clearLogView: 'Clear view', logCount: 'Showing {shown} / {total}', noLogs: 'No logs yet', noMatchingLogs: 'No logs match these filters',
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
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-platform-lifecycle-guard',
    order: -100,
  }, () => h(LifecycleGuard, { connection: ctx.connection })))
}
