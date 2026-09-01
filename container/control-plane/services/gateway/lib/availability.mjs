import { request as httpRequest } from 'node:http'

// A Bootstrap handoff stops DSH while the updater that initiated it is still
// recorded as building the candidate. This state is consulted only after the
// DSH upstream becomes unavailable, so ordinary candidate builds stay visible.
const SWITCHING_STATES = new Set(['building-candidate', 'snapshotting-data', 'switching', 'probation'])
const RECOVERING_STATES = new Set(['restoring-data'])

const COPY = Object.freeze({
  en: Object.freeze({
    starting: 'DeepSeek Harness is starting',
    stopping: 'DeepSeek Harness is stopping',
    stopped: 'DeepSeek Harness is stopped',
    restarting: 'DeepSeek Harness is restarting',
    switching: 'Switching the DeepSeek Harness runtime',
    'runtime-recovering': 'Restoring the DeepSeek Harness runtime',
    recovering: 'DeepSeek Harness stopped unexpectedly and recovery is in progress',
    failed: 'DeepSeek Harness could not start',
    'plugin-failed': 'DeepSeek Harness plugins repeatedly failed to load',
    unavailable: 'DeepSeek Harness is temporarily unavailable and recovery is in progress',
  }),
  zh: Object.freeze({
    starting: 'DeepSeek Harness 正在启动',
    stopping: 'DeepSeek Harness 正在停止',
    stopped: 'DeepSeek Harness 已停止',
    restarting: 'DeepSeek Harness 正在重新启动',
    switching: '正在切换 DeepSeek Harness 运行版本',
    'runtime-recovering': '正在恢复 DeepSeek Harness 运行版本',
    recovering: 'DeepSeek Harness 意外停止，正在尝试恢复',
    failed: 'DeepSeek Harness 启动失败',
    'plugin-failed': 'DeepSeek Harness 插件持续加载失败',
    unavailable: 'DeepSeek Harness 暂时不可用，正在尝试恢复',
  }),
})

const MANAGEMENT_LINK = Object.freeze({
  en: 'Open DSH Management Console for diagnostics and recovery',
  zh: '打开 DSH 管理中心进行检查和恢复',
})

const REFRESH_LINK = Object.freeze({ en: 'Reload page', zh: '刷新页面' })

export class DshAvailability {
  constructor({ now = () => Date.now(), failures = 3, failureWindowMs = 1_500 } = {}) {
    this.now = now
    this.failures = failures
    this.failureWindowMs = failureWindowMs
    this.everReady = false
    this.consecutiveFailures = 0
    this.firstFailureAt = null
  }

  observe(ready) {
    if (ready) {
      this.everReady = true
      this.consecutiveFailures = 0
      this.firstFailureAt = null
      return
    }
    this.consecutiveFailures += 1
    this.firstFailureAt ??= this.now()
  }

  classify(platform = {}) {
    if (platform.operation === 'restart-failed') return 'failed'
    if (platform.operation === 'restarting') return 'restarting'
    if (platform.operation === 'recovering') return 'runtime-recovering'
    if (platform.operation === 'switching') return 'switching'
    const updateState = platform.update?.status
    if (RECOVERING_STATES.has(updateState)) return 'runtime-recovering'
    if (SWITCHING_STATES.has(updateState)) return 'switching'
    const lifecycle = platform.dshLifecycle ?? {}
    if (['starting', 'stopping', 'stopped', 'restarting', 'recovering', 'failed'].includes(lifecycle.state)) {
      return lifecycle.state
    }
    if (platform.recoveryMode !== null && platform.recoveryMode !== undefined) return 'failed'
    if (!this.everReady) return 'starting'
    if (
      this.consecutiveFailures >= this.failures
      && this.firstFailureAt !== null
      && this.now() - this.firstFailureAt >= this.failureWindowMs
    ) return 'unavailable'
    return 'unknown'
  }
}

export function probeDsh({ host, port, timeoutMs = 750 }) {
  return new Promise(resolve => {
    const request = httpRequest({ hostname: host, port, path: '/', method: 'GET' }, response => {
      response.resume()
      resolve((response.statusCode ?? 500) < 500)
    })
    request.setTimeout(timeoutMs, () => request.destroy())
    request.once('error', () => resolve(false))
    request.end()
  })
}

function cookieLocale(cookie = '') {
  for (const part of cookie.split(';')) {
    const [name, value] = part.trim().split('=', 2)
    if (name === 'dsh_locale' && (value === 'zh' || value === 'en')) return value
  }
  return undefined
}

export function language(headers) {
  const saved = cookieLocale(headers.cookie)
  if (saved !== undefined) return saved
  for (const item of (headers['accept-language'] ?? '').split(',')) {
    const primary = item.trim().split(';', 1)[0].split('-', 1)[0].toLowerCase()
    if (primary === 'zh' || primary === 'en') return primary
  }
  return 'en'
}

export function stateMessage(state, headers = {}, lifecycle = {}) {
  const locale = language(headers)
  const message = COPY[locale][state] ?? COPY.en.unavailable
  if (state !== 'recovering' || !(lifecycle.attempt > 0) || !(lifecycle.maxAttempts > 0)) return message
  return locale === 'zh'
    ? `${message}（第 ${String(lifecycle.attempt)} / ${String(lifecycle.maxAttempts)} 次）`
    : `${message} (attempt ${String(lifecycle.attempt)} of ${String(lifecycle.maxAttempts)})`
}

export function availabilityPage(state, headers = {}, { lifecycle = {}, returnPath = null, poll = true, managementHref = '/_dsh_platform/console/' } = {}) {
  const locale = language(headers)
  const message = stateMessage(state, headers, lifecycle)
  const managementLink = MANAGEMENT_LINK[locale]
  const refreshLink = REFRESH_LINK[locale]
  const target = JSON.stringify(returnPath).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="${locale === 'zh' ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DeepSeek Harness</title>
<style>
html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#151517;color:#f3f3f4;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.boot{display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px;text-align:center}.wordmark{font-size:16px;line-height:24px;font-weight:600;letter-spacing:0}.status{max-width:520px;font-size:13px;line-height:20px;color:#a7a7ad}.actions{display:flex;flex-wrap:wrap;justify-content:center;gap:10px}.management{padding:7px 12px;border:1px solid #46464b;border-radius:6px;color:#d7d7db;font-size:13px;line-height:20px;text-decoration:none}.management:hover{background:#232326}.management:focus-visible{outline:2px solid #8ca8ff;outline-offset:2px}@media(prefers-color-scheme:light){body{background:#f9fafb;color:#0f1115}.status{color:#6d7178}.management{border-color:#d6d8dc;color:#34373d}.management:hover{background:#f0f1f3}}
</style>
</head>
<body>
<main class="boot"><div class="wordmark">HARNESS</div><div class="status" role="status">${message}</div><div class="actions"><a class="management" href="${String(managementHref).replaceAll('"', '&quot;')}">${managementLink}</a>${poll ? '' : `<a class="management refresh" href="">${refreshLink}</a>`}</div></main>
${poll ? `<script>
const returnPath=${target};const status=document.querySelector('.status');
async function check(){try{const response=await fetch('/_dsh_gateway/readiness',{cache:'no-store'});const value=await response.json();if(value.ready){if(returnPath===null)location.reload();else location.replace(returnPath);return}if(typeof value.message==='string')status.textContent=value.message}catch{}setTimeout(check,1000)}
setTimeout(check,600);
</script>` : ''}
</body>
</html>`
}
