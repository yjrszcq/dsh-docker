# Networking and authentication

## Ports and proxying

- Port `3080` is the Gateway and the only normal published service.
- Port `3079` is the loopback-only DSH upstream inside the container; do not publish or access it remotely.
- The standalone Management Console is below `/_dsh_platform/console/` on the Gateway.

For remote access, configure `DSH_TRUSTED_HOSTS` for accepted external Host values, require Gateway or platform authentication, and terminate HTTPS at a trusted reverse proxy or equivalent network boundary. Use a strong `DSH_PROXY_PASSWORD` unless an authenticated upstream boundary protects every Gateway route. Never expose port `3080` or the standalone Management Console without authentication: its terminal and file manager operate with Root authority. The reverse proxy must preserve the original `Host` and normal WebSocket upgrade headers.

Do not weaken Host/Origin checks to work around a reverse-proxy error. Diagnose the forwarded Host, scheme, Origin, WebSocket upgrade, and authentication headers first.

## Authentication

Gateway Basic Auth protects DSH and platform routes when configured. The standalone Management Console may additionally use `DSH_PLATFORM_PASSWORD`. If neither long-lived password is available, create a short-lived access key only when the user explicitly requests access and is present at the container console:

```sh
dsh-platform access create
```

Treat the returned key as a secret. Give it only to the requesting user through the current private interaction, never write it to logs or command history, and do not repeat it after the browser session is established.

Do not read configured passwords from environment files, `/proc`, process listings, or service memory. Ask the user to authenticate through the normal browser flow.

The Platform Management and Settings Document Editor System Plugins use the restricted DSH-side platform API and must not require a separate Management Console login. Access is inherited from the protected DSH page and limited by an exact Gateway route allowlist; do not search for a console session token or invent a separate plugin credential.

When the Gateway is behind another proxy, use the public Gateway URL for checks. A direct request with an untrusted Host can correctly return `403`; that is not evidence that DSH itself failed.
