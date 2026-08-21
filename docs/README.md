# DSH-Docker Complete Guide

English | [中文](README_CN.md) | [Quick start](../README.md)

This guide documents configuration, platform behavior, online updates, trust, release automation, and development workflows. For ordinary deployment, start with the root [README](../README.md).

## Configuration

### Compose Variables

| Variable | Default | Description |
| --- | --- | --- |
| `DSH_IMAGE_TAG` | `latest` | Image tag |
| `DSH_LISTEN_ADDRESS` | `127.0.0.1` | Host address used for port publication |
| `DSH_PORT` | `3080` | Published host port |
| `DSH_WORKSPACE` | `./workspace` | Host directory mounted at `/workspace` |
| `DSH_SUDO_ENABLED` | `true` | Add unrestricted passwordless sudo; `true` or `false` |

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

`DSH_DEFAULT_WORKSPACE` selects the initial directory for directory pickers and standalone file management. It is not a filesystem sandbox: users can access other paths available to the container's `node` user. DSH validates access while its Environment component starts.

The image implements this with an exact-match compiled-output patch. The patch must match exactly once, so an incompatible upstream release fails the build instead of modifying an unintended location.

## Platform Architecture

```text
tini
  └─ Stage-0
       └─ Bootstrap
            ├─ Control Plane
            │    ├─ management + DSH Management Console  Unix socket
            │    └─ gateway                      0.0.0.0:3080
            └─ Environment
                 └─ dsh-runtime                  127.0.0.1:3079
```

Stage-0 owns trust verification, initial seeding, Bootstrap A/B selection, failure rollback, and signal forwarding. Initial immutable versions run directly from the read-only image seed through validated Image References; only online update outputs are materialized in the platform data volume. Bootstrap supervises the persistent Control Plane separately from the reloadable Environment. Replacing, suspending, or restarting DSH therefore does not stop Gateway, Management, or DSH Management Console.

The source tree follows the same boundary:

- `container/platform/`: Stage-0, Bootstrap, shared contracts, and release tools.
- `container/control-plane/services/`: persistent Gateway and Management processes.
- `container/control-plane/hooks/`: supervised one-shot recovery work.
- `container/control-plane/modules/`: updater, logging, patch, and System Plugin logic.
- `container/environment/`: the complete Container Environment source, including workloads and `resources/{patches,system-plugins}`.

### Platform Data and Runtime Resolution

Persistent state and assets are deliberately separate from per-start runtime views:

```text
/data/platform/
├── state/{trust,bootstrap,deployments,updater,management}
├── store/{objects,bootstrap,environments,pristine,runtimes,system-plugins,snapshots}
├── cache/downloads
└── logs

/run/dsh-platform/
├── stage0-trust.sock
├── bootstrap.sock
├── management.sock
├── recovery.sock
├── deployments/
└── views/{bootstrap,environment,runtime,system-plugins}
```

`state` is authoritative selection, trust, and transaction state. `store` contains immutable Managed assets and rollback material and is reclaimed only when no slot, transaction, Hold, receipt, or snapshot refers to it. `cache` is disposable. `/run/dsh-platform` is rebuilt on every container start and must never be backed up or mounted as persistent data. `/data/dsh` remains a separate user-data volume.

Runtime, Environment, and System Plugins form one content-addressed Deployment Record. Bootstrap resolves that complete record into one candidate view, starts it, checks health, and commits the current/previous slots atomically. A partial combination is never selected after restart.

Patches are mandatory Deployment content, not user-selectable resources. Before every DSH start, recovery, reload, or single-service restart, Bootstrap checks each current Environment Patch Artifact's SHA-256 and size and runs the Patch-owned applied-result verifier. A candidate DSH is not started when verification fails.

When the current Deployment assets cannot resolve, Patch verification fails, or DSH fails to start, Bootstrap temporarily selects previous when one exists. It swaps the slots through a resumable journal only after previous passes the same Patch and health checks and its receipts activate. If previous also fails, no slot is committed and the Control Plane enters recovery mode. Unparseable Records and trust conflicts never trigger an automatic downgrade.

