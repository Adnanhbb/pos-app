# Pull Sync, Hydration, And Conflict Architecture

This document designs future remote-to-local synchronization before any auto-sync, pull-sync, background sync, polling, listeners, startup replay, or multi-device convergence behavior is implemented.

## Current Architecture State

Current sync is primarily push/replay oriented:

- local IndexedDB writes happen first for offline-first behavior
- low-risk CRUD queue rows can be manually replayed to PHP/MySQL
- safe mirrored entities receive `serverId` after successful replay
- Settings has a developer-only manual replay trigger
- backend transaction replay now owns authoritative transaction-side mutations
- CRUD auth can be audited and validated behind config, but enforcement remains default-off
- auto-sync remains disabled

The current architecture is intentionally conservative. It proves local-to-remote writes and backend-authoritative transaction mutation, but it does not yet make multiple devices converge automatically.

## Why Replay-Only Sync Is Insufficient

Replay-only sync sends local changes to the backend, but it does not answer these questions:

- did another device create or update the same entity?
- did another device delete a row locally cached here?
- did backend transaction replay change stock/accounting/batch/cylinder state?
- did this device miss remote changes while offline?
- does the local cache contain stale rows created before serverId mirroring?
- is a local pending row based on an old server version?

Without pull-sync/hydration, a device can successfully push its own changes while still showing stale customers, stale stock, stale settings, or stale transaction-derived balances.

Transaction replay alone is not enough for multi-device correctness because replay mutates authoritative server state, but every other device still needs a safe way to learn those authoritative results.

## Remote Authoritative Hydration Requirements

Hydration must fetch authoritative backend state and update local IndexedDB safely.

Minimum requirements:

- authenticated requests when CRUD auth is enforced
- paginated/windowed reads for large tables
- stable ordering by `updated_at` and `id`
- soft-deleted rows included when needed for delete propagation
- local-only pending rows protected from accidental overwrite
- safe field-level hydration rules per entity
- transaction-derived fields treated as backend-authoritative
- idempotent local writes so repeating hydration is safe
- diagnostics before mutation-capable hydration is enabled

Hydration must never blindly replace all local state while offline work is pending.

## Local/Server Versioning Strategy

Every hydratable backend row should expose:

- `id` / `serverId`
- `client_id` when created from an offline local row
- `updated_at`
- `is_deleted`
- `deleted_at`

Recommended future additions:

- integer `version` incremented server-side on every mutation
- `last_hydrated_at` locally per entity or per sync cursor
- per-row `lastSeenServerVersion` locally
- per-row `lastSyncedAt` locally where schema tolerates it

Initial hydration can use `updated_at` cursors, but long-term conflict detection should prefer server-side monotonically increasing versions. `updated_at` is useful but can be ambiguous across clocks, DB precision, migrations, and manual edits.

## UpdatedAt, Version, And Vector Clock Considerations

`updated_at` is currently available on most backend tables and is the practical first cursor. It should be treated as a server timestamp only.

A future `version` column is safer for conflict checks:

- server increments version atomically
- client records last seen version
- update requests can include expected version
- server can reject stale writes with `409 Conflict`

Vector clocks are likely too heavy for this app right now. They may only be justified if multiple offline devices are expected to edit the same high-value record concurrently and automatic merge is required. The recommended path is simpler: server versions plus entity-specific conflict policy.

## Entity-Level Vs Transaction-Level Hydration

Entity-level hydration applies to low-risk/profile tables:

- units
- taxes
- discounts
- brands
- categories
- expenses
- customers profile fields
- suppliers profile fields
- users safe profile fields
- settings
- held headers if still relevant
- item safe profile fields only

Transaction-level hydration applies to authoritative business state produced by backend replay:

- finalized sales
- sale_items
- stock totals
- customer/supplier accounting summaries
- payment ledger rows
- item batches
- cylinder tables
- customer-cylinder holdings

These two tracks must remain separate. CRUD hydration must not recompute stock or balances. Transaction hydration must consume backend-authoritative outputs from replay.

## Multi-Device Considerations

Multi-device correctness requires every device to eventually learn:

- remote CRUD changes from other devices
- server-assigned ids for rows it created
- soft deletes from other devices
- backend transaction replay results
- auth/session failures that block hydration
- conflicts where local pending work is based on stale remote state

