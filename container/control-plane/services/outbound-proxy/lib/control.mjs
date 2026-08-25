import { createServer } from 'node:http'
import { outboundProxyEnvironment } from '../../../../platform/lib/outbound-proxy.mjs'
import { sanitizedProxyConfiguration } from './contracts.mjs'
import { ProxyConfigurationError, proxyErrorBody } from './errors.mjs'

const MAX_CONTROL_BODY_BYTES = 64 * 1024
const MAX_PROVIDER_HANDLE_BODY_BYTES = 4096

async function jsonBody(request, maximum = MAX_CONTROL_BODY_BYTES) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.byteLength
    if (total > maximum) throw new ProxyConfigurationError('control request body is too large')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
    throw new ProxyConfigurationError('control request body is invalid')
  }
}

function send(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(value)}\n`)
}

function assertSupportedProviderPolicies(value, supportedProviderIds) {
  if (value?.modelApi?.default !== 'direct') {
    throw new ProxyConfigurationError('model API default proxy policy is not supported', {
      code: 'PROVIDER_POLICY_UNSUPPORTED', stage: 'validate',
    })
  }
  for (const id of Object.keys(value?.modelApi?.providers ?? {})) {
    if (!supportedProviderIds.has(id)) {
      throw new ProxyConfigurationError(`model API provider ${id} cannot use an independent proxy route`, {
        code: 'PROVIDER_POLICY_UNSUPPORTED', stage: 'validate',
      })
    }
  }
}

function configurationView(snapshot, routeHealth, state = {}) {
  return sanitizedProxyConfiguration(snapshot.configuration, snapshot.revision, {
    componentReady: true,
    routeHealth: routeHealth.status(snapshot),
    lastTest: state.lastTest ?? null,
  })
}

export function createOutboundProxyControl({
  getSnapshot,
  routeHealth,
  providerHandles,
  commitConfiguration,
  supportedProviderIds = new Set(),
  getTestState = () => ({ lastTest: null }),
}) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://outbound-proxy.internal')
    const snapshot = getSnapshot()
    if (request.method === 'GET' && url.pathname === '/v1/status') {
      send(response, 200, {
        componentReady: true,
        revision: snapshot.revision,
        recovery: snapshot.recovery,
        routeHealth: routeHealth.status(snapshot),
      })
      return
    }
    if (request.method === 'GET' && url.pathname === '/v1/configuration') {
      send(response, 200, configurationView(snapshot, routeHealth, getTestState()))
      return
    }
    if (request.method === 'PUT' && url.pathname === '/v1/configuration') {
      try {
        if (commitConfiguration === undefined) throw new Error('proxy configuration updates are unavailable')
        const body = await jsonBody(request)
        if (body === null || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).sort().join(',') !== 'baseRevision,value') {
          throw new ProxyConfigurationError('proxy configuration update is invalid')
        }
        assertSupportedProviderPolicies(body.value, supportedProviderIds)
        const activated = await commitConfiguration(body)
        providerHandles?.clear()
        send(response, 200, configurationView(activated, routeHealth, getTestState()))
      } catch (error) {
        send(response, error?.statusCode ?? 400, proxyErrorBody(error))
      }
      return
    }
    if (request.method === 'GET' && url.pathname === '/v1/environment') {
      try {
        const scope = url.searchParams.get('scope')
        const environment = outboundProxyEnvironment(scope, {
          noProxy: [...snapshot.configuration.noProxy.system, ...snapshot.configuration.noProxy.user],
          allProxy: snapshot.configuration.environment.allProxy === 'scope-proxy',
        })
        send(response, 200, { scope, revision: snapshot.revision, environment })
      } catch (error) {
        send(response, 400, { error: error instanceof Error ? error.message : 'invalid scope' })
      }
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/provider-handles') {
      try {
        if (providerHandles === undefined) throw new Error('provider handles are unavailable')
        send(response, 201, providerHandles.issue(await jsonBody(request, MAX_PROVIDER_HANDLE_BODY_BYTES), snapshot))
      } catch (error) {
        send(response, error?.statusCode ?? 400, proxyErrorBody(error))
      }
      return
    }
    send(response, 404, { error: 'not found' })
  })
}

export const outboundProxyControlInternals = Object.freeze({ assertSupportedProviderPolicies, configurationView })
