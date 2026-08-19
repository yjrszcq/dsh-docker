const API = '/_dsh_platform/api/v1'
const TERMINAL = new Set(['idle', 'success', 'failed'])
const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map(element => [element.id, element]))
const channelButtons = [...document.querySelectorAll('[data-channel]')]

let status
let rollbackPlan
let loading = false
let eventSource
let logSource
const logLines = []

function display(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value)
}

function setText(id, value) {
  elements[id].textContent = display(value)
}

function showError(error) {
  elements.error.textContent = error instanceof Error ? error.message : String(error)
  elements.error.hidden = false
}

function clearError() {
  elements.error.hidden = true
  elements.error.textContent = ''
}

function setConnection(state, label) {
  elements.connection.dataset.state = state
  elements.connection.querySelector('strong').textContent = label
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

function renderHolds(values, busy) {
  elements.holds.replaceChildren()
  elements.holds.hidden = values.length === 0
  for (const hold of values) {
    const row = document.createElement('div')
    row.className = 'hold'
    const identity = document.createElement('strong')
    identity.textContent = `${display(hold.dshVersion)}${hold.environmentVersion ? ` + ${hold.environmentVersion}` : ''}`
    const reason = document.createElement('span')
    reason.textContent = display(hold.reason)
    const retry = document.createElement('button')
    retry.type = 'button'
    retry.textContent = '重试'
    retry.disabled = busy
    retry.addEventListener('click', () => act(() => api('holds/retry', { method: 'POST', body: { id: hold.id } })))
    row.append(identity, reason, retry)
    elements.holds.append(row)
  }
}

function render(next) {
  status = next
  rollbackPlan = next.rollbackPlan
  const update = next.update ?? {}
  const busy = !TERMINAL.has(update.status ?? 'idle')
  setText('current-dsh', next.current?.dsh)
  setText('current-env', next.current?.environment)
  setText('supported-dsh', next.supported?.dsh)
  setText('supported-env', next.supported?.environment)
  setText('upstream-dsh', next.upstream?.version)
  setText('runtime', next.current?.runtime)
  setText('probation', next.probation?.until)
  setText('snapshot', rollbackPlan?.snapshot?.createdAt)
  setText('keyring', next.trust?.keyringGeneration)
  elements.checkedAt.textContent = update.checkedAt ? `上次检查 ${update.checkedAt}` : '尚未检查'
  elements.updateStatus.textContent = display(update.status)
  elements.updateResult.textContent = display(update.error ?? update.outcome)
  const progress = Math.max(0, Math.min(100, Number(update.progress) || 0))
  elements.progressBar.style.width = `${String(progress)}%`
  elements.progressValue.value = `${String(progress)}%`
  elements.progressValue.textContent = `${String(progress)}%`
  elements.progressBar.parentElement.setAttribute('aria-valuenow', String(progress))
  elements.update.textContent = next.updateChannel === 'experimental' ? '更新到最新上游版本' : '更新到最新支持版本'
  for (const button of channelButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.channel === next.updateChannel))
    button.disabled = busy
  }
  for (const button of [elements.check, elements.update]) button.disabled = busy
  elements.rollback.hidden = rollbackPlan === null || rollbackPlan === undefined
  elements.rollback.disabled = busy
  elements['return-stable'].hidden = !rollbackPlan?.returnStableAvailable
  elements['return-stable'].disabled = busy
  const holds = [...(next.holds ?? []), ...(next.experimentalBlocked ? [next.experimentalBlocked] : [])]
  renderHolds([...new Map(holds.map(hold => [hold.id, hold])).values()], busy)
  const notices = []
  if (next.aheadOfStable) notices.push('当前版本领先 Latest Supported，已冻结完整运行组合。')
  if (next.experimentalBlocked) notices.push('Experimental DSH 与正式 Environment 组合不可用。')
  elements.notice.textContent = notices.join(' ')
  elements.notice.hidden = notices.length === 0
}

async function loadStatus() {
  if (loading) return
  loading = true
  try {
    render(await api('status'))
    clearError()
    setConnection('online', '已连接')
  } catch (error) {
    showError(error)
    setConnection('offline', '连接中断')
  } finally {
    loading = false
  }
}

async function act(operation) {
  clearError()
  try {
    await operation()
    await loadStatus()
  } catch (error) {
    showError(error)
  }
}

function appendLog(entry) {
  logLines.push(`${display(entry.timestamp)} ${display(entry.source)} ${display(entry.message)}`)
  if (logLines.length > 300) logLines.splice(0, logLines.length - 300)
  elements.logs.textContent = logLines.join('\n')
  elements.logs.scrollTop = elements.logs.scrollHeight
}

function connectEvents() {
  eventSource?.close()
  eventSource = new EventSource(`${API}/events`)
  eventSource.addEventListener('state', () => { void loadStatus() })
  eventSource.onopen = () => setConnection('online', '已连接')
  eventSource.onerror = () => setConnection('connecting', '正在重连')

  logSource?.close()
  logSource = new EventSource(`${API}/logs/stream?source=audit&source=updater&limit=100`)
  logSource.addEventListener('log', event => {
    try { appendLog(JSON.parse(event.data)) } catch { /* Ignore malformed log events. */ }
  })
}

elements.check.addEventListener('click', () => act(() => api('check', { method: 'POST' })))
elements.update.addEventListener('click', () => act(() => api('update', { method: 'POST' })))
elements.rollback.addEventListener('click', () => act(() => api('rollback', {
  method: 'POST', body: { planId: rollbackPlan.planId },
})))
elements['return-stable'].addEventListener('click', () => {
  elements['stable-snapshot'].textContent = display(rollbackPlan?.snapshot?.createdAt)
  elements['confirm-data-loss'].checked = false
  elements['confirm-stable'].disabled = true
  elements['stable-dialog'].showModal()
})
elements['confirm-data-loss'].addEventListener('change', event => {
  elements['confirm-stable'].disabled = !event.target.checked
})
elements['confirm-stable'].addEventListener('click', () => {
  const planId = rollbackPlan?.planId
  elements['stable-dialog'].close()
  void act(() => api('return-stable', { method: 'POST', body: { planId, confirmDataLoss: true } }))
})
elements['clear-logs'].addEventListener('click', () => {
  logLines.length = 0
  elements.logs.textContent = ''
})
for (const button of channelButtons) {
  button.addEventListener('click', () => act(() => api('channel', {
    method: 'PUT', body: { channel: button.dataset.channel },
  })))
}

window.addEventListener('beforeunload', () => {
  eventSource?.close()
  logSource?.close()
})
void loadStatus()
connectEvents()
setInterval(() => { void loadStatus() }, 15_000)