The image contains an immutable Bootstrap and Deployment inventory. With no platform state, these assets run directly from the image without copying the Seed tree. A newer signed Stable image becomes the baseline only after health checks. A Managed deployment with a higher target sequence remains current and reports that the image is behind; an older image never downgrades it. Equal sequences must describe identical content, otherwise startup refuses the conflict. An Experimental DSH ahead of Stable is preserved while the platform reconciles the formal Environment according to the update state machine.

Consequently, pulling a newer image still matters: when its signed target sequence is newer than the current Stable deployment, the container advances to that image baseline. When an online update is already newer, the image instead provides a verified fallback without overwriting current state.

This pre-release layout is intentionally not migrated from older `/data/platform` layouts. Stage-0 refuses an old volume with an actionable error. Clear only the platform volume before starting the new image; never delete `/data/dsh` as part of that reset.

For routine backups, preserve `/data/dsh` and `/data/platform/state`. To retain exact local rollback points, also preserve `/data/platform/store`, especially snapshots. Backing up both complete volumes is the simplest safe policy. `/data/platform/cache` and `/run/dsh-platform` do not need backup.

## Gateway

The Gateway validates external `Host`, `Origin`, and Fetch Metadata and optionally requires HTTP Basic authentication. It proxies the fixed `/_dsh_platform/ui/` and bounded management API routes to Management. Other HTTP, SSE, and WebSocket traffic goes to DSH with loopback `Host` and `Origin` values.

Official DSH classifies the browser from its public hostname and can disable Host-backed settings on non-loopback pages. An exact-match patch marks browsers admitted by this Gateway as loopback, matching the authority sent upstream. No upstream server-side privileged API implementation is patched.

### Password Access

When `DSH_PROXY_PASSWORD` is non-empty, browsers receive an HTTP Basic challenge. If `DSH_PROXY_USERNAME` is empty, Gateway ignores the submitted username and validates only the password. If both are set, both must match. A username cannot contain `:`.

Credentials are not trimmed, logged, or persisted. Gateway removes `Authorization` before forwarding to DSH. Browsers may retain Basic credentials for the session and provide no reliable logout. Use HTTPS remotely because Basic credentials are encoded, not encrypted; TLS termination remains external.

When `DSH_PROXY_PASSWORD` is empty, every external `/_dsh_platform/ui/*` route, management API, SSE stream, and terminal WebSocket is protected by a separate platform session. Set `DSH_PLATFORM_PASSWORD` to sign in on the platform login page. The DSH settings integration and standalone console share this session.

When both passwords are empty, anonymous access remains locked and temporary-key mode is used. Run:

```bash
docker exec dsh-test dsh-platform access create
```

The command returns a random temporary key and expiry. It remains usable for 10 minutes; generating another produces a different key and immediately invalidates the prior key. A successful sign-in creates an HttpOnly, SameSite cookie scoped to `/_dsh_platform/`. Sessions expire after 30 minutes idle or eight hours total, and Gateway or container restart clears them. Neither temporary keys nor sessions are written to `/data/platform` or logs.

### Browser Compatibility

Gateway injects a feature-detected `crypto.randomUUID` polyfill into HTML by default. It runs only when needed, uses `crypto.getRandomValues`, and never falls back to `Math.random`. Set `DSH_PROXY_POLYFILL=false` when clients or a future DSH version no longer need it.

Modified HTML uses `Cache-Control: no-cache` and drops invalid upstream validators. Unmodified assets retain upstream caching behavior.

## Online Updates

`/data` is the container data namespace. Platform state lives in `/data/platform`; DSH settings, sessions, credentials, and third-party plugins live in `/data/dsh`. Keep the two independently mounted volumes.

