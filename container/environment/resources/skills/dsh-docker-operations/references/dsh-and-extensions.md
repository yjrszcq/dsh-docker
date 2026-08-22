# DSH, profiles, plugins, and skills

## DSH CLI

Use the `dsh` shim. It dynamically executes the current verified Runtime and remains correct across updates and rollbacks. Consult `dsh --help` and the relevant subcommand help instead of calling files below `/run/dsh-platform/views/runtime`.

The Web Profile is stored below `$DSH_HOME/profiles/web`. Treat its package manifest, lockfile, and bundle declarations as a coordinated profile owned by the DSH CLI; do not hand-edit them for ordinary plugin operations.

## User plugins

Install a published user plugin with:

```sh
dsh plugin --profile web add <package-or-supported-spec>
```

Remove it with:

```sh
dsh plugin --profile web remove <package-name>
```

Run these commands with the inherited `node` environment. The public container `dsh` shim also drops a Root caller to the managed `node` identity, but that protection is not a reason to invoke profile-internal pnpm commands as Root. Do not redirect pnpm configuration or caches. Prefer the package declared by the plugin project; clone/build source only when the user explicitly requests source installation or no published package exists.

The platform pins the Web Profile store below `$DSH_HOME/.pnpm-store` and transactionally migrates a legacy Profile whose pnpm metadata points at an older workspace or home. If a package operation reports `ERR_PNPM_UNEXPECTED_STORE`, restart DSH once through the public lifecycle command and inspect the DSH Runtime log for the migration result. Do not delete `$DSH_HOME`, edit `node_modules/.modules.yaml`, or create/chmod the old store path to suppress the check.

Some plugin changes require DSH to restart. Use:

```sh
dsh-platform restart
```

When this command is run by an Agent inside a DSH session, submit the asynchronous task and report its task ID. Do not add `--wait`: stopping the current DSH process interrupts the tool transport before a durable result can be returned. Use `--wait` only from `docker exec`, the standalone Management Console terminal, or external automation.

The standalone Management Console can disable or uninstall a faulty Web Profile Bundle while DSH is down. It deliberately manages only DSH bundle plugins, not arbitrary dependencies or hand-written Cordis patch entries.

If a plugin tool reports a successful removal but DSH then fails with `cannot resolve profile bundle`, inspect public DSH Runtime logs and restart once through `dsh-platform restart`. An authorized Web startup atomically removes only an orphaned Bundle which is no longer a declared dependency and cannot be resolved from the Profile or DSH installation. Do not hand-edit `package.json`, the lockfile, or `dsh.profile.bundles`; if the managed repair does not restore readiness, use User Plugin recovery in the standalone Management Console.

## System Plugins

System Plugins are signed resources supplied by the current DSH Docker Environment. Manage them through **System Plugins** in Platform Management or the standalone Management Console. Do not install, delete, or impersonate `@dsh-docker/*` packages through the normal user-plugin CLI.

## Skills

User and project skills belong to the official DSH roots such as `$DSH_HOME/skills`, `.dsh/skills`, or `.agents/skills`. System Skills are signed platform resources and are managed through **System Skills** in the two management interfaces.

Installing, uninstalling, enabling, or disabling a System Skill hot-refreshes the DSH skill catalog. It does not require a DSH restart. A project or user skill with the same name may override the bundled System Skill according to DSH's native precedence; platform management does not alter or remove that override.
