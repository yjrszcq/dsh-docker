import { readFile } from 'node:fs/promises'
import { durableReplace } from '../../../../platform/lib/atomic.mjs'

export const TERMINAL_UPDATE_STATES = new Set(['idle', 'success', 'failed'])

export class UpdateStateStore {
  constructor(path, now = () => new Date()) {
    this.path = path
    this.now = now
  }

  async read() {
    try {
      return JSON.parse(await readFile(this.path, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return { status: 'idle', taskId: null, progress: 0, error: null }
      throw error
    }
  }

  async write(status, fields = {}) {
    const previous = await this.read()
    const next = {
      ...previous,
      ...fields,
      status,
      updatedAt: this.now().toISOString(),
    }
    await durableReplace(this.path, `${JSON.stringify(next)}\n`)
    return Object.freeze(next)
  }
}
