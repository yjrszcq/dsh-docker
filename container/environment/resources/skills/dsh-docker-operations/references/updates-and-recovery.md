# Updates, rollback, and recovery

## Read-only check and activation

Checking never downloads or activates an update:

```sh
dsh-platform check
```

Inspect `dsh-platform status` after the check. Activate the latest supported target only after the user confirms:

```sh
dsh-platform update
```

For an Agent running inside the current DSH session, activation must remain asynchronous: report the returned task ID and do not use `update --wait`, because switching DSH can interrupt the tool transport. `--wait` is reserved for an external operator terminal, the standalone Management Console terminal, and external automation.

After submitting an update, use the public `dsh-platform status` result and task-correlated platform logs to report its current phase or terminal outcome. The Management interfaces reconstruct their stage history from this persistent state and JSONL log stream, so a browser refresh does not imply that the operation restarted. Prefer the phase, measurable byte/item/file/service counters, and structured failure details over an estimated elapsed time. Do not inspect updater journals, Deployment slots, or internal sockets to infer progress.

Use `dsh-platform channel` to inspect the current channel and `dsh-platform channel stable|experimental` only when the user requests a channel change.

Stable targets update the signed supported DSH and Environment. Before activating a newer upstream DSH, Experimental mode first converges the complete Deployment to the signed Stable target sequence, even if the displayed DSH and Environment versions already match. Do not download npm/GitHub artifacts yourself, submit an expected hash, or call the Trust API; Stage-0 alone authorizes and imports release objects.

## Rollback and return to stable

Use `dsh-platform rollback` only when a complete previous state is available and the user explicitly confirms the target and service interruption. Explain any reported snapshot or data boundary before proceeding, then verify status and health after rollback. Experimental return-to-stable can restore an older data snapshot and discard newer DSH data; use the interactive `dsh-platform return-stable` flow and present the data-loss boundary before proceeding.

The in-DSH Platform Management interface intentionally does not expose rollback or return-to-stable. Direct users who need these recovery actions to the standalone DSH Management Console, where return-to-stable is shown only for an active Experimental Deployment with a verified Stable recovery point.

Runtime reset rebuilds DSH from verified Pristine content and the current complete patch/plugin set. Use the standalone Management Console for that operation; it does not erase `$DSH_HOME`, sessions, user plugins, or the workspace.

## Exceptional recovery

```sh
dsh-platform recover
dsh-platform trust reset
```

Both commands are Root-only interactive console operations. `recover` restores the image-baseline Deployment after current and previous Deployments are unusable; `trust reset` clears the accepted trust state.

Never manually delete `$DSH_PLATFORM_DATA/state`, rewrite slots, copy objects into Store, edit keyrings, forge receipts, or reinterpret an image reference. If a legacy or corrupt platform volume prevents startup, preserve `$DSH_HOME` and follow the exact platform error/recovery guidance.
