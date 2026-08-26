import { createServer } from 'node:http'
import { outboundProxyEnvironment, outboundProxyScopeEnabled } from '../../../../platform/lib/outbound-proxy.mjs'
import { sanitizedProxyConfiguration } from './contracts.mjs'
import { ProxyConfigurationError, proxyErrorBody } from './errors.mjs'

const MAX_CONTROL_BODY_BYTES = 64 * 1024
const MAX_PROVIDER_HANDLE_BODY_BYTES = 4096
const TEST_TASK_ROUTE = /^\/v1\/test\/tasks\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/

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
  proxyTests,
  commitConfiguration,
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
        const activated = await commitConfiguration(body)
        providerHandles?.clear()
        send(response, 200, configurationView(activated, routeHealth, getTestState()))
      } catch (error) {
        send(response, error?.statusCode ?? 400, proxyErrorBody(error))
      }
      return
    }
    if (request.method === 'POST' && url.pathname === '/v1/test') {
      try {
        if (proxyTests === undefined) throw new Error('proxy connection tests are unavailable')
        send(response, 202, await proxyTests.start(await jsonBody(request), snapshot))
      } catch (error) {
        send(response, error?.statusCode ?? 400, proxyErrorBody(error))
      }
      return
    }
    if (request.method === 'GET' && TEST_TASK_ROUTE.test(url.pathname)) {
      try {
        if (proxyTests === undefined) throw new Error('proxy connection tests are unavailable')
        send(response, 200, proxyTests.get(TEST_TASK_ROUTE.exec(url.pathname)[1]))
      } catch (error) {
        send(response, error?.statusCode ?? 400, proxyErrorBody(error))
      }
      return
    }
    if (request.method === 'DELETE' && TEST_TASK_ROUTE.test(url.pathname)) {
      try {
        if (proxyTests === undefined) throw new Error('proxy connection tests are unavailable')
        send(response, 202, await proxyTests.cancel(TEST_TASK_ROUTE.exec(url.pathname)[1]))
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
          enabled: outboundProxyScopeEnabled(snapshot.configuration, scope),
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

export const outboundProxyControlInternals = Object.freeze({ configurationView })
