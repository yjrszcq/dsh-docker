import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

export const DSH_COMPATIBILITY_PACKAGES = Object.freeze({
  '@deepseek-ai/dsh-api-remotes': Object.freeze(['.', './client']),
  '@deepseek-ai/dsh-app-boot': Object.freeze(['.']),
  '@deepseek-ai/dsh-client-connection': Object.freeze(['.', './client']),
  '@deepseek-ai/dsh-client-locale': Object.freeze(['.', './client']),
  '@deepseek-ai/dsh-client-ui-settings': Object.freeze(['.', './client']),
  '@deepseek-ai/dsh-client-ui-theme': Object.freeze(['.', './client']),
  '@deepseek-ai/dsh-host-directory-picker-browse': Object.freeze(['.']),
  '@deepseek-ai/dsh-llm': Object.freeze(['.', './remote']),
  '@deepseek-ai/dsh-settings': Object.freeze(['.']),
  '@deepseek-ai/dsh-web-app': Object.freeze(['.', './startup', './cordis.patch.yml']),
})

const DSH_DIRECT_COMPATIBILITY_PACKAGES = Object.freeze([
  '@deepseek-ai/dsh-app-boot',
  '@deepseek-ai/dsh-web-app',
])

export const DSH_WEB_ROWS = Object.freeze({
  connection: '@deepseek-ai/dsh-client-connection',
  'plugin-inventory': '@deepseek-ai/dsh-host-plugin-inventory',
  'settings-controller': '@deepseek-ai/dsh-api-settings-controller',
  webserver: '@deepseek-ai/dsh-host-webserver',
  'web-runtime': '@deepseek-ai/dsh-web-app',
})

export const DSH_REMOTE_METHODS = Object.freeze([
  '@deepseek-ai/dsh-api-settings-controller#settings/describe',
  '@deepseek-ai/dsh-llm#llm/listConfigurableProviders',
  '@deepseek-ai/dsh-llm#llm/listProviders',
])

export const DSH_STATIC_CLIENT_MODULES = Object.freeze([
  '@deepseek-ai/dsh-client-ui-primitives',
  'react',
  'react-dom',
])

function packagePath(root, packageName, file = 'package.json') {
  return join(root, 'node_modules', ...packageName.split('/'), file)
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function requireObject(value, description) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${description} is invalid`)
  }
  return value
}

function requireText(source, expected, description) {
  if (!source.includes(expected)) throw new Error(`${description} is missing ${JSON.stringify(expected)}`)
}

function requireStaticModule(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = name === 'react'
    ? /(?:^|[{,])["']?react["']?:/
    : new RegExp(`["']${escaped}["']:`)
  if (!pattern.test(source)) throw new Error(`DSH Web static module table is missing ${JSON.stringify(name)}`)
}

function exported(manifest, subpath) {
  const exports = requireObject(manifest.exports, `${manifest.name} exports`)
  return Object.hasOwn(exports, subpath)
}

function webRowPattern(id, packageName) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedPackage = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n)- id: ${escapedId}\\n(?: {2}[^\\n]*\\n)*? {2}name: ['\"]?${escapedPackage}['\"]?(?:\\n|$)`)
}

export async function verifyDshCompatibility({ packageRoot, expectedVersion, home }) {
  if (typeof packageRoot !== 'string' || packageRoot === '') throw new TypeError('DSH package root is required')
  if (typeof expectedVersion !== 'string' || expectedVersion === '') throw new TypeError('Expected DSH version is required')
  if (typeof home !== 'string' || home === '') throw new TypeError('Temporary DSH home is required')

  const manifest = await json(join(packageRoot, 'package.json'))
  if (manifest.name !== '@deepseek-ai/dsh') throw new Error('DSH package name is invalid')
  if (manifest.version !== expectedVersion) {
    throw new Error(`DSH package version ${JSON.stringify(manifest.version)} does not match ${JSON.stringify(expectedVersion)}`)
  }
  if (manifest.bin?.dsh !== 'lib/bin.js') throw new Error('DSH command entry is not lib/bin.js')
  const dependencies = requireObject(manifest.dependencies, 'DSH dependencies')
  for (const packageName of DSH_DIRECT_COMPATIBILITY_PACKAGES) {
    if (typeof dependencies[packageName] !== 'string') throw new Error(`DSH does not declare ${packageName}`)
  }

  for (const [packageName, requiredExports] of Object.entries(DSH_COMPATIBILITY_PACKAGES)) {
    const dependency = await json(packagePath(packageRoot, packageName))
    if (dependency.name !== packageName || dependency.version !== expectedVersion) {
      throw new Error(`${packageName} is not installed at DSH version ${expectedVersion}`)
    }
    for (const subpath of requiredExports) {
      if (!exported(dependency, subpath)) throw new Error(`${packageName} does not export ${subpath}`)
    }
  }

  const remotes = await readFile(packagePath(packageRoot, '@deepseek-ai/dsh-api-remotes', 'lib/client.js'), 'utf8')
  for (const method of DSH_REMOTE_METHODS) requireText(remotes, method, 'DSH Remote registry')
  const frontendRoot = packagePath(packageRoot, '@deepseek-ai/dsh-web-frontend', 'dist/assets')
  const frontend = (await Promise.all((await readdir(frontendRoot))
    .filter(name => name.endsWith('.js'))
    .map(name => readFile(join(frontendRoot, name), 'utf8')))).join('\n')
  for (const moduleName of DSH_STATIC_CLIENT_MODULES) {
    requireStaticModule(frontend, moduleName)
  }

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [join(packageRoot, 'lib/bin.js'), '--profile', 'web', '--dump-default-config'],
    {
      env: { ...process.env, DSH_HOME: home },
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000,
    },
  )
  if (stderr.trim() !== '') throw new Error(`DSH config dump wrote to stderr: ${stderr.trim()}`)
  for (const [id, packageName] of Object.entries(DSH_WEB_ROWS)) {
    if (!webRowPattern(id, packageName).test(stdout)) {
      throw new Error(`DSH Web profile does not contain ${id} (${packageName})`)
    }
  }

  return Object.freeze({
    name: manifest.name,
    version: manifest.version,
    packages: Object.keys(DSH_COMPATIBILITY_PACKAGES).length,
    remoteMethods: DSH_REMOTE_METHODS.length,
    webRows: Object.keys(DSH_WEB_ROWS).length,
  })
}
