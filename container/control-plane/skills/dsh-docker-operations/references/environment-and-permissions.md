# Environment and permissions

## Process identity

DSH and its Agent normally run as `node` with:

- `HOME=/home/node`
- `USER=node`
- `LOGNAME=node`
- XDG configuration, data, and cache below `/home/node`
- `DSH_HOME`, normally `/data/dsh`
- the configured default workspace, normally `/workspace`

Do not replace these values to work around a package-manager error. First inspect ownership of the target profile or workspace and use the existing environment. A reference to `/root/.config`, `/root/.cache`, or `/root/.local` from a normal DSH/plugin operation is a defect or inherited override, not a directory to create or chmod around.

The standalone Management Console terminal and file manager run through the platform's Root maintenance broker. Its terminal intentionally uses UID 0 and `HOME=/root`. Do not generalize that identity to DSH or Agent commands.

## Persistent and ephemeral paths

- `$DSH_HOME` (`/data/dsh` by default): user configuration, profiles, sessions, user plugins, and DSH data.
- `$DSH_PLATFORM_DATA` (`/data/platform` by default): platform state, trusted/managed assets, cache, snapshots, and logs.
- `$DSH_DEFAULT_WORKSPACE` (`/workspace` by default): initial user workspace; it is not a sandbox.
- `/run/dsh-platform`: ephemeral runtime views and local sockets rebuilt at container start.
- `/opt/dsh-platform`: immutable image implementation and Seed.
- `/home/node`: normal user home and package-manager/XDG state.

Use the configured environment variables instead of hard-coding their default paths when writing scripts intended to survive custom deployments.

## Root and sudo

When `DSH_SUDO_ENABLED=true`, the DSH/Agent process can use passwordless `sudo` for commands that genuinely need operating-system authority. Use it narrowly for system package installation or protected host-mounted files. Keep ordinary workspace, DSH profile, npm, and pnpm operations as `node` so new files remain usable by DSH.

When sudo is disabled, do not assume a failing command may be rerun as Root. Explain the required permission or use the authenticated Management Console when the user explicitly asks for container maintenance.

Never combine broad Root operations with guessed paths, unresolved variables, recursive deletion, the Docker socket, or unrelated host mounts.
