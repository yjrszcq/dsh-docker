# DSH-Docker

English | [中文](README_CN.md)

An unofficial Docker image for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It installs the official `@deepseek-ai/dsh` package and adds persistent updates, rollback, gateway access control, and optional development tools.

> DeepSeek Harness is in Developer Preview and may introduce incompatible changes. This project is not affiliated with DeepSeek AI.

## Before You Start

- **Directory permissions:** Bind-mounted `data/dsh`, `data/platform`, and `workspace` must be writable by container UID/GID `1000:1000`. Keep both data directories when replacing or upgrading the container.
- **Port exposure:** The quick-start configuration binds `127.0.0.1:3080` and is reachable only from the Docker host. Changing it to `3080:3080` or `0.0.0.0:3080:3080` exposes the service on every host interface.
- **Remote access:** Before allowing LAN or Internet access, set `DSH_TRUSTED_HOSTS` to the exact IP addresses or domains used by browsers and set a strong `DSH_PROXY_PASSWORD`. Place the service behind HTTPS or another trusted network boundary, and do not expose privileged Docker or host resources to the container.
- **Root authority:** `group_add: dsh-sudo-true` gives DSH and its Agent unrestricted passwordless root access. If they do not need root, remove that `group_add` entry from the minimal Compose example (or omit `--group-add dsh-sudo-true` from `docker run`); with the repository Compose file, set `DSH_SUDO_ENABLED=false`. This does not disable the standalone Management Console's terminal and file manager, which always operate as container root and must remain protected by authentication and a trusted network boundary.
- **DSH Management Console:** `/_dsh_platform/console/` remains available when DSH is stopped or fails to start and provides updates, recovery, logs, plugin management, container files, and a root terminal. It uses `DSH_PROXY_PASSWORD` when Gateway authentication is enabled; otherwise set `DSH_PLATFORM_PASSWORD`, or create a temporary access key from the container when both passwords are empty.

| Variant | Rolling tag | Versioned tag | Contents |
| --- | --- | --- | --- |
| Standard | `latest` | `<version>` | DSH and normal runtime utilities |
| Devtools | `latest-devtools` | `<version>-devtools` | Standard image plus development tools |

## Quick Start

Create local data directories:

```bash
mkdir -p data/dsh data/platform workspace
```

Use this minimal `compose.yaml`:

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

For LAN or reverse-proxy access, set the browser-facing host and a strong password:

```dotenv
DSH_TRUSTED_HOSTS=192.168.1.100,dsh.example.com
DSH_PROXY_PASSWORD=choose-a-strong-password
```

A reverse proxy must preserve the original `Host` header. Terminate TLS outside this container. To publish only on the Docker host, use `127.0.0.1:3080:3080` instead of `3080:3080`.

Common settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DSH_TRUSTED_HOSTS` | Loopback only | Allowed browser-facing hosts |
| `DSH_PROXY_USERNAME` | Empty | Optional HTTP Basic username |
| `DSH_PROXY_PASSWORD` | Empty | HTTP Basic password; empty disables authentication |
| `DSH_PLATFORM_PASSWORD` | Empty | Protects DSH Management Console when the gateway password is empty; empty uses temporary-key mode |
| `DSH_DEFAULT_WORKSPACE` | `/workspace` | Default workspace for directory pickers and standalone file management |
| `DSH_SUDO_ENABLED` | `true` | Compose-only passwordless sudo switch |

See the [complete configuration reference](docs/en/guide.md#configuration) for all variables and validation rules.

## Updates

Open **Platform Management** in DSH settings or visit the standalone **DSH Management Console** at <http://127.0.0.1:3080/_dsh_platform/console/>. Checks do not download or activate anything until you confirm an update.

The standalone page remains available when DSH is down and includes User Plugin recovery, file management, and a container terminal.

When the gateway password is empty, DSH Management Console uses its separate `DSH_PLATFORM_PASSWORD`. If that password is also empty, the console stays locked until you create a temporary access key. The key expires after 10 minutes, and creating another immediately invalidates the previous key:

```bash
docker exec deepseek-harness dsh-platform access create
```

Useful commands:

```bash
docker exec deepseek-harness dsh-platform status
docker exec deepseek-harness dsh-platform check
docker exec deepseek-harness dsh-platform update --wait
docker exec deepseek-harness dsh-platform restart --wait
docker exec deepseek-harness dsh-platform rollback
```

Stable follows the supported DSH release. Experimental can install a newer verified upstream DSH and creates a data snapshot before activation. Returning to Stable may discard data written after that snapshot.

## Security

Anyone admitted by the gateway has full DSH authority. The standalone Management Console also provides a root container terminal and root file operations, so an admitted user can read credentials, execute commands, and modify container data. Use HTTPS and a trusted network boundary for remote access.

Compose enables unrestricted passwordless sudo by default. Set `DSH_SUDO_ENABLED=false` unless the agent needs root access. Do not combine sudo with privileged mode, the Docker socket, or sensitive host mounts without understanding the impact.

## Documentation

The [complete guide](docs/en/guide.md) covers:

- all configuration variables and gateway behavior;
- platform architecture, online updates, trust, recovery, and rollback;
- password and browser compatibility details;
- release automation, local builds, tests, and devtools.
