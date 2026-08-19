# **DSH-Docker**

English | [中文](README_CN.md)

An unofficial Docker image build repository for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The image installs the official `@deepseek-ai/dsh` npm package at build time. Repository-owned container adaptations live in [`container/`](container/): a persistent control plane, exact-match patches for the directory picker's initial path and the browser's loopback classification, and their integration checks. No upstream server-side privileged-API code is patched.

> DeepSeek Harness is in Developer Preview and may introduce incompatible changes. This image is not affiliated with DeepSeek AI.

Two image variants are published from the same DSH version and container adaptations:

| Variant | Rolling tag | Versioned tag | Contents |
| --- | --- | --- | --- |
| Standard | `latest` | `<version>` | DSH and the runtime utilities required for normal use |
| Devtools | `latest-devtools` | `<version>-devtools` | Standard image plus a general-purpose development toolset |

## **Quick start**

### **One-command deployment**

```bash
docker run -d \
  --name deepseek-harness \
  --restart unless-stopped \
  --group-add dsh-sudo-true \
  -p 3080:3080 \
  -v dsh-platform-data:/data \
  -v "$(pwd)/data:/home/node/.dsh" \
  -v "$(pwd)/workspace:/workspace" \
  szcq/deepseek-harness:latest
```

### **Docker Compose**

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
      - dsh-platform-data:/data
      - ./data:/home/node/.dsh
      - ./workspace:/workspace

volumes:
  dsh-platform-data:
```

### **Usage notes**

Create the bind-mount directories before using either deployment method:

```bash
mkdir -p data workspace
```

Start Compose with `docker compose up -d`. To customize it, copy the example environment file beforehand:

```bash
cp .env.example .env
```

Open <http://127.0.0.1:3080>. DSH data is stored in `./data`; `./workspace` is mounted at `/workspace`.

### **Important notes**

#### **Permission notes**

Stage-0 runs as root while Bootstrap and Environment components run as `node` (UID/GID `1000:1000`). If a bind mount is inaccessible, correct its ownership or permissions, for example:

```bash
sudo chown -R 1000:1000 data workspace
```

For the one-command deployment, omit `--group-add dsh-sudo-true` to disable passwordless sudo. With Compose, set `DSH_SUDO_ENABLED=false`.

#### **Remote access**

For a LAN address or reverse-proxy domain, allow the authority used by the browser:

```dotenv
DSH_TRUSTED_HOSTS=192.168.1.100,dsh.example.com
DSH_PROXY_PASSWORD=choose-a-strong-password
```

`DSH_PROXY_PASSWORD` may always be empty; empty means the gateway does not request browser authentication.

A reverse proxy must preserve the browser-facing `Host` header. TLS certificates and termination are managed outside this image.

#### **Port exposure**

The short port syntax `3080:3080` normally publishes the port on every host interface. To accept connections only from the Docker host, use `127.0.0.1:3080:3080` in Compose:

```yaml
ports:
  - "127.0.0.1:3080:3080"
