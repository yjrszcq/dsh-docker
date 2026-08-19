import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { reconcileSystemPlugins } from '../../components/system-plugin-manager/index.mjs'

async function archive(root, id, patch) {
  const source = join(root, `source-${id}`, 'package')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'cordis.patch.json'), JSON.stringify(patch))
  await writeFile(join(source, 'plugin.mjs'), `export const id = ${JSON.stringify(id)}\n`)
  const path = join(root, `${id}.tgz`)
  const result = spawnSync('tar', ['-czf', path, '-C', dirname(source), 'package'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return path
}

function dirname(path) {
  return path.slice(0, path.lastIndexOf('/'))
}

test('reconciles only declared System Plugins into a separate immutable overlay', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-system-plugins-'))
  const userHome = join(root, 'user-home')
  await mkdir(join(userHome, 'profiles/web'), { recursive: true })
  await writeFile(join(userHome, 'cordis.patch.yml'), '[{"id":"user-owned"}]\n')
  await writeFile(join(userHome, 'profiles/web/package.json'), '{"dependencies":{"third-party":"1.0.0"}}\n')
  const first = await archive(root, 'update-ui', [{ id: 'dsh-docker.update-ui.host', name: './plugin.mjs' }])
  const second = await archive(root, 'diagnostics', [{ id: 'dsh-docker.diagnostics.host', name: './plugin.mjs' }])
  const artifacts = new Map([['update-ui', first], ['diagnostics', second]])
  await reconcileSystemPlugins({
    root: join(root, 'managed'),
    environmentVersion: '2026.08.19.1',
    plugins: [
      { id: 'update-ui', sha256: '1'.repeat(64) },
      { id: 'diagnostics', sha256: '2'.repeat(64) },
    ],
    artifactPath: reference => artifacts.get(reference.id),
  })
  const overlay = JSON.parse(await readFile(join(root, 'managed/current/cordis.patch.yml'), 'utf8'))
  assert.deepEqual(overlay.map(entry => entry.id), ['dsh-docker.update-ui.host', 'dsh-docker.diagnostics.host'])
  assert.equal(await readFile(join(userHome, 'cordis.patch.yml'), 'utf8'), '[{"id":"user-owned"}]\n')
  assert.match(await readFile(join(userHome, 'profiles/web/package.json'), 'utf8'), /third-party/)
})

test('rejects a System Plugin which claims another namespace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-system-plugin-invalid-'))
  const artifact = await archive(root, 'update-ui', [{ id: 'unowned-row', name: './plugin.mjs' }])
  await assert.rejects(reconcileSystemPlugins({
    root: join(root, 'managed'),
    environmentVersion: 'invalid',
    plugins: [{ id: 'update-ui', sha256: '1'.repeat(64) }],
    artifactPath: () => artifact,
  }), /namespace/)
})
