import { request } from 'node:http'
import { ProxyTransportError } from './transport.mjs'

export async function probeProxyEntry(port, { timeoutMs = 2_000 } = {}) {
  await new Promise((resolve, reject) => {
    const probe = request({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path: '/__dsh_outbound_proxy_readiness__',
      headers: { connection: 'close' },
      agent: false,
    }, response => {
      response.resume()
      response.once('end', () => {
        if (response.statusCode === 400 && response.headers['x-dsh-proxy-error'] === 'INVALID_PROXY_REQUEST') resolve()
        else reject(new ProxyTransportError('outbound proxy readiness response is invalid', {
          code: 'PROXY_READINESS_FAILED',
        }))
      })
    })
    const timer = setTimeout(() => probe.destroy(new ProxyTransportError('outbound proxy readiness timed out', {
      code: 'PROXY_READINESS_FAILED',
    })), timeoutMs)
    probe.once('close', () => clearTimeout(timer))
    probe.once('error', reject)
    probe.end()
  })
}