```

The equivalent `docker run` option is `-p 127.0.0.1:3080:3080`. Apply an external firewall when additional network-level restriction is required. `DSH_TRUSTED_HOSTS` validates HTTP authorities; it is not a substitute for network isolation or authentication.

## **Configuration**

### **Compose-only variables**

| Variable | Default | Description |
| --- | --- | --- |
| `DSH_IMAGE_TAG` | `latest` | Image tag |
| `DSH_LISTEN_ADDRESS` | `127.0.0.1` | Host address used for port publication |
| `DSH_PORT` | `3080` | Published host port |
| `DSH_WORKSPACE` | `./workspace` | Host directory mounted at `/workspace` |
| `DSH_SUDO_ENABLED` | `true` | Add unrestricted passwordless `sudo` inside the container; `true` or `false` |

### **Container variables**

| Variable | Default | Description |
| --- | --- | --- |
| `DSH_HOME` | `/home/node/.dsh` | DSH configuration and data directory |
| `DSH_DEFAULT_WORKSPACE` | `/workspace` | Initial directory-picker path; must be an existing, accessible absolute directory |
| `DSH_TELEMETRY_DISABLED` | `true` | Disable upstream telemetry; `true` or `false` |
| `DSH_TRUSTED_HOSTS` | Empty | Comma-separated external `host` or `host:port` authorities |
| `DSH_PROXY_USERNAME` | Empty | Optional HTTP Basic username; ignored when the password is empty |
| `DSH_PROXY_PASSWORD` | Empty | Optional single gateway password; empty disables gateway authentication |
| `DSH_PROXY_POLYFILL` | `true` | Inject a guarded `crypto.randomUUID` compatibility shim; `true` or `false` |
| `DSH_UPDATE_CHECK_INTERVAL_SECONDS` | `21600` | Background check interval; checks do not download or activate |
| `DSH_LOG_MAX_BYTES` | `104857600` | Aggregate platform JSONL log budget |
| `DSH_LOG_RETENTION_DAYS` | `14` | Platform log retention |
| `DSH_ACTIVATION_TIMEOUT_SECONDS` | `60` | Update activation health deadline |
| `DSH_EXPERIMENTAL_PROBATION_SECONDS` | `120` | Experimental Runtime observation period before commit |

`DSH_TRUSTED_HOSTS` has these semantics:

- Empty: accept loopback Hosts only.
- One value: accept loopback plus that host; without a port it matches any port.
- Comma-separated values: accept every listed authority.
- `*`: accept any Host. This disables the Host allowlist, but Origin/Fetch Metadata and optional password checks remain.

Values must not contain a scheme, path, credentials, or subdomain wildcard. For example, `dsh.example.com`, `dsh.example.com:8443`, `192.168.1.100`, and `[fd00::1]:3080` are valid. The legacy single-value `DSH_TRUSTED_HOST` remains supported; do not set both variables at once.

### **Workspace behavior**

`DSH_DEFAULT_WORKSPACE` only changes the initial path shown when the web directory picker receives no explicit path. It is not a filesystem sandbox: users can select other paths that the container's `node` user can access. DSH validates access while its Environment component starts.

The image makes this behavior through an exact-match compiled-output patch. The patch must match exactly once, so an incompatible upstream release fails the image build instead of silently applying the wrong edit.

### **Browser loopback behavior**

Official DSH also classifies the browser from the public page hostname and disables Host-backed settings on non-loopback pages. Because every browser admitted by this image's gateway receives full DSH authority, a second exact-match compiled-output patch marks that browser connection as loopback. This keeps the browser UI consistent with the loopback `Host`/`Origin` values the gateway sends upstream. The server-side privileged-method implementation remains unchanged.

## **How the gateway works**

```text
tini
  └─ Stage-0
       └─ Bootstrap
            ├─ Control Plane
            │    ├─ management + Update Console  Unix socket
            │    └─ gateway                      0.0.0.0:3080
            └─ Environment
                 └─ dsh-runtime                  127.0.0.1:3079
