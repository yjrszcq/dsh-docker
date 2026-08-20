import { UsageError } from './errors.mjs'
import { readFile } from 'node:fs/promises'

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
  const raw = environment.DSH_TRUSTED_HOSTS?.trim() ?? ''
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

export async function loadConfig(environment = process.env) {
  const username = environment.DSH_PROXY_USERNAME ?? ''
  const password = environment.DSH_PROXY_PASSWORD ?? ''
  const platformPasswordPath = environment.DSH_PLATFORM_PASSWORD_FILE?.trim() ?? ''
  const configuredPlatformPassword = environment.DSH_PLATFORM_PASSWORD ?? ''
  if (configuredPlatformPassword !== '' && platformPasswordPath !== '') {
    throw new UsageError('DSH_PLATFORM_PASSWORD and DSH_PLATFORM_PASSWORD_FILE cannot both be set')
  }
  let platformPassword = configuredPlatformPassword
  if (platformPasswordPath !== '') {
    try {
      platformPassword = (await readFile(platformPasswordPath, 'utf8')).replace(/\r?\n$/, '')
    } catch (error) {
      throw new UsageError(`DSH_PLATFORM_PASSWORD_FILE cannot be read: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }
  if (password !== '' && username.includes(':')) {
    throw new UsageError('DSH_PROXY_USERNAME cannot contain a colon when authentication is enabled')
  }
  return Object.freeze({
    trustedHosts: parseTrustedHosts(environment),
    password,
    platformPassword,
    username,
    polyfill: parseBoolean('DSH_PROXY_POLYFILL', environment.DSH_PROXY_POLYFILL, true),
  })
}
