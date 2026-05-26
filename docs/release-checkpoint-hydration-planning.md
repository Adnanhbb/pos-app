# Release Checkpoint: Hydration Planning Before Apply

Suggested git tag:

```text
hydration-planning-before-apply
```

## Milestone Summary

Dry-run hydration planning now exists before any hydration apply, merge, overwrite, or conflict-resolution behavior is implemented.

The planner converts read-only local/backend divergence into proposed action categories so developers can inspect likely future hydration behavior without changing IndexedDB or backend data.

## Available Command

```powershell
npm.cmd run sync:plan-hydration
```

This command is dry-run only.

## Dry-Run Action Categories

- `createLocalFromRemote`
- `updateLocalFromRemote`
- `possibleConflict`
- `skipSoftDeleted`
- `skipLocalNewer`
- `skipRemoteOlder`
- `manualReviewRequired`

## Current Planner Summary

Latest dry-run planner summary:

- `createLocalFromRemote`: `7`
- `updateLocalFromRemote`: `0`
- `possibleConflict`: `0`
- `skipSoftDeleted`: `0`
- `skipLocalNewer`: `0`
- `skipRemoteOlder`: `0`
- `manualReviewRequired`: `860`

## Planning Rules

Local-only rows are never planned for overwrite or deletion. They remain `manualReviewRequired` until a future explicit conflict/repair strategy exists.

Backend-only rows that look like dev/test data remain `manualReviewRequired` and are not planned for automatic hydration.

Backend-only active rows with no obvious dev/test marker may be planned as `createLocalFromRemote`, but this remains a dry-run proposal only.

Matched rows may only be considered for `updateLocalFromRemote` when timestamps are available, the backend row is newer, and no soft-delete conflict is detected.

User rows do not plan auth/session/security field overwrites.

## Not Implemented Yet

No hydration apply behavior exists yet.

No merge behavior exists yet.

No automatic conflict resolution exists yet.

No IndexedDB mutation, backend mutation, replay triggering, repair behavior, auto-sync, background sync, startup replay, polling, or online/offline listeners exist in this planning step.

## Verified Results

- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`
- `npx.cmd tsc -b` passed

## Next Phase

Before hydration apply is implemented, the project still needs explicit idempotent apply rules, conflict records, auth-expiry behavior, soft-delete handling, crash recovery, and tests for each entity class.

Auto-sync remains disabled until pull hydration, push replay, auth, diagnostics, retry behavior, and conflict handling are stable together.