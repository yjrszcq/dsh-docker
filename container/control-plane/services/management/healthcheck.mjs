import { request } from 'node:http'

const socketPath = process.env.DSH_PLATFORM_MANAGEMENT_SOCKET ?? '/run/dsh-platform/management.sock'

const status = await new Promise((resolve, reject) => {
  const probe = request({
    socketPath,
    path: '/_dsh_platform/internal/health',
    method: 'GET',
    timeout: 2_000,
  }, response => {
    response.resume()
    resolve(response.statusCode)
  })
  probe.once('timeout', () => probe.destroy(new Error('management health check timed out')))
  probe.once('error', reject)
  probe.end()
})

if (status !== 200) throw new Error(`management health check returned ${String(status)}`)
