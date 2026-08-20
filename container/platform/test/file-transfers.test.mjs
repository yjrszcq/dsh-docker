import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { FileTransferManager, fileTransferInternals } from '../../control-plane/modules/file-manager/transfers.mjs'

async function collect(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

test('streams complete, ranged, suffix, and empty downloads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-download-'))
  const path = join(root, '中文 name.txt')
  await writeFile(path, '0123456789')
  const transfers = new FileTransferManager()
  const complete = await transfers.openDownload(path)
  assert.equal((await collect(complete.stream)).toString(), '0123456789')
  await complete.handle.close()
  assert.equal(complete.headers['content-length'], '10')
  assert.match(complete.headers['content-disposition'], /filename\*=UTF-8''/)
  const ranged = await transfers.openDownload(path, { range: 'bytes=2-5', revision: complete.revision })
  assert.equal(ranged.status, 206)
  assert.equal((await collect(ranged.stream)).toString(), '2345')
  await ranged.handle.close()
  const suffix = await transfers.openDownload(path, { range: 'bytes=-3' })
  assert.equal((await collect(suffix.stream)).toString(), '789')
  await suffix.handle.close()
  const emptyPath = join(root, 'empty')
  await writeFile(emptyPath, '')
  const empty = await transfers.openDownload(emptyPath)
  assert.equal((await collect(empty.stream)).byteLength, 0)
  await empty.handle.close()
  await assert.rejects(transfers.openDownload(path, { range: 'bytes=20-30' }), error => error.statusCode === 416)
})

test('uploads through sibling staging with reject, overwrite, and rename policies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-upload-'))
  const path = join(root, 'file.txt')
  const transfers = new FileTransferManager()
  const first = await transfers.upload(Readable.from(['first']), path, { contentLength: 5 })
  assert.equal(first.path, path)
  assert.equal(await readFile(path, 'utf8'), 'first')
  await assert.rejects(transfers.upload(Readable.from(['no']), path), error => error.statusCode === 409)
  const renamed = await transfers.upload(Readable.from(['second']), path, { conflict: 'rename' })
  assert.equal(renamed.path, join(root, 'file (1).txt'))
  assert.equal(await readFile(renamed.path, 'utf8'), 'second')
  await mkdir(join(root, 'directory'))
  const directoryConflict = await transfers.upload(Readable.from(['safe']), join(root, 'directory'), { conflict: 'rename' })
  assert.equal(directoryConflict.path, join(root, 'directory (1)'))
  const oldMode = (await stat(path)).mode & 0o777
  await transfers.upload(Readable.from(['replacement']), path, { conflict: 'overwrite' })
  assert.equal(await readFile(path, 'utf8'), 'replacement')
  assert.equal((await stat(path)).mode & 0o777, oldMode)
})

test('cleans staging files after interrupted or mismatched uploads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-upload-failure-'))
  const path = join(root, 'file')
  const transfers = new FileTransferManager()
  await assert.rejects(transfers.upload(Readable.from(['short']), path, { contentLength: 100 }), /Content-Length/)
  assert.equal(await readFile(path).then(() => true, error => error.code !== 'ENOENT'), false)
  const entries = await import('node:fs/promises').then(fs => fs.readdir(root))
  assert.deepEqual(entries, [])
})

test('sanitizes download names and parses only a single byte range', () => {
  assert.match(fileTransferInternals.disposition('a"b.txt'), /filename="a_b.txt"/)
  assert.deepEqual(fileTransferInternals.parseRange('bytes=0-0', 5), { start: 0, end: 0, partial: true })
  assert.throws(() => fileTransferInternals.parseRange('bytes=0-1,3-4', 5), /invalid/)
})
