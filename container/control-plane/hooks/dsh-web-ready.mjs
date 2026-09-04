#!/usr/bin/env node

import { request } from 'node:http'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const RUN_ROOT = process.env.DSH_PLATFORM_RUN ?? '/run/dsh-platform'

function fetchResponse(host, port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ hostname: host, port, path, ...options }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.once('end', () => {
        resolve({
          body: Buffer.concat(chunks),
          headers: response.headers,
          status: response.statusCode,
        })
      })
    })
    outgoing.setTimeout(2_000, () => outgoing.destroy(new Error('DSH Web request timed out')))
    outgoing.once('error', reject)
    outgoing.end(options.body)
  })
}

async function fetch(host, port, path, options = {}) {
  const response = await fetchResponse(host, port, path, options)
  if (response.status !== 200) throw new Error(`${path} returned HTTP ${String(response.status)}`)
  return response.body
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function lifecycleReadiness() {
  const body = Buffer.from('{}')
  return new Promise((resolve, reject) => {
    const outgoing = request({
      socketPath: `${RUN_ROOT}/dsh-lifecycle.sock`,
      path: '/v1/runtime/readiness',
      method: 'POST',
      headers: {
        'content-length': body.byteLength,
        'content-type': 'application/json',
      },
    }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.once('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`DSH lifecycle readiness returned HTTP ${String(response.statusCode)}`))
          return
        }
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          resolve({
            ready: value?.ready === true,
            readyUrl: typeof value?.readyUrl === 'string' ? value.readyUrl : null,
          })
        } catch (error) {
          reject(error)
        }
      })
    })
    outgoing.setTimeout(2_000, () => outgoing.destroy(new Error('DSH lifecycle readiness timed out')))
    outgoing.once('error', reject)
    outgoing.end(body)
  })
}

async function waitForManagedReady(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const readiness = await lifecycleReadiness()
    if (readiness.ready) return readiness
    await delay(100)
  }
  throw new Error('DSH managed Web boot did not complete')
}

async function authenticationHeaders(host, port, readyUrl) {
  if (readyUrl === null) return {}
  const url = new URL(readyUrl)
  if (url.protocol !== 'http:' || url.hostname !== host || Number(url.port) !== port
    || url.pathname !== '/' || url.username !== '' || url.password !== '' || url.hash !== ''
    || url.searchParams.getAll('token').length !== 1) {
    throw new Error('DSH Web readiness URL is invalid')
  }
  const exchange = await fetchResponse(host, port, `${url.pathname}${url.search}`, {
    headers: { 'cache-control': 'no-store' },
  })
  const cookie = exchange.headers['set-cookie']?.[0]?.split(';', 1)[0]
  if (exchange.status !== 303 || exchange.headers.location !== '/' || typeof cookie !== 'string' || cookie === '') {
    throw new Error('DSH Web authentication exchange failed')
  }
  return { cookie }
}

async function verifyBootManifest(host, port, headers) {
  const html = (await fetch(host, port, '/', { headers })).toString('utf8')
  const match = /(?:window\.__DSH_BOOT__|globalThis\["__DSH_BOOT__"\])\s*=\s*(\{.*?\})<\/script>/s.exec(html)
  if (match === null) throw new Error('DSH boot manifest is unavailable')
  const manifest = JSON.parse(match[1])
  if (!Array.isArray(manifest.entries)) throw new Error('DSH boot manifest entries are invalid')
  await Promise.all(manifest.entries.map(async entry => {
    if (typeof entry?.url !== 'string' || !entry.url.startsWith('/plugins/')) {
      throw new Error('DSH boot manifest contains an invalid Plugin URL')
    }
    await fetch(host, port, entry.url, { headers })
  }))
}

async function verifyPluginInventory(host, port, headers) {
  const body = JSON.stringify({
    type: 'client-request',
    rpcId: 'dsh-platform-readiness',
    method: 'pluginInventory/list',
    payload: { args: {} },
  })
  const response = JSON.parse((await fetch(host, port, '/api/pluginInventory/list', {
    method: 'POST',
    headers: {
      ...headers,
      'content-length': Buffer.byteLength(body),
      'content-type': 'application/json',
    },
    body,
  })).toString('utf8'))
  if (response?.rpcId !== 'dsh-platform-readiness' || response?.result?.ok !== true) {
    const message = response?.result?.error?.message
    throw new Error(`DSH Plugin inventory is unavailable${typeof message === 'string' ? `: ${message}` : ''}`)
  }
  const entries = response.result.value?.entries
  if (!Array.isArray(entries)) throw new Error('DSH Plugin inventory entries are invalid')
  const unhealthy = entries.filter(entry => entry?.enabled === true && entry?.fiberPhase !== 'active')
  if (unhealthy.length > 0) {
    const detail = unhealthy.map(entry => `${String(entry?.moduleName ?? entry?.entryId ?? 'unknown')} (${String(entry?.fiberPhase)})`).join(', ')
    throw new Error(`DSH Plugins are not active: ${detail}`)
  }
}

export async function verifyDshWebReady({
  host = '127.0.0.1',
  port = 3079,
  stabilityMs = 1_000,
  managedReady = waitForManagedReady,
} = {}) {
  const readiness = await managedReady()
  const headers = await authenticationHeaders(host, port, readiness?.readyUrl ?? null)
  await verifyBootManifest(host, port, headers)
  await verifyPluginInventory(host, port, headers)
  if (stabilityMs > 0) await delay(stabilityMs)
  await verifyBootManifest(host, port, headers)
  await verifyPluginInventory(host, port, headers)
}

if (process.argv[1] !== undefined
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await verifyDshWebReady()
}
