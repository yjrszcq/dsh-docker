import { readFile } from 'node:fs/promises'
import { durableReplace } from './atomic.mjs'
import { canonicalJson } from './canonical-json.mjs'

export async function readDeploymentStatus(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value
      : { platformLayout: 1, imageBaseline: null, current: null, imageBehindCurrent: false, recoveryMode: 'status-invalid' }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { platformLayout: 1, imageBaseline: null, current: null, imageBehindCurrent: false, recoveryMode: 'status-unavailable' }
    }
    throw error
  }
}

export async function writeDeploymentStatus(path, value) {
  await durableReplace(path, canonicalJson(value))
  return value
}
