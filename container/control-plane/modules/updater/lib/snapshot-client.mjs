export class SnapshotClient {
  constructor(api, scope) {
    if (!['dsh', 'user-plugin'].includes(scope)) throw new Error('snapshot scope is invalid')
    this.api = api
    this.scope = scope
  }

  async call(operation, body, onProgress) {
    const response = await this.api.request('POST', `/v1/${this.scope}/${operation}`, body)
    if (response.progress !== null && onProgress !== undefined) await onProgress(response.progress)
    return response.result
  }

  create(value = undefined) {
    if (this.scope === 'dsh') {
      const { onProgress, ...body } = value
      return this.call('create', body, onProgress)
    }
    return this.call('create', { id: value })
  }

  inspect(id) { return this.call('inspect', { id }) }

  restore(id, { onProgress } = {}) {
    return this.call('restore', { id }, onProgress)
  }

  remove(id) { return this.call('remove', { id }) }
}
