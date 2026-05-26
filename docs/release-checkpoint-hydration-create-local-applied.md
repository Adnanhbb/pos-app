# Release Checkpoint: Hydration Create-Local Applied

Suggested git tag:

```text
hydration-create-local-applied-before-update-merge
```

## Milestone Summary

This checkpoint records the first controlled hydration apply operation. It applied only safe `createLocalFromRemote` actions from the dry-run hydration planner into local IndexedDB.

This is not full hydration, merge, pull-sync, or conflict resolution. It does not introduce automatic sync behavior.

## Available Commands

```powershell
npm.cmd run sync:hydrate-create-local:dry
npm.cmd run sync:hydrate-create-local
```

`sync:hydrate-create-local:dry` is the default inspection mode. The apply command passes `--apply` and is required before any local IndexedDB rows are created.

## Apply Scope

The hydration apply tool is intentionally narrow:

- applies only `createLocalFromRemote` actions
- does not apply `updateLocalFromRemote`
- does not hydrate `manualReviewRequired` rows
- does not resolve conflicts
- does not overwrite local rows
- does not delete local rows
- does not delete backend rows
- preserves backend `serverId` on the local row
- writes only safe entity fields
- uses direct IndexedDB writes only
- does not call repository `create()` or `update()` methods
- does not create `sync_queue` rows
- does not mutate backend data

## Applied Result

The dry-run matched the expected seven safe `createLocalFromRemote` rows, so apply was run manually.

Applied rows:

- `units` serverId `70`
- `units` serverId `69`
- `taxes` serverId `68`
- `discounts` serverId `39`
- `brands` serverId `40`
- `brands` serverId `39`
- `categories` serverId `39`

Apply summary:

```text
appliedRows: 7
syncQueueCountBefore: 0
syncQueueCountAfter: 0
queueRowsCreated: 0
```

## Post-Apply State

Post-apply hydration and reconciliation reports showed:

```text
createLocalFromRemote: 0
likelyNeedsHydration: 0
localOnlyRows: 3
missingServerIds: 3
queueRows: 0
```

The remaining local-only / missing-serverId rows still require manual review and were intentionally not hydrated or repaired by this tool.

## Verified Results

Verification after the controlled apply:

- `node --check scripts/apply-hydration-createlocal.mjs` passed
- `npx.cmd tsc -b` passed
- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`

## Safety Boundary

This checkpoint does not add:

- update hydration
- merge hydration
- conflict resolution
- overwrite behavior
- delete behavior
- backend mutation
- replay triggering
- auto-sync
- background sync
- startup replay
- polling
- online/offline listeners

