import { PROXY_PORTS } from './contracts.mjs'

function enabled(configuration, scope) {
  if (!configuration.enabled) return false
  if (scope === 'sharedDsh') return configuration.scopes.dshCore || configuration.scopes.dshPlugins
  if (scope === 'modelApi') return false
  return configuration.scopes[scope] === true
}

export class ProxyRouteHealth {
  constructor() {
    this.revision = null
    this.routes = new Map()
  }

  observe(snapshot, scope, outcome) {
    if (snapshot.revision !== this.revision) {
      this.revision = snapshot.revision
      this.routes.clear()
    }
    if (!['ready', 'degraded'].includes(outcome)) throw new TypeError('proxy route health outcome is invalid')
    this.routes.set(scope, outcome)
  }

  status(snapshot) {
    if (snapshot.revision !== this.revision) {
      this.revision = snapshot.revision
      this.routes.clear()
    }
    return Object.freeze(Object.fromEntries(Object.keys(PROXY_PORTS).map(scope => [
      scope,
      enabled(snapshot.configuration, scope) ? (this.routes.get(scope) ?? 'unknown') : 'direct',
    ])))
  }
}
