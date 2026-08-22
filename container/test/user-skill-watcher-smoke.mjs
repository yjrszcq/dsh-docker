import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '/run/dsh-platform/views/runtime/package/node_modules/@deepseek-ai/cordis/lib/index.js'
import SkillRegistry from '/run/dsh-platform/views/runtime/package/node_modules/@deepseek-ai/dsh-skill/lib/index.js'
import * as SkillFileSystem from '/run/dsh-platform/views/runtime/package/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js'
import LocalFileSystem from '/run/dsh-platform/views/runtime/package/node_modules/@deepseek-ai/dsh-fs-local/lib/index.js'

const dshHome = process.env.DSH_HOME ?? '/data/dsh'
const workspace = process.env.DSH_DEFAULT_WORKSPACE ?? '/workspace'
const skillRoot = join(dshHome, 'skills')
const activePath = join(skillRoot, 'smoke-user-skill')
const disabledPath = join(skillRoot, '.disabled', 'smoke-user-skill')

async function waitForSkill(context, expected) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const values = await context.skills?.list({ cwd: workspace })
    if (values !== undefined && values.some(value => value.name === 'smoke-user-skill') === expected) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`user skill watcher did not report expected=${expected}`)
}

await rm(activePath, { recursive: true, force: true })
await rm(disabledPath, { recursive: true, force: true })
await mkdir(activePath, { recursive: true })
await writeFile(join(activePath, 'SKILL.md'), `---
name: smoke-user-skill
description: Smoke-test user skill watcher behavior.
---

# Smoke User Skill
`)

const context = new Context()
context.plugin(SkillRegistry)
context.plugin(LocalFileSystem, { cwd: workspace })
context.plugin(SkillFileSystem, {
  dshHome,
  agentsHome: process.env.DSH_AGENTS_HOME ?? '/home/node/.agents',
  bundledSkillDir: process.env.DSH_BUNDLED_SKILL_DIR ?? '/run/dsh-platform/views/skills',
})

await waitForSkill(context, true)
await mkdir(join(skillRoot, '.disabled'), { recursive: true })
await rename(activePath, disabledPath)
await waitForSkill(context, false)
await rename(disabledPath, activePath)
await waitForSkill(context, true)
await rm(activePath, { recursive: true })
await waitForSkill(context, false)

console.log(JSON.stringify({ discovered: true, disabled: true, enabled: true, deleted: true }))
process.exit(0)
