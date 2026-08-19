# Container source layout

The container source tree follows runtime ownership boundaries:

```text
container/
├── platform/           Stage-0, Bootstrap, shared contracts, and release tools
├── control-plane/      Bootstrap-owned services and platform managers
├── environment/        Reloadable Environment definition and workload components
├── patches/            Exact patches applied while constructing an immutable DSH Runtime
├── system-plugins/     Platform-owned DSH System Plugin packages
└── test/               Container and Compose integration checks
```

`platform/` contains the trust boundary, Bootstrap, and shared protocol code. Persistent services and managers belong under `control-plane/<component>/`; reloadable workloads belong under `environment/<component>/`. A Component Manifest lives with the implementation it starts. DSH overlays belong under `system-plugins/<plugin>/`, while source patches remain data under `patches/`. Environment-owned components, patches, and System Plugins are identified by `id` and SHA-256 rather than independent release versions.

Bootstrap archives preserve the same `platform/` and `control-plane/` top-level layout. Container image paths and `/data/bootstrap/current` therefore resolve imports identically, without compatibility links or duplicate component copies.
