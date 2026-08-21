import assert from 'node:assert/strict'
import { mkdir, symlink, writeFile } from 'node:fs/promises'

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

const config = await request('files/config')
assert.equal(config.privileged, true)
const rootFile = `/root/dsh-maintenance-smoke-${String(process.pid)}.txt`
await request('files/content', {
  method: 'PUT', body: { path: rootFile, revision: null, content: 'root maintenance\n', create: true },
})
const rootItem = await item(rootFile)
assert.equal(rootItem.user, 'root')
assert.equal(rootItem.group, 'root')
assert.equal((await request(`files/content?path=${encodeURIComponent(rootFile)}`)).content, 'root maintenance\n')
await task({ operation: 'delete', sources: [{ path: rootItem.path, revision: rootItem.revision }] })
await assert.rejects(item(rootFile), /returned 404/)

const workspaceRoot = `/workspace/file-management-smoke-${String(process.pid)}`
const dshRoot = `/data/dsh/file-management-smoke-${String(process.pid)}`
await mkdir(workspaceRoot)
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

const archiveSource = `${workspaceRoot}/archive-source`
await task({ operation: 'mkdir', destination: archiveSource })
await request('files/content', {
  method: 'PUT', body: { path: `${archiveSource}/entry.txt`, revision: null, content: 'archive fixture\n', create: true },
})
for (const [format, extension] of [['zip', 'zip'], ['7z', '7z'], ['tar.gz', 'tar.gz']]) {
  const source = await item(archiveSource)
  const archivePath = `${workspaceRoot}/fixture-${format}.${extension}`
  await task({
    operation: 'archive', archiveFormat: format,
    sources: [{ path: source.path, revision: source.revision }], destination: archivePath,
  })
  const extraction = `${workspaceRoot}/extracted-${format}`
  await task({ operation: 'mkdir', destination: extraction })
  const archive = await item(archivePath)
  await task({
    operation: 'extract', archiveFormat: format,
    sources: [{ path: archive.path, revision: archive.revision }], destination: extraction,
  })
  assert.equal((await request(`files/content?path=${encodeURIComponent(`${extraction}/archive-source/entry.txt`)}`)).content, 'archive fixture\n')
}
const directoryDownload = await request(`files/download?path=${encodeURIComponent(archiveSource)}&revision=${encodeURIComponent((await item(archiveSource)).revision)}`, { raw: true })
assert.equal(directoryDownload.headers.get('content-disposition').includes('archive-source.zip'), true)
assert.deepEqual([...new Uint8Array(await directoryDownload.arrayBuffer()).slice(0, 2)], [0x50, 0x4b])

const pagingRoot = `${workspaceRoot}/paging`
await mkdir(pagingRoot)
await Promise.all(Array.from({ length: 125 }, (_, index) => writeFile(`${pagingRoot}/${String(index).padStart(3, '0')}.txt`, 'x')))
const firstPage = await request(`files/list?path=${encodeURIComponent(pagingRoot)}&limit=50`)
assert.equal(firstPage.entries.length, 50)
assert.equal(firstPage.total, 125)
assert.equal(typeof firstPage.nextCursor, 'string')
const secondPage = await request(`files/list?path=${encodeURIComponent(pagingRoot)}&limit=50&cursor=${encodeURIComponent(firstPage.nextCursor)}`)
assert.equal(secondPage.entries.length, 50)
assert.equal(secondPage.entries[0].name, '050.txt')

const searchRoot = await request(`files/list?path=${encodeURIComponent(workspaceRoot)}`)
assert.ok(searchRoot.entries.every(entry => typeof entry.user === 'string' && typeof entry.group === 'string'))
const workspaceBeforeAttributes = await item(workspaceRoot)
await task({
  operation: 'attributes',
  sources: [{ path: workspaceRoot, revision: workspaceBeforeAttributes.revision }],
  attributes: { user: 'root', group: 'root', mode: '0750', recursive: true },
})
const workspaceAttributes = await item(workspaceRoot)
assert.equal(workspaceAttributes.user, 'root')
assert.equal(workspaceAttributes.group, 'root')
assert.equal(workspaceAttributes.mode, 0o750)
assert.equal((await item(uploadedPath)).mode, 0o750)
const sizeTask = await request('files/tasks', { method: 'POST', body: { operation: 'size', path: workspaceRoot, revision: workspaceAttributes.revision } })
let sizeResult
for (let attempt = 0; attempt < 100; attempt += 1) {
  sizeResult = await request(`files/tasks/${sizeTask.taskId}`)
  if (sizeResult.status !== 'running') break
  await new Promise(resolve => setTimeout(resolve, 10))
}
assert.equal(sizeResult.status, 'success')
assert.ok(sizeResult.bytes >= 10)
const staleSize = await request('files/tasks', { method: 'POST', body: { operation: 'size', path: workspaceRoot, revision: searchRoot.revision } })
let staleSizeResult
for (let attempt = 0; attempt < 100; attempt += 1) {
  staleSizeResult = await request(`files/tasks/${staleSize.taskId}`)
  if (staleSizeResult.status !== 'running') break
  await new Promise(resolve => setTimeout(resolve, 10))
}
assert.equal(staleSizeResult.status, 'failed')
assert.match(staleSizeResult.error, /changed/)
const searchRootAfterAttributes = await request(`files/list?path=${encodeURIComponent(workspaceRoot)}`)
const search = await request('files/tasks', { method: 'POST', body: { operation: 'search', path: workspaceRoot, revision: searchRootAfterAttributes.revision, query: 'uploaded' } })
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

console.log(JSON.stringify({ range: '3456', searched: searchResult.results.length, directoryBytes: sizeResult.bytes, attributes: workspaceAttributes.mode, archives: 3, paged: firstPage.total, dshUnavailable: true }))
