# Updates, rollback, and recovery

## Read-only check and activation

Checking never downloads or activates an update:

```sh
dsh-platform check
```

Inspect `dsh-platform status` after the check. Activate the latest supported target only after the user confirms:

```sh
dsh-platform update --wait
```

Use `dsh-platform channel` to inspect the current channel and `dsh-platform channel stable|experimental` only when the user requests a channel change.

Stable targets update the signed supported DSH and Environment. Experimental mode may use a newer upstream DSH while retaining the supported Environment. Do not download npm/GitHub artifacts yourself, submit an expected hash, or call the Trust API; Stage-0 alone authorizes and imports release objects.

## Rollback and return to stable

Use `dsh-platform rollback` only when a complete previous state is available and the user explicitly confirms the target and service interruption. Explain any reported snapshot or data boundary before proceeding, then verify status and health after rollback. Experimental return-to-stable can restore an older data snapshot and discard newer DSH data; use the interactive `dsh-platform return-stable` flow and present the data-loss boundary before proceeding.

Runtime reset rebuilds DSH from verified Pristine content and the current complete patch/plugin set. Use the standalone Management Console for that operation; it does not erase `$DSH_HOME`, sessions, user plugins, or the workspace.

## Exceptional recovery

`dsh-platform recover --image-baseline` and `dsh-platform trust reset` are Root-only interactive console operations. Use them only when the normal current/previous recovery paths are unavailable and the user explicitly authorizes the risk.

Never manually delete `$DSH_PLATFORM_DATA/state`, rewrite slots, copy objects into Store, edit keyrings, forge receipts, or reinterpret an image reference. If a legacy or corrupt platform volume prevents startup, preserve `$DSH_HOME` and follow the exact platform error/recovery guidance.