A new device needs bootstrap hydration before it can safely perform online writes. Existing devices need incremental hydration after manual replay and before controlled auto-sync is considered.

## Eventual Consistency Expectations

Offline-first means local work should continue without the server. It does not mean every local value is immediately authoritative.

Expected model:

- local writes are immediately visible locally
- queued writes are pending until remote confirmation
- backend replay is authoritative for transactional state
- hydration eventually brings local caches into alignment
- conflicts are explicit and visible, not silently overwritten

## Stale Local Cache Handling

Stale local rows should be classified before mutation:

- local row has no `serverId` and no queue row: legacy/local-only candidate
- local row has `serverId` but backend row missing: missing backend or deleted remote row
- local row has older version than backend: safe hydration candidate unless local pending update exists
- local row has pending update and backend changed: conflict candidate
- local row soft-deleted locally while backend changed remotely: conflict candidate

Initial tooling should report these states read-only before any repair/hydration apply mode exists.

## Soft-Delete Propagation

Soft deletes must be hydrated deliberately:

- backend `is_deleted = 1` should mark local row deleted where safe
- backend `deleted_at` should be copied locally when present
- local pending updates should not overwrite a remotely deleted row without conflict handling
- local pending delete should be idempotent if backend is already deleted

Hard deletes should be avoided for synced entities until retention and recovery rules are defined.

## Replay Reconciliation After Hydration

Hydration must reconcile with queue state:

- pending local create with matching backend `client_id` can patch `serverId`
- pending local update should check server version before replay
- done queue rows can be cleanup candidates after hydration confirms server state
- failed auth rows should remain repair/retry candidates, not be marked done
- transaction replay results should hydrate authoritative outputs instead of being reconstructed on the client

## Offline-First Guarantees

Hydration must preserve:

- local IndexedDB writes while offline
- local queue creation while offline
- local login fallback where backend is unavailable
- no silent deletion of unsynced local work
- no automatic replay loops
- manual/operator visibility for auth and sync errors

## Bootstrap And New-Device Sync

A new device should follow a safe bootstrap sequence:

1. authenticate user/device
2. hydrate settings and user/session metadata
3. hydrate low-risk reference data
4. hydrate parties and safe item profiles
5. hydrate transaction-derived summaries and ledger views
6. hydrate stock/batches/cylinders using backend-authoritative tables
7. record hydration cursors
8. allow writes only after required baseline data is present

Bootstrap must be restartable and idempotent.

## Pagination And Windowing Strategy

Hydration should avoid loading entire tables indefinitely.

Recommended first strategy:

- `updated_since` cursor
- `limit`
- stable ordering by `updated_at ASC, id ASC`
- next cursor returned by backend
- include soft-deleted rows in cursor windows
- cap page size for shared hosting

Large tables like sales, sale_items, payments, item_batches, and replay audit logs may need date windows in addition to cursor windows.

## Hydration Safety Ordering

Recommended hydration order:

1. auth/session check
2. settings
3. users safe metadata for current actor/allowed scope
4. units, taxes, discounts, brands, categories
5. customers and suppliers profile fields
6. item safe profiles
7. expenses
8. transaction headers and sale_items
9. payments
10. stock/item totals
11. batches
12. cylinders and customer-cylinder holdings
13. replay/audit diagnostics

Transactional derived state should hydrate after the base reference data it depends on.

## Idempotent Hydration Requirements

Hydration apply must be safe to repeat:

- upsert by `serverId`
- preserve local IndexedDB primary key where possible
- patch `serverId` by `client_id` for local-origin rows
- skip or conflict when a local pending update exists
- never duplicate rows on repeated pages
- never duplicate payment/sale/batch/cylinder ledger rows
- record cursors only after page apply succeeds

## Conflict Categories

### CRUD Conflicts

Examples:

- two devices edit a brand/customer name concurrently
- local pending update exists while backend row changed
- remote row deleted while local row changed

Recommended policy:

- low-risk catalog entities: last-server-write wins only when no local pending write exists
- customers/suppliers profile: conflict if local pending write and remote changed
- users/settings: conflict/manual review for concurrent changes

