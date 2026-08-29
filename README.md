# DSH-Docker

English | [中文](README_CN.md)

An unofficial Docker image for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It installs the official `@deepseek-ai/dsh` package and adds persistent updates, rollback, gateway access control, and optional development tools.

> DeepSeek Harness is in Developer Preview and may introduce incompatible changes. This project is not affiliated with DeepSeek AI.

## Before You Start

- **Directory permissions:** Bind-mounted `data/dsh`, `data/platform`, and `workspace` must be writable by container UID/GID `1000:1000`. Keep both data directories when replacing or upgrading the container.
- **Port exposure:** The quick-start configuration binds `127.0.0.1:3080` and is reachable only from the Docker host. Changing it to `3080:3080` or `0.0.0.0:3080:3080` exposes the service on every host interface.
- **Remote access:** Before allowing LAN or Internet access, set `DSH_TRUSTED_HOSTS` to the exact IP addresses or domains used by browsers, initialize the local administrator account, and use HTTPS or another trusted network boundary. Do not expose privileged Docker or host resources to the container.
- **Root authority:** `group_add: dsh-sudo-true` gives DSH and its Agent unrestricted passwordless root access. If they do not need root, remove that `group_add` entry from the minimal Compose example (or omit `--group-add dsh-sudo-true` from `docker run`); with the repository Compose file, set `DSH_SUDO_ENABLED=false`. This does not disable the standalone Management Console's terminal and file manager, which always operate as container root and must remain protected by authentication and a trusted network boundary.
- **DSH Management Console:** `/_dsh_platform/console/` remains available when DSH is stopped or fails to start. It provides updates and recovery, outbound proxy settings, live logs, bundled System Plugin and System Skill management, User Plugin recovery, User Skill management, container files, and a root terminal. The first browser visit creates the local administrator account. Management uses a separate session derived from the active DSH browser session; an optional Management password adds a second login layer.

| Variant | Rolling tag | Versioned tag | Contents |
| --- | --- | --- | --- |
| Standard | `latest` | `<version>` | DSH and normal runtime utilities |
| Devtools | `latest-devtools` | `<version>-devtools` | Standard image plus development tools |

Docker Hub tags follow the DSH version. `ghcr.io/yjrszcq/dsh-docker` mirrors only the Standard image with Environment version tags and `dsh-<version>` lookup tags; it does not publish Devtools images.

## Quick Start

Create local data directories:

```bash
mkdir -p data/dsh data/platform workspace
```

Use this minimal `docker-compose.yaml`:

```yaml
services:
  deepseek-harness:
    image: szcq/deepseek-harness:latest
    container_name: deepseek-harness
    restart: unless-stopped
    ports:
      - "127.0.0.1:3080:3080"
    group_add:
      - dsh-sudo-true
    volumes:
      - ./data/dsh:/data/dsh
      - ./data/platform:/data/platform
      - ./workspace:/workspace
```

Start it with:

```bash
docker compose up -d
```

Or use the equivalent `docker run` command:

```bash
docker run -d \
  --name deepseek-harness \
  --restart unless-stopped \
  --group-add dsh-sudo-true \
  -p 127.0.0.1:3080:3080 \
  -v "$(pwd)/data/platform:/data/platform" \
  -v "$(pwd)/data/dsh:/data/dsh" \
  -v "$(pwd)/workspace:/workspace" \
  szcq/deepseek-harness:latest
```

Open <http://127.0.0.1:3080>.

## Storage

Keep both persistent locations:

| Path | Purpose |
| --- | --- |
| `/data/platform` | Platform state, managed rollback assets, snapshots, and logs |
| `/data/dsh` | DSH settings, sessions, credentials, and third-party plugins |
| `/workspace` | Default working directory |

Container workloads run as UID/GID `1000:1000`. If a bind mount is inaccessible:

```bash
sudo chown -R 1000:1000 data workspace
```

## Remote Access

For LAN or reverse-proxy access, set the browser-facing host:

```dotenv
DSH_TRUSTED_HOSTS=192.168.1.100,dsh.example.com
```

Use this minimal remote-access `docker-compose.yaml`, replacing the trusted hosts first:

```yaml
services:
  deepseek-harness:
    image: szcq/deepseek-harness:latest
    container_name: deepseek-harness
    restart: unless-stopped
    ports:
      - "3080:3080"
    group_add:
      - dsh-sudo-true
    environment:
      DSH_TRUSTED_HOSTS: "192.168.1.100,dsh.example.com"
    volumes:
      - ./data/dsh:/data/dsh
      - ./data/platform:/data/platform
      - ./workspace:/workspace
```

Or use the equivalent `docker run` command:

```bash
docker run -d \
  --name deepseek-harness \
  --restart unless-stopped \
  --group-add dsh-sudo-true \
  -p 3080:3080 \
  -e 'DSH_TRUSTED_HOSTS=192.168.1.100,dsh.example.com' \
  -v "$(pwd)/data/platform:/data/platform" \
  -v "$(pwd)/data/dsh:/data/dsh" \
  -v "$(pwd)/workspace:/workspace" \
  szcq/deepseek-harness:latest
```

A reverse proxy must preserve the original `Host` header. Terminate TLS outside this container. To publish only on the Docker host, use `127.0.0.1:3080:3080` instead of `3080:3080`.

After startup, open the browser-facing address and create the local administrator username and main password. The initialization page blocks DSH and Management until registration finishes. Use HTTPS or another trusted network boundary because credentials and authenticated sessions grant full DSH access.