```

The gateway validates the external `Host`, `Origin`, and Fetch Metadata and optionally requires one password. It sends the fixed `/_dsh_platform/ui/` and bounded management API routes to the persistent Management service; all other HTTP, SSE, and WebSocket traffic goes to DSH with loopback `Host`/`Origin` values. Consequently, every user admitted by the gateway receives the complete DSH feature set, including settings, credentials, and host-operation interfaces.

The source tree follows the same lifecycle boundary. `container/control-plane/services/` contains the Gateway and Management processes supervised by Bootstrap, while `container/control-plane/hooks/` contains supervised one-shot recovery work. `container/control-plane/modules/` contains updater, logging, patch, and System Plugin logic imported by them. `container/environment/` contains workloads that updates may suspend and replace. Environment reload therefore stops DSH without stopping Gateway, Management, or the Update Console.

## **Online updates and trust**

Platform state lives in `/data`; DSH settings, sessions, and third-party plugins remain in `/home/node/.dsh`. Keep both volumes. Existing Compose deployments gain the new platform volume on the next `docker compose up -d`; the original DSH volume is reused in place.

Stage-0 contains one offline Recovery Root public key. It first verifies a monotonically increasing Recovery-signed keyring, then accepts `stable.json` only from that keyring's current Release Key. Downloads remain under `/data/downloads/untrusted` until Stage-0 verifies their authority and imports them into the trusted object store. Bootstrap and Updater have no API for adding a root key, editing keyrings, submitting an arbitrary expected hash, or minting receipts.

Stable metadata also delegates the official npm Registry origin, the exact `@deepseek-ai/dsh` package name, and accepted npm Registry signing keys. In Experimental mode, this dsh-docker instance queries npm directly. Stage-0 verifies the Registry signature over `name@version:integrity`, canonical tarball URL, version advancement, and downloaded SHA-512 before issuing an Experimental receipt. There is no per-version Experimental GitHub workflow or `experimental.json` publication.

Management checks every six hours with jitter but does not download or activate automatically. The Platform Update settings section opens the persistent Console at `/_dsh_platform/ui/`; after navigation, it remains available while DSH is suspended, replaced, health-checked, or rolled back. You can also use:

```bash
docker exec deepseek-harness dsh-platform status
docker exec deepseek-harness dsh-platform check
docker exec deepseek-harness dsh-platform update --wait
docker exec deepseek-harness dsh-platform channel experimental
docker exec deepseek-harness dsh-platform retry
docker exec deepseek-harness dsh-platform logs --source updater
docker exec deepseek-harness dsh-platform rollback
docker exec -it deepseek-harness dsh-platform return-stable
```

Changing the channel only changes local desired state; it never downloads or activates by itself. Stable converges to the signed supported DSH and Environment. Experimental first converges the official Environment, then offers the newest verified upstream DSH. When the running DSH is ahead of Latest Supported, the complete Runtime/Environment combination is frozen until Stable catches up. Failed candidate builds create a version Hold; failed Runtime/Environment combinations create a combination Hold. `retry` clears the one active Hold or Blocked combination.

Before an Experimental Runtime can touch real data, the updater stops `dsh-runtime` and creates a verified tar snapshot of the complete `/home/node/.dsh`. It then switches the Runtime, checks health, and observes the candidate for the configured probation period. Failure or an interrupted transaction restores Runtime, Environment, System Plugins, receipts, and snapshot before DSH restarts. `rollback` restores the retained previous complete state. `return-stable` is interactive, is available only with a verified pre-Experimental recovery point, and warns that data written after the displayed snapshot time will be lost.

`dsh` is a dynamic shim and always executes the current verified Runtime. `dsh-platform trust status` reports the accepted generation. `dsh-platform trust reset` is deliberately console-only: stop the service, mount its platform-data Volume into a one-shot image with `--entrypoint dsh-platform`, run `trust reset` from an interactive TTY, and type the exact confirmation. It clears accepted trust state but does not change the Recovery Root embedded in the image.

For routine Release Key rotation or compromise, use the offline Recovery key to sign generation+1: promote the old `next` key to `current`, revoke the old current key, and install a new next key. Revocations are cumulative. Only Recovery Root compromise or a cryptographic algorithm migration requires a new image or explicit trust reset. Recovery private material must never be stored in GitHub secrets; CI receives only the signed public keyring bundle and the protected current Release private key.

## **Release automation**

`DSH Upstream Update` runs daily and on demand. It compares npm `latest` with [`release/supported-target.json`](release/supported-target.json), preserves the current Environment, and creates or updates one candidate PR for promotion into Latest Supported. It is not the Experimental client update path. Candidate CI verifies npm integrity, applies the current Environment during the image build, runs both project suites, and executes the standard and devtools container smoke tests. These jobs have no Docker, Release, or Recovery credentials; a human merge remains the publication gate.

`Publish Latest Supported DSH` runs only from `main` after the Supported Target changes, or by an explicitly approved manual dispatch. Configure a protected `production-release` GitHub Environment restricted to `main`, with:

- `DSH_RECOVERY_ROOT_PUBLIC_KEY`
- `DSH_KEYRING_JSON_BASE64`
- `DSH_KEYRING_SIGNATURE_BASE64`
- `DSH_RELEASE_PRIVATE_KEY`

The workflow resumes `targetSequence` from the current Latest Release, prepares a draft with immutable Artifacts, uploads every asset, and only then publishes it as Latest. The Recovery private key has no workflow input and stays offline.

`Publish Docker Image` is a separate manual workflow protected by a `production-image` Environment restricted to `main`. It uses the three public trust-bundle secrets above plus `DOCKER_TOKEN`; it has no Release private key or GitHub Release write permission. Its default `supported` input builds the reviewed DSH version. Repository or organization secrets `GOTIFY_URL` and `GOTIFY_TOKEN` are passed explicitly to `yjrszcq/github-workflows/.github/workflows/gotify-notify.yml@v1` for notifications.

## **Password access**

When `DSH_PROXY_PASSWORD` is non-empty, the gateway uses HTTP Basic authentication so the browser presents its native authentication dialog. If `DSH_PROXY_USERNAME` is empty, the gateway ignores the supplied username and validates only the password. If both variables are non-empty, both values must match. Setting only `DSH_PROXY_USERNAME` does not enable authentication. Failed attempts are rate-limited.

The username and password are not trimmed, logged, or persisted by the gateway, and the `Authorization` header is removed before requests reach DSH. An active username cannot contain `:` because HTTP Basic uses it as the field separator. Browsers may retain Basic credentials for the browsing session and do not provide a reliable gateway logout operation. Use HTTPS for remote access because Basic credentials are encoded, not encrypted. TLS termination remains outside this image.

## **Security model**

Gateway access is full DSH access. An admitted user may be able to read or replace model credentials, execute commands, and read or write every path available to the container's `node` user—not only `/workspace`. The Host allowlist is anti-rebinding input validation, not user authentication.

The quick-start examples use Docker's short port syntax and may be reachable through every host interface. Before allowing untrusted network access, use a strong gateway password, an authenticated reverse proxy, a VPN, or another trusted access boundary. An SSH tunnel can be used with an explicitly loopback-bound deployment:

```bash
ssh -L 3080:127.0.0.1:3080 user@server
```

Compose enables unrestricted passwordless root access for the agent by default. Set `DSH_SUDO_ENABLED=false` to disable it. Do not combine sudo with privileged mode, the Docker socket, or sensitive host mounts unless that authority is intentional.

## **Browser compatibility**

By default, the gateway injects a feature-detected `crypto.randomUUID` polyfill into HTML responses. It runs only when `randomUUID` is absent and uses `crypto.getRandomValues`; there is no `Math.random` fallback. Set `DSH_PROXY_POLYFILL=false` if all clients provide the API or a DSH update no longer needs the shim.

Injected HTML uses `Cache-Control: no-cache` and drops upstream validators that no longer describe the modified body. Browsers therefore revalidate the entry document instead of retaining a stale version; unmodified static assets keep their upstream caching behavior.

## **Build and test**

```bash
docker build -t deepseek-harness:local .
```

Local builds use a marked, non-production trust fixture. The release workflow refuses that marker and requires an offline Recovery-signed public trust bundle through protected secrets before it can push an image.

Build a specific official package version:

```bash
docker build --build-arg DSH_VERSION=0.1.0-rc.6 -t deepseek-harness:0.1.0-rc.6 .
```

Build the devtools variant:

```bash
docker build --build-arg INSTALL_DEVTOOLS=true -t deepseek-harness:local-devtools .
```

Run local checks with Node.js 24 and Docker Compose:

```bash
npm test --prefix container/control-plane/services/gateway
npm test --prefix container/platform
node container/test/compose-config.mjs
```

With a Docker daemon available, `container/test/container-smoke.sh [image]` builds or tests an image and verifies the managed process, trust/password flow, and loopback-only DSH listener. `container/test/devtools-smoke.sh <image>` verifies the devtools variant.

The standard runtime image is based on Node.js 24 and includes `pnpm`, Python 3 with `venv`, Git, OpenSSH, curl, jq, ripgrep, and optional sudo support. The devtools variant additionally includes Bash completion, `build-essential`, DNS and network diagnostics, archive and file utilities, Vim and other interactive terminal tools, `pkg-config`, and a pinned uv installation.

The devtools image uses uv instead of a shared pre-created Python environment. For disposable scripts, use commands such as `uv run --with requests script.py`; projects can use `uv sync` and `uv run`. Bare `pip` and `pip3` commands are intentionally absent, while `python3 -m venv` remains available for compatibility. Automatic Python downloads are disabled, but an additional version can be installed explicitly with `uv python install <version>`.
