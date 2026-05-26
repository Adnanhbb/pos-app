# Sync Stabilization Status

This document records the current offline sync architecture, verified test status, developer tools, and safety boundaries before the next migration phase.

## Current Architecture Summary

- IndexedDB remains the local runtime data source for reads.
- Repositories are the UI-facing data access boundary.
- Migrated repositories can write locally and enqueue offline sync work.
- `sync_queue` stores pending sync operations in IndexedDB.
- `syncEngine.processPending()` is manual/dev-invoked only.
- The PHP/MySQL backend is reachable through `/api/*.php` endpoints.
- The server database is the intended source of truth once sync is fully enabled.
- IndexedDB is a local cache plus offline queue.
- No automatic sync startup exists.

## Offline Flow

When API access is unavailable or a remote write fails:

1. The repository saves the change to IndexedDB.
2. The repository adds one `sync_queue` row when the operation is sync-aware.
3. The UI continues using the local IndexedDB state.
4. Queue write failures after successful local writes are treated as non-blocking in migrated repository helpers.

POS transaction queueing is separate from normal CRUD queueing. Finalized POS flows queue one transaction payload rather than individual stock, customer, supplier, payment, cylinder, or sale item rows.

## Manual Replay Flow

Manual replay is currently performed through dev/test scripts or explicit `syncEngine.processPending()` calls.

1. `syncEngine.processPending(limit)` checks connectivity.
2. Pending rows are processed oldest first.
3. CRUD rows call the matching entity API.
4. Transaction rows call `transactions.php`.
5. Successful CRUD replay can patch the local IndexedDB row with `serverId`.
6. The queue row is marked `done`.
7. Failures are retried through queue metadata and diagnostics.

There is no interval, listener, startup hook, or automatic replay loop.

## Safe Mirrored Entities

The current local mirror handlers cover these entities:

- `units`
- `taxes`
- `discounts`
- `brands`
- `categories`
- `expenses`
- `customers`
- `suppliers`
- `users`
- `settings`
- `held`

Mirror writes are local-only. They preserve the local IndexedDB `id`, patch `serverId`, and avoid repository update methods that would enqueue again.

## Protected And Non-Mirrored Fields

These fields and relationships are intentionally protected:

- Customers and suppliers do not mirror `invoices`, `payable`, `paid`, or `balance`.
- Users do not mirror `Password`, `password`, or `password_hash`.
- `held_items` are not mirrored separately.
- Item stock/cascade fields are not mirrored.
- Item stock fields such as `availableStock` are not part of mirror replay.
- Item relation fields such as `category`, `brand`, `minunit`, `maxunit`, and `ConvQty` are not mirrored through simple CRUD replay.
- The transactions endpoint is storage/idempotency-only and does not mutate stock, accounting, cylinders, payments, customers, suppliers, batches, or sale items yet.

## High-Risk Entities Intentionally Deferred

These areas remain deferred until atomic transaction sync is implemented and tested:

- POS sales
- Returns
- Invoice deletion/reversal
- Customer payments
- Supplier payments
- Sale item writes
- Stock updates
- Batch updates
- Cylinder updates
- Cylinder customer assignments
- Item create/delete/restore/permanent delete
- Full item stock and relation sync
- Remote pull/hydration
- Conflict UI

## Current Test Status

Final verified status:

- `npm.cmd run test:sync:low-risk` => `79 passed, 0 failed`
- `npm.cmd run test:sync:real-low-risk` => `39 passed, 0 failed`

The simulated mirror test validates backend contract plus local mirror mechanics.

The real low-risk test calls actual `syncEngine.processPending()` for a small safe subset and verifies queue completion, backend writes, local `serverId` mirror patching, and protected field preservation.

## Dev-Only Scripts

Run these from the project root with the app available at `APP_URL`.

```powershell
$env:APP_URL="http://localhost:5173"
$env:API_BASE_URL="http://localhost/jawad-bro/api"
```

Available commands:

```powershell
npm.cmd run test:sync:low-risk
npm.cmd run test:sync:real-low-risk
npm.cmd run sync:report
npm.cmd run sync:report-stuck
npm.cmd run sync:report-cleanup
npm.cmd run sync:reset-failed:dry
npm.cmd run sync:reset-failed
npm.cmd run sync:cleanup-done:dry
npm.cmd run sync:cleanup-done
```

## What Each Script Does

