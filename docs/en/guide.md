# DSH-Docker Complete Guide

English | [中文](../cn/guide.md) | [Quick start](../../README.md)

This guide expands the root [README](../../README.md) into a complete deployment, operation, recovery, security, release, and development reference.

## Contents

- [Deployment](#deployment)
- [Configuration](#configuration)
- [Platform Architecture](#platform-architecture)
- [Gateway](#gateway)
- [Online Updates](#online-updates)
- [System Plugins](#system-plugins)
- [System Skills](#system-skills)
- [Standalone Recovery Tools](#standalone-recovery-tools)
- [Logs](#logs)
- [Update Channels and Rollback](#update-channels-and-rollback)
- [Trust and Recovery](#trust-and-recovery)
- [Security Model](#security-model)
- [Release Automation](#release-automation)
- [Build and Test](#build-and-test)

## Deployment

### Image Variants

| Variant | Docker Hub rolling tag | Docker Hub DSH-version tag | Contents |
| --- | --- | --- | --- |
| Standard | `latest` | `<version>` | DSH and normal runtime utilities |
| Devtools | `latest-devtools` | `<version>-devtools` | Standard image plus development tools |

Use the Standard image for ordinary deployments. It includes the minimal compiler toolchain needed by native DSH plugin dependencies. The Devtools image adds broader diagnostics, editors, and other development utilities while using the same persistent data layout.

Docker Hub publishes both variants. GHCR is a Standard-image backup only: `ghcr.io/yjrszcq/dsh-docker` uses the Environment tags `latest`, `x.x.x`, `x.x`, and `x`, plus the DSH lookup tag `dsh-x.x.x-rc.x`; it never publishes Devtools tags.

### Before You Start

- **Directory permissions:** Bind-mounted DSH data, platform data, and workspace directories must be writable by UID/GID `1000:1000`. Keep both data directories when replacing or upgrading a container.
- **Port exposure:** Bind `127.0.0.1:3080:3080` for host-only access. `3080:3080` or `0.0.0.0:3080:3080` publishes DSH on every host interface.
- **Remote access:** Set `DSH_TRUSTED_HOSTS` to the exact browser-facing IP addresses or domains. A strong `DSH_PROXY_PASSWORD` is recommended, and HTTPS should terminate outside the container.
- **Agent root authority:** The `dsh-sudo-true` supplementary group grants DSH and its Agent unrestricted passwordless root access. Omit it when root is unnecessary, or set `DSH_SUDO_ENABLED=false` when using the repository Compose file.
- **Management root authority:** Disabling Agent sudo does not restrict the standalone DSH Management Console. Its container terminal and file manager intentionally run as root and require authentication and a trusted network boundary.
- **Recovery access:** `/_dsh_platform/console/` remains available while DSH is stopped or cannot start. It uses the Gateway password when configured, otherwise `DSH_PLATFORM_PASSWORD`, and falls back to temporary-key mode when both are empty.

### Minimal Bind-Mount Compose

Create transparent, host-visible persistent directories:

```bash
mkdir -p data/dsh data/platform workspace
```

Create `docker-compose.yaml`:

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

Then start the container:

```bash
docker compose up -d
```

If a bind mount is not writable, fix the host directory ownership before retrying:

```bash
sudo chown -R 1000:1000 data workspace
```

### Equivalent Docker Run

The same bind-mount deployment can be started without Compose:

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

Open <http://127.0.0.1:3080>. Remove `--group-add dsh-sudo-true` when DSH and its Agent do not need root.

### Repository Compose

The checked-in [`docker-compose.yaml`](../../docker-compose.yaml) is the configurable production-oriented alternative. It uses named volumes `dsh-data` and `dsh-platform`, bind-mounts the workspace selected by `DSH_WORKSPACE`, and reads the settings documented in [Compose Variables](#compose-variables). Start from the supplied environment template:

```bash
cp .env.example .env
docker compose up -d
```

Named volumes survive ordinary container replacement and `docker compose down`, but they are not visible as normal project directories. Include both complete volumes in Docker-aware backups. `docker compose down -v` deletes them and therefore deletes persistent DSH and platform data.

## Configuration

### Compose Variables

| Variable | Default | Description |
| --- | --- | --- |
| `DSH_IMAGE_TAG` | `latest` | `szcq/deepseek-harness` image tag |
| `DSH_LISTEN_ADDRESS` | `127.0.0.1` | Host address used for port publication |
| `DSH_PORT` | `3080` | Published host port |
| `DSH_WORKSPACE` | `./workspace` | Host directory mounted at `/workspace` |
| `DSH_SUDO_ENABLED` | `true` | Add unrestricted passwordless sudo; `true` or `false` |

These values describe the checked-in `.env.example`. Compose stores DSH and platform data in named volumes and bind-mounts `DSH_WORKSPACE` at `/workspace`.

### Container Variables

| Variable | Default | Description |
| --- | --- | --- |
| `DSH_PLATFORM_DATA` | `/data/platform` | Platform state, managed assets, snapshots, and logs |
| `DSH_HOME` | `/data/dsh` | DSH configuration and data directory |
| `DSH_DEFAULT_WORKSPACE` | `/workspace` | Default directory for directory pickers and standalone file management; must be an accessible absolute directory |
| `DSH_TELEMETRY_DISABLED` | `true` | Disable upstream telemetry; `true` or `false` |
| `DSH_TRUSTED_HOSTS` | Empty | Comma-separated external `host` or `host:port` authorities |
| `DSH_PROXY_USERNAME` | Empty | Optional HTTP Basic username; ignored when the password is empty |
| `DSH_PROXY_PASSWORD` | Empty | Optional gateway password; empty disables authentication |
| `DSH_PLATFORM_PASSWORD` | Empty | DSH Management Console password used when the gateway password is empty; empty selects temporary-key mode |
| `DSH_PROXY_POLYFILL` | `true` | Inject the guarded `crypto.randomUUID` compatibility shim |
| `DSH_LOG_MAX_BYTES` | `104857600` | Aggregate platform JSONL log budget |
| `DSH_LOG_RETENTION_DAYS` | `14` | Platform log retention |
| `DSH_ACTIVATION_TIMEOUT_SECONDS` | `60` | Update activation health deadline |
| `DSH_EXPERIMENTAL_PROBATION_SECONDS` | `120` | Experimental Runtime observation period before commit |

`DSH_TRUSTED_HOSTS` accepts:

- Empty: loopback Hosts only.
- One value: loopback plus that host; a value without a port matches any port.
- Comma-separated values: every listed authority.
- `*`: any Host. Origin, Fetch Metadata, and optional password checks remain enabled.

Values must not contain a scheme, path, credentials, or subdomain wildcard. Valid examples include `dsh.example.com`, `dsh.example.com:8443`, `192.168.1.100`, and `[fd00::1]:3080`.

### Workspace Behavior

`DSH_DEFAULT_WORKSPACE` selects the initial directory for directory pickers and standalone file management. It is not a filesystem sandbox. Standalone file operations run through the root Maintenance Broker, while DSH validates workspace access for its own `node` process when the Environment starts.

The image implements this with an exact-match compiled-output patch. The patch must match exactly once, so an incompatible upstream release fails the build instead of modifying an unintended location.

## Platform Architecture

```text
Docker Image
│
├── System Runtime
├── Image Inventory and Seed
│   ├── Bootstrap Record
│   └── Deployment Record
├── tini
└── Stage-0
      │
      ├── Trust and receipt verification
      ├── Image / Store Reference resolution
      │
      ▼
Bootstrap Runtime (current / previous)
│
├── Control Plane (persistent)
│   ├── Services
│   │   ├── gateway                              0.0.0.0:3080
│   │   └── management + DSH Management Console  Unix socket
│   ├── Managers
│   │   ├── updater
│   │   ├── patch-manager
│   │   ├── plugin-manager
│   │   ├── skill-manager
│   │   ├── log-manager
│   │   └── file-manager
│   └── Recovery hooks
│
└── Container Environment (reloadable)
    ├── Components
    │   └── dsh-runtime                          127.0.0.1:3079
    └── Resources
        ├── Patches
        └── System Plugins

Verified Pristine DSH
          +
Complete Environment
├── Component Manifest
├── Complete Patch Set
└── Complete System Plugin Set
          │
          ▼
Complete Deployment
├── Runtime DSH
├── Environment view
└── System Plugin overlay
          │
          ▼
Atomic current / previous slots
```

Stage-0 owns trust verification, initial seeding, Bootstrap A/B selection, failure rollback, and signal forwarding. Initial immutable versions run directly from the read-only image seed through validated Image References; only online update outputs are materialized in the platform data volume. Bootstrap supervises the persistent Control Plane separately from the reloadable Environment. Replacing, suspending, or restarting DSH therefore does not stop Gateway, Management, or DSH Management Console.

The source tree follows the same boundary:

- `container/platform/`: Stage-0, Bootstrap, shared contracts, and release tools.
- `container/control-plane/services/`: persistent Gateway and Management processes.
- `container/control-plane/hooks/`: supervised one-shot recovery work.
- `container/control-plane/modules/`: updater, logging, patch, System Plugin, and System Skill logic.
- `container/environment/resources/skills/`: Environment-owned System Skill catalogs and instruction trees, mapped into the signed Bootstrap package for trusted runtime management.
- `container/environment/`: the complete Container Environment source, including workloads and `resources/{patches,plugins,skills}`.

### Platform Data and Runtime Resolution

Persistent state and assets are deliberately separate from per-start runtime views:

```text
/data/platform/
├── state/{trust,bootstrap,deployments,updater,management}
├── store/{objects,bootstrap,environments,pristine,runtimes,system-plugins,snapshots}
├── cache/{downloads,npm}
└── logs

/run/dsh-platform/
├── stage0-trust.sock
├── bootstrap.sock
├── dsh-lifecycle.sock
├── management.sock
├── maintenance.sock
├── gateway-access.sock
├── recovery.sock
├── deployments/
├── system-plugin-views/
├── deployment
└── views/{bootstrap,environment,runtime,system-plugins,skills}
```

`state` is authoritative selection, trust, and transaction state. `store` contains immutable Managed assets and rollback material and is reclaimed only when no slot, transaction, Hold, receipt, or snapshot refers to it. `cache` is disposable: `downloads` holds untrusted transfer data and `npm` reuses integrity-checked dependency downloads while constructing future Pristine DSH versions. `/run/dsh-platform` is rebuilt on every container start and must never be backed up or mounted as persistent data. `/data/dsh` remains a separate user-data volume.

Runtime, Environment, and System Plugins form one content-addressed Deployment Record. Bootstrap resolves that complete record into one candidate view, starts it, checks health, and commits the current/previous slots atomically. A partial combination is never selected after restart.

Patches are mandatory Deployment content, not user-selectable resources. Before every DSH start, recovery, reload, or single-service restart, Bootstrap checks each current Environment Patch Artifact's SHA-256 and size and runs the Patch-owned applied-result verifier. A candidate DSH is not started when verification fails.

When the current Deployment assets cannot resolve, Patch verification fails, or DSH fails to start, Bootstrap temporarily selects previous when one exists. It swaps the slots through a resumable journal only after previous passes the same Patch and health checks and its receipts activate. If previous also fails, no slot is committed and the Control Plane enters recovery mode. Unparseable Records and trust conflicts never trigger an automatic downgrade.

The image contains an immutable Bootstrap and Deployment inventory. With no platform state, these assets run directly from the image without copying the Seed tree. A newer signed Stable image becomes the baseline only after health checks. A Managed deployment with a higher target sequence remains current and reports that the image is behind; an older image never downgrades it. Equal sequences must describe identical content, otherwise startup refuses the conflict. An Experimental DSH ahead of Stable is preserved while the platform reconciles the formal Environment according to the update state machine.

Consequently, pulling a newer image still matters: when its signed target sequence is newer than the current Stable deployment, the container advances to that image baseline. When an online update is already newer, the image instead provides a verified fallback without overwriting current state.

This pre-release layout is intentionally not migrated from older `/data/platform` layouts. Stage-0 refuses an old volume with an actionable error. Clear only the platform volume before starting the new image; never delete `/data/dsh` as part of that reset.

For routine backups, preserve `/data/dsh` and `/data/platform/state`. Compose stores them in the `dsh-data` and `dsh-platform` named volumes. To retain exact local rollback points, also preserve `/data/platform/store`, especially snapshots. Backing up both complete volumes is the simplest safe policy. `/data/platform/cache` and `/run/dsh-platform` do not need backup.

## Gateway

The Gateway validates external `Host`, `Origin`, and Fetch Metadata and optionally requires HTTP Basic authentication. It proxies the fixed `/_dsh_platform/console/` and bounded management API routes to Management. Other HTTP, SSE, and WebSocket traffic goes to DSH with loopback `Host` and `Origin` values. Before forwarding to DSH, Gateway also removes external `Forwarded`, every `X-Forwarded-*`, and `X-Real-IP` header. An outer proxy such as OpenResty therefore cannot make same-origin DSH plugins mistake the trusted Gateway hop for an untrusted proxy. Management routes retain those forwarding headers, and the original external request still passes every Gateway security check.

Official DSH classifies the browser from its public hostname and can disable Host-backed settings on non-loopback pages. An exact-match patch marks browsers admitted by this Gateway as loopback, matching the authority sent upstream. No upstream server-side privileged API implementation is patched.

### Remote Deployment Examples

Remote publication requires both an external bind address and an explicit trusted-host allowlist. The example also includes the recommended Gateway password. Replace its values before use:

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
      DSH_PROXY_PASSWORD: "replace-with-a-strong-password"
    volumes:
      - ./data/dsh:/data/dsh
      - ./data/platform:/data/platform
      - ./workspace:/workspace
```

The equivalent command without Compose is:

```bash
docker run -d \
  --name deepseek-harness \
  --restart unless-stopped \
  --group-add dsh-sudo-true \
  -p 3080:3080 \
  -e 'DSH_TRUSTED_HOSTS=192.168.1.100,dsh.example.com' \
  -e 'DSH_PROXY_PASSWORD=replace-with-a-strong-password' \
  -v "$(pwd)/data/platform:/data/platform" \
  -v "$(pwd)/data/dsh:/data/dsh" \
  -v "$(pwd)/workspace:/workspace" \
  szcq/deepseek-harness:latest
```

A reverse proxy must preserve the original `Host` header, and remote deployments must terminate TLS outside this container. Restrict the published address with a host firewall when only selected clients should connect.

`DSH_PROXY_PASSWORD` may be removed from either example. Without it, standalone Management Console access falls back to `DSH_PLATFORM_PASSWORD` or temporary-key mode; this does not remove Host, Origin, or Fetch Metadata validation.

### Password Access

When `DSH_PROXY_PASSWORD` is non-empty, browsers receive an HTTP Basic challenge. If `DSH_PROXY_USERNAME` is empty, Gateway ignores the submitted username and validates only the password. If both are set, both must match. A username cannot contain `:`.

Credentials are not trimmed, logged, or persisted. Gateway removes `Authorization` before forwarding to DSH. Browsers may retain Basic credentials for the session and provide no reliable logout. Use HTTPS remotely because Basic credentials are encoded, not encrypted; TLS termination remains external.

When `DSH_PROXY_PASSWORD` is empty, the standalone console's `/_dsh_platform/console/*` routes, full management API, SSE streams, and terminal WebSocket are protected by a separate platform session. Set `DSH_PLATFORM_PASSWORD` to sign in on the platform login page. Platform Management and the Settings Document Editor inside DSH settings use a separate restricted API and do not require a console session. That API exposes only the DSH integrations' update, DSH restart, log, System Plugin, System Skill, and settings-document operations; it does not expose the container terminal, file manager, or User Plugin recovery. Anyone who can access the DSH page can therefore use those integration operations.

When both passwords are empty, anonymous access remains locked and temporary-key mode is used. Run:

```bash
docker exec deepseek-harness dsh-platform access create
```

The command returns a random temporary key and expiry. It remains usable for 10 minutes; generating another produces a different key and immediately invalidates the prior key. A successful sign-in creates an HttpOnly, SameSite cookie scoped to `/_dsh_platform/`. Sessions expire after 30 minutes idle or eight hours total, and Gateway or container restart clears them. Neither temporary keys nor sessions are written to `/data/platform` or logs.

### Browser Compatibility

Gateway injects a feature-detected `crypto.randomUUID` polyfill into HTML by default. It runs only when needed, uses `crypto.getRandomValues`, and never falls back to `Math.random`. Set `DSH_PROXY_POLYFILL=false` when clients or a future DSH version no longer need it.

Modified HTML uses `Cache-Control: no-cache` and drops invalid upstream validators. Unmodified assets retain upstream caching behavior.

## Online Updates

### Checks and Notifications

`/data` is the container data namespace. Platform state lives in `/data/platform`; DSH settings, sessions, credentials, and third-party plugins live in `/data/dsh`. Keep the two independently mounted volumes.

Automatic checks default to every six hours with jitter and can be disabled or rescheduled from either Management frontend. Checks never download or activate an update. Optional notifications appear only on DSH pages and only after an automatic check; the standalone console never shows an update popup. Opening either Management frontend performs one read-only check in the background, while a manual check refreshes the saved result without notifying. Both frontends open on **Maintenance**: the standalone console then orders Files, Container terminal, System Plugins, System Skills, User Plugins, User Skills, and Updates; Platform Management inside DSH orders System Plugins, System Skills, and Updates. The Management component serves the standalone console at `/_dsh_platform/console/` and follows the saved DSH locale when available.

### DSH Lifecycle and Runtime Maintenance

The standalone console and `dsh-platform start|stop|restart` control only `dsh-runtime`. Bootstrap, Gateway, Management, and the container remain running. An explicit stop lasts until DSH is started again or the container itself restarts. Lifecycle operations are mutually exclusive with update activation, rollback, Runtime reset, and plugin transactions.

The CLI returns a task ID immediately by default. Agents operating through the current DSH session must use asynchronous `dsh-platform restart` and must not use `restart --wait` or `stop --wait`, because stopping DSH also interrupts that tool transport. `--wait` remains appropriate for `docker exec`, the standalone console terminal, and external automation.

Before each Web Profile launch, Bootstrap issues a one-time token and binds the supervised instance through the internal Broker at `/run/dsh-platform/dsh-lifecycle.sock`. A manual command or third-party helper that runs `dsh web` again cannot create a second instance. It submits a formal start task when DSH is stopped; reports the current state and exits while DSH is running, starting, restarting, recovering, or owned by another platform transaction; and directs the user to the standalone console in failed/recovery mode. Tokens and sessions are never written to logs, persistent state, or Deployment Records.

When the supervised DSH receives a first `SIGTERM` that was not registered by the platform, it asks the Broker for disposition and submits a formal asynchronous restart through Management. The browser can therefore show **Restarting DSH**, while any detached replacement created in advance remains unable to bypass the single-instance gate. During an explicit Bootstrap stop, restart, switch, or container shutdown, the Broker instead tells DSH to terminate gracefully so no duplicate task is registered. A second `SIGTERM`, request timeout, or unavailable Control Plane falls back to the original graceful exit and bounded Bootstrap recovery. `process.exit()`, uncaught exceptions, and `SIGKILL` remain unexpected exits and are never presented as normal restarts.

Before a registered operation disconnects DSH, open browser pages move to a localized holding page. The page distinguishes starting, stopping, stopped, restarting, unexpected recovery, Runtime switching/recovery, and startup failure, then returns to the original same-origin path after readiness. Gateway readiness requires both a responsive DSH HTTP upstream and the platform lifecycle to have left every start, restart, recovery, and switch state. It therefore does not return the browser while DSH is listening but Bootstrap is still completing the plugin health check. A brief transport interruption is verified through this combined readiness before navigation. API and WebSocket requests continue receiving `503`; these classified lifecycle responses are not logged as upstream failures or recoveries. Unknown proxy failures remain `502` and retain their failure logs.

If a browser requests a plugin bundle during a registered lifecycle transition, Gateway holds the request until DSH is ready. This applies to every DSH-loaded client bundle, including official DSH plugins, bundled System Plugins, and User Plugins. If the frontend still encounters a transient `502`, `503`, or network failure, or DSH's dynamic importer has already rendered `Failed to load plugins`, the guard confirms the platform lifecycle state and automatically enters the holding page at most once. A second failure in the same lifecycle is not reloaded again; DSH's real plugin-load error remains visible. The platform log records failure, recovery start, recovery completion, and final failure as `browser.plugin-load.failed`, `browser.plugin-load.recovery.started`, `browser.plugin-load.recovery.completed`, and `browser.plugin-load.recovery.failed`, including bounded plugin, revision, lifecycle-task, and reason fields.

If `dsh-runtime` exits without a registered platform operation, Bootstrap retries it at most three times with immediate, 2-second, and 5-second delays. Recovery does not run in parallel with an update, rollback, reset, or probation owner. Three failed attempts enter recovery mode while Gateway and the Management Console remain available.

The image HEALTHCHECK probes the DSH HTTP listener directly at loopback `127.0.0.1:3079`. It represents DSH readiness, not merely Stage-0, Gateway, or Management liveness. An intentional DSH stop therefore makes Docker report the container as unhealthy even though the standalone Management Console remains available.

The standalone console also provides **Reset runtime** for repairing damaged DSH program or patch bytes. It rebuilds the current Runtime from the verified Pristine DSH and the current Environment's complete Patch Set, verifies that the rebuilt content still matches the current Deployment Record, and only then pauses and restarts DSH. It does not change the DSH or Environment version, update channel, rollback slots, settings, sessions, credentials, or third-party plugins under `/data/dsh`. If the rebuilt Runtime cannot start, the prior Runtime directory is restored automatically.

## System Plugins

The Container Environment currently includes:

| Plugin | Purpose |
| --- | --- |
| `@dsh-docker/platform-management` | Adds **Platform Management** to DSH settings for updates, maintenance, logs, System Plugin, and System Skill controls |
| `@dsh-docker/settings-document-editor` | Replaces desktop-only configuration-file opening with an optional browser editor for `settings.yaml` |

The standalone console lists every System Plugin bundled by the current Environment and can install, uninstall, enable, or disable them, including recovery of the `platform-management` DSH integration. The integration inside DSH shows missing plugins with an Install action and limits installed plugins to enable/disable; it cannot uninstall them. Changes are marked **Pending restart** and take effect only after restarting DSH. Refreshing before restart discards the pending draft. Installation rebuilds and verifies the complete System Plugin Set from the current Deployment's local trusted Environment Artifact against the Deployment Record content hash. It never contacts GitHub or npm, never copies files from a built Runtime, and never reinstalls a missing plugin automatically.

The optional Settings Document Editor System Plugin replaces DSH's native **Open configuration file** action in container deployments with a responsive browser editor. It edits only the current `$DSH_HOME/settings.yaml`, saves atomically, and rejects a save when the file changed after the page loaded. It uses the same restricted DSH-side platform boundary as Platform Management and remains usable without first signing in to the standalone console.

## System Skills

The signed Bootstrap includes `dsh-docker-operations`, an English machine-facing operations guide for the official container environment. Its compact `SKILL.md` routes the Agent to focused references covering identity and permissions, workspaces and development tools, DSH and extensions, lifecycle and logs, updates and recovery, networking and authentication, and ordered diagnostics. The guide instructs the Agent to answer in the user's language and to use `dsh`, `dsh-platform`, their current help, and the Management interfaces before inspecting platform implementation details. It explicitly forbids credential discovery, direct socket calls, manual Trust/Store/Runtime-view mutation, and package-manager environment overrides during ordinary operations.

Bootstrap publishes enabled skills from its verified local bundle into `/run/dsh-platform/views/skills`, and DSH discovers that fixed root through `DSH_BUNDLED_SKILL_DIR`. System Skills use `id + SHA-256` identity and have no independent release version. Their selection is stored at `/data/platform/state/deployments/skills.json`; uninstalling removes only the active selection, so the signed Bootstrap copy remains available for offline reinstallation. No management action accepts a URL, path, uploaded body, or client-supplied hash.

The standalone console lists every System Skill supplied by the current Bootstrap and supports install, uninstall, enable, and disable. Platform Management inside DSH can install a missing skill and enable or disable an installed one, but cannot uninstall it. All changes atomically update the stable skill view and are picked up by DSH's native filesystem watcher without restarting DSH. The same state survives container restarts, newly signed skills default to installed and enabled, and skills removed by a newer Bootstrap are pruned. Project and user skills retain DSH's native precedence over bundled skills; disabling a System Skill does not alter either override.

`dsh-docker-operations` is model-discoverable and can also be invoked explicitly as `/dsh-docker-operations`. It applies to operating the installed environment, not to developing dsh-docker itself. Only an explicit platform-development or implementation-debugging request permits inspection of `/opt/dsh-platform` and `/run/dsh-platform` internals.

## Standalone Recovery Tools

### User Skill Management

The standalone console's **User Skills** tab inventories native directory and flat-file skills from `$DSH_HOME/skills` and `$DSH_AGENTS_HOME/skills`. It does not scan or modify project-level skills. Each entry shows its source, native entry name, parsed Skill name and description, enabled state, and any metadata error; malformed entries remain visible so they can still be disabled or deleted.

Disabling atomically moves the exact entry into that user root's hidden disabled directory while preserving its contents. Enabling restores it to the same root, and Delete permanently removes only the selected entry. Symbolic links are handled as links and deletion never follows their targets. Every action carries the current inventory revision, conflicts with other managed mutations, and is audited as started, completed, or failed. DSH's native filesystem watcher applies enable and disable changes immediately without restarting DSH. The Platform Management integration inside DSH deliberately does not expose User Skill controls.

### User Plugin Recovery

The **User Plugins** and **Container terminal** tabs in `/_dsh_platform/console/` are provided by Management, not DSH. They remain available when `dsh-runtime` is stopped or fails during plugin startup. The Platform Management integration inside DSH deliberately does not expose these two recovery tabs.

User Plugin recovery manages only Bundle plugins declared by `$DSH_HOME/profiles/web/package.json`: a package must be both a dependency and an ordered member of `dsh.profile.bundles`. Ordinary dependencies and hand-written entries in `cordis.patch.yml` are never rewritten. Damaged installed metadata remains visible and uninstallable. Names reserved by the verified Environment System Plugin manifest cannot be enabled as User Plugins, regardless of package scope or prefix.

Enable, disable, and uninstall changes are accumulated as a page-local draft. Applying them pauses DSH idempotently, snapshots the complete Web Profile, performs the exact actions, validates the resulting Profile, and restarts only DSH. Refreshing or leaving before Apply discards the draft. A revision conflict returns the latest inventory instead of overwriting concurrent changes. Pre-commit interruption restores the snapshot; after commit, a plugin change is retained even if DSH still fails, so multiple faulty plugins can be removed over consecutive attempts. Installation is intentionally not offered here; use DSH's normal plugin flow or the standalone terminal.

Older DSH releases and third-party plugin tools may remove a package without removing its now-unresolvable entry from `dsh.profile.bundles`. Before an authorized Web Profile launch, the managed Runtime removes only entries which are no longer dependencies and cannot be resolved from either the Profile or the DSH installation. Built-in bundles, declared dependencies, and still-resolvable local bundles are preserved. The repair is atomic and is recorded in the DSH Runtime log; users should restart with the current image instead of editing the Profile manifest by hand.

The managed Runtime also pins the Web Profile pnpm store to `$DSH_HOME/.pnpm-store`. When an existing Profile still points at a store from an older image, such as `/workspace/.pnpm-store` or a previous user home, startup copies reusable store content and asks the image's pinned pnpm to rebuild links from the lockfile. The original workspace configuration and `node_modules` are restored if migration fails or is interrupted. Public `dsh` commands invoked from a Root container shell are automatically run as the `node` identity so plugin files do not become Root-owned; `dsh-platform` and the Management Console terminal remain Root maintenance tools. Do not delete `/data/dsh`, edit `.modules.yaml`, or chmod Root package directories to work around a store mismatch.

### Container Terminal

The Container terminal tab uses a constrained Maintenance Broker inside Stage-0 to start a real interactive `/bin/bash` as root. Its initial directory comes from `DSH_DEFAULT_WORKSPACE`, and it receives `DSH_HOME`, PATH, and proxy variables. `DSH_SUDO_ENABLED` controls only DSH/Agent sudo access; it does not reduce this terminal's administrator privileges. Restarting only DSH does not terminate the terminal. A browser refresh or brief disconnect can reattach for 30 seconds and redraw up to 256 KiB of recent output; explicitly closing the session, stopping Stage-0, or stopping the container terminates it. Platform logs record session lifecycle only, never terminal input, output, command history, or the complete environment.

### File Management

The standalone DSH Management Console **Files** tab also remains available while DSH is stopped, fails to start, or is in recovery mode. The Platform Management plugin inside DSH deliberately does not expose this tab. Its initial directory comes from `DSH_DEFAULT_WORKSPACE`; shortcuts use `DSH_DEFAULT_WORKSPACE`, `DSH_HOME`, `DSH_PLATFORM_DATA`, and `/`, with duplicates removed. File operations run through the Maintenance Broker as root. They can repair files that the ordinary Management/DSH identity cannot write, while still respecting read-only mounts and the platform-managed-path mutation lease. Host bind mounts backed by Windows, SMB, or another filesystem without Unix metadata may silently ignore `chown` and `chmod`; the platform verifies the result and reports failure, so use a Linux/WSL path or named volume with Unix metadata support when ownership and mode changes are required.

Directory inventory supports hidden files, sorting, local filtering, owner/group display, and bounded recursive search. It uses a fixed scrolling viewport and server-backed pages of 50, 100 (default), or 200 items; default name sorting resolves detailed metadata only for the requested page. Directory size is calculated only when requested, as a cancellable read-only task that does not follow symbolic links. The expanded permissions editor changes a file or directory user, group, and octal mode; directory changes can be applied recursively without following symbolic links. Symbolic links are listed, copied, and deleted as links and are not followed recursively. Regular UTF-8 text up to 2 MiB can be edited in the line-number editor. Saves include a revision and return a conflict instead of overwriting changes made by a terminal, Agent, or another page.

Files or complete browser-selected folders can be uploaded while retaining their relative layout, and files can be dropped onto the directory listing to upload them into the current directory. Files stream directly to downloads; directories are temporarily packaged as ZIP and the temporary archive is removed after completion, failure, or cancellation. Selected files and directories can also create and extract ZIP, 7z, and tar.gz archives. Upload, download, paste, archive, extraction, and permanent deletion share one visible FIFO queue. Only one conflicting job runs at a time; queued and running jobs can be cancelled before their safe commit boundary. Measurable transfer phases show actual bytes, while archive phases without reliable tool telemetry remain explicitly indeterminate instead of inventing a percentage. Refreshing or closing the page aborts browser-owned upload/download streams and drops uploads that have not started; staging data is cleaned. Persistent background tasks are rediscovered after reconnecting.

Copy, move, archive, extraction, and permanent deletion run as persistent background tasks. Move and delete write durable commit boundaries so Management can safely finish them after a restart; an uncommitted operation that cannot be proven idempotent is marked interrupted and retains its source. There is no trash. `/`, `/data`, `/data/dsh`, `/data/platform`, `/workspace`, and the active Deployment view root cannot themselves be selected for recursive deletion. Platform-managed paths remain accessible but are clearly marked because updates, restarts, runtime rebuilds, or GC can replace changes and manual edits can damage the active Deployment. Audit logs record paths, operation type, byte counts, duration, and outcome, never file contents.

Both tools use the existing Gateway Host, Origin, Fetch Metadata, Basic Auth, or standalone Management Console session checks and add no listener. This is a container-root management boundary: anyone admitted to the page can read or modify container data and execute arbitrary shell commands. Expose it only behind the trusted boundary described in [Security Model](#security-model).

## Logs

New Platform and DSH log entries are also emitted as source-tagged JSON to container stdout or stderr, so `docker logs deepseek-harness` shows the complete live operational stream. Both Management interfaces support text, Source, and level filters; processed-entry limits of 100, 250, 500, or 1000; manual refresh; optional automatic scrolling; and JSONL export. Each row starts with a compact summary and expands to the complete structured record, including error stacks, causes, task IDs, and diagnostic fields. **Clear view** affects only the current browser view and does not delete stored logs. Historical entries are not replayed to stdout at startup. Source-separated JSONL under `/data/platform/logs` remains the authoritative store and rotates according to `DSH_LOG_MAX_BYTES` and `DSH_LOG_RETENTION_DAYS` (100 MiB and 14 days by default).

## Update Channels and Rollback

```bash
docker exec deepseek-harness dsh-platform status
docker exec deepseek-harness dsh-platform check
docker exec deepseek-harness dsh-platform update --wait
docker exec deepseek-harness dsh-platform stop --wait
docker exec deepseek-harness dsh-platform start --wait
docker exec deepseek-harness dsh-platform restart --wait
docker exec deepseek-harness dsh-platform channel experimental
docker exec deepseek-harness dsh-platform retry
docker exec deepseek-harness dsh-platform logs --source updater
docker exec deepseek-harness dsh-platform rollback
docker exec -it deepseek-harness dsh-platform return-stable
```

An Agent running inside the current DSH session must start activation asynchronously with `dsh-platform update` and report the returned task ID. `update --wait` is reserved for `docker exec`, the standalone console terminal, and external automation because activation may switch DSH and interrupt the current tool transport.

Changing channels modifies only local desired state. Stable converges to the signed supported DSH and Environment. Experimental first converges the official Environment, then offers the newest verified upstream DSH. When current DSH is ahead of Latest Supported, the complete combination is frozen until Stable catches up.

Candidate build failures create a version Hold; incompatible Runtime/Environment combinations create a combination Hold. `retry` clears the one active Hold or Blocked combination.

Before an Experimental Runtime touches real data, Updater stops `dsh-runtime` and creates a verified tar snapshot of `/data/dsh`. It then switches Runtime, checks health, and observes the candidate during probation. Failure or interruption restores Runtime, Environment, System Plugins, receipts, and the snapshot before DSH restarts.

`rollback` restores the retained previous complete state. Interactive `return-stable` is available only with a verified pre-Experimental recovery point and may discard data written after the displayed snapshot time.

## Trust and Recovery

Stage-0 embeds one offline Recovery Root public key. It reads the public machine channel from the append-only `release-channel` branch, first verifies a monotonically increasing Recovery-signed keyring, then accepts `stable.json` only from the keyring's current Release Key. Immutable target files live under `targets/<targetSequence>/`; the branch root exposes the current signed keyring and Stable pointer. Bootstrap and Environment Artifacts downloaded by Updater stay in `/data/platform/cache/downloads` until Stage-0 matches them to signed descriptors and imports them into `/data/platform/store/objects`. Every path later used by the Runtime builder comes from the resulting receipt, never from the untrusted download.

Bootstrap and Updater cannot add a root key, modify keyrings, submit arbitrary expected hashes, or mint receipts. They consume only Stage-0 verification results.

Stable metadata delegates the exact official npm Registry origin, `@deepseek-ai/dsh` package identity, and accepted Registry signing keys. Updater may inspect npm `latest` to choose an Experimental version, but both Stable and Experimental submit only that selected version to `POST /v1/dsh/ensure`. Stage-0 independently fetches the exact version metadata with redirects disabled, verifies the Registry signature over `name@version:integrity`, derives the canonical tarball URL, downloads with a bounded identity-encoded response, recalculates SHA-512, and issues an `official-dsh` receipt backed by the trusted object store. Updater cannot submit a package, Registry, URL, integrity, expected hash, candidate document, or tarball path through this operation.

The official DSH ledger is monotonic: same-version repair is allowed only for identical signed content, lower-version import is rejected, and rollback restores the retained previous Runtime/Environment/receipt/snapshot state without downloading an older package. A Release-key or Registry-policy change invalidates staged receipts but does not destroy already active or previous states.

`dsh` is a dynamic shim which always executes the current verified Runtime. `dsh-platform trust status` reports accepted trust state. `dsh-platform trust reset` is console-only: stop Stage-0, mount the platform-data Volume into a one-shot container with `dsh-platform` as its entrypoint, run `trust reset` from an interactive TTY, and enter the exact confirmation. This clears accepted state but does not replace the image Recovery Root.

If both current and previous Deployments are unusable, the Control Plane remains available in recovery mode. Restore the exact Deployment shipped by the currently running image from a root, interactive container console:

```bash
docker exec -it --user root deepseek-harness dsh-platform recover --image-baseline
```

The command displays the failed current state, image baseline, and data-compatibility warning, then requires the complete image build ID as confirmation. It is unavailable through Gateway and the Web API. Recovery health-checks the image Deployment before committing it and does not delete `/data/dsh`; operators must still judge whether existing DSH data is compatible with the older or newer image baseline.

For routine Release Key rotation or compromise, use the offline Recovery private key to sign generation+1: promote the old next key to current, revoke the old current key, and add a new next key. Revocations are cumulative. Only Recovery Root compromise or cryptographic migration requires a new image or explicit trust reset.

Recovery private material must never enter GitHub secrets. CI receives only a signed public keyring bundle and the protected current Release private key.

## Security Model

Gateway access is full DSH access. After standalone Management Console authentication, the Container terminal and Files tools additionally have root authority. An admitted user may read or replace model credentials, execute commands, and access any writable path in the container. The Host allowlist mitigates DNS rebinding; it is not user authentication.

Before exposing the service to untrusted networks, use a strong Gateway password, authenticated reverse proxy, VPN, or another trusted boundary. An SSH tunnel can be combined with loopback-only publication:

```bash
ssh -L 3080:127.0.0.1:3080 user@server
```

Compose enables unrestricted passwordless root access for the agent by default. Set `DSH_SUDO_ENABLED=false` to disable it. Do not combine sudo with privileged mode, the Docker socket, or sensitive host mounts unless that authority is intentional.

## Release Automation

`DSH Upstream Update` runs every six hours on the hour and on demand. It compares npm `latest` with [`release/supported-target.json`](../../release/supported-target.json), keeps the current Environment, and creates or updates a candidate PR based on and targeting `dev`. It sends one notification after discovering a new upstream version and creating its candidate PR, then one final notification when full compatibility validation passes or fails. Candidate CI verifies npm integrity, applies the current Environment, runs both project suites, and executes standard and devtools container smoke tests. These jobs have no Release or Recovery credentials; candidates merge into `dev`, and only a later promotion from `dev` to `main` enters the production publication flow. The automated candidate branch is validated only by the reusable job inside `DSH Upstream Update`, while other PRs run the standalone validation automatically. A maintainer can also run `DSH Candidate Validation` manually against an already merged branch, tag, or commit before publication. Standalone PR and manual results notify through a `workflow_run` that neither checks out nor executes candidate code, keeping Secrets out of candidate execution. No notification is sent when no newer version exists.

`Publish Supported Platform Target` runs when the Supported Target, Environment definition, or official DSH Registry policy changes on `main`, and also supports approved manual dispatch. Configure a protected `production-release` GitHub Environment restricted to `main` with:

- `DSH_RECOVERY_ROOT_PUBLIC_KEY`
- `DSH_KEYRING_JSON_BASE64`
- `DSH_KEYRING_SIGNATURE_BASE64`
- `DSH_RELEASE_PRIVATE_KEY`

The workflow starts the first formal `targetSequence` at 1 and appends each later signed target to the `release-channel` branch. It validates the selected npm tarball and binds its npm integrity into Stable metadata, but does not republish a duplicate DSH tarball; Stage-0 imports the official npm copy. A retry of the same source commit and keyring reuses the already-published target instead of consuming another sequence. The Recovery private key has no workflow input.

GitHub Releases describe only the Container Environment. A new Environment publishes `v<environment-version>` (for example `v1.0.0`) and marks it Latest. A DSH-only update advances the signed channel and rebuilds images without creating a GitHub Release. Changes to packaged Environment or Bootstrap content, or to [`release/official-dsh-policy.json`](../../release/official-dsh-policy.json), require an Environment version increase; the Environment fingerprint check rejects reuse of an existing version for different content.

Each Environment Release uploads only one custom asset, `environment-release.json`, to prevent one version from being rebound to different Environment content. Online updates fetch manifests and artifacts from the immutable `release-channel` and have Stage-0 verify each item; they do not depend on GitHub Release assets at all. With GitHub's two automatically generated source archives, the Release page normally shows three assets.

`Publish Container Images` runs as a separate Actions run after `Publish Supported Platform Target` completes successfully. It is protected by the separate `production-image` Environment, so the Release workflow itself never accesses the image environment. Put `DSH_RECOVERY_ROOT_PUBLIC_KEY` in that Environment and `DOCKER_TOKEN` in repository or organization Actions Secrets. The image job has no Release private key; it resolves the exact matching immutable channel commit from the append-only `release-channel` history using the upstream run's source commit. Grant the workflow `packages: write`; it logs in to GHCR with `GITHUB_TOKEN`.

The Standard multi-architecture image is built once and pushed to both registries. Docker Hub receives `<dsh-version>` and `latest`; its separately tested Devtools image receives `<dsh-version>-devtools` and `latest-devtools`. GHCR receives only the Standard image under `latest`, full/minor/major Environment tags, and `dsh-<dsh-version>`. A DSH-only update moves the current Environment tags without publishing a GitHub Release. An Environment-only update intentionally replaces the existing Docker Hub DSH tags with a new image digest and publishes the new Environment hierarchy on GHCR.

Repository or organization Secrets `GOTIFY_URL` and `GOTIFY_TOKEN` are passed explicitly to the reusable Gotify workflow. One result-notification workflow handles only final success or failure for formal target publication and manual candidate PR validation; each event can match exactly one notification job. After the signed target and any required Environment Release are published, it reports that image publication has started and may be waiting for `production-image` approval; notification service availability cannot affect the formal publication result or block the image trigger. The image workflow also sends exactly one final result: success after both image variants are published and verified, or a failure notification with the Actions run link if any step fails.

## Build and Test

Build the standard image:

```bash
docker build -t deepseek-harness:local .
```

Build a specific official package for local development, or build the devtools variant:

```bash
DSH_VERSION="$(jq -r .latestSupportedDsh release/supported-target.json)"
docker build --build-arg "DSH_VERSION=$DSH_VERSION" -t "deepseek-harness:$DSH_VERSION" .
docker build --build-arg INSTALL_DEVTOOLS=true -t deepseek-harness:local-devtools .
```

An arbitrary local `DSH_VERSION` produces a development-authority inventory with target sequence 0. It cannot become a formal tag or `latest`. Production workflows build only the reviewed Supported Target from a verified signed channel target, reject the marked non-production trust fixture, and require an offline Recovery-signed public trust bundle.

Run local checks with Node.js 24 and Docker Compose:

```bash
npm ci --omit=dev --ignore-scripts --prefix container/control-plane/services/management
npm test --prefix container/control-plane/services/gateway
npm test --prefix container/platform
node container/test/compose-config.mjs
```

With Docker available, `container/test/container-smoke.sh [image]` checks managed processes, trust, password flow, persistent Console access, and the loopback-only DSH listener. `container/test/devtools-smoke.sh <image>` checks the devtools variant.

The standard image includes Node.js 24, `pnpm`, Python 3 with `venv`, Git, OpenSSH, curl, jq, ripgrep, optional sudo, and the minimal `make`/C++ toolchain needed to build native DSH plugin dependencies. Devtools additionally includes broader development headers and tools, Bash completion, network diagnostics, archive and file utilities, Vim, `pkg-config`, and pinned uv.

Devtools uses uv instead of a shared pre-created Python environment. Use `uv run --with requests script.py`, or `uv sync` and `uv run` in projects. Bare `pip` and `pip3` commands are intentionally absent; `python3 -m venv` remains available. Additional Python versions require an explicit `uv python install <version>`.
