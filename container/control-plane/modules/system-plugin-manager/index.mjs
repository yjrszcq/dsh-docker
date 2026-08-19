import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { canonicalJson } from '../../../platform/lib/canonical-json.mjs'

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolveRun(Buffer.concat(stdout).toString('utf8'))
      else reject(new Error(`${command} failed: ${Buffer.concat(stderr).toString('utf8').trim()}`))
    })
  })
}

async function extractPackage(archive, destination) {
  const listing = (await run('tar', ['-tzf', archive])).split('\n').filter(Boolean)
  if (listing.length === 0) throw new Error('System Plugin archive is empty')
  for (const name of listing) {
    if (!name.startsWith('package/') || name.startsWith('/') || name.split('/').includes('..')) {
      throw new Error(`System Plugin archive path is unsafe: ${name}`)
    }
  }
  await mkdir(destination, { recursive: true })
  await run('tar', ['-xzf', archive, '--strip-components=1', '--no-same-owner', '--no-same-permissions', '-C', destination])
}

function validatePatch(value, pluginId) {
  if (!Array.isArray(value)) throw new Error(`System Plugin ${pluginId} cordis.patch.json must be an array`)
  for (const [index, entry] of value.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`System Plugin ${pluginId} patch ${String(index)} must be an object`)
    }
    if (typeof entry.id !== 'string' || !entry.id.startsWith(`dsh-docker.${pluginId}.`)) {
      throw new Error(`System Plugin ${pluginId} patch IDs must use its dsh-docker namespace`)
    }
  }
  return value
}

async function replaceLink(root, name, version) {
  const temporary = join(root, `.${name}.${randomUUID()}.tmp`)
  await symlink(join('versions', version), temporary)
  await rename(temporary, join(root, name))
}

export async function reconcileSystemPlugins({ root, environmentVersion, plugins, artifactPath }) {
  const managedRoot = resolve(root)
  const versions = join(managedRoot, 'versions')
  const destination = join(versions, environmentVersion)
  const staging = join(versions, `.${environmentVersion}.${randomUUID()}.tmp`)
  await mkdir(staging, { recursive: true })
  const patches = []
  try {
    for (const plugin of plugins) {
      const packageRoot = join(staging, 'packages', plugin.id)
      await extractPackage(artifactPath(plugin), packageRoot)
      const patch = JSON.parse(await readFile(join(packageRoot, 'cordis.patch.json'), 'utf8'))
      patches.push(...validatePatch(patch, plugin.id))
    }
    await writeFile(join(staging, 'cordis.patch.yml'), canonicalJson(patches), { flag: 'wx' })
    await rename(staging, destination)
    const current = await import('node:fs/promises').then(({ readlink }) => readlink(join(managedRoot, 'current')).catch(error => error.code === 'ENOENT' ? undefined : Promise.reject(error)))
    if (current !== undefined) await replaceLink(managedRoot, 'previous', current.split('/').at(-1))
    await replaceLink(managedRoot, 'current', environmentVersion)
    return destination
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}
