import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { UsageError } from './errors.mjs'

export function parseBoolean(name, value, fallback) {
  const resolved = value ?? String(fallback)
  if (resolved === 'true') return true
  if (resolved === 'false') return false
  throw new UsageError(`${name} must be true or false`)
}

function parseUrlAuthority(value) {
  try {
    return new URL(`http://${value}`)
  } catch {
    return undefined
  }
}

function canonicalAuthority(value, parsed) {
  const port = parsed.port !== '' ? parsed.port : new URL(`https://${value}`).port
  return port === '' ? parsed.hostname : `${parsed.hostname}:${port}`
}

export function parseTrustedAuthority(value) {
  const parsed = parseUrlAuthority(value)
  if (
    parsed === undefined
    || parsed.hostname.includes('*')
    || canonicalAuthority(value, parsed) !== value.toLowerCase()
  ) {
    throw new UsageError(
      `DSH_TRUSTED_HOSTS entry ${JSON.stringify(value)} must be a canonical host or host:port authority`,
    )
  }
  const authority = canonicalAuthority(value, parsed)
  return Object.freeze({
    hostname: parsed.hostname,
    authority,
    anyPort: authority === parsed.hostname,
    matchAuthority: parsed.host,
  })
}

export function parseTrustedHosts(environment = process.env) {
  const plural = environment.DSH_TRUSTED_HOSTS?.trim() ?? ''
  const legacy = environment.DSH_TRUSTED_HOST?.trim() ?? ''
  if (plural !== '' && legacy !== '') {
    throw new UsageError('DSH_TRUSTED_HOSTS and DSH_TRUSTED_HOST cannot both be set')
  }

  const raw = plural !== '' ? plural : legacy
  if (raw === '') return Object.freeze({ wildcard: false, authorities: Object.freeze([]) })

  const entries = raw.split(',').map(entry => entry.trim())
  if (entries.some(entry => entry === '')) {
    throw new UsageError('DSH_TRUSTED_HOSTS cannot contain an empty entry')
  }
  if (entries.includes('*')) {
    if (entries.length !== 1) throw new UsageError('DSH_TRUSTED_HOSTS wildcard must be used alone')
    return Object.freeze({ wildcard: true, authorities: Object.freeze([]) })
  }

  const unique = new Map()
  for (const entry of entries) {
    const parsed = parseTrustedAuthority(entry)
    unique.set(`${parsed.authority}|${String(parsed.anyPort)}`, parsed)
  }
  return Object.freeze({ wildcard: false, authorities: Object.freeze([...unique.values()]) })
}

export async function validateWorkspace(path) {
  if (!isAbsolute(path)) throw new UsageError('DSH_DEFAULT_WORKSPACE must be an absolute path')
  try {
    const details = await stat(path)
    if (!details.isDirectory()) throw new UsageError('DSH_DEFAULT_WORKSPACE must name a directory')
    await access(path, constants.R_OK | constants.X_OK)
  } catch (error) {
    if (error instanceof UsageError) throw error
    throw new UsageError(`DSH_DEFAULT_WORKSPACE is not an accessible directory: ${path}`)
  }
  return path
}

export async function loadConfig(environment = process.env) {
  const workspace = await validateWorkspace(environment.DSH_DEFAULT_WORKSPACE ?? '/workspace')
  const username = environment.DSH_PROXY_USERNAME ?? ''
  const password = environment.DSH_PROXY_PASSWORD ?? ''
  if (password !== '' && username.includes(':')) {
    throw new UsageError('DSH_PROXY_USERNAME cannot contain a colon when authentication is enabled')
  }
  return Object.freeze({
    trustedHosts: parseTrustedHosts(environment),
    password,
    username,
    polyfill: parseBoolean('DSH_PROXY_POLYFILL', environment.DSH_PROXY_POLYFILL, true),
    telemetryDisabled: parseBoolean(
      'DSH_TELEMETRY_DISABLED',
      environment.DSH_TELEMETRY_DISABLED,
      true,
    ),
    workspace,
  })
}
