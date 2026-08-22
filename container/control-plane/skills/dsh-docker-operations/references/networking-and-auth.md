# Networking and authentication

## Ports and proxying

- Port `3080` is the Gateway and the only normal published service.
- Port `3079` is the loopback-only DSH upstream inside the container; do not publish or access it remotely.
- The standalone Management Console is below `/_dsh_platform/console/` on the Gateway.

For remote access, configure `DSH_TRUSTED_HOSTS` for accepted external Host values and use a strong `DSH_PROXY_PASSWORD`. Terminate HTTPS at a trusted reverse proxy or equivalent network boundary. The reverse proxy must preserve the original `Host` and normal WebSocket upgrade headers.

Do not weaken Host/Origin checks to work around a reverse-proxy error. Diagnose the forwarded Host, scheme, Origin, WebSocket upgrade, and authentication headers first.

## Authentication

Gateway Basic Auth protects DSH and platform routes when configured. The standalone Management Console may additionally use `DSH_PLATFORM_PASSWORD`. If neither long-lived password is available, a user at the container console can create a short-lived access key with:

```sh
dsh-platform access create
```

Do not read configured passwords from environment files, `/proc`, process listings, or service memory. Ask the user to authenticate through the normal browser flow.

The Platform Management plugin uses its platform-issued internal authorization and must not require a separate Management Console login. Do not copy that internal credential into commands or expose it to third-party plugins.

When the Gateway is behind another proxy, use the public Gateway URL for checks. A direct request with an untrusted Host can correctly return `403`; that is not evidence that DSH itself failed.
