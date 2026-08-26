import { readFileSync, watch } from 'node:fs'
import { basename, dirname } from 'node:path'
import { installProviderRouting } from './provider-routing.js'

export const name = '@dsh-docker/platform-management'
export const inject = ['subprocess']

const PROXY_KEYS = Object.freeze([
  'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy',
  'NO_PROXY', 'no_proxy', 'ALL_PROXY', 'all_proxy',
])
const CONNECTION_PROXY_KEYS = Object.freeze([
  'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy',
])
const SHARED_DSH_PROXY_URL = 'http://127.0.0.1:17898'
const ROUTING_STATE_PATH = `${process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform'}/outbound-proxy-routing.json`

function routingState(path = ROUTING_STATE_PATH) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (value?.schema !== 1 || typeof value.enabled !== 'boolean' || typeof value.scopes?.agentNetwork !== 'boolean') return null
    return value
  } catch {
    return null
  }
}

function agentNetworkEnvironment(environment = process.env) {
  const proxy = environment.DSH_PLATFORM_AGENT_PROXY_URL
  if (typeof proxy !== 'string' || proxy === '') return null
  const noProxy = environment.NO_PROXY ?? environment.no_proxy ?? ''
  const allProxy = environment.ALL_PROXY !== undefined || environment.all_proxy !== undefined
  return {
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    http_proxy: proxy,
    https_proxy: proxy,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
    ...(allProxy ? { ALL_PROXY: proxy, all_proxy: proxy } : {}),
  }
}

function sharedDshProxyEnabled(state) {
  return state !== null && state.enabled
    && (state.scopes?.dshCore === true || state.scopes?.dshPlugins === true)
}

function synchronizeSharedDshEnvironment(environment, state) {
  if (state === null) return
  for (const key of CONNECTION_PROXY_KEYS) delete environment[key]
  const noProxy = [...new Set([
    ...(state.noProxy?.system ?? []),
    ...(state.noProxy?.user ?? []),
  ])].join(',')
  environment.NO_PROXY = noProxy
  environment.no_proxy = noProxy
  if (!sharedDshProxyEnabled(state)) return
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) environment[key] = SHARED_DSH_PROXY_URL
  if (state.environment?.allProxy === 'scope-proxy') {
    environment.ALL_PROXY = SHARED_DSH_PROXY_URL
    environment.all_proxy = SHARED_DSH_PROXY_URL
  }
}

function watchSharedDshEnvironment(path = ROUTING_STATE_PATH, environment = process.env) {
  const original = Object.fromEntries(PROXY_KEYS.map(key => [key, environment[key]]))
  const synchronize = () => synchronizeSharedDshEnvironment(environment, routingState(path))
  synchronize()
  let watcher
  try {
    watcher = watch(dirname(path), (_event, filename) => {
      if (filename === null || filename.toString() === basename(path)) synchronize()
    })
    watcher.on('error', () => {})
  } catch {}
  return () => {
    watcher?.close()
    for (const key of PROXY_KEYS) {
      if (original[key] === undefined) delete environment[key]
      else environment[key] = original[key]
    }
  }
}

function managedSubprocessSpec(spec, environment = process.env, routingPath = ROUTING_STATE_PATH) {
  if (spec?.env?.DSH_SHELL !== '1') return spec
  const env = { ...spec.env }
  for (const key of PROXY_KEYS) delete env[key]
  const state = routingState(routingPath)
  if (state !== null && (!state.enabled || !state.scopes.agentNetwork)) {
    for (const key of PROXY_KEYS) env[key] = undefined
    return { ...spec, env }
  }
  const proxy = agentNetworkEnvironment(environment)
  if (proxy === null) return spec
  return { ...spec, env: { ...env, ...proxy } }
}

export function apply(ctx) {
  const removeSharedDshEnvironment = watchSharedDshEnvironment()
  const removeProviderRouting = installProviderRouting(ctx)
  const service = ctx.subprocess
  const spawn = service.spawn
  const spawnTerminal = service.spawnTerminal
  const managedSpawn = function (spec) {
    return spawn.call(this, managedSubprocessSpec(spec))
  }
  const managedSpawnTerminal = function (spec) {
    return spawnTerminal.call(this, managedSubprocessSpec(spec))
  }
  service.spawn = managedSpawn
  service.spawnTerminal = managedSpawnTerminal
  ctx.effect(() => () => {
    removeSharedDshEnvironment()
    removeProviderRouting()
    if (service.spawn === managedSpawn) service.spawn = spawn
    if (service.spawnTerminal === managedSpawnTerminal) service.spawnTerminal = spawnTerminal
  }, 'dsh-docker managed network scopes')
}

export const managedNetworkInternals = Object.freeze({
  agentNetworkEnvironment,
  managedSubprocessSpec,
  routingState,
  sharedDshProxyEnabled,
  synchronizeSharedDshEnvironment,
})
