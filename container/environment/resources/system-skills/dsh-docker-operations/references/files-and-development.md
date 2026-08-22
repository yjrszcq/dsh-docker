# Files and development tools

## Work in the selected workspace

Start from `$DSH_DEFAULT_WORKSPACE` when the user has not named a directory. Confirm the current directory before installing dependencies, initializing a repository, or running destructive commands. Preserve existing files and unrelated changes.

Use ordinary shell and editor tools for accessible workspace and DSH user data. Use the standalone Management Console file manager for browser-based upload/download, archive operations, ownership/mode changes, or Root-only repair. It is available independently of the DSH Runtime.

Do not edit these managed paths during routine work:

- `$DSH_PLATFORM_DATA/state`
- `$DSH_PLATFORM_DATA/store`
- `/run/dsh-platform/views`
- `/opt/dsh-platform`

Cache directories may be cleared only when the user requests it and the exact cache target is known. Never delete `$DSH_HOME` to solve a platform or image upgrade problem.

## Package managers and toolchains

Run language package managers from the intended project or DSH profile directory under the inherited environment. Do not set XDG/npm/pnpm variables to the workspace, `/root`, or a temporary directory merely to make one command pass.

For Node development:

- use the installed Node/npm/pnpm commands and their project lockfile;
- do not use global installs when a project-local dependency or `npx`/`pnpm exec` is appropriate;
- keep user caches and configuration under `/home/node` through the inherited environment;
- use `sudo` only for explicit operating-system or global-tool installation requested by the user.

For other development environments, use the same rule: normal user tooling belongs to `/home/node` and the workspace, while system packages may require narrowly scoped sudo. Do not make a tool inherit Root's home just because its installer was invoked through sudo.

Before downloading or executing a third-party installer, verify the requested source and explain any material external side effect. Prefer the project's documented package manager over cloning and building source unless the user explicitly wants a source installation.