### Transaction Conflicts

Transactions must remain backend-authoritative. The client should not merge transaction effects.

Recommended policy:

- transaction replay idempotency by `clientTransactionId`
- duplicate transaction payload conflict returns `409`
- hydration pulls finalized authoritative transaction outputs

### Stock Conflicts

Stock is backend-authoritative after replay.

Recommended policy:

- client never resolves stock conflicts by arithmetic merge
- hydrate server stock totals
- local pending stock-affecting transactions wait for replay
- insufficient stock remains a replay validation failure, not a hydration merge

### Accounting Conflicts

Accounting summaries are backend-authoritative.

Recommended policy:

- hydrate server `invoices`, `payable`, `paid`, `balance`
- client CRUD mirrors must not overwrite accounting fields
- payment and transaction replay own ledger/accounting mutation

### Batch Conflicts

Batches are backend-authoritative.

Recommended policy:

- hydrate backend batch rows and remaining quantities
- explicit batch conflicts require manual review or server-side replay rejection
- client should not locally rebalance batches after hydration

### Cylinder Conflicts

Cylinder counts and customer holdings are backend-authoritative.

Recommended policy:

- hydrate cylinder rows and customer-cylinder holdings from server
- customer return that exceeds holdings fails replay
- client should not repair cylinder invariant locally

## Recommended Conflict Policy By Entity Type

- units/taxes/discounts/brands/categories: server wins unless local pending write exists
- expenses: server wins unless local pending write exists
- customers/suppliers profile: field-level safe hydration; accounting fields server-only
- users: server safe metadata wins; never hydrate password fields
- settings: server wins, with manual review if local pending settings change exists
- held: hydrate headers only if still operationally needed; do not split held_items unless schema supports it safely
- items: safe profile hydration only; stock fields hydrate from transaction-derived state
- sales/sale_items/payments/batches/cylinders: backend-authoritative transaction hydration only

## Server-Authoritative Vs Client-Authoritative Boundaries

Server-authoritative:

- transaction replay status
- finalized sales and sale_items
- stock totals
- accounting summaries
- payment ledger rows
- batches
- cylinders
- customer-cylinder holdings
- user/session/auth state

Client-authoritative while offline, until replay/hydration:

- unsynced local CRUD drafts
- unsynced local queue rows
- UI-only preferences not synced to backend
- local pending transaction payloads before backend acceptance

The backend replay processor must remain the source of truth for stock/accounting/payment/batch/cylinder mutations.

## Operational Considerations

### Bandwidth Limits

Use pagination, compression where hosting allows, and narrow field selection for diagnostics. Avoid full-table hydration on every app open.

### Retry Behavior

Retries must be bounded and visible. Auth failures should stop hydration/replay until the user signs in again. Network failures should preserve cursors from the last successful page only.

### Crash Recovery

Hydration should record progress after each fully applied page. Partial pages should be retried idempotently. Local queue rows must not be deleted during failed hydration.

### Auth Expiry During Hydration

If auth expires mid-hydration:

- stop further pages
- preserve local data already applied
- show safe auth diagnostics
- do not clear pending queue rows
- do not auto-replay after refresh unless explicitly designed later

### Partial Hydration Rollback

IndexedDB lacks multi-page transaction rollback across the whole hydration job. Therefore each page must be internally atomic and idempotent. Cursors should advance only after the page is applied.

### Observability Requirements

Diagnostics should include:

- last hydration time per entity
- last cursor per entity
- pages applied
- rows inserted/updated/deleted-marked
- conflicts detected
- auth failures
- network failures
- safe row metadata only, no payload/password/token leakage

## Why Auto-Sync Is Still Unsafe

Auto-sync is unsafe until hydration/conflict handling exists because background replay could push local changes while the local cache is stale, auth is expired, or remote deletes/conflicts are unknown.

Without hydration:

- devices do not converge
- stale stock/accounting can be displayed
- remote deletes are missed
- local pending updates can overwrite newer remote values
- transaction replay results are not reflected on other devices

Auto-sync eligibility requires both push replay and pull hydration to be safe.

## No-Go Conditions Before Auto-Sync

Do not enable auto-sync if any of these are true:

