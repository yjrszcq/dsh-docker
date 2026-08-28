import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { LocalApiClient } from '../../control-plane/modules/updater/lib/client.mjs'
import {
  createRestrictedCliServer,
  restrictedCliRoute,
} from '../../control-plane/services/management/restricted-cli.mjs'
import { listenManagement } from '../../control-plane/services/management/server.mjs'

test('restricted CLI channel forwards only documented public operations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-restricted-cli-'))
  const managementSocket = join(root, 'management.sock')
  const cliSocket = join(root, 'management-cli.sock')
  const seen = []
  const management = createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, token: request.headers['x-dsh-restricted-cli'] })
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"ok":true}')
  })
  const cli = createRestrictedCliServer({ managementSocketPath: managementSocket, token: 'x'.repeat(32) })
  try {
    await listenManagement(management, managementSocket)
    await listenManagement(cli, cliSocket)
    const client = new LocalApiClient(cliSocket)
    assert.deepEqual(await client.request('GET', '/_dsh_platform/api/v1/status'), { ok: true })
    assert.deepEqual(await client.request('GET', '/_dsh_platform/api/v1/logs?limit=10'), { ok: true })
    assert.deepEqual(await client.request('POST', '/_dsh_platform/api/v1/restart-dsh'), { ok: true })
    await assert.rejects(
      client.request('GET', '/_dsh_platform/api/v1/auth-settings'),
      error => error.statusCode === 404 && error.code === 'CLI_ROUTE_NOT_AVAILABLE',
    )
    await assert.rejects(
      client.request('GET', '/_dsh_platform/api/v1/files/list?path=%2F'),
      error => error.statusCode === 404 && error.code === 'CLI_ROUTE_NOT_AVAILABLE',
    )
    assert.equal(seen.length, 3)
    assert.equal(seen.every(value => value.token === 'x'.repeat(32)), true)
  } finally {
    await Promise.all([
      new Promise(resolve => cli.close(resolve)),
      new Promise(resolve => management.close(resolve)),
    ])
    await rm(root, { recursive: true, force: true })
  }
})

test('restricted CLI allowlist binds both method and normalized pathname', () => {
  assert.equal(restrictedCliRoute('GET', '/_dsh_platform/api/v1/status'), true)
  assert.equal(restrictedCliRoute('POST', '/_dsh_platform/api/v1/status'), false)
  assert.equal(restrictedCliRoute('GET', '/_dsh_platform/api/v1/logs?source=stage0'), true)
  assert.equal(restrictedCliRoute('GET', '/_dsh_platform/api/v1/terminal/sessions'), false)
  assert.equal(restrictedCliRoute('GET', '/_dsh_platform/api/v1/status/../auth-settings'), false)
})
