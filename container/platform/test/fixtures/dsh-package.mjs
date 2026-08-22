import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function writeDshEntrypointFixture(packageRoot) {
  await mkdir(join(packageRoot, 'lib'), { recursive: true })
  await writeFile(join(packageRoot, 'lib/bin.js'), `#!/usr/bin/env node
const invocation = parseDshArgs(process.argv.slice(2), readVersion());
switch (invocation.mode) {
  case "profile": {
    const { runProfile } = await import("./profile-boot-fixture.js");
  }
}
`)
  await writeFile(join(packageRoot, 'lib/profile-boot-fixture.js'), 'import { r as runProfile } from "./profile-boot-implementation.js";\nexport { runProfile };\n')
  await writeFile(join(packageRoot, 'lib/profile-boot-implementation.js'), `async function runProfile(options) {
\tprocess.on("SIGTERM", () => {
\t\tinterrupt(0);
\t});
\tprocess.on("SIGINT", () => { interrupt(130); });
\tconst ctx = await boot(NAME, rootConfig, patches, (hostCtx) => {
\t\thostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment);
\t});
}
export { runProfile as r };
`)
}
