# Container source layout

The container source tree follows runtime ownership boundaries:

```text
container/
├── platform/           Stage-0, Bootstrap, shared contracts, management, and release tools
├── components/         Independently owned Environment component implementations and manifests
├── patches/            Exact patches applied while constructing an immutable DSH Runtime
├── system-plugins/     Platform-owned DSH System Plugin packages
└── test/               Container and Compose integration checks
```

`platform/` contains the control plane and shared protocol code. Runtime services and managers belong under `components/<component>/`; their Component Manifest should live with the implementation it starts. DSH overlays belong under `system-plugins/<plugin>/`, while source patches remain data under `patches/`. Environment-owned components, patches, and System Plugins are identified by `id` and SHA-256 rather than independent release versions.

Bootstrap archives preserve the same `platform/` and `components/` top-level layout. Container image paths and `/data/bootstrap/current` therefore resolve imports identically, without compatibility links or duplicate component copies.