- no read-only hydration diagnostics
- no server version or reliable cursor strategy
- no conflict detection for local pending writes
- no soft-delete propagation plan
- no auth expiry behavior for hydration/replay
- no transaction-derived hydration for stock/accounting/batches/cylinders
- no idempotent hydration apply path
- no operator diagnostics for stuck/failed hydration
- no bounded retry strategy
- no rollback/recovery plan for partial hydration

## Phased Roadmap

### Phase 1: Read-Only Hydration Diagnostics

Add reports comparing local and backend state by entity, cursor, version, and soft-delete status. No local mutation.

### Phase 2: Safe Entity Hydration

Implement idempotent hydration for low-risk entities first. Skip rows with local pending changes and report conflicts.

### Phase 3: Soft-Delete Propagation

Hydrate remote soft deletes into local deleted state with diagnostics and pending-write conflict checks.

### Phase 4: Conflict Detection

Add explicit conflict records and manual resolution flows for stale local writes, remote deletes, and transaction-derived mismatches.

### Phase 5: Controlled Background Sync Eligibility

Only after replay, hydration, auth, diagnostics, retry, and conflict handling are stable should controlled background sync be considered.

## Final Boundary

This document is design-only. It does not implement pull-sync, hydration, conflict resolution, auto-sync, startup replay, polling, intervals, online/offline replay listeners, or background workers.
## Read-Only Hydration Diagnostics Foundation

A developer-only read-only hydration divergence report now exists:

```powershell
npm.cmd run sync:report-hydration-divergence
```

Purpose:

- compare backend entity counts with local IndexedDB counts
- detect server rows missing locally
- detect local rows missing remotely
- detect possible `updated_at` / local `updatedAt` divergence where fields exist
- detect soft-delete state mismatches where possible
- provide safe visibility before any hydration apply logic is implemented

Initial scope:

- units
- taxes
- discounts
- brands
- categories
- customers
- suppliers
- settings
- users
- held

Safety boundaries:

- read-only only
- no IndexedDB mutation
- no backend mutation
- no replay triggering
- no hydration apply behavior
- no merge or overwrite behavior
- no payload, password, or token body logging
- uses an Authorization header only if a token already exists in the dev profile, but never prints the token

Diagnostics intentionally come before hydration so divergence can be inspected, classified, and tested before any local cache mutation is allowed. Auto-sync remains disabled.
## Detailed Hydration Divergence Classification

The detailed hydration divergence report is available as:

```powershell
npm.cmd run sync:report-hydration-details
```

It exists to separate harmless dev/test divergence from possible real hydration gaps before any apply path is built. The report adds per-entity counts plus safe row snippets for local-only and remote-only rows, then classifies findings as:

- `likelyDevTestData`
- `likelyNeedsHydration`
- `needsManualReview`

These classifications are diagnostics only. They are not repair instructions, they do not update local data, and they do not hydrate backend rows into IndexedDB. Any future hydration implementation must still add explicit idempotent apply logic, conflict checks, auth handling, rollback/recovery behavior, and tests before automatic sync can be considered.
Checkpoint reference: [release-checkpoint-hydration-diagnostics.md](./release-checkpoint-hydration-diagnostics.md)
## Dry-Run Hydration Planning Foundation

The first hydration planning step is dry-run only:

```powershell
npm.cmd run sync:plan-hydration
```

It turns read-only divergence findings into proposed action categories, but it does not execute them. This deliberately separates planning from apply/merge so conflicts, stale local rows, soft deletes, auth expiry, and security-sensitive entities can be reviewed before any IndexedDB mutation path exists.

The planner is not conflict resolution. `possibleConflict` and `manualReviewRequired` outputs are blockers for automatic apply behavior. Future hydration apply must still be idempotent, authenticated, recoverable after crashes, careful with soft deletes, and tested before controlled background sync can be considered.
Checkpoint reference: [release-checkpoint-hydration-planning.md](./release-checkpoint-hydration-planning.md)

## Controlled Create-Local Hydration Apply

The first hydration apply path now exists, but it is intentionally limited to backend-only rows that the planner classified as `createLocalFromRemote`.

Commands:

```powershell
npm.cmd run sync:hydrate-create-local:dry
npm.cmd run sync:hydrate-create-local
```

