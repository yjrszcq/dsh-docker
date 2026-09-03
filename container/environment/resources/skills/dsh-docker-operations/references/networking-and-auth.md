# Networking and authentication

## Ports and proxying

- Port `3080` is the Gateway and the only normal published service.
- Port `3079` is the loopback-only DSH upstream inside the container; do not publish or access it remotely.
- The standalone Management Console is below `/_dsh_platform/console/` on the Gateway in compatibility mode. Separate-origin mode uses the container's dedicated Management entry without a DSH upstream.

For remote access, configure `DSH_TRUSTED_HOSTS` for accepted external Host values, initialize the local administrator in the browser, and terminate HTTPS at a trusted reverse proxy or equivalent network boundary. Never expose port `3080` or the standalone Management Console before authentication: its terminal and file manager operate with Root authority. The reverse proxy must preserve the original `Host` and normal WebSocket upgrade headers. Optional strong isolation publishes the dedicated Management entry without a DSH upstream; for a public separate origin configure its exact public URL, and for a local separate origin configure the host port mapped to the container entry (default `3081`, but the host port is user-selectable). Do not assume either separate entry is exposed unless the operator configured it.

Do not weaken Host/Origin checks to work around a reverse-proxy error. Diagnose the forwarded Host, scheme, Origin, WebSocket upgrade, and authentication headers first.

## Managed outbound proxy

Configure an existing HTTP or SOCKS5 proxy through the **Proxy** tab in the DSH Management Console or Platform Management. Do not edit `/data/platform/state/proxy`, read the Outbound Proxy process environment, or call `/run/dsh-platform/outbound-proxy.sock` directly. Proxy credentials are write-only and must never be recovered from files or logs.

The UI can route updates, platform components, DSH core/plugins, Agent network operations, the Management container terminal, and model Providers independently. A remote Provider identified through DSH `llm/stream` uses one switch: off selects direct access and on selects its dedicated proxy route. A future Provider that cannot carry stable identity is marked with a read-only **Follow DSH** label; its switch selects direct access when off and the shared DSH policy when on. Local Providers remain direct. Host-side `docker exec` commands are not classified by the platform.

For Agent-issued `curl`, Git, npm, pnpm, and similar commands, preserve the injected `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, and optional `ALL_PROXY` environment. Do not replace these with the external proxy URL or expose its credentials. Tool support for `ALL_PROXY` varies; inspect the tool's current documentation or behavior before relying on it.

Use `.example.com`, not `*.example.com`, for a domain suffix. Platform-required loopback rules cannot be removed. If the proxy runs on the Docker host, obtain the current bridge gateway with `ip route`; container `127.0.0.1` is not the host. The host proxy must listen on the bridge address, with appropriate firewall restrictions.

Use the built-in asynchronous proxy test before saving uncertain settings. A failed test does not replace the active configuration. When diagnosing update checks, distinguish a later remote failure that retains the last verified result from a first check that has never succeeded.

## Authentication

Access Manager owns the single local administrator account. A fresh installation stays in an initialization page until the browser sets a username and main password. DSH login creates a DSH Session; the standalone Management Console consumes a one-time handoff and creates a separate Management Session that remains valid only while its source DSH Session is active. Direct Management access always completes the main DSH login first, including on an isolated Management Origin. An optional Management console password is a second layer. DSH logout or session expiry also invalidates linked Management sessions. During a classified DSH outage, top-level navigation may show a generic Gateway recovery page before login so the Management entry remains reachable; it does not grant a session or expose failure details. Do not look for Gateway Basic Auth, `DSH_PROXY_PASSWORD`, `DSH_PLATFORM_PASSWORD`, or a temporary login key: those legacy login paths are removed.

Browser authentication forms only transport values; the Access Manager performs authentication and credential decisions. Authentication Settings changes the username without a current password, while main-password and Management-console-password changes require the current main password. Resetting or disabling the Management console password does not require the old Management console password and revokes existing Management Sessions.

After five consecutive failures from one browser source, Access Manager imposes a 30-second retry wait and doubles later waits up to 15 minutes. Each source has fixed limits of 12 failures per hour and 24 per 24 hours; the whole instance has wider flood limits of 20 per minute, 60 per hour, and 120 per 24 hours. Treat `AUTHENTICATION_RETRY_REQUIRED` and `AUTHENTICATION_RATE_LIMITED` as backend decisions; do not retry around them or implement credential admission in the browser.

Lost credentials can only be recovered by Root from an interactive container TTY:

```sh
docker exec -it --user root <container> dsh-platform access status
docker exec -it --user root <container> dsh-platform access reset
docker exec -it --user root <container> dsh-platform access clear-retry
docker exec -it --user root <container> dsh-platform access clear-retry --global-only
docker exec -it --user root <container> dsh-platform access clear-retry --two-factor
docker exec -it --user root <container> dsh-platform access disable-two-factor
docker exec -it --user root <container> dsh-platform access clear-sessions [--management-only]
```

The combined `access reset` command atomically applies selected username and main-password changes and, when configured, uses a numbered menu to preserve, disable, or reset the Management console password. It submits nothing until all prompts complete. Yes/no recovery prompts accept only `y` or `n`, with the default shown in brackets. Other interactive recovery commands include `access set-username`, `access reset-password`, `access reset-management-password`, and `access disable-management-password`. `access clear-retry` uses the same Root/TTY and `y/[n]` boundary; it clears every browser-source wait, every source rolling window, and the instance-wide failure windows without changing credentials or sessions. Add `--global-only` to clear only the instance-wide windows while leaving browser waits and source windows active. The optional `--main-password`, `--management-password`, or `--two-factor` selector limits clearing to one credential class; `--two-factor` clears only its daily limit and leaves the fixed 10-second code backoff active. Fresh empty volumes register without a key. Persisted pre-account deployments and damaged authentication state use `access generate-key`, which issues a single-use authentication reset key valid for ten minutes from the same Root TTY. Never pass passwords as arguments or pipe them to the CLI.

`--global-only` limits `access clear-retry` to the instance-wide flood windows; without it, both source/browser waits and instance windows are cleared. `access clear-sessions` clears all sessions, or only Management sessions with `--management-only`.

Do not read configured passwords from environment files, `/proc`, process listings, or service memory. Ask the user to authenticate through the normal browser flow.

The Platform Management and Settings Document Editor System Plugins use the restricted DSH-side platform API and must not require a separate Management Console login. Access is inherited from the authenticated DSH Session and limited by an exact Gateway route allowlist; do not search for a Management session token or invent a separate plugin credential. The restricted API cannot access files, the Root terminal, User Plugin recovery, or authentication settings.

When the Gateway is behind another proxy, use the public Gateway URL for checks. A direct request with an untrusted Host can correctly return `403`; that is not evidence that DSH itself failed.
