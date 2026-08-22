---
name: dsh-docker-operations
description: Use for operating inside the official DSH Docker Environment, including files, development tools, plugins, skills, lifecycle, logs, updates, recovery, networking, permissions, and container-specific diagnostics.
user-invocable: true
disable-model-invocation: false
---

# DSH Docker Operations

Use the platform's supported interfaces before inspecting implementation details. Match the user's language in every response; these instructions being English does not change the response language.

## Operating rules

1. Preserve the user's requested scope and authorization. Read-only diagnosis does not authorize updates, restarts, plugin mutations, or destructive file operations.
2. Start with `dsh`, `dsh-platform`, their help output, and the DSH Management Console. Do not rediscover public behavior by reading Stage-0, Bootstrap, sockets, process environments, or runtime source.
3. In routine work, never override `HOME`, `USER`, `LOGNAME`, XDG variables, npm configuration, pnpm configuration, or package-manager cache paths. The container already provides the correct `node` environment.
4. Do not read credentials from process environments, files, command histories, or service internals. Never print secrets.
5. Do not mutate platform state, Store assets, runtime views, keyrings, receipts, or Unix sockets. Use only the documented recovery commands for exceptional operations.
6. Inspect `/opt/dsh-platform` or `/run/dsh-platform` internals only when the user explicitly asks to develop or debug the platform implementation itself. Ordinary DSH, plugin, update, and container troubleshooting does not meet that condition.

## Load the relevant guide

- Environment identity, paths, persistence, Root, and sudo: [references/environment-and-permissions.md](references/environment-and-permissions.md)
- Workspaces, files, development tools, and package managers: [references/files-and-development.md](references/files-and-development.md)
- DSH CLI, profiles, user plugins, System Plugins, and skills: [references/dsh-and-extensions.md](references/dsh-and-extensions.md)
- Status, health, logs, restart, and Management Console: [references/lifecycle-and-logs.md](references/lifecycle-and-logs.md)
- Stable/experimental updates, rollback, reset, and recovery: [references/updates-and-recovery.md](references/updates-and-recovery.md)
- Gateway, ports, reverse proxies, authentication, and remote access: [references/networking-and-auth.md](references/networking-and-auth.md)
- Ordered troubleshooting and protected implementation boundaries: [references/diagnostics-and-boundaries.md](references/diagnostics-and-boundaries.md)

Read only the references needed for the current task. When a referenced command differs from the installed version, prefer that command's current `--help` output and report the difference.
