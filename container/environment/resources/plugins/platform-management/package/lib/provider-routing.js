import { AsyncLocalStorage } from 'node:async_hooks'
import { request } from 'node:http'
import { fetch as proxyFetch, ProxyAgent } from 'undici'

export const fetchRoutedProviderIds = Object.freeze([
  'deepseek-official',
  'ant-ling',
  'anthropic',
  'azure-openai-responses',
  'cerebras',
  'cloudflare-ai-gateway',
  'cloudflare-workers-ai',
  'deepseek',
  'fireworks',
  'github-copilot',
  'google',
  'google-vertex',
  'groq',
  'huggingface',
  'kimi-coding',
  'minimax',
  'minimax-cn',
  'mistral',
  'moonshotai',
  'moonshotai-cn',
  'nvidia',
  'openai',
  'opencode',
  'opencode-go',
  'openrouter',
  'qwen-token-plan',
  'qwen-token-plan-cn',
  'together',
  'vercel-ai-gateway',
  'xai',
  'xiaomi',
  'xiaomi-token-plan-ams',
  'xiaomi-token-plan-cn',
  'xiaomi-token-plan-sgp',
  'zai',
  'zai-coding-cn',
])

const supportedProviders = new Set(fetchRoutedProviderIds)
const FETCH_ROUTER = Symbol.for('dsh-docker.platform-management.provider-fetch-router')
const MAX_CONTROL_RESPONSE_BYTES = 64 * 1024
const DEFAULT_SOCKET = '/run/dsh-platform/outbound-proxy.sock'
const DEFAULT_PROXY_URL = 'http://127.0.0.1:17897'

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

function installFetchRouter(store, routedFetch = proxyFetch) {
  const owner = Object.freeze({})
  let registry = globalThis[FETCH_ROUTER]
  if (registry === undefined) {
    const original = globalThis.fetch
    registry = { original, owner, store, routedFetch }
    const wrapper = function (input, init) {
      const route = registry.store.getStore()
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
  }
  return () => {
    if (registry.owner !== owner) return
    if (globalThis.fetch === registry.wrapper) globalThis.fetch = registry.original
    delete globalThis[FETCH_ROUTER]
  }
}

function routedIterator(next, providerId, store, { socketPath, proxyUrl, createDispatcher }) {
  let iterator
  let routePromise
  let closed = false

  async function route() {
    if (routePromise === undefined) {
      routePromise = issueProviderHandle(providerId, socketPath).then(({ handle }) => ({
        dispatcher: createDispatcher({ uri: proxyUrl, token: `DSH-Provider ${handle}` }),
      }))
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
    await context.dispatcher.close()
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
  createDispatcher = options => new ProxyAgent(options),
  routedFetch = proxyFetch,
} = {}) {
  const store = new AsyncLocalStorage()
  const removeFetchRouter = installFetchRouter(store, routedFetch)
  const disposeStream = ctx.on('llm/stream', (options, next) => {
    if (!supportedProviders.has(options.provider)) return next()
    return routedIterator(next, options.provider, store, { socketPath, proxyUrl, createDispatcher })
  }, { global: true, prepend: true })
  return () => {
    disposeStream?.()
    removeFetchRouter()
  }
}

export const providerRoutingInternals = Object.freeze({
  FETCH_ROUTER,
  controlRequest,
  installFetchRouter,
  issueProviderHandle,
  routedIterator,
})
