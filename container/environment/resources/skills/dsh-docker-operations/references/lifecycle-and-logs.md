# Lifecycle, health, and logs

## Public status and lifecycle

Start diagnosis with:

```sh
dsh-platform status
```

Restart only DSH, while keeping Gateway and Management available, with:

```sh
dsh-platform restart
```

For an Agent running inside the current DSH session, `restart` must remain asynchronous: report the returned task ID and let the browser enter the lifecycle holding page. Never run `restart --wait` or `stop --wait` from that session because DSH shutdown interrupts the tool transport. `--wait` is reserved for `docker exec`, the standalone Management Console terminal, and external automation.

The standalone Management Console and CLI also expose explicit lifecycle operations:

```sh
dsh-platform start
dsh-platform stop
dsh-platform restart
```

An explicit stop lasts only for the current container lifetime. An unexpected DSH exit is recovered at most three times; check `dshLifecycle` and `recoveryMode` rather than repeatedly sending restart commands.

The container admits only the Bootstrap-supervised Web Profile. Do not launch a replacement with `dsh web`: when DSH is stopped that command delegates to the public start operation, and otherwise it reports the managed state without creating a second instance. An unregistered first `SIGTERM` is converted into a public asynchronous restart, but this compatibility behavior is not a reason to signal the process directly.

Do not send signals to DSH, kill its PID, invoke Bootstrap sockets, or restart the whole container unless the user specifically requested that broader action. During a registered lifecycle operation, browser navigation enters the localized holding page and returns to the original same-origin path after readiness; API and WebSocket requests receive `503`.

Plugin bundle requests are held while a registered lifecycle transition makes DSH temporarily unavailable. The same guard covers official DSH plugins, bundled System Plugins, and User Plugins. If a browser still receives a transient bundle failure, including a dynamic-import failure already rendered by DSH, the injected guard may enter the holding page once for that lifecycle. It deliberately does not loop: a second failure exposes the real DSH plugin-load error. Do not advise repeated manual refreshes before checking lifecycle state and the browser recovery events in platform logs.

Docker health probes the DSH HTTP listener directly at loopback `127.0.0.1:3079`. It represents DSH readiness; Stage-0, Gateway, or Management being alive is not sufficient for a healthy container. An intentional DSH stop therefore makes Docker report the container as unhealthy even though the standalone Management Console remains available.

## Logs

Inside the container, query structured platform logs with:

```sh
dsh-platform logs --limit 500
dsh-platform logs --source dsh-runtime --limit 500
dsh-platform logs --since <ISO-8601-time> --limit 500
```

The standalone Management Console and Platform Management plugin provide filtering, expansion of complete structured entries, refresh, live following, and JSONL export. From the Docker host, `docker logs <container>` includes platform and DSH output.

When reporting a failure, include the operation/task ID, source, timestamp, complete error, and the smallest relevant surrounding entries. Do not include credentials, terminal contents, or unrelated user data.

For a browser plugin-load failure, correlate `browser.plugin-load.failed` with `browser.plugin-load.recovery.started`, `browser.plugin-load.recovery.completed`, or `browser.plugin-load.recovery.failed`. A completed recovery confirms a transient lifecycle race; a final failure or a failure without a registered lifecycle requires investigation of the named plugin bundle and DSH Runtime logs.

Logs rotate automatically according to the platform size and retention settings. Clearing the UI display is a local display cutoff and does not delete the persisted platform log files.

## Management surfaces

The standalone DSH Management Console is served at `/_dsh_platform/console/` and stays available when DSH is starting, restarting, recovering, or down. Platform Management inside DSH exposes the routine subset appropriate while DSH is available. Prefer the standalone console for recovery, Root terminal/file access, user-plugin recovery, and System Skill reinstallation.
