import { Context } from "/run/dsh-platform/views/runtime/package/node_modules/@deepseek-ai/cordis/lib/index.js";
import SkillRegistry from "/run/dsh-platform/views/runtime/package/node_modules/@deepseek-ai/dsh-skill/lib/index.js";
import * as SkillFileSystem from "/run/dsh-platform/views/runtime/package/node_modules/@deepseek-ai/dsh-skill-filesystem/lib/index.js";
import LocalFileSystem from "/run/dsh-platform/views/runtime/package/node_modules/@deepseek-ai/dsh-fs-local/lib/index.js";

const context = new Context();
context.plugin(SkillRegistry);
context.plugin(LocalFileSystem, { cwd: process.env.DSH_DEFAULT_WORKSPACE ?? "/workspace" });
context.plugin(SkillFileSystem, {
  dshHome: process.env.DSH_HOME ?? "/data/dsh",
  agentsHome: process.env.DSH_AGENTS_HOME ?? "/home/node/.agents",
  bundledSkillDir: process.env.DSH_BUNDLED_SKILL_DIR ?? "/run/dsh-platform/views/skills",
});
await new Promise((resolve) => setTimeout(resolve, 100));

const summaries = await context.skills.list({
  cwd: process.env.DSH_DEFAULT_WORKSPACE ?? "/workspace",
});
const summary = summaries.find((entry) => entry.name === "dsh-docker-operations");
if (summary?.source !== "bundled" || summary.provider !== "filesystem") {
  throw new Error(`bundled operations skill was not discovered: ${JSON.stringify(summary)}`);
}

const definition = await context.skills.get("dsh-docker-operations", {
  cwd: process.env.DSH_DEFAULT_WORKSPACE ?? "/workspace",
});
if (!definition || definition.name !== "dsh-docker-operations" || definition.content.length < 500) {
  throw new Error("bundled operations skill did not load a complete definition");
}

console.log(JSON.stringify({
  name: definition.name,
  source: summary.source,
  provider: summary.provider,
  contentBytes: Buffer.byteLength(definition.content),
}));
process.exit(0);
