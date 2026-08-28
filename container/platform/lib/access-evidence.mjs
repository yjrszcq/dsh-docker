import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const EVIDENCE_KEYS = Object.freeze([
  'dshSettings',
  'webProfile',
  'dshSessions',
  'userSkills',
  'deploymentState',
  'managementState',
  'updaterState',
  'legacyAuthenticationConfigured',
])

async function exists(path) {
  return lstat(path).then(() => true, error => error?.code === 'ENOENT' ? false : Promise.reject(error))
}

async function nonEmptyDirectory(path) {
  try { return (await readdir(path)).length > 0 }
  catch (error) { return error?.code === 'ENOENT' ? false : Promise.reject(error) }
}

export function parseAccessEvidence(value) {
  let parsed
  try { parsed = JSON.parse(value) } catch { throw new Error('legacy installation evidence is invalid') }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed).length !== EVIDENCE_KEYS.length
    || EVIDENCE_KEYS.some(key => typeof parsed[key] !== 'boolean')) {
    throw new Error('legacy installation evidence is invalid')
  }
  return Object.freeze(Object.fromEntries(EVIDENCE_KEYS.map(key => [key, parsed[key]])))
}

export async function collectAccessEvidence({ dshHome, paths, legacyAuthenticationConfigured = false }) {
  const [
    dshSettings,
    webProfile,
    dshSessions,
    userSkills,
    deploymentState,
    managementState,
    updaterState,
  ] = await Promise.all([
    exists(join(dshHome, 'settings.yaml')),
    exists(join(dshHome, 'profiles', 'web', 'package.json')),
    nonEmptyDirectory(join(dshHome, 'sessions')),
    nonEmptyDirectory(join(dshHome, 'skills')),
    exists(join(paths.deploymentStateRoot, 'slots.json')),
    nonEmptyDirectory(paths.managementStateRoot),
    nonEmptyDirectory(paths.updaterStateRoot),
  ])
  return Object.freeze({
    dshSettings,
    webProfile,
    dshSessions,
    userSkills,
    deploymentState,
    managementState,
    updaterState,
    legacyAuthenticationConfigured: legacyAuthenticationConfigured === true,
  })
}
