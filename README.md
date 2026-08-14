# DSH-Docker

English | [中文](README_CN.md)

An unofficial Docker image build repository for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

This repository does not include or redistribute the DeepSeek Harness source code. During the image build, the specified version of the official `@deepseek-ai/dsh` package is installed from npm and a small set of container-specific patches is applied. This repository maintains only the container configuration, patches, and image publishing workflow.

> DeepSeek Harness is currently in Developer Preview and may introduce incompatible changes. This image is not affiliated with DeepSeek AI. The upstream project and software licenses are governed by the official repository.

## Quick Start

### Docker Compose

Minimal `docker-compose.yaml`:

```yaml
services:
  deepseek-harness:
    image: szcq/deepseek-harness:latest
    container_name: deepseek-harness
    restart: unless-stopped
    ports:
      - "${DSH_LISTEN_ADDRESS:-127.0.0.1}:3080:3080"
    environment:
      DSH_TRUSTED_HOST: "${DSH_TRUSTED_HOST:-}"
    volumes:
      - ./data:/home/node/.dsh
      - ./workspace:/workspace
```

> **Remote access:** To access the service through a LAN IP address or domain, set `DSH_LISTEN_ADDRESS=0.0.0.0` and `DSH_TRUSTED_HOST=192.168.1.100` in `.env`. Replace the example IP address with the IP address or domain actually used by the browser, without a scheme or path. Then run `docker compose up -d --force-recreate`.

1. Create the host data and workspace directories:

   ```bash
   mkdir -p data workspace
   ```

   The container runs as the `node` user with UID/GID `1000:1000`. If a directory was previously created by root or automatically by Docker, startup may fail with `EACCES: permission denied`. Correct the directory ownership and try again:

   ```bash
   sudo chown -R 1000:1000 data workspace
   ```

2. Start the service:

   ```bash
   docker compose up -d
   ```

3. Open <http://127.0.0.1:3080>, click **Choose workspace**, then add and select `/workspace`.

   The initial path shown by the web directory picker is controlled by `DSH_DEFAULT_WORKSPACE` and defaults to `/workspace`.

4. Configure a DeepSeek API key or another compatible model under **Settings → Models**.

Stop the service:

```bash
docker compose down
```

Harness configuration, credentials, and session data are stored in the `dsh-data` named volume. Workspace files are stored in the `workspace` directory under the current directory by default.

### Docker CLI

```bash
mkdir -p workspace data

docker run -d \
  --name deepseek-harness \
  --restart unless-stopped \
  -p 127.0.0.1:3080:3080 \
  -v "$(pwd)/workspace:/workspace" \
  -v "$(pwd)/data:/home/node/.dsh" \
  szcq/deepseek-harness:latest
```

> **Remote access:** To access the service through a LAN IP address or domain, change the port mapping to `-p 0.0.0.0:3080:3080` and add `-e DSH_TRUSTED_HOST=192.168.1.100` to the `docker run` arguments. Replace the example IP address with the IP address or domain actually used by the browser, without a scheme or path.

If a bind mount reports a permission error, ensure that the host directory is readable and writable by the container's `node` user (UID/GID 1000). Alternatively, use a named volume for `$DSH_HOME`, as shown in the Compose example.

## Compose Configuration

Copy the example configuration and edit it as needed:

```bash
cp .env.example .env
```

You can also override the defaults with shell environment variables.

### Compose File Variables

The following variables are used only for interpolation in the Compose file and are not passed into the container:

| Variable | Default | Description |
| --- | --- | --- |
| `DSH_IMAGE_TAG` | `latest` | Image tag |
| `DSH_LISTEN_ADDRESS` | `127.0.0.1` | Host listen address |
| `DSH_PORT` | `3080` | Host port |
| `DSH_WORKSPACE` | `./workspace` | Host directory mounted at `/workspace` |

### Container Environment Variables

The following variables are passed into the container through the Compose `environment` section. `DSH_HOME` is fixed by the Compose file; the remaining variables can be read from `.env` or the shell environment:

| Variable | Default | Description |
| --- | --- | --- |
| `DSH_HOME` | `/home/node/.dsh` | Harness configuration and data directory inside the container |
| `DSH_DEFAULT_WORKSPACE` | `/workspace` | Initial container directory shown by the web directory picker; the directory must exist |
| `DSH_TELEMETRY_DISABLED` | `true` | Whether to disable telemetry; accepts only `true` or `false` |
| `DSH_TRUSTED_HOST` | Empty | IP address or domain actually used by the browser, required to pass `/api` trust checks |

Example:

```dotenv
# Compose file variables
DSH_IMAGE_TAG=0.1.0-rc.6
DSH_PORT=8080
DSH_WORKSPACE=/path/to/project

# Container environment variables
DSH_DEFAULT_WORKSPACE=/workspace
DSH_TRUSTED_HOST=192.168.1.100
```

Restart the service after making changes:

```bash
docker compose up -d
```

## Security

DeepSeek Harness is a coding agent that can read and write files and execute commands in the mounted workspace. Do not expose the current Web UI directly to an untrusted network.

By default, Compose listens only on the host's `127.0.0.1`. For access from another device, prefer an authenticated reverse proxy, VPN, or SSH tunnel. Set `DSH_LISTEN_ADDRESS` to `0.0.0.0` only when you understand the risks.

When accessing the service through a LAN IP address or custom domain, you must also use `DSH_TRUSTED_HOST` to declare the IP address or domain actually used by the browser. Otherwise, `/api` requests will return HTTP 403. For example, configure LAN access in `.env` as follows:

```dotenv
DSH_LISTEN_ADDRESS=0.0.0.0
DSH_TRUSTED_HOST=192.168.1.100
```

When using a reverse proxy, you can set `DSH_TRUSTED_HOST=dsh.example.com`. Do not include `http://`, `https://`, or a path. A port is usually unnecessary because a value without a port can match that address on any port. After changing the configuration, run `docker compose up -d --force-recreate`.

During the image build, this image patches the upstream privileged API trust check so that `DSH_TRUSTED_HOST` also applies to sensitive endpoints for settings, credentials, and host operations. This resolves HTTP 403 responses from endpoints such as `settings.describe` when accessing the service through a trusted LAN IP address or domain. The patch does not add authentication: anyone who can access the Web UI using a trusted Host may be able to modify credentials, execute commands, and read or write the workspace. Use this feature only on a trusted network or behind an authenticated reverse proxy.

If you do not want to relax access to these endpoints, leave `DSH_TRUSTED_HOST` unset and connect through an SSH tunnel using a local loopback address:

```bash
ssh -L 3080:127.0.0.1:3080 user@server
```

Then open <http://127.0.0.1:3080>.

The container sets `DSH_TELEMETRY_DISABLED=true` by default. Set it to `false` to enable upstream telemetry. Before enabling telemetry, review whether the collected data may contain session or workspace information. The entrypoint converts this Boolean setting to the environment-variable semantics expected by the upstream package.

## Build the Image Locally

Build the latest npm version:

```bash
docker build -t deepseek-harness:local .
```

Build a specific version:

```bash
docker build \
  --build-arg DSH_VERSION=0.1.0-rc.6 \
  -t deepseek-harness:0.1.0-rc.6 .
```

Run the local image:

```bash
docker run --rm \
  -p 127.0.0.1:3080:3080 \
  -v "$(pwd)/workspace:/workspace" \
  deepseek-harness:local
```

The image is based on Node.js 24 and includes `pnpm`, Git, the OpenSSH client, curl, jq, and ripgrep so Harness can work in the workspace and install plugins.
