# DSH-Docker

English | [中文](README_CN.md)

An unofficial Docker image for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It installs the official `@deepseek-ai/dsh` package and adds persistent updates, rollback, gateway access control, and optional development tools.

> DeepSeek Harness is in Developer Preview and may introduce incompatible changes. This project is not affiliated with DeepSeek AI.

| Variant | Rolling tag | Versioned tag | Contents |
| --- | --- | --- | --- |
| Standard | `latest` | `<version>` | DSH and normal runtime utilities |
| Devtools | `latest-devtools` | `<version>-devtools` | Standard image plus development tools |

## Quick Start

Create local data directories:

```bash
mkdir -p data workspace
```

Run the standard image:

```bash
docker run -d \
  --name deepseek-harness \
  --restart unless-stopped \
  --group-add dsh-sudo-true \
  -p 3080:3080 \
  -v dsh-platform-data:/data/platform \
  -v "$(pwd)/data:/data/dsh" \
  -v "$(pwd)/workspace:/workspace" \
  szcq/deepseek-harness:latest
```

Or use the included Compose configuration:

```bash
cp .env.example .env
docker compose up -d
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

See the [complete configuration reference](docs/README.md#configuration) for all variables and validation rules.

## Updates

Open **Platform Management** in DSH settings or visit the standalone **DSH Management Console** at <http://127.0.0.1:3080/_dsh_platform/console/>. Checks do not download or activate anything until you confirm an update.

The standalone page remains available when DSH is down and includes User Plugin recovery, file management, and a container terminal.

When the gateway password is empty, DSH Management Console uses its separate `DSH_PLATFORM_PASSWORD`. If that password is also empty, the console stays locked until you create a temporary access key. The key expires after 10 minutes, and creating another immediately invalidates the previous key:

```bash
docker exec dsh-test dsh-platform access create
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

Anyone admitted by the gateway has full DSH authority and may be able to read credentials, execute commands, and access every path available to the container's `node` user. Use HTTPS and a trusted network boundary for remote access.

Compose enables unrestricted passwordless sudo by default. Set `DSH_SUDO_ENABLED=false` unless the agent needs root access. Do not combine sudo with privileged mode, the Docker socket, or sensitive host mounts without understanding the impact.

## Documentation

The [complete guide](docs/README.md) covers:

- all configuration variables and gateway behavior;
- platform architecture, online updates, trust, recovery, and rollback;
- password and browser compatibility details;
- release automation, local builds, tests, and devtools.
