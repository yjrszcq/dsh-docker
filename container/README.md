# Container source layout

The container source tree follows runtime ownership boundaries:

```text
container/
├── platform/           Stage-0, Bootstrap, shared contracts, and release tools
├── control-plane/      Bootstrap-owned services and platform managers
├── environment/        Reloadable Environment definition and workload components
├── resources/          Patches and System Plugins packaged into an Environment
│   ├── patches/
│   └── system-plugins/
└── test/               Container and Compose integration checks
```

`platform/` contains the trust boundary, Bootstrap, and shared protocol code. Persistent services and managers belong under `control-plane/`; reloadable workloads belong under `environment/`. A Component Manifest lives with the implementation it starts. Environment inputs which are not processes belong under `resources/`: DSH overlays under `resources/system-plugins/<plugin>/` and exact source patches under `resources/patches/`. Environment-owned components, patches, and System Plugins are identified by `id` and SHA-256 rather than independent release versions.

Bootstrap archives preserve the same `platform/` and `control-plane/` top-level layout. Container image paths and `/data/bootstrap/current` therefore resolve imports identically, without compatibility links or duplicate component copies.
