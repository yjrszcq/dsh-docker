import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import { Agent, fetch as proxyFetch, ProxyAgent } from 'undici'

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/
const FETCH_ROUTER = Symbol.for('dsh-docker.platform-management.provider-fetch-router')
const MAX_CONTROL_RESPONSE_BYTES = 64 * 1024
const DEFAULT_SOCKET = '/run/dsh-platform/outbound-proxy.sock'
const DEFAULT_PROXY_URL = 'http://127.0.0.1:17897'
const DEFAULT_SHARED_PROXY_URL = 'http://127.0.0.1:17898'
const DEFAULT_ROUTING_STATE = '/run/dsh-platform/outbound-proxy-routing.json'

function routingState(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value?.schema !== 1 || typeof value.enabled !== 'boolean' || value.modelApi === null || typeof value.modelApi !== 'object') return null
    return value
  } catch {
    return null
  }
}

function providerProxyEnabled(state, providerId) {
  if (state === null || !state.enabled) return false
  const policy = state.modelApi.providers?.[providerId] ?? state.modelApi.default
  if (policy?.proxyEnabled !== true) return false
  return policy.followDsh !== true || state.scopes?.dshCore === true || state.scopes?.dshPlugins === true
}

function sharedDshProxyEnabled(state) {
  return state !== null && state.enabled
    && (state.scopes?.dshCore === true || state.scopes?.dshPlugins === true)
}

function controlRequest(socketPath, method, path, body) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const outgoing = request({
      socketPath,
      method,
      path,
      headers: bytes === undefined ? {} : {
        'content-type': 'application/json',
        'content-length': bytes.byteLength,
      },
      signal: AbortSignal.timeout(5_000),
    }, response => {
      const chunks = []
      let size = 0
      response.on('data', chunk => {
        size += chunk.byteLength
        if (size > MAX_CONTROL_RESPONSE_BYTES) outgoing.destroy(new Error('Outbound Proxy response is too large'))
        else chunks.push(chunk)
      })
      response.on('end', () => {
        let value
        try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
          reject(new Error('Outbound Proxy response is invalid'))
          return
        }
        if ((response.statusCode ?? 500) >= 400) {
          const error = new Error(value?.error?.message ?? `Outbound Proxy returned HTTP ${String(response.statusCode)}`)
          error.statusCode = response.statusCode
          error.code = value?.error?.code
          reject(error)
        } else resolve(value)
      })
    })
    outgoing.once('error', reject)
    outgoing.end(bytes)
  })
}

async function issueProviderHandle(providerId, socketPath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const configuration = await controlRequest(socketPath, 'GET', '/v1/configuration')
    try {
      return await controlRequest(socketPath, 'POST', '/v1/provider-handles', {
        providerId,
        policyRevision: configuration.revision,
      })
    } catch (error) {
      if (error?.code !== 'REVISION_CONFLICT' || attempt > 0) throw error
    }
  }
  throw new Error('Provider policy changed repeatedly')
}

function installFetchRouter(store, routedFetch = proxyFetch, resolveDefaultRoute = () => undefined) {
  const owner = Object.freeze({})
  let registry = globalThis[FETCH_ROUTER]
  if (registry === undefined) {
    const original = globalThis.fetch
    registry = { original, owner, store, routedFetch, resolveDefaultRoute }
    const wrapper = function (input, init) {
      const route = registry.store.getStore() ?? registry.resolveDefaultRoute()
      if (route === undefined || (init !== undefined && Object.hasOwn(init, 'dispatcher'))) {
        return registry.original.call(this, input, init)
      }
      return registry.routedFetch(input, { ...init, dispatcher: route.dispatcher })
    }
    registry.wrapper = wrapper
    globalThis[FETCH_ROUTER] = registry
    globalThis.fetch = wrapper
  } else {
    registry.owner = owner
    registry.store = store
    registry.routedFetch = routedFetch
    registry.resolveDefaultRoute = resolveDefaultRoute
  }
  return () => {
    if (registry.owner !== owner) return
    if (globalThis.fetch === registry.wrapper) globalThis.fetch = registry.original
    delete globalThis[FETCH_ROUTER]
  }
}

function routedIterator(next, providerId, store, { resolveRoute }) {
  let iterator
  let routePromise
  let closed = false

  async function route() {
    if (routePromise === undefined) {
      routePromise = resolveRoute(providerId)
    }
    return routePromise
  }

  async function invoke(method, value) {
    const context = await route()
    if (iterator === undefined) iterator = store.run(context, () => next()[Symbol.asyncIterator]())
    if (typeof iterator[method] !== 'function') {
      await close(context)
      if (method === 'throw') throw value
      return { value, done: true }
    }
    try {
      const result = await store.run(context, () => iterator[method](value))
      if (result.done) await close(context)
      return result
    } catch (error) {
      await close(context)
      throw error
    }
  }

  async function close(context) {
    if (closed) return
    closed = true
    if (context.owned) await context.dispatcher.close()
  }

  return {
    next: value => invoke('next', value),
    return: value => invoke('return', value),
    throw: value => invoke('throw', value),
    [Symbol.asyncIterator]() { return this },
  }
}

export function installProviderRouting(ctx, {
  socketPath = process.env.DSH_PLATFORM_RUN === undefined
    ? DEFAULT_SOCKET
    : `${process.env.DSH_PLATFORM_RUN}/outbound-proxy.sock`,
  proxyUrl = DEFAULT_PROXY_URL,
  routingStatePath = process.env.DSH_PLATFORM_RUN === undefined
    ? DEFAULT_ROUTING_STATE
    : `${process.env.DSH_PLATFORM_RUN}/outbound-proxy-routing.json`,
  createDispatcher = options => new ProxyAgent(options),
  createSharedDispatcher = options => new ProxyAgent(options),
  createDirectDispatcher = () => new Agent(),
  routedFetch = proxyFetch,
} = {}) {
  const store = new AsyncLocalStorage()
  const directDispatcher = createDirectDispatcher()
  const sharedDispatcher = createSharedDispatcher({ uri: DEFAULT_SHARED_PROXY_URL })
  const resolveDefaultRoute = () => {
    const state = routingState(routingStatePath)
    if (state === null) return undefined
    return { dispatcher: sharedDshProxyEnabled(state) ? sharedDispatcher : directDispatcher }
  }
  const removeFetchRouter = installFetchRouter(store, routedFetch, resolveDefaultRoute)
  const disposeStream = ctx.on('llm/stream', (options, next) => {
    if (!PROVIDER_ID_PATTERN.test(options.provider)) return next()
    return routedIterator(next, options.provider, store, {
      resolveRoute: async providerId => {
        const state = routingState(routingStatePath)
        if (state !== null && !providerProxyEnabled(state, providerId)) {
          return { dispatcher: directDispatcher, owned: false }
        }
        const { handle } = await issueProviderHandle(providerId, socketPath)
        return {
          dispatcher: createDispatcher({ uri: proxyUrl, token: `DSH-Provider ${handle}` }),
          owned: true,
        }
      },
    })
  }, { global: true, prepend: true })
  return () => {
    disposeStream?.()
    removeFetchRouter()
    void directDispatcher.close()
    void sharedDispatcher.close()
  }
}

export const providerRoutingInternals = Object.freeze({
  FETCH_ROUTER,
  controlRequest,
  installFetchRouter,
  issueProviderHandle,
  providerProxyEnabled,
  sharedDshProxyEnabled,
  routingState,
  routedIterator,
})