Automatic checks default to every six hours with jitter and can be disabled or rescheduled from either DSH Management Console frontend. Checks never download or activate an update. Optional web notifications are produced only by automatic checks; page-open and manual checks update the displayed result without showing a notification. The Management component serves the standalone console at `/_dsh_platform/ui/`; it follows the saved DSH locale when available, exposes the same update, maintenance, log, and System Plugin workflows, and renders notifications only inside its own page.

The Runtime maintenance action and `dsh-platform restart` restart only `dsh-runtime`. Bootstrap, Gateway, Management, and the container remain running, so an already loaded DSH Management Console view continues reporting progress and reloads after DSH passes its health check. Restart is mutually exclusive with update activation and complete rollback. The CLI returns the task immediately by default; `--wait` follows only that task to completion.

The standalone console also provides **Reset runtime** for repairing damaged DSH program or patch bytes. It rebuilds the current Runtime from the verified Pristine DSH and the current Environment's complete Patch Set, verifies that the rebuilt content still matches the current Deployment Record, and only then pauses and restarts DSH. It does not change the DSH or Environment version, update channel, rollback slots, settings, sessions, credentials, or third-party plugins under `/data/dsh`. If the rebuilt Runtime cannot start, the prior Runtime directory is restored automatically.

The standalone console also lists System Plugins bundled by the current Environment. A user can reinstall one from the current Deployment's local trusted Environment Artifact, including the `platform-management` DSH integration if it was disabled or uninstalled. The platform rebuilds and verifies the complete System Plugin Set against the Deployment Record content hash, then restarts only DSH. This operation never contacts GitHub or npm and never copies files from a built Runtime. A missing plugin does not trigger automatic reinstallation.

### Standalone Recovery Tools

The **User Plugins** and **Container terminal** tabs in `/_dsh_platform/ui/` are provided by Management, not DSH. They remain available when `dsh-runtime` is stopped or fails during plugin startup. The Platform Management integration inside DSH deliberately does not expose these two recovery tabs.

User Plugin recovery manages only Bundle plugins declared by `/data/dsh/profiles/web/package.json`: a package must be both a dependency and an ordered member of `dsh.profile.bundles`. Ordinary dependencies and hand-written entries in `cordis.patch.yml` are never rewritten. Damaged installed metadata remains visible and uninstallable. Names reserved by the verified Environment System Plugin manifest cannot be enabled as User Plugins, regardless of package scope or prefix.

Enable, disable, and uninstall changes are accumulated as a page-local draft. Applying them pauses DSH idempotently, snapshots the complete Web Profile, performs the exact actions, validates the resulting Profile, and restarts only DSH. Refreshing or leaving before Apply discards the draft. A revision conflict returns the latest inventory instead of overwriting concurrent changes. Pre-commit interruption restores the snapshot; after commit, a plugin change is retained even if DSH still fails, so multiple faulty plugins can be removed over consecutive attempts. Installation is intentionally not offered here; use DSH's normal plugin flow or the standalone terminal.

The Container terminal tab starts a real interactive `/bin/bash` in `/workspace` with the same UID, GID, supplementary groups, `DSH_HOME=/data/dsh`, PATH, proxy variables, and sudo policy as DSH. Restarting only DSH does not terminate the terminal. A browser refresh or brief disconnect can reattach for 30 seconds and redraw up to 256 KiB of recent output; explicitly closing the session, stopping Management, or stopping the container terminates it. Platform logs record session lifecycle only, never terminal input, output, command history, or the complete environment.

The standalone DSH Management Console **Files** tab is also served by Management, so it remains available while DSH is stopped, fails to start, or is in recovery mode. The Platform Management plugin inside DSH deliberately does not expose this tab. Its initial directory comes from `DSH_DEFAULT_WORKSPACE`; shortcuts use `DSH_DEFAULT_WORKSPACE`, `DSH_HOME`, `DSH_PLATFORM_DATA`, and `/`, with duplicates removed. Operations run as the Management/DSH container identity and retain the existing UID, GID, supplementary groups, read-only mounts, and filesystem permissions. They never invoke `sudo`; use the standalone terminal for privilege elevation, chmod/chown, archives, and other advanced work.

