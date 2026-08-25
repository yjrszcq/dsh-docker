import { installProviderRouting } from './provider-routing.js'

export const name = '@dsh-docker/platform-management'
export const inject = ['subprocess']

const PROXY_KEYS = Object.freeze([
  'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy',
  'NO_PROXY', 'no_proxy', 'ALL_PROXY', 'all_proxy',
])

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

function managedSubprocessSpec(spec, environment = process.env) {
  if (spec?.env?.DSH_SHELL !== '1') return spec
  const proxy = agentNetworkEnvironment(environment)
  if (proxy === null) return spec
  const env = { ...spec.env }
  for (const key of PROXY_KEYS) delete env[key]
  return { ...spec, env: { ...env, ...proxy } }
}

export function apply(ctx) {
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
    removeProviderRouting()
    if (service.spawn === managedSpawn) service.spawn = spawn
    if (service.spawnTerminal === managedSpawnTerminal) service.spawnTerminal = spawnTerminal
  }, 'dsh-docker managed network scopes')
}

export const managedNetworkInternals = Object.freeze({ agentNetworkEnvironment, managedSubprocessSpec })
