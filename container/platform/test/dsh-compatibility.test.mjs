import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  DSH_COMPATIBILITY_PACKAGES,
  DSH_REMOTE_METHODS,
  DSH_STATIC_CLIENT_MODULES,
  DSH_WEB_ROWS,
  verifyDshCompatibility,
} from '../lib/dsh-compatibility.mjs'

const VERSION = '0.1.5-rc.1'

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`)
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-compatibility-fixture-'))
  await mkdir(join(root, 'lib'), { recursive: true })
  await writeJson(join(root, 'package.json'), {
    name: '@deepseek-ai/dsh',
    version: VERSION,
    type: 'module',
    bin: { dsh: 'lib/bin.js' },
    dependencies: Object.fromEntries(Object.keys(DSH_COMPATIBILITY_PACKAGES).map(name => [name, `^${VERSION}`])),
  })
  const config = Object.entries(DSH_WEB_ROWS)
    .map(([id, name]) => `- id: ${id}\n  name: '${name}'`)
    .join('\n')
  await writeFile(join(root, 'lib/bin.js'), `console.log(${JSON.stringify(config)})\n`)
  for (const [name, exports] of Object.entries(DSH_COMPATIBILITY_PACKAGES)) {
    const directory = join(root, 'node_modules', ...name.split('/'))
    await mkdir(join(directory, 'lib'), { recursive: true })
    await writeJson(join(directory, 'package.json'), {
      name,
      version: VERSION,
      exports: Object.fromEntries(exports.map(subpath => [subpath, './lib/index.js'])),
    })
    await writeFile(join(directory, 'lib/index.js'), '')
  }
  await writeFile(
    packageFile(root, '@deepseek-ai/dsh-api-remotes', 'lib/client.js'),
    DSH_REMOTE_METHODS.join('\n'),
  )
  const frontendAssets = packageFile(root, '@deepseek-ai/dsh-web-frontend', 'dist/assets')
  await mkdir(frontendAssets, { recursive: true })
  await writeFile(join(frontendAssets, 'index.js'), DSH_STATIC_CLIENT_MODULES.join('\n'))
  return root
}

function packageFile(root, packageName, file) {
  return join(root, 'node_modules', ...packageName.split('/'), file)
}

function removeAfter(t, ...paths) {
  t.after(() => Promise.all(paths.map(path => rm(path, { recursive: true, force: true }))))
}

test('accepts the complete DSH package, Web profile, and Remote contract', async t => {
  const packageRoot = await fixture()
  const home = await mkdtemp(join(tmpdir(), 'dsh-compatibility-home-'))
  removeAfter(t, packageRoot, home)
  assert.deepEqual(await verifyDshCompatibility({ packageRoot, expectedVersion: VERSION, home }), {
    name: '@deepseek-ai/dsh',
    version: VERSION,
    packages: 10,
    remoteMethods: 3,
    webRows: 5,
  })
})

test('rejects a stale installed package in the DSH dependency closure', async t => {
  const packageRoot = await fixture()
  const home = await mkdtemp(join(tmpdir(), 'dsh-compatibility-home-'))
  removeAfter(t, packageRoot, home)
  const manifestPath = packageFile(packageRoot, '@deepseek-ai/dsh-client-connection', 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  await writeJson(manifestPath, { ...manifest, version: '0.1.2-rc.1' })
  await assert.rejects(
    verifyDshCompatibility({ packageRoot, expectedVersion: VERSION, home }),
    /dsh-client-connection is not installed at DSH version 0\.1\.5-rc\.1/,
  )
})

test('rejects missing Web rows and management Remote methods', async t => {
  const packageRoot = await fixture()
  const home = await mkdtemp(join(tmpdir(), 'dsh-compatibility-home-'))
  removeAfter(t, packageRoot, home)
  await writeFile(join(packageRoot, 'lib/bin.js'), 'console.log("- id: connection\\n  name: missing")\n')
  await assert.rejects(
    verifyDshCompatibility({ packageRoot, expectedVersion: VERSION, home }),
    /DSH Web profile does not contain/,
  )

  await writeFile(
    packageFile(packageRoot, '@deepseek-ai/dsh-api-remotes', 'lib/client.js'),
    DSH_REMOTE_METHODS.slice(1).join('\n'),
  )
  await assert.rejects(
    verifyDshCompatibility({ packageRoot, expectedVersion: VERSION, home }),
    /Remote registry is missing/,
  )
})

test('rejects a missing static module required by a bundled System Plugin', async t => {
  const packageRoot = await fixture()
  const home = await mkdtemp(join(tmpdir(), 'dsh-compatibility-home-'))
  removeAfter(t, packageRoot, home)
  await writeFile(
    packageFile(packageRoot, '@deepseek-ai/dsh-web-frontend', 'dist/assets/index.js'),
    'no platform modules\n',
  )
  await assert.rejects(
    verifyDshCompatibility({ packageRoot, expectedVersion: VERSION, home }),
    /Web static module table is missing/,
  )
})
