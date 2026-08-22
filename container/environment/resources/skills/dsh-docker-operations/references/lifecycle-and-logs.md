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

Do not send signals to DSH, kill its PID, invoke Bootstrap sockets, or restart the whole container unless the user specifically requested that broader action. During a registered lifecycle operation, browser navigation enters the localized holding page and returns to the original same-origin path after readiness; API and WebSocket requests receive `503`.

Docker health represents DSH HTTP readiness through the Gateway's internal health path. Stage-0 or Management being alive is not sufficient for a healthy container.

## Logs

Inside the container, query structured platform logs with:

```sh
dsh-platform logs --limit 500
dsh-platform logs --source dsh-runtime --limit 500
dsh-platform logs --since <ISO-8601-time> --limit 500
```

The standalone Management Console and Platform Management plugin provide filtering, expansion of complete structured entries, refresh, live following, and JSONL export. From the Docker host, `docker logs <container>` includes platform and DSH output.

When reporting a failure, include the operation/task ID, source, timestamp, complete error, and the smallest relevant surrounding entries. Do not include credentials, terminal contents, or unrelated user data.

Logs rotate automatically according to the platform size and retention settings. Clearing the UI display is a local display cutoff and does not delete the persisted platform log files.

## Management surfaces

The standalone DSH Management Console is served at `/_dsh_platform/console/` and stays available when DSH is starting, restarting, recovering, or down. Platform Management inside DSH exposes the routine subset appropriate while DSH is available. Prefer the standalone console for recovery, Root terminal/file access, user-plugin recovery, and System Skill reinstallation.
