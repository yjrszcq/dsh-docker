import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { UserSkillManager } from '../../control-plane/services/management/user-skills.mjs'
import { LocalApiClient } from '../../control-plane/modules/updater/lib/client.mjs'
import { createUserSkillServer, listenUserSkills } from '../stage0/lib/user-skill-server.mjs'

async function rootOwnedFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-user-skill-server-'))
  const dshHome = join(root, 'dsh')
  const agentsHome = join(root, 'agents')
  const skill = join(dshHome, 'skills', 'root-owned')
  await mkdir(skill, { recursive: true })
  await mkdir(join(agentsHome, 'skills'), { recursive: true })
  await writeFile(join(skill, 'SKILL.md'), '---\nname: root-owned\ndescription: Root-owned fixture\n---\n')
  await chmod(skill, 0o755)
  await chmod(join(skill, 'SKILL.md'), 0o644)
  const manager = new UserSkillManager({ dshHome, agentsHome })
  const server = createUserSkillServer({ manager })
  const socket = join(root, 'run', 'user-skills.sock')
  await listenUserSkills(server, socket)
  return { root, dshHome, manager, server, socket, skill }
}

test('privileged User Skill broker validates and configures root-owned entries', async t => {
  const value = await rootOwnedFixture()
  t.after(async () => {
    await new Promise(resolve => value.server.close(resolve))
    await rm(value.root, { recursive: true, force: true })
  })
  const client = new LocalApiClient(value.socket)
  const initial = await value.manager.list()
  const entry = initial.skills[0]
  const disabled = await client.request('POST', '/v1/action', {
    entryId: entry.entryId,
    revision: initial.revision,
    action: 'disable',
  })
  assert.equal(disabled.skills[0].enabled, false)
  assert.equal((await lstat(join(value.dshHome, 'skills/.disabled/root-owned'))).isDirectory(), true)

  await assert.rejects(client.request('POST', '/v1/action', {
    entryId: entry.entryId,
    revision: initial.revision,
    action: 'delete',
  }), error => error.statusCode === 409)

  const deleted = await client.request('POST', '/v1/action', {
    entryId: disabled.skills[0].entryId,
    revision: disabled.revision,
    action: 'delete',
  })
  assert.deepEqual(deleted.skills, [])
})

test('privileged User Skill broker exposes no arbitrary path operation', async t => {
  const value = await rootOwnedFixture()
  t.after(async () => {
    await new Promise(resolve => value.server.close(resolve))
    await rm(value.root, { recursive: true, force: true })
  })
  const client = new LocalApiClient(value.socket)
  await assert.rejects(client.request('POST', '/v1/action', {
    entryId: `sha256:${'a'.repeat(64)}`,
    revision: `sha256:${'b'.repeat(64)}`,
    action: 'delete',
    path: '/root',
  }), error => error.statusCode === 400)
  assert.equal((await lstat(value.skill)).isDirectory(), true)
})