- `test:sync:low-risk`: simulated replay test for safe mirrored entities. It does not claim to test actual `syncEngine.processPending()`.
- `test:sync:real-low-risk`: dev-only test that injects safe queue rows and explicitly calls `syncEngine.processPending()`.
- `sync:report`: read-only summary of all `sync_queue` rows.
- `sync:report-stuck`: read-only report of old pending queue rows.
- `sync:report-cleanup`: read-only report of old completed rows that are cleanup candidates.
- `sync:reset-failed:dry`: dry-run report for resetting failed rows back to pending.
- `sync:reset-failed`: applies the failed-row reset. This must remain manual.
- `sync:cleanup-done:dry`: dry-run report for deleting old completed rows.
- `sync:cleanup-done`: applies deletion of old rows whose status is exactly `done`. This must remain manual.

## What Scripts Must Not Be Used For

- Do not use report scripts as sync triggers.
- Do not use cleanup tools to delete pending or failed rows.
- Do not use reset tools to hide real backend or schema failures.
- Do not use mirror tests as proof that high-risk POS transaction sync is complete.
- Do not run apply-mode cleanup/reset commands casually on a production browser profile.
- Do not treat `transactions.php` storage acceptance as finalized POS sync.

## Remaining Risks

- There is no automatic sync scheduler yet.
- There is no remote pull/hydration path yet.
- There is no conflict UI yet.
- Backend auth is not enforced yet.
- Transaction processing is not production-complete.
- POS stock/accounting/cylinder/payment side effects are not replayed atomically on the backend yet.
- Local `serverId` mirroring currently covers only selected safe entities.
- Tests use local dev browser IndexedDB and local PHP endpoints, not a deployed shared-hosting environment.

## Recommended Next Phase

The safest next phase is stabilization before broader feature sync:

1. Keep using manual/dev replay only.
2. Add backend auth/login and API protection.
3. Add controlled remote pull/hydration planning.
4. Design conflict handling before automatic replay.
5. Only then consider guarded auto-sync behind an explicit startup feature flag or developer setting.

High-risk POS transaction processing should remain separate and should use one atomic backend endpoint that commits or rolls back all related MySQL changes together.

## Rules Before Enabling Auto-Sync

Before any auto-sync is enabled:

- Backend auth must be implemented.
- Conflict policy must be documented and tested.
- Retry/backoff behavior must be designed.
- Sensitive payload logging must remain forbidden.
- Transaction endpoint must become atomic for stock/accounting/cylinder/payment updates.
- Pending/failed/done queue diagnostics must remain available.
- Auto-sync must not process high-risk POS transaction side effects until backend atomic processing is complete.
- Auto-sync must be opt-in or gated during development.
- A rollback/disable switch must exist.

## Dev-Only Settings Manual Replay Trigger

The Settings page now includes a `Developer Sync Replay` section for controlled manual replay.

Available controls:

- `Refresh Counts` reads the local IndexedDB `sync_queue` and shows pending and failed queue counts.
- `Run Manual Replay` calls the real `syncEngine.processPending()` only when the button is clicked.

Displayed diagnostics are intentionally safe and limited to:

- `processed`
- `succeeded`
- `failed`
- `skipped`
- safe error summaries containing queue id, entity, operation, and message only

The UI must not display payload bodies, passwords, auth/session data, customer/supplier bodies, item bodies, or other full record data.

Safety boundaries:

- no auto-sync exists
- no startup replay exists
- no intervals exist
- no online/offline listeners were added
- no polling exists
- the trigger is dev-only/control-only and remains fully manual

Verified results after adding the manual trigger:

- `npx.cmd tsc -b` passed
- `test:transactions:cylinder-mutation` => `46 passed, 0 failed`
- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`


## Brand Sync Plumbing Fix

A local-dev brand sync issue was fixed in the shared low-risk sync plumbing.

What changed:

- Vite dev now falls back to `http://localhost/jawad-bro/api` when the app is running at `http://localhost:5173`.
- `VITE_API_BASE_URL` can still override the API base URL for other environments.
- PHP responses shaped as `{ success, data }` are unwrapped by shared sync normalization before local mirror records are created.
- Queued CRUD payloads now include `localId`, so backend `client_id` mapping is stable for offline-created rows.
- `syncEngine.processPending()` diagnostics now report skipped pending rows when the API is unreachable instead of returning all-zero diagnostics that hide the reason.

