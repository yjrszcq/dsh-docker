# Lifecycle, health, and logs

## Public status and lifecycle

Start diagnosis with:

```sh
dsh-platform status
```

Restart only DSH, while keeping Gateway and Management available, with:

```sh
dsh-platform restart --wait
```

Do not send signals to DSH, kill its PID, invoke Bootstrap sockets, or restart the whole container unless the user specifically requested that broader action. A DSH restart can temporarily return the Gateway's localized startup/maintenance page for browser navigation while API requests receive `503`.

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
