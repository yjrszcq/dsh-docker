import assert from 'node:assert/strict'
import { lstat, mkdir, readFile, readlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import test from 'node:test'
import {
  readSystemSkillCatalog,
  SystemSkillManager,
} from '../../control-plane/modules/skill-manager/index.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-system-skills-'))
  const sourceRoot = join(root, 'source')
  const bundle = join(sourceRoot, 'operations')
  await mkdir(join(bundle, 'references'), { recursive: true })
  await writeFile(join(sourceRoot, 'catalog.json'), JSON.stringify({
    schema: 1,
    skills: [{
      id: 'operations',
      source: 'operations',
      description: { en: 'Operate DSH.', zh: '操作 DSH。' },
    }],
  }))
  await writeFile(join(bundle, 'SKILL.md'), '---\nname: operations\ndescription: Operate DSH.\n---\n\n# Operations\n')
  await writeFile(join(bundle, 'references', 'guide.md'), '# Guide\n')
  return {
    root,
    sourceRoot,
    viewRoot: join(root, 'run', 'skills'),
    statePath: join(root, 'state', 'skills.json'),
  }
}

test('System Skills are identified by signed catalog ID and content hash', async () => {
  const { sourceRoot } = await fixture()
  const catalog = await readSystemSkillCatalog(sourceRoot)
  assert.equal(catalog.length, 1)
  assert.equal(catalog[0].id, 'operations')
  assert.match(catalog[0].sha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(catalog[0].description, { en: 'Operate DSH.', zh: '操作 DSH。' })
})

test('System Skill selection hot-updates one stable view and persists install state', async () => {
  const paths = await fixture()
  const manager = new SystemSkillManager(paths)
  assert.deepEqual(await manager.initialize(), [{
    id: 'operations',
    sha256: (await manager.list())[0].sha256,
    description: { en: 'Operate DSH.', zh: '操作 DSH。' },
    installed: true,
    enabled: true,
  }])
  assert.equal(await readlink(join(paths.viewRoot, 'operations')), join(paths.sourceRoot, 'operations'))

  assert.equal((await manager.configure('operations', 'disable'))[0].enabled, false)
  await assert.rejects(lstat(join(paths.viewRoot, 'operations')), { code: 'ENOENT' })
  assert.equal((await manager.configure('operations', 'enable'))[0].enabled, true)
  assert.equal(await readlink(join(paths.viewRoot, 'operations')), join(paths.sourceRoot, 'operations'))

  const uninstalled = (await manager.configure('operations', 'uninstall'))[0]
  assert.deepEqual({ installed: uninstalled.installed, enabled: uninstalled.enabled }, { installed: false, enabled: false })
  await assert.rejects(manager.configure('operations', 'enable'), /must be installed/)
  assert.equal((await new SystemSkillManager(paths).initialize())[0].installed, false)
  assert.equal((await manager.configure('operations', 'install'))[0].enabled, true)
})

test('System Skill state ignores removed entries and defaults newly signed skills on', async () => {
  const paths = await fixture()
  const manager = new SystemSkillManager(paths)
  await manager.initialize()
  await manager.configure('operations', 'uninstall')
  const second = join(paths.sourceRoot, 'second')
  await mkdir(second)
  await writeFile(join(second, 'SKILL.md'), '---\nname: second\ndescription: Second.\n---\n\n# Second\n')
  await writeFile(join(paths.sourceRoot, 'catalog.json'), JSON.stringify({
    schema: 1,
    skills: [{ id: 'second', source: 'second', description: { en: 'Second.', zh: '第二个。' } }],
  }))
  const listed = await manager.initialize()
  assert.deepEqual(listed.map(skill => ({ id: skill.id, installed: skill.installed, enabled: skill.enabled })), [
    { id: 'second', installed: true, enabled: true },
  ])
  const saved = JSON.parse(await readFile(paths.statePath, 'utf8'))
  assert.deepEqual(Object.keys(saved.skills), ['second'])
})

test('System Skill catalog rejects source aliases and mismatched frontmatter', async () => {
  const paths = await fixture()
  const document = JSON.parse(await readFile(join(paths.sourceRoot, 'catalog.json'), 'utf8'))
  document.skills[0].source = '../operations'
  await writeFile(join(paths.sourceRoot, 'catalog.json'), JSON.stringify(document))
  await assert.rejects(readSystemSkillCatalog(paths.sourceRoot), /source is invalid/)
})
