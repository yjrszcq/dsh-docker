#!/usr/bin/env node

import { request } from 'node:http'
import { pathToFileURL } from 'node:url'

function fetch(host, port, path) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ hostname: host, port, path }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.once('end', () => {
        if (response.statusCode !== 200) reject(new Error(`${path} returned HTTP ${String(response.statusCode)}`))
        else resolve(Buffer.concat(chunks))
      })
    })
    outgoing.setTimeout(2_000, () => outgoing.destroy(new Error(`${path} timed out`)))
    outgoing.once('error', reject)
    outgoing.end()
  })
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function verifyBootManifest(host, port) {
  const html = (await fetch(host, port, '/')).toString('utf8')
  const match = /window\.__DSH_BOOT__\s*=\s*(\{.*?\})<\/script>/s.exec(html)
  if (match === null) throw new Error('DSH boot manifest is unavailable')
  const manifest = JSON.parse(match[1])
  if (!Array.isArray(manifest.entries)) throw new Error('DSH boot manifest entries are invalid')
  await Promise.all(manifest.entries.map(async entry => {
    if (typeof entry?.url !== 'string' || !entry.url.startsWith('/plugins/')) {
      throw new Error('DSH boot manifest contains an invalid Plugin URL')
    }
    await fetch(host, port, entry.url)
  }))
}

export async function verifyDshWebReady({ host = '127.0.0.1', port = 3079, stabilityMs = 1_000 } = {}) {
  await verifyBootManifest(host, port)
  if (stabilityMs > 0) await delay(stabilityMs)
  await verifyBootManifest(host, port)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyDshWebReady()
}
