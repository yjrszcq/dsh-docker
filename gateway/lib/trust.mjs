function parseRequestAuthority(value) {
  try {
    return new URL(`http://${value}`)
  } catch {
    return undefined
  }
}

export function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function matchesTrustedAuthority(requestUrl, trustedHosts) {
  if (trustedHosts.wildcard) return true
  return trustedHosts.authorities.some((entry) => (
    entry.anyPort ? entry.hostname === requestUrl.hostname : entry.matchAuthority === requestUrl.host
  ))
}

export function inspectExternalRequest(headers, trustedHosts) {
  const host = headers.host
  if (typeof host !== 'string') return Object.freeze({ accepted: false, reason: 'missing-host' })
  const hostUrl = parseRequestAuthority(host)
  if (hostUrl === undefined) return Object.freeze({ accepted: false, reason: 'invalid-host' })
  if (!isLoopbackHostname(hostUrl.hostname) && !matchesTrustedAuthority(hostUrl, trustedHosts)) {
    return Object.freeze({ accepted: false, reason: 'untrusted-host' })
  }
  if (headers['sec-fetch-site'] === 'cross-site') {
    return Object.freeze({ accepted: false, reason: 'cross-site' })
  }
  const origin = headers.origin
  if (origin !== undefined) {
    if (typeof origin !== 'string') return Object.freeze({ accepted: false, reason: 'invalid-origin' })
    try {
      if (new URL(origin).host !== hostUrl.host) {
        return Object.freeze({ accepted: false, reason: 'origin-mismatch' })
      }
    } catch {
      return Object.freeze({ accepted: false, reason: 'invalid-origin' })
    }
  }
  return Object.freeze({ accepted: true, externalAuthority: hostUrl.host })
}
