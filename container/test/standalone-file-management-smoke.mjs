import assert from 'node:assert/strict'
import { symlink } from 'node:fs/promises'

const API = 'http://127.0.0.1:3080/_dsh_platform/api/v1'
const headers = {
  authorization: `Basic ${Buffer.from('smoke-user:smoke-password').toString('base64')}`,
  host: 'smoke.example',
}

async function request(path, { method = 'GET', body, raw = false, extraHeaders = {} } = {}) {
  const response = await fetch(`${API}/${path}`, {
    method,
    headers: { ...headers, ...extraHeaders, ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${method} ${path} returned ${String(response.status)}: ${await response.text()}`)
  return raw ? response : response.json()
}

async function task(body) {
  const started = await request('files/tasks', { method: 'POST', body })
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const state = await request(`files/tasks/${started.taskId}`)
    if (state.status === 'success') return state
    if (state.status !== 'running') throw new Error(`file task ${state.taskId} ${state.status}: ${state.error}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`file task ${started.taskId} timed out`)
}

async function item(path) { return request(`files/stat?path=${encodeURIComponent(path)}`) }

const workspaceRoot = `/workspace/file-management-smoke-${String(process.pid)}`
const dshRoot = `/data/dsh/file-management-smoke-${String(process.pid)}`
await task({ operation: 'mkdir', destination: workspaceRoot })
await task({ operation: 'mkdir', destination: dshRoot })

const uploadedPath = `${workspaceRoot}/uploaded-中文.txt`
const upload = await request(`files/upload?path=${encodeURIComponent(uploadedPath)}&conflict=reject`, {
  method: 'POST', body: Buffer.from('0123456789'), raw: true, extraHeaders: { 'content-length': '10' },
}).then(response => response.json())
assert.equal(upload.size, 10)
const range = await request(`files/download?path=${encodeURIComponent(uploadedPath)}&revision=${encodeURIComponent(upload.revision)}`, {
  raw: true, extraHeaders: { range: 'bytes=3-6' },
})
assert.equal(range.status, 206)
assert.equal(await range.text(), '3456')

const before = await request(`files/content?path=${encodeURIComponent(uploadedPath)}`)
const saved = await request('files/content', {
  method: 'PUT', body: { path: uploadedPath, revision: before.revision, content: 'edited in recovery mode\n' },
})
assert.notEqual(saved.revision, before.revision)
assert.equal((await request(`files/content?path=${encodeURIComponent(uploadedPath)}`)).content, 'edited in recovery mode\n')

const copyRoot = `${workspaceRoot}/copies`
await task({ operation: 'mkdir', destination: copyRoot })
const source = await item(uploadedPath)
await task({ operation: 'copy', sources: [{ path: source.path, revision: source.revision }], destination: copyRoot, conflict: 'reject' })
const copiedPath = `${copyRoot}/uploaded-中文.txt`
assert.equal((await request(`files/content?path=${encodeURIComponent(copiedPath)}`)).content, 'edited in recovery mode\n')

const linkPath = `${workspaceRoot}/relative-link`
await symlink('uploaded-中文.txt', linkPath)
const link = await item(linkPath)
assert.equal(link.type, 'symlink')
await task({ operation: 'copy', sources: [{ path: link.path, revision: link.revision }], destination: copyRoot, conflict: 'reject' })
assert.equal((await item(`${copyRoot}/relative-link`)).type, 'symlink')

const movedRoot = `${workspaceRoot}/moved`
await task({ operation: 'mkdir', destination: movedRoot })
const copied = await item(copiedPath)
await task({ operation: 'move', sources: [{ path: copied.path, revision: copied.revision }], destination: movedRoot, conflict: 'reject' })
assert.equal((await request(`files/content?path=${encodeURIComponent(`${movedRoot}/uploaded-中文.txt`)}`)).content, 'edited in recovery mode\n')

const dshFile = `${dshRoot}/recovery.json`
await request('files/content', { method: 'PUT', body: { path: dshFile, revision: null, content: '{"recovered":true}\n', create: true } })
assert.equal((await request(`files/content?path=${encodeURIComponent(dshFile)}`)).content, '{"recovered":true}\n')

const searchRoot = await request(`files/list?path=${encodeURIComponent(workspaceRoot)}`)
const search = await request('files/tasks', { method: 'POST', body: { operation: 'search', path: workspaceRoot, revision: searchRoot.revision, query: 'uploaded' } })
let searchResult
for (let attempt = 0; attempt < 100; attempt += 1) {
  searchResult = await request(`files/tasks/${search.taskId}?limit=1000`)
  if (searchResult.status !== 'running') break
  await new Promise(resolve => setTimeout(resolve, 10))
}
assert.equal(searchResult.status, 'success')
assert.ok(searchResult.results.length >= 2)

const workspace = await item(workspaceRoot)
const dsh = await item(dshRoot)
await task({ operation: 'delete', sources: [{ path: workspace.path, revision: workspace.revision }, { path: dsh.path, revision: dsh.revision }] })
await assert.rejects(item(workspaceRoot), /returned 404/)
await assert.rejects(item(dshRoot), /returned 404/)

console.log(JSON.stringify({ range: '3456', searched: searchResult.results.length, dshUnavailable: true }))
