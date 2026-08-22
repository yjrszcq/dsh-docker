# Diagnostics and protected boundaries

## Ordered diagnosis

Use the least invasive source of truth that can answer the question:

1. Run the relevant public command's `--help` when syntax is uncertain.
2. Inspect `dsh-platform status` and the current operation/task state.
3. Read focused structured logs through `dsh-platform logs` or a management UI.
4. Check DSH/Profile state with the public `dsh` CLI.
5. Use the standalone Management Console for recovery actions, Root file inspection, or a terminal explicitly requested by the user.
6. Inspect platform implementation files only when the user explicitly asks to debug or develop dsh-docker itself.

For a restart failure immediately after plugin removal, first look for `cannot resolve profile bundle` in the structured DSH Runtime logs. A current managed startup repairs legacy orphaned Bundle references automatically; verify the subsequent lifecycle terminal state before escalating. Do not bypass that repair by editing the Web Profile manifest or lockfile directly.

Stop once the cause is established. Do not enumerate Seed trees, runtime packages, sockets, process environments, or supervisor source as a substitute for trying the public operation.

## Protected trust boundary

Stage-0 is the only writer and verifier for Recovery-signed keyrings, Release signatures, monotonic ledgers, trusted objects, and receipts. Bootstrap, Updater, DSH, plugins, and agents consume its verified results.

Never:

- edit or replace the Recovery Root public key;
- add a Release key or modify keyring state;
- call the Stage-0 Trust socket directly;
- import an object by supplying an arbitrary expected hash;
- forge, copy, reactivate, or rewrite a receipt;
- lower keyring generation or target sequence;
- mutate current/previous deployment or Bootstrap slots by hand.

Use `dsh-platform trust status` for read-only trust diagnostics. Trust reset is a last-resort Root TTY operation, not a Web/API repair method.

## Failure reporting

Distinguish among DSH startup, update/restart, automatic rollback, startup failure, prolonged unavailability, Gateway authorization, and an unclassified proxy error. Capture the public status plus complete relevant structured error. Do not label a warning or ordinary stderr line as a failure without its structured level/result, and do not report an operation as successful until its terminal state and postcondition are verified.
