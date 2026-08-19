import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { patchBrowserLoopback } from '../../../../resources/patches/browser-loopback.mjs'

const BEFORE = 'isLoopback: pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname),'

test('browser loopback patch changes exactly one connection classification', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-browser-loopback-patch-'))
  const target = join(directory, 'client.js')
  try {
    await writeFile(target, `before;${BEFORE}after;`)
    patchBrowserLoopback(target)
    assert.equal(await readFile(target, 'utf8'), 'before;isLoopback: true,after;')
    assert.throws(() => patchBrowserLoopback(target), /found 0/)

    await writeFile(target, `${BEFORE}${BEFORE}`)
    assert.throws(() => patchBrowserLoopback(target), /found 2/)
  } finally {
    await rm(directory, { recursive: true })
  }
})
