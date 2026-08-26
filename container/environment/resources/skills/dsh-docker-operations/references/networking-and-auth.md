# Networking and authentication

## Ports and proxying

- Port `3080` is the Gateway and the only normal published service.
- Port `3079` is the loopback-only DSH upstream inside the container; do not publish or access it remotely.
- The standalone Management Console is below `/_dsh_platform/console/` on the Gateway.

For remote access, configure `DSH_TRUSTED_HOSTS` for accepted external Host values, require Gateway or platform authentication, and terminate HTTPS at a trusted reverse proxy or equivalent network boundary. Use a strong `DSH_PROXY_PASSWORD` unless an authenticated upstream boundary protects every Gateway route. Never expose port `3080` or the standalone Management Console without authentication: its terminal and file manager operate with Root authority. The reverse proxy must preserve the original `Host` and normal WebSocket upgrade headers.

Do not weaken Host/Origin checks to work around a reverse-proxy error. Diagnose the forwarded Host, scheme, Origin, WebSocket upgrade, and authentication headers first.

## Managed outbound proxy

Configure an existing HTTP or SOCKS5 proxy through the **Proxy** tab in the DSH Management Console or Platform Management. Do not edit `/data/platform/state/proxy`, read the Outbound Proxy process environment, or call `/run/dsh-platform/outbound-proxy.sock` directly. Proxy credentials are write-only and must never be recovered from files or logs.

The UI can route updates, platform components, DSH core/plugins, Agent network operations, the Management container terminal, and model Providers independently. A remote Provider identified through DSH `llm/stream` has two controls: its proxy switch selects direct or proxy access, while **Follow DSH** selects the shared DSH policy instead of the Provider's independent proxy route. A future Provider that cannot carry stable identity is visibly locked to **Follow DSH**. Local Providers remain direct. Host-side `docker exec` commands are not classified by the platform.

For Agent-issued `curl`, Git, npm, pnpm, and similar commands, preserve the injected `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, and optional `ALL_PROXY` environment. Do not replace these with the external proxy URL or expose its credentials. Tool support for `ALL_PROXY` varies; inspect the tool's current documentation or behavior before relying on it.

Use `.example.com`, not `*.example.com`, for a domain suffix. Platform-required loopback rules cannot be removed. If the proxy runs on the Docker host, obtain the current bridge gateway with `ip route`; container `127.0.0.1` is not the host. The host proxy must listen on the bridge address, with appropriate firewall restrictions.

Use the built-in asynchronous proxy test before saving uncertain settings. A failed test does not replace the active configuration. When diagnosing update checks, distinguish a later remote failure that retains the last verified result from a first check that has never succeeded.

## Authentication

Gateway Basic Auth protects DSH and platform routes when configured. The standalone Management Console may additionally use `DSH_PLATFORM_PASSWORD`. If neither long-lived password is available, create a short-lived access key only when the user explicitly requests access and is present at the container console:

```sh
dsh-platform access create
```

Treat the returned key as a secret. Give it only to the requesting user through the current private interaction, never write it to logs or command history, and do not repeat it after the browser session is established.

Do not read configured passwords from environment files, `/proc`, process listings, or service memory. Ask the user to authenticate through the normal browser flow.

The Platform Management and Settings Document Editor System Plugins use the restricted DSH-side platform API and must not require a separate Management Console login. Access is inherited from the protected DSH page and limited by an exact Gateway route allowlist; do not search for a console session token or invent a separate plugin credential.

When the Gateway is behind another proxy, use the public Gateway URL for checks. A direct request with an untrusted Host can correctly return `403`; that is not evidence that DSH itself failed.