Common settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DSH_TRUSTED_HOSTS` | Loopback only | Allowed browser-facing hosts |
| `DSH_DEFAULT_WORKSPACE` | `/workspace` | Default workspace for directory pickers and standalone file management |
| `DSH_SUDO_ENABLED` | `false` | Compose-only passwordless sudo switch for DSH and its Agent |

See the [complete configuration reference](docs/en/guide.md#configuration) for all variables and validation rules.

## Online Updates

Open **Platform Management** in DSH settings or visit the standalone **DSH Management Console** at <http://127.0.0.1:3080/_dsh_platform/console/>. Checks do not download or activate anything until you confirm an update. Both interfaces can configure an existing HTTP or SOCKS5 proxy for selected managed outbound traffic; DSH Docker does not expose or create a public proxy service.

The standalone page remains available when DSH is down. It provides DSH lifecycle and recovery controls, live logs, bundled System Plugin and System Skill management, User Plugin and User Skill recovery, root file management, and a container terminal.

Authentication is initialized in the browser. A DSH login creates only a DSH Session; opening the Management Console exchanges that active session once for a separate Management Session. Direct Management access always completes the main DSH login first and then, when configured, asks for the Management console password. Logging out of DSH, or expiry of its session, also invalidates every linked Management Session. During a classified DSH outage, top-level browser navigation shows a generic recovery page before login so the standalone Management entry remains discoverable; API and WebSocket requests still fail closed. Authentication Settings can revoke either session class or move Management to a separately published origin on port `3081`.

Lost credentials are recovered only from an interactive Root console. Passwords are read with input echo disabled and are never accepted as command arguments or piped input:

```bash
docker exec -it --user root deepseek-harness dsh-platform access status
docker exec -it --user root deepseek-harness dsh-platform access reset
```

Useful commands:

```bash
docker exec deepseek-harness dsh-platform status
docker exec deepseek-harness dsh-platform check
docker exec deepseek-harness dsh-platform update --wait
docker exec deepseek-harness dsh-platform stop --wait
docker exec deepseek-harness dsh-platform start --wait
docker exec deepseek-harness dsh-platform restart --wait
docker exec deepseek-harness dsh-platform rollback
```

Stable follows the supported DSH release. Experimental can install a newer verified upstream DSH and creates a data snapshot before activation. Returning to Stable may discard data written after that snapshot.

## System Plugins

The Container Environment includes these DSH-Docker integrations:

| Plugin | Purpose |
| --- | --- |
| `@dsh-docker/platform-management` | Adds **Platform Management** to DSH settings for updates, maintenance, logs, System Plugins, System Skills, and current-browser sign-out controls; this integration is platform-managed |
| `@dsh-docker/settings-navigation` | Keeps the desktop Settings directory independently scrollable and provides directory/detail navigation on narrow screens |
| `@dsh-docker/settings-document-editor` | Replaces desktop-only configuration-file opening with an optional browser editor for `settings.yaml` |

Other installed System Plugins can be enabled or disabled from **Platform Management** in DSH; it cannot modify itself. The standalone **DSH Management Console** can install, uninstall, enable, or disable bundled System Plugins, including restoring Platform Management when it is missing. Changes are marked pending and take effect after restarting DSH. Installation restores verified local Environment assets and does not download from GitHub or npm. Third-party User Plugins remain separate and are not treated as System Plugins.

Platform Management and the Settings Document Editor use the restricted DSH-side platform API through the authenticated DSH Session. They do not require a separate Management Session. Platform Management can revoke the current browser's DSH Session and its linked Management Sessions, but account names, passwords, and complete authentication settings remain available only in the standalone Management Console or Root CLI.

## User Plugins

The standalone Management Console inventories Bundle plugins in the DSH Web Profile and can enable, disable, or uninstall an exact User Plugin. Applying a change snapshots the complete Web Profile and restarts only DSH. Installation remains in DSH's normal plugin flow or the container terminal; the recovery page does not install arbitrary packages.

## System and User Skills

DSH Docker includes the signed `dsh-docker-operations` System Skill. It gives the Agent container-specific instructions for files, development tools, plugins, lifecycle, logs, updates, recovery, networking, and permissions, and can also be invoked explicitly as `/dsh-docker-operations`.

System Skills are available under **Platform Management** in DSH and **System Skills** in the standalone Management Console. Changes are applied immediately without restarting DSH. The standalone console can install, uninstall, enable, or disable a bundled skill; Platform Management can restore a missing skill and enable or disable it. Project and user skills with the same name retain DSH's native precedence and can override the bundled copy.

The standalone console also inventories native User Skills from the configured DSH and Agent Skill roots. It can enable, disable, or delete an exact entry without modifying project-level Skills.

## Security

An authenticated DSH Session has full DSH authority. A Management Session additionally grants a root container terminal and root file operations, so an admitted administrator can read credentials, execute commands, and modify container data. Use HTTPS and a trusted network boundary for remote access.

Repository Compose disables DSH/Agent passwordless sudo by default. Set `DSH_SUDO_ENABLED=true` only when the agent intentionally needs root access. Do not combine sudo with privileged mode, the Docker socket, or sensitive host mounts without understanding the impact.

## Documentation

The [complete guide](docs/en/guide.md) covers:

- deployment prerequisites, both Compose layouts, and Docker Run;
- all configuration variables, storage, gateway, and remote-access behavior;
- platform architecture, online updates, System and User Plugins, System and User Skills, logs, trust, recovery, and rollback;
- standalone recovery tools, release automation, local builds, tests, and devtools.
