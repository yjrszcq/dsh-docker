# Container source layout

The container source tree follows runtime ownership boundaries:

```text
container/
├── platform/           Stage-0, Bootstrap, shared contracts, and release tools
├── control-plane/      Bootstrap-owned services and platform managers
├── environment/        Reloadable definition, workloads, and packaged resources
└── test/               Container and Compose integration checks
```

`platform/` contains the trust boundary, Bootstrap, and shared protocol code. Persistent services and managers belong under `control-plane/`; the complete Container Environment source belongs under `environment/`. A Component Manifest lives with the implementation it starts. Environment inputs which are not processes live under `environment/resources/`: DSH overlays under `resources/system-plugins/<plugin>/`, exact source patches under `resources/patches/`, and Agent guidance under `resources/system-skills/<skill>/`. Environment-owned components, patches, System Plugins, and System Skills are identified by `id` and SHA-256 rather than independent release versions.

Bootstrap archives preserve the same `platform/` and `control-plane/` top-level layout. Image and Store References therefore resolve through the same `/run/dsh-platform/views/bootstrap` runtime view, without compatibility links or duplicate component copies.