Safety model:

- dry-run is the default
- apply requires explicit `--apply`
- only `createLocalFromRemote` actions are applied
- local rows are created with backend `serverId`
- writes go directly to IndexedDB
- repository create/update methods are not called
- `sync_queue` rows are not created
- backend rows are not mutated

Applied result:

- `appliedRows: 7`
- `units` serverIds `70`, `69`
- `taxes` serverId `68`
- `discounts` serverId `39`
- `brands` serverIds `40`, `39`
- `categories` serverId `39`
- `syncQueueCountBefore: 0`
- `syncQueueCountAfter: 0`

Post-apply state:

- `createLocalFromRemote: 0`
- `likelyNeedsHydration: 0`
- `localOnlyRows: 3`
- `missingServerIds: 3`
- `queueRows: 0`

This does not add update hydration, merge hydration, conflict resolution, overwrite behavior, delete behavior, auto-sync, background sync, startup replay, polling, or online/offline listeners.

Checkpoint reference: [release-checkpoint-hydration-create-local-applied.md](./release-checkpoint-hydration-create-local-applied.md)

## Dry-Run Update Hydration Planning

The hydration planner now classifies matched local/backend rows that already have `serverId` values. This remains dry-run only.

Additional update planning classifications:

- `noOpRows`
- `remoteNewerCandidates`
- `localNewerRows`
- `conflictCandidates`
- `timestampMissingRows`

Automatic `updateLocalFromRemote` planning is limited to explicit safe fields for:

- units
- taxes
- discounts
- brands
- categories
- customers profile fields
- suppliers profile fields
- settings safe fields
- held header fields

Explicitly excluded from update planning:

- customer/supplier accounting fields
- passwords, `password`, `Password`, and `password_hash`
- stock fields
- transaction/replay fields
- cylinder quantities
- batch quantities

Rows missing comparable local `updatedAt` or backend `updated_at` are classified as `timestampMissingRows` and `manualReviewRequired`. Rows with equal timestamps and matching safe fields are classified as `noOpRows`. Remote-newer rows with safe field differences can be reported as `updateLocalFromRemote`, but no update apply path exists yet.

Current planner summary:

- `createLocalFromRemote: 0`
- `updateLocalFromRemote: 0`
- `possibleConflict: 0`
- `manualReviewRequired: 884`
- `noOpRows: 7`
- `remoteNewerCandidates: 0`
- `localNewerRows: 0`
- `conflictCandidates: 0`
- `timestampMissingRows: 0`

This does not add update apply, overwrite behavior, merge behavior, conflict resolution, auto-sync, background sync, startup replay, polling, or online/offline listeners.

Checkpoint reference: [release-checkpoint-hydration-update-planning.md](./release-checkpoint-hydration-update-planning.md)

## Manual Review Classification Report

Manual-review hydration rows can now be inspected with:

```powershell
npm.cmd run sync:report-hydration-manual-review
```

The report exists to classify planner rows that are not safe for automatic create/update hydration. It groups rows by entity, reason, suggested disposition, and categories such as:

- `likelyDevTestData`
- `localOnlyUnmatched`
- `remoteOnlyDevTest`
- `timestampMissing`
- `auth/security-sensitive`
- `unsafeEntityOrField`

This is an inspection layer only. It does not apply hydration, does not clean up dev/test rows, does not mutate IndexedDB, does not mutate backend rows, and does not enable auto-sync or background behavior.

Checkpoint reference: [release-checkpoint-hydration-manual-review.md](./release-checkpoint-hydration-manual-review.md)

## Mandatory But Deferred Advanced Sync Phases

Controlled background sync, conflict resolution, and advanced hydration automation are mandatory long-term phases. Deferred does not mean abandoned. These phases are required for mature multi-device production sync, but must wait until production hardening, backup/restore, auth rollout, and operational visibility are stable.

Delivery can proceed with manual/gated sync first, but the architecture must continue reserving room for:

- controlled background low-risk CRUD sync
- authenticated background transaction replay
- conflict detection and resolution
- advanced hydration apply/automation
- multi-device convergence
- operator-visible pause/resume/recovery controls

These phases remain deferred for safety, not skipped.
