import { lstat, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDeploymentRecord } from '../../lib/deployment-contracts.mjs'

async function jsonOptional(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

async function files(root, suffix = '') {
  try { return (await readdir(root)).filter(name => !name.startsWith('.') && name.endsWith(suffix)).sort() } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function removeUnmarked(root, retained, reserved = new Set()) {
  const removed = []
  for (const name of await files(root)) {
    if (reserved.has(name) || retained.has(name)) continue
    const path = join(root, name)
    const details = await lstat(path)
    if (!details.isDirectory() || details.isSymbolicLink()) continue
    await rm(path, { recursive: true, force: true })
    removed.push(name)
  }
  return removed
}

async function deploymentRecords(root) {
  const records = new Map()
  for (const name of await files(root, '.json')) {
    const record = parseDeploymentRecord(await readFile(join(root, name)))
    records.set(record.id, record)
  }
  return records
}

function recordIds(value, output) {
  if (typeof value === 'string' && value.startsWith('deployment-record-')) output.add(value)
  else if (Array.isArray(value)) for (const entry of value) recordIds(entry, output)
  else if (value !== null && typeof value === 'object') for (const entry of Object.values(value)) recordIds(entry, output)
}

function heldRecords(channel, records, roots) {
  const held = [...(channel?.holds ?? []), ...(channel?.experimentalBlocked === null || channel?.experimentalBlocked === undefined
    ? []
    : [channel.experimentalBlocked])]
  for (const hold of held) {
    for (const record of records.values()) {
      if (
        record.dshVersion === hold.dshVersion
        && (hold.environmentVersion === null || hold.environmentVersion === undefined || record.environmentVersion === hold.environmentVersion)
      ) roots.add(record.id)
    }
  }
}

export class PlatformGarbageCollector {
  constructor({ paths, deployments }) {
    this.paths = paths
    this.deployments = deployments
  }

  async roots(records) {
    const roots = new Set()
    const slots = await this.deployments.state()
    if (slots.current !== null) roots.add(slots.current)
    if (slots.previous !== null) roots.add(slots.previous)
    recordIds(await jsonOptional(this.deployments.activationPath), roots)
    const transaction = await jsonOptional(join(this.paths.updaterStateRoot, 'transaction.json'))
    recordIds(transaction, roots)
    heldRecords(await jsonOptional(join(this.paths.updaterStateRoot, 'channel.json')), records, roots)
    return { roots, transaction }
  }

  async collectDeployments() {
    const records = await deploymentRecords(this.deployments.recordsRoot)
    const { roots, transaction } = await this.roots(records)
    const retained = {
      environments: new Set(),
      pristine: new Set(),
      runtimes: new Set(),
      systemPlugins: new Set(),
      snapshots: new Set(),
    }
    for (const id of roots) {
      const record = records.get(id)
      if (record === undefined) continue
      for (const [field, output] of [
        ['environment', retained.environments],
        ['pristine', retained.pristine],
        ['runtime', retained.runtimes],
        ['systemPlugins', retained.systemPlugins],
      ]) if (record[field].storage === 'store') output.add(record[field].id)
      if (record.snapshotId !== null) retained.snapshots.add(record.snapshotId)
    }
    if (typeof transaction?.snapshotId === 'string') retained.snapshots.add(transaction.snapshotId)

    const reserved = new Set(['current', 'previous', 'versions'])
    const removed = {
      environments: await removeUnmarked(this.paths.environmentsRoot, retained.environments, reserved),
      pristine: await removeUnmarked(this.paths.pristineRoot, retained.pristine, reserved),
      runtimes: await removeUnmarked(this.paths.runtimesRoot, retained.runtimes, reserved),
      systemPlugins: await removeUnmarked(this.paths.systemPluginsRoot, retained.systemPlugins, reserved),
      snapshots: await removeUnmarked(join(this.paths.snapshotsRoot, 'versions'), retained.snapshots),
      records: [],
    }
    for (const [id] of records) {
      if (!roots.has(id)) {
        await rm(join(this.deployments.recordsRoot, `${id}.json`), { force: true })
        removed.records.push(id)
      }
    }
    return removed
  }

  async cleanCache() {
    const removed = []
    for (const name of await files(this.paths.downloadsRoot)) {
      await rm(join(this.paths.downloadsRoot, name), { recursive: true, force: true })
      removed.push(name)
    }
    return removed
  }

  async collect() {
    return Object.freeze({
      deployments: await this.collectDeployments(),
      cache: await this.cleanCache(),
    })
  }
}
