import { request as httpRequest } from 'node:http'

const SWITCHING_STATES = new Set(['snapshotting-data', 'switching', 'probation'])
const RECOVERING_STATES = new Set(['restoring-data'])

const COPY = Object.freeze({
  en: Object.freeze({
    starting: 'DeepSeek Harness is starting',
    restarting: 'DeepSeek Harness is restarting',
    switching: 'Switching the DeepSeek Harness runtime',
    recovering: 'Restoring DeepSeek Harness',
    failed: 'DeepSeek Harness could not start',
    unavailable: 'DeepSeek Harness is temporarily unavailable and recovery is in progress',
  }),
  zh: Object.freeze({
    starting: 'DeepSeek Harness 正在启动',
    restarting: 'DeepSeek Harness 正在重新启动',
    switching: '正在切换 DeepSeek Harness 运行版本',
    recovering: '平台正在恢复 DeepSeek Harness',
    failed: 'DeepSeek Harness 启动失败',
    unavailable: 'DeepSeek Harness 暂时不可用，正在尝试恢复',
  }),
})

const MANAGEMENT_LINK = Object.freeze({
  en: 'Open Platform Management for diagnostics and recovery',
  zh: '打开平台管理进行检查和恢复',
})

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
    if (platform.operation === 'recovering') return 'recovering'
    if (platform.operation === 'switching') return 'switching'
    const updateState = platform.update?.status
    if (RECOVERING_STATES.has(updateState)) return 'recovering'
    if (SWITCHING_STATES.has(updateState)) return 'switching'
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

export function stateMessage(state, headers = {}) {
  return COPY[language(headers)][state] ?? COPY.en.unavailable
}

export function availabilityPage(state, headers = {}) {
  const locale = language(headers)
  const message = COPY[locale][state] ?? COPY.en.unavailable
  const managementLink = MANAGEMENT_LINK[locale]
  const messages = JSON.stringify(COPY[locale])
  return `<!doctype html>
<html lang="${locale === 'zh' ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DeepSeek Harness</title>
<style>
html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#151517;color:#f3f3f4;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.boot{display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px;text-align:center}.wordmark{font-size:16px;line-height:24px;font-weight:600;letter-spacing:0}.status{max-width:520px;font-size:13px;line-height:20px;color:#a7a7ad}.management{padding:7px 12px;border:1px solid #46464b;border-radius:6px;color:#d7d7db;font-size:13px;line-height:20px;text-decoration:none}.management:hover{background:#232326}.management:focus-visible{outline:2px solid #8ca8ff;outline-offset:2px}@media(prefers-color-scheme:light){body{background:#f9fafb;color:#0f1115}.status{color:#6d7178}.management{border-color:#d6d8dc;color:#34373d}.management:hover{background:#f0f1f3}}
</style>
</head>
<body>
<main class="boot"><div class="wordmark">HARNESS</div><div class="status" role="status">${message}</div><a class="management" href="/_dsh_platform/ui/">${managementLink}</a></main>
<script>
const messages=${messages};const status=document.querySelector('.status');
async function check(){try{const response=await fetch('/_dsh_gateway/readiness',{cache:'no-store'});const value=await response.json();if(value.ready){location.reload();return}if(messages[value.state])status.textContent=messages[value.state]}catch{}setTimeout(check,1000)}
setTimeout(check,600);
</script>
</body>
</html>`
}
