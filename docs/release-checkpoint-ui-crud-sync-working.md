# Release Checkpoint: UI CRUD Sync Working

Suggested git tag: `ui-crud-sync-working-before-auto-sync`

## Milestone Summary

Real UI-created low-risk CRUD rows now reach MySQL when the backend is online. This checkpoint records the verified state after fixing the brand sync plumbing that previously made a UI-created brand appear locally while not reaching the Laragon/MySQL `brands` table.

This milestone covers low-risk CRUD sync behavior only. The full backend transaction replay chain is documented separately and is not changed by this checkpoint.

## Brand UI Verification Result

The brand UI path now has a working backend route when Laragon is reachable:

1. The Brands page calls the repository create path.
2. The repository checks API reachability.
3. When the PHP API is reachable, the repository writes the brand to `brands.php`.
4. The PHP response is normalized and mirrored locally with `serverId`.
5. The MySQL `brands` table receives the row.

For offline/API-unreachable cases, the same repository path saves locally and queues a pending `sync_queue` row for later manual replay.

## Online Repository Write Is Not Auto-Sync

An online repository write is a direct user-initiated create/update/delete request made as part of the UI action. It is not background sync.

This checkpoint does not introduce:

- automatic replay
- startup replay
- intervals
- polling
- online/offline replay listeners
- background queue processing

The app still only processes queued rows when a user/developer explicitly triggers replay.

## Manual Replay Purpose

Manual replay is for pending offline rows already stored in IndexedDB `sync_queue`.

When the backend is online and the repository write succeeds immediately, there may be no pending queue row to replay. In that case, Settings -> Developer Sync Replay may correctly report `processed: 0` because there is no pending offline work.

When the backend is offline or unreachable, the repository saves locally, queues a pending row, and manual replay can later send that row to MySQL after the backend is restored.

## API Config Fix Summary

Vite dev now falls back to:

```text
http://localhost/jawad-bro/api
```

when the app is served from:

```text
http://localhost:5173
```

`VITE_API_BASE_URL` can still override this fallback for staging, production, or alternate local paths.

## PHP Response Unwrapping Summary

The PHP endpoints return responses shaped like:

```json
{ "success": true, "data": { ... } }
```

Shared sync normalization now unwraps the `data` object before creating or mirroring local records. This allows online repository writes to preserve returned fields such as `serverId`.

## localId Queue Payload Summary

Queued CRUD payloads now include `localId` in addition to the queue row `localId` metadata.

This keeps offline-created rows stable across replay and supports backend `client_id` mapping for idempotent local-to-server identity.

## Skipped Diagnostics Summary

`syncEngine.processPending()` now reports pending rows as `skipped` when the API is unreachable.

This prevents the confusing all-zero diagnostic case where pending rows existed but replay was skipped because connectivity failed.

Safe skipped diagnostics include only queue metadata such as id, entity, operation, and a safe message. Payload bodies are not displayed.

## Verified Test Results

Current verified low-risk sync results:

- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`

The full backend replay chain remains documented separately and was not modified by this checkpoint.

## Current Safety Boundary

This checkpoint confirms low-risk UI CRUD sync behavior is working without crossing into automatic sync.

Still not enabled:

- auto-sync
- startup replay
- online/offline replay listeners
- background intervals
- production pull/hydration
- conflict UI

Transaction replay and backend business mutations remain governed by their separate replay documentation and tests.

## Rollback Value

This checkpoint is useful as a clean restore point before any future auto-sync or broader frontend replay wiring begins. It captures a state where:

- UI-created low-risk rows can reach MySQL when online
- offline rows can be manually replayed
- diagnostics identify skipped unreachable-API cases
- no automatic replay behavior exists