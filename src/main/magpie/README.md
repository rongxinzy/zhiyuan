# Bundled local CLI management

The host executes the unchanged pinned Magpie binary described by
`resources/magpie/upstream.json`. Its MIT notice ships with the resource.

## Explicit enablement

Creating `MagpieManager` and requesting `status()` do not start a process.
The product must explain that upstream startup synchronizes previously managed
CLI configuration (`agent.SyncCatalog`) and that `/api/state` may follow/apply
configuration (`a.Follow`). Only the user's **Enable local CLI management**
action calls `start()`. Do not label `agents()` a read-only scan.

Production retains HOME/USERPROFILE for real local CLI management, while
XDG_CONFIG_HOME puts Magpie's own files below the supplied app-private directory.
Account discovery is disabled by MAGPIE_NO_ACCOUNTS=1; telemetry is disabled by
DO_NOT_TRACK=1 and upstream settings. The gateway and Web UI bind to loopback.
The host does not copy application provider credentials into Magpie. Its ephemeral
Web key remains in Main and the separate in-memory management-window cookie jar.
This window has no application preload, cannot open other windows, and denies
external navigation and permission requests. External OAuth browser flows are
not supported through this embedded window in this version.

The host verifies source pin/platform/version and the packaged binary SHA256 in
a cancellable worker before spawning. macOS manifests include the post-signing
binary digest; build provenance retains the pre-signing digest. Missing or changed
resources fail closed. Start is single-flight; quit first requests upstream's
POST /api/window/quit, then terminates only the process it owns if needed.
No Windows Job Object or descendant cleanup is claimed for this Go process.

## Narrow renderer contract

`src/shared/magpie/types.ts` defines status/start/stop/models/agents/setModel and
openManagement. The IPC registrar requires the application's existing trusted
main-frame predicate. It does not provide a generic URL or HTTP proxy.

- models: official GET /v1/models, projected id/owned_by only
- agents: official GET /api/state + GET /api/agents/cli, projected identity,
  missing-CLI flag, connection flag, versions and model fields only
- setModel: explicit user apply action, official POST /api/set with Agent/Field/Value
- openManagement: sandboxed official local Web UI, only after explicit start

The caller registers `registerMagpieIpc` once and awaits its returned disposer
before application shutdown. The shared MagpieApi is exposed as
window.electron.magpie. Do not persist an auto-start flag.

## Verification

`bun x vitest run src/main/magpie` covers process ownership, explicit enablement,
credential omission, trusted manifest, safe projection and cancellation.
After building the target binary, run
`ZHIYUAN_MAGPIE_SMOKE=1 bun x vitest run src/main/magpie`.
The opt-in smoke creates a temporary HOME/.codex/config.toml, discovers its model,
sets a different model through the real API, verifies the configuration file and
stops the real process. It never uses a real account or API key.

Linux x64 runtime and emitted SHA worker were exercised locally. The other five
cross-built targets still require native platform CI execution/signing checks.