UI verification steps:

1. Restart `npm run dev` so Vite picks up the API fallback change.
2. Keep Laragon running and create a brand from the app UI.
3. Verify the brand appears in the MySQL `brands` table. This path may sync immediately and therefore may not leave a pending queue row.
4. Stop Laragon and create another brand from the app UI.
5. Open Settings -> Developer Sync Replay and click `Refresh Counts`; pending count should include the queued brand.
6. Restart Laragon.
7. Click `Run Manual Replay`; the queued brand should replay to MySQL and the local IndexedDB brand should receive `serverId`.

Verified results after the fix:

- `npx.cmd tsc -b` passed
- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`

Safety boundaries remain unchanged:

- no auto-sync was added
- no startup replay was added
- no intervals were added
- no online/offline replay listeners were added
- replay remains manual/dev-triggered only

## Reconciliation Diagnostics

A dev-only reconciliation report is available:

```powershell
npm.cmd run sync:report-reconciliation
```

The script is read-only. It does not call `syncEngine.processPending()`, does not replay queue rows, does not repair IndexedDB, does not mutate backend rows, and does not print payload bodies or passwords.

Reported diagnostic categories:

- `missingServerIds`: local rows that do not currently have a mirrored `serverId`
- `orphanQueueRows`: queue rows that reference missing local rows
- `orphanedPendingRows`: pending queue rows that reference missing local rows
- `duplicateServerIds`: multiple local rows sharing the same `serverId`
- `missingBackendRows`: local rows with `serverId` whose backend row is missing
- `failedReplayRows`: failed local queue rows or failed backend transaction replay rows
- `stuckReplayRows`: local processing queue rows or backend replay rows stuck in processing beyond the threshold
- `countMismatchWarnings`: warning-only local/backend count differences

Current observed findings:

- `sync:report-reconciliation` passed
- `missingServerIds`: `4`
- `orphanQueueRows`: `0`
- `duplicateServerIds`: `0`
- `missingBackendRows`: `0`
- `failedReplayRows`: `144`
- `stuckReplayRows`: `0`
- local `sync_queue` total rows from `sync:report`: `0`

Interpretation:

- The `missingServerIds` likely represent old local rows created before sync plumbing was fixed, or local rows that have not yet been mirrored. They should be inspected before any repair is attempted.
- The `failedReplayRows` are backend dev/test replay failures unless proven otherwise. They are useful for validation history and should not be auto-cleared or auto-repaired.
- Neither finding should be auto-repaired without a read-only detail report and a dry-run repair plan.

Recommended next phase:

1. Create a read-only detail report for `missingServerIds`.
2. Create a read-only detail report for `failedReplayRows`.
3. Create dry-run repair plans based on those reports.
4. Only after review, add explicit `--apply` repair scripts for narrowly scoped fixes.

Verified results:

- `sync:report-reconciliation` passed
- `sync:report` passed with `totalRows: 0`
- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`

Safety boundaries:

- no repair was implemented
- no local IndexedDB mutation was added
- no backend DB mutation was added
- no auto-sync was added
- no listeners, intervals, or startup replay were added
## Controlled ServerId Repair Outcome

A controlled local-only repair tool now exists for high-confidence missing `serverId` rows:

```powershell
npm.cmd run sync:repair-serverids:dry
npm.cmd run sync:repair-serverids
```

The reconciliation and serverId repair tools use a shared dev-only Playwright profile so dry-run, apply, and follow-up reports inspect the same IndexedDB state:

- default profile: `%TEMP%\jawad-bro-sync-tools-profile`
- override: `SYNC_TOOLS_USER_DATA_DIR`

Applied repair:

- `users` local id `1` was patched locally to `serverId: 63`
- match basis: single backend match by `Username`
- confidence: high

Rows intentionally left untouched:

- `customers`: `1` missing `serverId` row
- `settings`: `2` missing `serverId` rows

Those rows had no safe backend match and must not be auto-repaired. Any future repair must start with a fresh read-only report and dry-run plan.

Latest verified reconciliation state after the controlled repair:

- `sync:report-reconciliation` => `missingServerIds: 3`
- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`

Safety boundaries remain unchanged:

- no backend DB rows were mutated
- no rows were deleted
- no replay was triggered
- no auto-sync was added
- no listeners, intervals, or startup replay were added

