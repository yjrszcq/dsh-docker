import { BlockList, isIP } from 'node:net'
import { domainToASCII } from 'node:url'
import { ProxyConfigurationError } from './errors.mjs'

export const PLATFORM_NO_PROXY = Object.freeze(['localhost', '127.0.0.1', '::1'])

function invalid(label) {
  throw new ProxyConfigurationError(`${label} rule is invalid`)
}

function normalizePort(value, label) {
  if (!/^[0-9]+$/.test(value)) invalid(label)
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) invalid(label)
  return port
}

function splitHostPort(input, label) {
  if (input.startsWith('[')) {
    const close = input.indexOf(']')
    if (close < 0) invalid(label)
    const host = input.slice(1, close)
    const suffix = input.slice(close + 1)
    if (suffix === '') return { host, port: null }
    if (!suffix.startsWith(':')) invalid(label)
    return { host, port: normalizePort(suffix.slice(1), label) }
  }
  if (isIP(input) === 6) return { host: input, port: null }
  const colon = input.lastIndexOf(':')
  if (colon >= 0) {
    if (input.indexOf(':') !== colon) invalid(label)
    return { host: input.slice(0, colon), port: normalizePort(input.slice(colon + 1), label) }
  }
  return { host: input, port: null }
}

function normalizeHost(input, label) {
  let value = input.toLowerCase()
  while (value.endsWith('.')) value = value.slice(0, -1)
  if (value === '') invalid(label)
  const ipType = isIP(value)
  if (ipType !== 0) return { host: value, ipType }
  const suffix = value.startsWith('.')
  const name = suffix ? value.slice(1) : value
  if (name === '' || name.includes('*')) invalid(label)
  const ascii = domainToASCII(name)
  if (ascii === '' || ascii.length > 253 || ascii.split('.').some(part => part === '' || part.length > 63)) invalid(label)
  return { host: suffix ? `.${ascii}` : ascii, ipType: 0 }
}

export function normalizeProxyRule(input, { allowWildcard = false, allowCidr = false, label = 'proxy' } = {}) {
  if (
    typeof input !== 'string'
    || input === ''
    || input !== input.trim()
    || /[\u0000-\u0020\u007f]/.test(input)
    || /[@?#]/.test(input)
  ) invalid(label)
  if (input === '*') {
    if (!allowWildcard) invalid(label)
    return Object.freeze({ type: 'wildcard', value: '*' })
  }
  if (input.includes('/')) {
    if (!allowCidr) invalid(label)
    if (input.indexOf('/') !== input.lastIndexOf('/')) invalid(label)
    const slash = input.lastIndexOf('/')
    const address = input.slice(0, slash)
    const type = isIP(address)
    const prefix = Number(input.slice(slash + 1))
    if (type === 0 || !Number.isInteger(prefix) || prefix < 0 || prefix > (type === 4 ? 32 : 128)) invalid(label)
    return Object.freeze({ type: 'cidr', value: `${address}/${prefix}`, address, prefix, ipType: type })
  }
  const { host: rawHost, port } = splitHostPort(input, label)
  const { host, ipType } = normalizeHost(rawHost, label)
  const bracketed = ipType === 6 && port !== null
  const value = port === null ? host : `${bracketed ? `[${host}]` : host}:${String(port)}`
  return Object.freeze({ type: host.startsWith('.') ? 'suffix' : 'host', value, host, port, ipType })
}

export function normalizeProxyRules(values, options = {}) {
  if (!Array.isArray(values)) throw new ProxyConfigurationError(`${options.label ?? 'proxy'} rules must be an array`)
  const result = new Map()
  for (const value of values) {
    const rule = normalizeProxyRule(value, options)
    result.set(rule.value, rule)
  }
  return Object.freeze([...result.values()].sort((left, right) => left.value.localeCompare(right.value)))
}

function hostMatches(rule, host, port) {
  if (rule.port !== null && rule.port !== port) return false
  if (rule.type === 'suffix') {
    const root = rule.host.slice(1)
    return host === root || host.endsWith(`.${root}`)
  }
  return host === rule.host
}

export function matchesProxyRules(rules, targetHost, targetPort = null) {
  const normalized = normalizeHost(String(targetHost), 'target').host
  const ipType = isIP(normalized)
  for (const rule of rules) {
    if (rule.type === 'wildcard') return true
    if (rule.type === 'cidr') {
      if (ipType === 0) continue
      const block = new BlockList()
      block.addSubnet(rule.address, rule.prefix, rule.ipType === 4 ? 'ipv4' : 'ipv6')
      if (block.check(normalized, ipType === 4 ? 'ipv4' : 'ipv6')) return true
      continue
    }
    if (hostMatches(rule, normalized, targetPort)) return true
  }
  return false
}

export function noProxyEnvironment(userRules) {
  const system = normalizeProxyRules(PLATFORM_NO_PROXY, { label: 'platform NO_PROXY' })
  const user = normalizeProxyRules(userRules, { allowWildcard: true, label: 'NO_PROXY' })
  return [...new Set([...system, ...user].map(rule => rule.value))].join(',')
}
