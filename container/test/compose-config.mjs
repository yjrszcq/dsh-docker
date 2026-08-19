#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

function render(overrides = {}) {
  const env = {
    ...process.env,
    DSH_DEFAULT_WORKSPACE: '/workspace',
    DSH_IMAGE_TAG: 'latest',
    DSH_LISTEN_ADDRESS: '0.0.0.0',
    DSH_PORT: '3000',
    DSH_PROXY_USERNAME: '',
    DSH_PROXY_PASSWORD: '',
    DSH_PROXY_POLYFILL: 'true',
    DSH_TELEMETRY_DISABLED: 'true',
    DSH_TRUSTED_HOST: '',
    DSH_TRUSTED_HOSTS: '',
    DSH_WORKSPACE: './workspace',
    ...overrides,
  }
  if (!Object.hasOwn(overrides, 'DSH_SUDO_ENABLED')) delete env.DSH_SUDO_ENABLED

  const result = spawnSync(
    'docker',
    ['compose', '-f', 'docker-compose.yaml', 'config', '--format', 'json'],
    {
      encoding: 'utf8',
      env,
    },
  )
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout).services['deepseek-harness']
}

const defaults = render()
assert.equal(defaults.image, 'dsh-docker:test')
assert.equal(defaults.container_name, 'dsh-test')
assert.equal(defaults.ports[0].host_ip, '0.0.0.0')
assert.equal(defaults.ports[0].published, '3000')
assert.equal(defaults.environment.DSH_PROXY_USERNAME, '')
assert.equal(defaults.environment.DSH_PROXY_PASSWORD, '')
assert.equal(defaults.environment.DSH_PROXY_POLYFILL, 'true')
assert.equal(defaults.environment.DSH_TRUSTED_HOSTS, '')
assert.equal(Object.hasOwn(defaults.environment, 'DSH_UPDATE_METADATA_URL'), false)
assert.deepEqual(defaults.group_add, ['dsh-sudo-true'])
assert.equal(defaults.environment.DSH_UPDATE_CHECK_INTERVAL_SECONDS, '21600')
assert.equal(defaults.environment.DSH_EXPERIMENTAL_PROBATION_SECONDS, '120')
assert.equal(defaults.environment.DSH_LOG_MAX_BYTES, '104857600')
assert.equal(defaults.environment.DSH_PLATFORM_DATA, '/data/platform')
assert.equal(defaults.environment.DSH_HOME, '/data/dsh')
assert.deepEqual(defaults.volumes.map(volume => volume.target).sort(), ['/data/dsh', '/data/platform', '/workspace'])

const configured = render({
  DSH_LISTEN_ADDRESS: '0.0.0.0',
  DSH_PORT: '4080',
  DSH_PROXY_USERNAME: 'compose-user',
  DSH_PROXY_PASSWORD: 'compose-secret',
  DSH_PROXY_POLYFILL: 'false',
  DSH_SUDO_ENABLED: 'false',
  DSH_TELEMETRY_DISABLED: 'false',
  DSH_TRUSTED_HOSTS: '192.168.1.10,dsh.example:8443',
})
assert.equal(configured.ports[0].host_ip, '0.0.0.0')
assert.equal(configured.ports[0].published, '4080')
assert.equal(configured.environment.DSH_PROXY_USERNAME, 'compose-user')
assert.equal(configured.environment.DSH_PROXY_PASSWORD, 'compose-secret')
assert.equal(configured.environment.DSH_PROXY_POLYFILL, 'false')
assert.equal(configured.environment.DSH_TELEMETRY_DISABLED, 'false')
assert.equal(configured.environment.DSH_TRUSTED_HOSTS, '192.168.1.10,dsh.example:8443')
assert.deepEqual(configured.group_add, ['dsh-sudo-false'])

const legacy = render({ DSH_TRUSTED_HOST: 'old.example', DSH_TRUSTED_HOSTS: '' })
assert.equal(legacy.environment.DSH_TRUSTED_HOST, 'old.example')
assert.equal(legacy.environment.DSH_TRUSTED_HOSTS, '')

console.log('Compose configuration checks passed')