Directory inventory supports hidden files, sorting, pagination, local filtering, owner/group display, and bounded recursive search. Directory size is calculated only when requested, as a cancellable read-only task that does not follow symbolic links. Symbolic links are listed, copied, and deleted as links and are not followed recursively. Regular UTF-8 text up to 2 MiB can be edited in the line-number editor. Saves include a revision and return a conflict instead of overwriting changes made by a terminal, Agent, or another page. Uploads and downloads are streamed, downloads support HTTP Range, and multi-file uploads are queued one file at a time in the current browser tab. Files that have not started uploading do not continue after the page closes.

Copy, move, and permanent deletion run as persistent background tasks. Move and delete write durable commit boundaries so Management can safely finish them after a restart; an uncommitted operation that cannot be proven idempotent is marked interrupted and retains its source. There is no trash. `/`, `/data`, `/data/dsh`, `/data/platform`, `/workspace`, and the active Deployment view root cannot themselves be selected for recursive deletion. Platform-managed paths remain accessible but are clearly marked because updates, restarts, runtime rebuilds, or GC can replace changes and manual edits can damage the active Deployment. Audit logs record paths, operation type, byte counts, duration, and outcome, never file contents.

Both tools use the existing Gateway Host, Origin, Fetch Metadata, and optional Basic Auth checks. They do not add another password or listener. Consequently, anyone admitted to this page has the same command and data authority already granted to DSH; expose it only behind the trusted boundary described in [Security Model](#security-model).

The optional Settings Document Editor System Plugin replaces DSH's native **Open configuration file** action in container deployments with a responsive browser editor. It edits only the current `/data/dsh/settings.yaml`, saves atomically, and rejects a save when the file changed after the page loaded.

New Platform and DSH log entries are also emitted as source-tagged JSON to container stdout or stderr, so `docker logs deepseek-harness` shows the complete live operational stream. Both Management interfaces show a compact summary for each entry; selecting it expands the complete structured record, including error stacks, causes, task IDs, and diagnostic fields. Historical entries are not replayed at startup. Source-separated JSONL under `/data/platform/logs` remains the authoritative, queryable, and rotated log store.

```bash
docker exec deepseek-harness dsh-platform status
docker exec deepseek-harness dsh-platform check
docker exec deepseek-harness dsh-platform update --wait
docker exec deepseek-harness dsh-platform restart --wait
docker exec deepseek-harness dsh-platform channel experimental
docker exec deepseek-harness dsh-platform retry
docker exec deepseek-harness dsh-platform logs --source updater
docker exec deepseek-harness dsh-platform rollback
docker exec -it deepseek-harness dsh-platform return-stable
```

Changing channels modifies only local desired state. Stable converges to the signed supported DSH and Environment. Experimental first converges the official Environment, then offers the newest verified upstream DSH. When current DSH is ahead of Latest Supported, the complete combination is frozen until Stable catches up.

Candidate build failures create a version Hold; incompatible Runtime/Environment combinations create a combination Hold. `retry` clears the one active Hold or Blocked combination.

Before an Experimental Runtime touches real data, Updater stops `dsh-runtime` and creates a verified tar snapshot of `/data/dsh`. It then switches Runtime, checks health, and observes the candidate during probation. Failure or interruption restores Runtime, Environment, System Plugins, receipts, and the snapshot before DSH restarts.

`rollback` restores the retained previous complete state. Interactive `return-stable` is available only with a verified pre-Experimental recovery point and may discard data written after the displayed snapshot time.

## Trust and Recovery

Stage-0 embeds one offline Recovery Root public key. It first verifies a monotonically increasing Recovery-signed keyring, then accepts `stable.json` only from the keyring's current Release Key. Bootstrap and Environment Artifacts downloaded by Updater stay in `/data/platform/cache/downloads` until Stage-0 matches them to signed descriptors and imports them into `/data/platform/store/objects`. Every path later used by the Runtime builder comes from the resulting receipt, never from the untrusted download.

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

Gateway access is full DSH access. An admitted user may read or replace model credentials, execute commands through DSH or the standalone terminal, and access every path available to the container's `node` user, not only `/workspace`. The Host allowlist mitigates DNS rebinding; it is not user authentication.

Before exposing the service to untrusted networks, use a strong Gateway password, authenticated reverse proxy, VPN, or another trusted boundary. An SSH tunnel can be combined with loopback-only publication:

```bash
ssh -L 3080:127.0.0.1:3080 user@server
```

Compose enables unrestricted passwordless root access for the agent by default. Set `DSH_SUDO_ENABLED=false` to disable it. Do not combine sudo with privileged mode, the Docker socket, or sensitive host mounts unless that authority is intentional.

## Release Automation

`DSH Upstream Update` runs daily and on demand. It compares npm `latest` with [`release/supported-target.json`](../release/supported-target.json), keeps the current Environment, and creates or updates a candidate PR for promotion to Latest Supported. Candidate CI verifies npm integrity, applies the current Environment, runs both project suites, and executes standard and devtools container smoke tests. These jobs have no Release or Recovery credentials; merge remains the publication gate.

`Publish Latest Supported DSH` runs after a Supported Target change on `main` or by approved manual dispatch. Configure a protected `production-release` GitHub Environment restricted to `main` with:

- `DSH_RECOVERY_ROOT_PUBLIC_KEY`
- `DSH_KEYRING_JSON_BASE64`
- `DSH_KEYRING_SIGNATURE_BASE64`
- `DSH_RELEASE_PRIVATE_KEY`

The workflow resumes `targetSequence`, creates a draft, uploads immutable Bootstrap and Environment Artifacts plus signed metadata, then publishes it as Latest. It validates the selected npm tarball and binds its npm integrity into Stable metadata, but does not republish a duplicate DSH tarball; Stage-0 imports the official npm copy. The Recovery private key has no workflow input.

`Publish Docker Image` is protected by a separate `production-image` Environment. It uses the three public trust-bundle secrets and `DOCKER_TOKEN`; it has no Release private key or GitHub Release write permission. Repository or organization secrets `GOTIFY_URL` and `GOTIFY_TOKEN` are passed explicitly to the reusable Gotify workflow.

## Build and Test

Build the standard image:

```bash
docker build -t deepseek-harness:local .
```

Build a specific official package for local development, or build the devtools variant:

```bash
docker build --build-arg DSH_VERSION=0.1.0-rc.6 -t deepseek-harness:0.1.0-rc.6 .
docker build --build-arg INSTALL_DEVTOOLS=true -t deepseek-harness:local-devtools .
```

An arbitrary local `DSH_VERSION` produces a development-authority inventory with target sequence 0. It cannot become a formal tag or `latest`. Release workflows build only the reviewed Supported Target from verified signed Release artifacts, reject the marked non-production trust fixture, and require an offline Recovery-signed public trust bundle.

Run local checks with Node.js 24 and Docker Compose:

```bash
npm test --prefix container/control-plane/services/gateway
npm test --prefix container/platform
node container/test/compose-config.mjs
```

With Docker available, `container/test/container-smoke.sh [image]` checks managed processes, trust, password flow, persistent Console access, and the loopback-only DSH listener. `container/test/devtools-smoke.sh <image>` checks the devtools variant.

The standard image includes Node.js 24, `pnpm`, Python 3 with `venv`, Git, OpenSSH, curl, jq, ripgrep, and optional sudo. Devtools additionally includes build tools, Bash completion, network diagnostics, archive and file utilities, Vim, `pkg-config`, and pinned uv.

Devtools uses uv instead of a shared pre-created Python environment. Use `uv run --with requests script.py`, or `uv sync` and `uv run` in projects. Bare `pip` and `pip3` commands are intentionally absent; `python3 -m venv` remains available. Additional Python versions require an explicit `uv python install <version>`.
