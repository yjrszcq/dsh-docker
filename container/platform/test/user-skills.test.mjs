import assert from 'node:assert/strict'
import { lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { UserSkillConflictError, UserSkillManager } from '../../control-plane/services/management/user-skills.mjs'

async function writeDirectorySkill(root, entry, name = entry, description = `${name} description`) {
  const path = join(root, entry)
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nUse ${name}.\n`)
  return path
}

async function fixture() {
  const root = await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), 'dsh-user-skills-')))
  const dshHome = join(root, 'dsh')
  const agentsHome = join(root, 'agents')
  await mkdir(join(dshHome, 'skills'), { recursive: true })
  await mkdir(join(agentsHome, 'skills'), { recursive: true })
  return { root, dshHome, agentsHome, manager: new UserSkillManager({ dshHome, agentsHome }) }
}

test('inventories native directory and flat user skills from both user roots', async t => {
  const value = await fixture()
  t.after(() => rm(value.root, { recursive: true, force: true }))
  await writeDirectorySkill(join(value.dshHome, 'skills'), 'directory-entry', 'shared-name', 'Directory guidance')
  await writeFile(join(value.agentsHome, 'skills/flat-entry.md'), '---\nname: shared-name\ndescription: Flat guidance\n---\n\nFlat body.\n')
  await writeFile(join(value.dshHome, 'skills/notes.txt'), 'not a skill')
  await mkdir(join(value.dshHome, 'skills/.system/ignored'), { recursive: true })

  const inventory = await value.manager.list()
  assert.match(inventory.revision, /^sha256:[0-9a-f]{64}$/)
  assert.deepEqual(inventory.skills.map(skill => ({
    source: skill.source, entryName: skill.entryName, name: skill.name,
    kind: skill.kind, enabled: skill.enabled, description: skill.description,
  })), [
    { source: 'user-agents', entryName: 'flat-entry.md', name: 'shared-name', kind: 'file', enabled: true, description: 'Flat guidance' },
    { source: 'user-dsh', entryName: 'directory-entry', name: 'shared-name', kind: 'directory', enabled: true, description: 'Directory guidance' },
  ])
})

test('keeps malformed user skills visible for disable and delete', async t => {
  const value = await fixture()
  t.after(() => rm(value.root, { recursive: true, force: true }))
  await mkdir(join(value.dshHome, 'skills/broken'), { recursive: true })
  await writeFile(join(value.dshHome, 'skills/broken/SKILL.md'), '---\nname: Broken_Name\ndescription: broken\n---\n')
  const inventory = await value.manager.list()
  assert.equal(inventory.skills.length, 1)
  assert.equal(inventory.skills[0].damaged, true)
  assert.match(inventory.skills[0].metadataError, /name is invalid/i)

  const disabled = await value.manager.configure({
    entryId: inventory.skills[0].entryId,
    revision: inventory.revision,
    action: 'disable',
  })
  assert.equal(disabled.skills[0].enabled, false)
  const deleted = await value.manager.configure({
    entryId: disabled.skills[0].entryId,
    revision: disabled.revision,
    action: 'delete',
  })
  assert.deepEqual(deleted.skills, [])
})

test('atomically disables and enables exact entries without confusing duplicate names', async t => {
  const value = await fixture()
  t.after(() => rm(value.root, { recursive: true, force: true }))
  await writeDirectorySkill(join(value.dshHome, 'skills'), 'first-entry', 'duplicate-name')
  await writeDirectorySkill(join(value.agentsHome, 'skills'), 'second-entry', 'duplicate-name')
  const before = await value.manager.list()
  const selected = before.skills.find(skill => skill.source === 'user-dsh')

  const disabled = await value.manager.configure({ entryId: selected.entryId, revision: before.revision, action: 'disable' })
  assert.equal(disabled.skills.find(skill => skill.source === 'user-dsh').enabled, false)
  assert.equal(disabled.skills.find(skill => skill.source === 'user-agents').enabled, true)
  await assert.rejects(lstat(join(value.dshHome, 'skills/first-entry')), error => error.code === 'ENOENT')
  assert.equal((await lstat(join(value.dshHome, 'skills/.disabled/first-entry'))).isDirectory(), true)

  const disabledEntry = disabled.skills.find(skill => skill.source === 'user-dsh')
  const enabled = await value.manager.configure({ entryId: disabledEntry.entryId, revision: disabled.revision, action: 'enable' })
  assert.equal(enabled.skills.find(skill => skill.source === 'user-dsh').enabled, true)
  assert.match(await readFile(join(value.dshHome, 'skills/first-entry/SKILL.md'), 'utf8'), /duplicate-name/)
})

test('rejects stale revisions and destination conflicts', async t => {
  const value = await fixture()
  t.after(() => rm(value.root, { recursive: true, force: true }))
  await writeDirectorySkill(join(value.dshHome, 'skills'), 'example')
  const before = await value.manager.list()
  await writeDirectorySkill(join(value.agentsHome, 'skills'), 'concurrent')
  await assert.rejects(value.manager.configure({
    entryId: before.skills[0].entryId, revision: before.revision, action: 'disable',
  }), UserSkillConflictError)

  const current = await value.manager.list()
  const selected = current.skills.find(skill => skill.entryName === 'example')
  await mkdir(join(value.dshHome, 'skills/.disabled/example'), { recursive: true })
  await assert.rejects(value.manager.configure({
    entryId: selected.entryId, revision: current.revision, action: 'disable',
  }), UserSkillConflictError)
})

test('deletes a symlink entry without touching its external target', async t => {
  const value = await fixture()
  t.after(() => rm(value.root, { recursive: true, force: true }))
  const external = await writeDirectorySkill(value.root, 'external-skill', 'linked-skill')
  await symlink(external, join(value.dshHome, 'skills/linked-skill'), 'dir')
  const before = await value.manager.list()
  assert.equal(before.skills[0].symbolicLink, true)
  const after = await value.manager.configure({
    entryId: before.skills[0].entryId, revision: before.revision, action: 'delete',
  })
  assert.deepEqual(after.skills, [])
  assert.match(await readFile(join(external, 'SKILL.md'), 'utf8'), /linked-skill/)
})
