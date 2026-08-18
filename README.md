# DSH-Docker

English | [中文](README_CN.md)

An unofficial Docker image build repository for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The image installs the official `@deepseek-ai/dsh` npm package at build time. Repository-owned container adaptations live in [`container/`](container/): a small gateway, exact-match patches for the directory picker's initial path and the browser's loopback classification, and their integration checks. No upstream server-side privileged-API code is patched.

> DeepSeek Harness is in Developer Preview and may introduce incompatible changes. This image is not affiliated with DeepSeek AI.

## Quick start

### Docker Compose

Minimal `docker-compose.yaml`:

```yaml
services:
  deepseek-harness:
    image: szcq/deepseek-harness:latest
    container_name: deepseek-harness
    restart: unless-stopped
    ports:
      - "3080:3080"
    group_add:
      - "dsh-sudo-${DSH_SUDO_ENABLED:-true}"
    environment:
      DSH_PROXY_PASSWORD: "${DSH_PROXY_PASSWORD:-}"
      DSH_TRUSTED_HOSTS: "${DSH_TRUSTED_HOSTS:-}"
    volumes:
      - ./data:/home/node/.dsh
      - ./workspace:/workspace
```

### Docker CLI

```bash
docker run -d \
  --name deepseek-harness \
  --restart unless-stopped \
  --group-add dsh-sudo-true \
  -p 3080:3080 \
  -v "$(pwd)/data:/home/node/.dsh" \
  -v "$(pwd)/workspace:/workspace" \
  szcq/deepseek-harness:latest
```

### Usage notes

Create the bind-mount directories before using either example:

```bash
mkdir -p data workspace
```

Start the Compose deployment with `docker compose up -d`. Copy the example settings before customizing it:

```bash
cp .env.example .env
docker compose up -d --force-recreate
```

Open <http://127.0.0.1:3080>. Configuration, credentials, and sessions are stored in `./data`; `./workspace` is mounted at `/workspace`.

The container runs as `node` (UID/GID `1000:1000`). If a bind mount is inaccessible, correct its ownership or permissions, for example:

```bash
sudo chown -R 1000:1000 data workspace
```

Omit `--group-add dsh-sudo-true` to run without passwordless sudo.

> **Attention:** The short port syntax `3080:3080` normally publishes the port on every host interface. Bind a specific host address or apply an external firewall when network-level restriction is required. `DSH_TRUSTED_HOSTS` validates HTTP authorities; it is not a substitute for network isolation or authentication.

### Remote access

For a LAN address or reverse-proxy domain, allow the authority used by the browser:

```dotenv
DSH_TRUSTED_HOSTS=192.168.1.100,dsh.example.com
DSH_PROXY_PASSWORD=choose-a-strong-password
```

`DSH_PROXY_PASSWORD` may always be empty; empty means the gateway does not request browser authentication.

A reverse proxy must preserve the browser-facing `Host` header. TLS certificates and termination are managed outside this image.

## Configuration

### Compose-only variables

| Variable | Default | Description |
| --- | --- | --- |
| `DSH_IMAGE_TAG` | `latest` | Image tag |
| `DSH_LISTEN_ADDRESS` | `127.0.0.1` | Host address used for port publication |
| `DSH_PORT` | `3080` | Published host port |
| `DSH_WORKSPACE` | `./workspace` | Host directory mounted at `/workspace` |
| `DSH_SUDO_ENABLED` | `true` | Add unrestricted passwordless `sudo` inside the container; `true` or `false` |

### Container variables

| Variable | Default | Description |
| --- | --- | --- |
| `DSH_HOME` | `/home/node/.dsh` | DSH configuration and data directory |
| `DSH_DEFAULT_WORKSPACE` | `/workspace` | Initial directory-picker path; must be an existing, accessible absolute directory |
| `DSH_TELEMETRY_DISABLED` | `true` | Disable upstream telemetry; `true` or `false` |
| `DSH_TRUSTED_HOSTS` | Empty | Comma-separated external `host` or `host:port` authorities |
| `DSH_PROXY_USERNAME` | Empty | Optional HTTP Basic username; ignored when the password is empty |
| `DSH_PROXY_PASSWORD` | Empty | Optional single gateway password; empty disables gateway authentication |
| `DSH_PROXY_POLYFILL` | `true` | Inject a guarded `crypto.randomUUID` compatibility shim; `true` or `false` |

`DSH_TRUSTED_HOSTS` has these semantics:

- Empty: accept loopback Hosts only.
- One value: accept loopback plus that host; without a port it matches any port.
- Comma-separated values: accept every listed authority.
- `*`: accept any Host. This disables the Host allowlist, but Origin/Fetch Metadata and optional password checks remain.

Values must not contain a scheme, path, credentials, or subdomain wildcard. For example, `dsh.example.com`, `dsh.example.com:8443`, `192.168.1.100`, and `[fd00::1]:3080` are valid. The legacy single-value `DSH_TRUSTED_HOST` remains supported; do not set both variables at once.

### Workspace behavior

`DSH_DEFAULT_WORKSPACE` only changes the initial path shown when the web directory picker receives no explicit path. It is not a filesystem sandbox: users can select other paths that the container's `node` user can access. The gateway validates this variable before starting, and invalid values exit with status 64.

The image makes this behavior through an exact-match compiled-output patch. The patch must match exactly once, so an incompatible upstream release fails the image build instead of silently applying the wrong edit.

### Browser loopback behavior

Official DSH also classifies the browser from the public page hostname and disables Host-backed settings on non-loopback pages. Because every browser admitted by this image's gateway receives full DSH authority, a second exact-match compiled-output patch marks that browser connection as loopback. This keeps the browser UI consistent with the loopback `Host`/`Origin` values the gateway sends upstream. The server-side privileged-method implementation remains unchanged.

## How the gateway works

```text
tini
  └─ gateway        0.0.0.0:3080
       └─ dsh web   127.0.0.1:3079
```

The gateway validates the external `Host`, `Origin`, and Fetch Metadata, optionally requires one password, and then proxies HTTP, SSE, and WebSocket traffic to DSH with loopback `Host`/`Origin` values. Consequently, every user admitted by the gateway receives the complete DSH feature set, including settings, credentials, and host-operation interfaces.

## Password access

When `DSH_PROXY_PASSWORD` is non-empty, the gateway uses HTTP Basic authentication so the browser presents its native authentication dialog. If `DSH_PROXY_USERNAME` is empty, the gateway ignores the supplied username and validates only the password. If both variables are non-empty, both values must match. Setting only `DSH_PROXY_USERNAME` does not enable authentication. Failed attempts are rate-limited.

The username and password are not trimmed, logged, or persisted by the gateway, and the `Authorization` header is removed before requests reach DSH. An active username cannot contain `:` because HTTP Basic uses it as the field separator. Browsers may retain Basic credentials for the browsing session and do not provide a reliable gateway logout operation. Use HTTPS for remote access because Basic credentials are encoded, not encrypted. TLS termination remains outside this image.

## Security model

Gateway access is full DSH access. An admitted user may be able to read or replace model credentials, execute commands, and read or write every path available to the container's `node` user—not only `/workspace`. The Host allowlist is anti-rebinding input validation, not user authentication.

The quick-start examples use Docker's short port syntax and may be reachable through every host interface. Before allowing untrusted network access, use a strong gateway password, an authenticated reverse proxy, a VPN, or another trusted access boundary. An SSH tunnel can be used with an explicitly loopback-bound deployment:

```bash
ssh -L 3080:127.0.0.1:3080 user@server
```

Compose enables unrestricted passwordless root access for the agent by default. Set `DSH_SUDO_ENABLED=false` to disable it. Do not combine sudo with privileged mode, the Docker socket, or sensitive host mounts unless that authority is intentional.

## Browser compatibility

By default, the gateway injects a feature-detected `crypto.randomUUID` polyfill into HTML responses. It runs only when `randomUUID` is absent and uses `crypto.getRandomValues`; there is no `Math.random` fallback. Set `DSH_PROXY_POLYFILL=false` if all clients provide the API or a DSH update no longer needs the shim.

Injected HTML uses `Cache-Control: no-cache` and drops upstream validators that no longer describe the modified body. Browsers therefore revalidate the entry document instead of retaining a stale version; unmodified static assets keep their upstream caching behavior.

## Build and test

```bash
docker build -t deepseek-harness:local .
```

Build a specific official package version:

```bash
docker build --build-arg DSH_VERSION=0.1.0-rc.6 -t deepseek-harness:0.1.0-rc.6 .
```

Run local checks with Node.js 24 and Docker Compose:

```bash
npm test --prefix container/gateway
node container/test/compose-config.mjs
```

With a Docker daemon available, `container/test/container-smoke.sh [image]` builds or tests an image and verifies the managed process, trust/password flow, and loopback-only DSH listener.

The runtime image is based on Node.js 24 and includes `pnpm`, Git, OpenSSH, curl, jq, ripgrep, and optional sudo support.
