# Sync Roadmap And Current Status

This document is the high-level roadmap and status snapshot for the offline sync migration. It summarizes what is complete, what is stabilized, what is intentionally deferred, and what must happen before transactional replay broadens beyond stock, finalized sales/sale_items persistence, accounting summary mutation, and payment ledger persistence.

## Executive Summary

The project now has a stabilized low-risk offline sync foundation. Safe CRUD repositories can queue offline writes, manually replay them, and mirror server ids back into IndexedDB. Developer diagnostics and recovery tooling exist for queue inspection and controlled cleanup.

Transaction ingestion exists as storage through `transactions.php`. Dev replay helpers now validate stored payloads, apply backend-authoritative stock changes to `items.availableStock`, persist finalized `sales`/`sale_items`, update customer/supplier accounting summaries, and persist payment ledger rows; cylinders are now replayed for cylinder/gas items.

Auto-sync is not enabled. `syncEngine` remains manually/dev invoked only.

## Current Stable Capabilities

Stable capabilities include:

- repository-boundary cleanup for UI data access
- shared entity types outside `db.ts`
- sync metadata types
- frontend API client skeleton
- connectivity service skeleton
- IndexedDB `sync_queue` store
- sync queue repository
- manual `syncEngine.processPending()` through dev scripts or the Settings developer replay control
- safe mirror support for selected low-risk entities
- backend PHP/MySQL CRUD endpoints for migrated entities
- backend storage-only transaction ingestion
- transaction idempotency storage
- dev-only sync reports and queue recovery tools
- transaction storage validation tests
- backend replay lock primitives with dev-only tests
- validation-only backend replay skeleton with dev-only tests
- validation-only transaction business-reference checks with dev-only tests
- Terminal-state replay protection for `committed`, `rolled_back`, and `duplicate` rows, with no lock acquisition or attempt increment
- validation-only inventory sufficiency checks for deduction-style transactions with dev-only tests
- in-memory mutation planning with dev-only tests
- backend-authoritative stock mutation replay for `items.availableStock` with dev-only tests
- finalized backend `sales`/`sale_items` persistence atomically with stock replay, with dev-only tests
- backend-authoritative customer/supplier accounting summary mutation atomically with stock and sales replay, with dev-only tests
- backend-authoritative payment ledger persistence atomically with stock, sales, and accounting replay, with dev-only tests
- backend-authoritative batch mutation atomically with stock, sales, accounting, and payment replay, with dev-only tests

## Current Verified Test Counts

Latest verified results:

- `test:sync:low-risk` => `79 passed, 0 failed`
- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:transactions:storage` => `22 passed, 0 failed`
- `test:transactions:locks` => `8 passed, 0 failed`
- `test:transactions:replay-skeleton` => `9 passed, 0 failed`
- `test:transactions:business-validation` => `18 passed, 0 failed`
- `test:transactions:terminal-protection` => `10 passed, 0 failed`
- `test:transactions:inventory-validation` => `15 passed, 0 failed`
- `test:transactions:mutation-planning` => `22 passed, 0 failed`
- `test:transactions:stock-mutation` => `28 passed, 0 failed`
- `test:transactions:sales-persistence` => `26 passed, 0 failed`
- `test:transactions:accounting-mutation` => `29 passed, 0 failed`
- `test:transactions:payment-persistence` => `65 passed, 0 failed`
- `test:transactions:batch-mutation` => `39 passed, 0 failed`
- `test:transactions:cylinder-mutation` => `46 passed, 0 failed`

These tests validate the current safe sync surface and the current backend-authoritative stock, finalized sales/sale_items, accounting summary, and payment ledger replay step. They do not prove full transaction replay is production-ready because cylinders, batches, frontend wiring, and auto-sync remain deferred.

## Safe Mirrored Entities

The current safe mirrored entities are:

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

Mirror writes are local-only, preserve local IndexedDB ids, patch `serverId`, and avoid repository update paths that would enqueue new rows.

## Current Developer Tooling

Current test and report tooling:

```powershell
npm.cmd run test:sync:low-risk
npm.cmd run test:sync:real-low-risk
npm.cmd run test:transactions:storage
npm.cmd run test:transactions:locks
npm.cmd run test:transactions:replay-skeleton
npm.cmd run test:transactions:business-validation
npm.cmd run test:transactions:terminal-protection
npm.cmd run test:transactions:inventory-validation
npm.cmd run test:transactions:mutation-planning
npm.cmd run test:transactions:stock-mutation
npm.cmd run test:transactions:sales-persistence
npm.cmd run test:transactions:accounting-mutation
npm.cmd run test:transactions:payment-persistence
npm.cmd run test:transactions:batch-mutation
npm.cmd run test:transactions:cylinder-mutation
npm.cmd run sync:report
npm.cmd run sync:report-stuck
npm.cmd run sync:report-cleanup
npm.cmd run sync:cleanup-done:dry
npm.cmd run sync:cleanup-done
npm.cmd run sync:reset-failed:dry
npm.cmd run sync:reset-failed
npm.cmd run sync:report-transactions
```

Common environment setup:

```powershell
$env:APP_URL="http://localhost:5173"
$env:API_BASE_URL="http://localhost/jawad-bro/api"
```

## Current Diagnostics And Recovery Tooling

Diagnostics:

- `sync:report`: read-only queue health summary
- `sync:report-stuck`: read-only report of old pending rows
- `sync:report-cleanup`: read-only report of old completed cleanup candidates
- `sync:report-transactions`: read-only backend stored transaction metadata report
- `sync:report-replay-audit`: read-only backend transaction replay audit metadata report

Recovery and cleanup:

- `sync:reset-failed:dry`: dry-run failed queue reset report
- `sync:reset-failed`: manual apply reset from failed to pending
- `sync:cleanup-done:dry`: dry-run report for old completed row cleanup
- `sync:cleanup-done`: manual apply deletion of old rows whose status is exactly `done`

Recovery tools are manual and developer-only. They must not be treated as automatic production recovery.

## Storage-Only Transaction Capabilities

Current transaction storage behavior:

- `transactions.php` accepts `POST` only.
- It validates required top-level fields.
- It accepts only known transaction type values.
- It validates shallow payload shape for sale, return, invoice delete, and payment payloads.
- It stores full payload JSON in `sync_transactions`.
- It stores idempotency metadata in `transaction_idempotency`.
- It records safe storage/audit events in `transaction_replay_audit` for developer inspection.
- It returns `storedOnly: true`.


Current replay lock foundation:

- `acquireReplayLock($pdo, $syncTransactionId, $workerId)` and `releaseReplayLock($pdo, $syncTransactionId, $workerId, $finalStatus = null, $error = null)` exist as backend primitives.
- Lock acquisition currently allows `stored` or `failed` rows and moves them to `processing`.
- Lock acquisition increments `replay_attempts` and sets `locked_at`, `locked_by`, and `replay_started_at`.
- Lock release requires matching worker ownership and clears lock metadata.
- Lock acquire/release/failure events are written to `transaction_replay_audit`.
- These primitives are used by the replay processor but do not inspect payload bodies or mutate business tables by themselves.

Current replay processor foundation:

- `replayStoredTransaction($pdo, $syncTransactionId, $workerId)` exists as a backend replay helper.
- It acquires a replay lock, opens a DB transaction, loads the stored transaction row with `FOR UPDATE`, validates payload shape and matching `clientTransactionId`, checks business references, checks inventory sufficiency, generates a mutation plan, applies stock adjustments, persists finalized sales/sale_items, updates customer/supplier accounting summaries, persists payment ledger rows, writes audit events, commits, and releases the lock.
- `committed` currently means validation, stock mutation, finalized sales/sale_items persistence, customer/supplier accounting summary mutation, payment ledger persistence, backend batch mutation, and cylinder/customer-cylinder mutation committed successfully when applicable. It includes cylinder replay for cylinder/gas items when applicable.
- Terminal replay attempts return safely before lock acquisition and without another attempt increment.
- Malformed stored payloads fail safely, release the lock, and set `replay_error`.
- Only `items.availableStock`, finalized `sales`/`sale_items`, customer/supplier accounting summary fields, and customer/supplier payment ledger rows are mutated by replay.

Current terminal-state protection:

- Terminal states are `committed`, `rolled_back`, and `duplicate`.
- Terminal rows short-circuit before replay lock acquisition.
- `replay_attempts` does not increment for terminal rows.
- No lock is acquired and `locked_at` / `locked_by` are not changed.
- Safe results include `terminalStateSkipped: true`.
- `committed` rows preserve `alreadyCommitted` compatibility.
- Audit event: `replay_terminal_state_skipped`.
- This protection prevents duplicate stock mutation, duplicate finalized sales/sale_items insertion, duplicate accounting summary mutation, and duplicate payment ledger persistence on repeated replay.

Current business-reference behavior:

- `customerId` is checked when provided and must reference an existing, non-deleted customer.
- `supplierId` is checked when provided and must reference an existing, non-deleted supplier.
- `saleItems` or `items` must be arrays when present.
- each item entry must include `originalItemId` or `itemId`.
- referenced items must exist and not be soft-deleted.
- failures roll back the replay DB transaction, set `replay_status` to `failed`, populate `replay_error`, and write `replay_business_validation_failed`.
- full payload bodies are not logged.

Current inventory sufficiency behavior:

- referenced item rows must exist and be active
- deduction quantities must be numeric and greater than zero
- `availableStock` must be present and numeric
- `availableStock` must be sufficient for deduction-style transactions
- stock sufficiency is checked for `Sale` and supplier return / `returnMode: "supplier"`
- purchase-style payloads and customer returns skip stock sufficiency checks because current POS semantics increase stock
- failures roll back the replay DB transaction, set `replay_status` to `failed`, populate `replay_error`, and write `replay_inventory_validation_failed`
- full payload bodies are not logged

Current mutation planning, stock replay, sales persistence, accounting, and payment behavior:

- after validation succeeds, `replayStoredTransaction(...)` returns an in-memory `mutationPlan`
- the plan shape includes `stockAdjustments`, `accountingAdjustments`, `paymentEffects`, `cylinderEffects`, `batchEffects`, and `warnings`
- only `stockAdjustments` are populated and applied currently; accounting summary mutation and payment ledger persistence are derived directly from backend-calculated sale/purchase/return amounts
- stock rules are `Sale` decreases stock, `Purchase` increases stock, `Customer Return` increases stock, and `Supplier Return` decreases stock
- only `items.availableStock` is stock-mutated
- finalized `sales` and linked `sale_items` rows are inserted after stock mutation succeeds
- customer/supplier accounting summaries are updated after sales persistence succeeds
- accounting locks the customer/supplier row with `FOR UPDATE`
- accounting mutates only `invoices`, `payable`, `paid`, and `balance`
- `balance = payable - paid`; `invoices` increments by 1
- `Sale` updates customer summary; `Purchase` updates supplier summary
- `Customer Return` updates customer summary with negative payable/paid deltas
- `Supplier Return` updates supplier summary with negative payable/paid deltas
- backend calculations are used instead of trusting client balance fields
- stock mutation and sales persistence run inside the same backend DB transaction
- failure rolls back stock mutation, sales persistence, accounting summary mutation, and payment ledger persistence
- mutation runs inside the backend DB transaction
- item rows are locked with `FOR UPDATE`
- decreases re-check stock sufficiency immediately before update
- negative stock results are rejected
- any failure rolls back the full DB transaction
- audit events: `replay_mutation_plan_generated`, `replay_stock_mutation_started`, `replay_stock_mutation_completed`, `replay_stock_mutation_failed`, `replay_sales_persistence_started`, `replay_sales_persistence_completed`, `replay_sales_persistence_failed`, `replay_accounting_mutation_started`, `replay_accounting_mutation_completed`, `replay_accounting_mutation_failed`, `replay_payment_persistence_started`, `replay_payment_persistence_completed`, `replay_payment_persistence_failed`

Current payment ledger behavior:

- payment rows are created only when the effective paid amount is non-zero
- `Sale` and customer returns write to `customer_payments`
- `Purchase` and supplier returns write to `supplier_payments`
- return transactions use negative payment amounts
- payment persistence runs in the same backend DB transaction as stock, sales, and accounting
- payment persistence failure rolls back stock, sales, and accounting
- terminal-state protection prevents duplicate payment rows
- missing payment tables are skipped safely for shared-hosting/dev schema compatibility


Current backend batch behavior:

- `item_batches` exists as the backend batch schema foundation.
- `Purchase` creates batch rows.
- `Customer Return` creates/restocks batch rows.
- `Sale` consumes active batches.
- `Supplier Return` decrements/reverses active batches.
- explicit `batchId` is used when present; otherwise consumption is FIFO by purchase date and id.
- legacy payloads with no batch rows and no explicit `batchId` may skip batch mutation safely.
- explicit insufficient batch inventory fails safely.
- batch mutation runs in the same DB transaction as stock, sales, accounting, and payment persistence.
- batch failure rolls back stock, sales, accounting, and payment changes.
- terminal-state protection prevents duplicate batch mutation.
- audit events: `replay_batch_mutation_started`, `replay_batch_mutation_completed`, `replay_batch_mutation_failed`.

Current `transactions.php` storage endpoint alone does not execute replay. Explicit backend replay now can insert finalized sales/sale_items, update customer/supplier accounting summaries, and persist payment ledger rows, and mutate item batch rows. The remaining deferred replay areas are:
- update cylinders
- process finalized returns
- reverse invoices

## Current Architectural Guarantees

Current guarantees:

- UI/pages use repositories rather than direct IndexedDB runtime access for migrated paths.
- Reads remain IndexedDB-first/local for the current app behavior.
- Safe repository writes can queue offline operations.
- Queue failures after successful local writes are non-blocking where helper patterns are used.
- `syncEngine` is not auto-started.
- Transaction payloads are queued as one logical transaction row, not individual stock/accounting rows.
- Low-risk CRUD mirrors are separated from transactional state.
- Customer/supplier accounting fields are not mirrored through profile CRUD.
- User password fields are not mirrored from backend responses.

## Explicitly Deferred Dangerous Areas

Deferred areas:

- invoice deletion/reversal replay
- item create/delete/restore/permanent delete sync
- automatic sync loops
- remote pull/hydration
- conflict UI
- production auth enforcement

## Why Those Areas Are Deferred

These areas are deferred because they are multi-entity transactional mutations.

A single finalized POS operation can affect:

- sales
- sale items
- item stock
- batches
- customer or supplier balances
- payments
- cylinders
- invoice status
- audit/idempotency state

Replaying any one part as generic CRUD can corrupt inventory, accounting, or invoice history. These operations require backend-owned atomic processing, row locking, idempotency, rollback behavior, and conflict handling.

## Current No-Go Boundaries

Do not cross these boundaries yet:

- no automatic replay
- no stock CRUD replay
- no balance CRUD replay
- no client-authoritative inventory
- no client-authoritative balances
- no partial transaction commits
- no transaction replay without locking
- no transaction replay without idempotency
- no transaction replay without auth
- no transaction replay expansion without rollback tests
- no transaction replay without recovery/audit tooling

## Current Known Technical Debt

Known technical debt:

- backend auth is not implemented/enforced
- no production-grade recovery UI exists
- transaction and replay-audit report tooling depends on local PHP CLI access
- replay lock primitives do not yet include stale-lock timeout/recovery policy
- pull/hydration is not implemented
- conflict handling is not implemented
- transaction replay status lifecycle is not fully represented in backend schema
- PHP endpoint test coverage is useful but still local-dev focused
- sync tools are developer scripts, not production operations tooling
- low-risk mirror support is entity-specific and duplicated in places

## Current Known Risks

Known risks:

- enabling auto-sync too early could replay incomplete or unsafe operations
- treating storage-only transaction acceptance as transaction success would be dangerous
- generic CRUD replay for stock/accounting would corrupt data
- backend without auth should not be exposed for production writes
- missing pull/hydration means server truth is not automatically projected back into all local stores
- conflict states are not yet visible in the UI
- local test database can accumulate stored transaction rows over repeated test runs

## Replay Prerequisites

Before transaction replay:

- review `transaction-replay-preflight-checklist.md`
- review `backend-transaction-replay-contract.md`
- implement auth/session checks
- implement row locking or equivalent protection
- wrap replay in one backend DB transaction
- lock idempotency state
- validate current server state
- add rollback tests
- add audit logging
- add safe failure responses
- add conflict policy
- add recovery workflow

## Auto-Sync Prerequisites

Before auto-sync:

- backend auth must exist
- retry/backoff behavior must exist
- diagnostics must remain safe and available
- conflict handling must exist
- transaction replay must be atomic if transactions are included
- pull/hydration must exist for server truth convergence
- auto-sync must be gated by a feature flag or explicit setting
- a disable switch must exist

## Auth Prerequisites

Before production sync:

- login endpoint must be implemented
- session or token strategy must be chosen
- all write endpoints must require auth
- role/permission checks must be enforced
- transaction replay must record authenticated operator context
- password and auth secrets must never appear in sync logs or payload reports

## Future Pull-Sync And Hydration Requirements

Pull/hydration must eventually update IndexedDB from server truth.

Hydration should cover:

- server ids
- updated stock
- batches
- customer/supplier balances
- payment rows
- sales and sale items
- cylinders and customer cylinder holdings
- deleted/soft-deleted records
- conflict resolution state

Hydration must be designed separately from transaction replay.

## Conflict Resolution Requirements

Conflict handling must define behavior for:

- insufficient server stock
- missing item
- missing customer
- missing supplier
- deleted customer/supplier
- missing batch
- missing cylinder
- invoice number collision
- duplicate replay payload mismatch
- return quantity exceeding original sale
- payment amount conflicts

Conflicts must not silently overwrite server state.

## Recommended Next Implementation Phase

The recommended next phase is auth/session hardening and controlled transaction replay wiring design, because the backend replay chain now includes stock, finalized sales/sale_items, accounting, payment ledger, batch, and cylinder/customer-cylinder mutation.

Do not wire frontend transaction replay or auto-sync until auth, idempotency, locking, rollback tests, replay audit reporting, conflict handling, and pull/hydration strategy remain clean around the full backend replay chain.

## Recommended Implementation Order

1. Keep low-risk sync stabilized.
2. Implement backend auth/session model.
3. Protect write endpoints.
4. Extend transaction replay schema/status fields if needed.
5. Add backend row locking/idempotency locking skeleton.
6. Add DB transaction wrapper tests.
7. Add read-only transaction business validation against server state.
8. Narrow sale/purchase/return replay now persists stock plus finalized sales/sale_items without batches/cylinders.
9. Stock mutation under backend transaction is implemented for planned stock adjustments.
10. Finalized sales/sale_items persistence under backend transaction is implemented.
11. Customer/supplier accounting mutation under backend transaction is implemented.
12. Add payment mutation under backend transaction.
13. Batch handling under backend transaction is implemented.\r\n14. Add cylinder handling.
15. Add invoice deletion/reversal.
16. Add pull/hydration.
17. Add conflict UI/workflow.
18. Add controlled auto-sync only after the above is stable.

## Explicit Anti-Patterns To Avoid

Avoid:

- generic CRUD replay for inventory
- generic CRUD replay for balances
- client-authoritative stock mutation
- client-authoritative accounting balances
- partial commit acceptance
- replay without locking
- replay without idempotency
- replay without auth
- replay without audit logs
- hiding failed transactions by deleting queue rows
- marking transaction queue rows done without backend acceptance
- adding auto-sync before replay and conflict handling are safe

## Recommended Release And Staging Strategy

Recommended rollout:

1. Keep all transaction replay disabled in production.
2. Use local dev tests for storage and validation only.
3. Add staging environment with separate database.
4. Test auth-protected low-risk sync in staging.
5. Test transaction replay with synthetic data only.
6. Test rollback failures intentionally.
7. Test duplicate replay intentionally.
8. Test pull/hydration against known server state.
9. Enable manual replay in staging before any auto-sync.
10. Enable auto-sync only behind a feature flag after repeated clean staging runs.

## Reference Documents

- [Sync Stabilization Status](sync-stabilization-status.md)
- [Transaction Sync Architecture](transaction-sync-architecture.md)
- [Transaction Payload Reference](transaction-payload-reference.md)
- [Transaction Replay Preflight Checklist](transaction-replay-preflight-checklist.md)
- [Backend Transaction Replay Contract](backend-transaction-replay-contract.md)

## Final Snapshot

The backend replay chain is complete for the current stock, finalized sales/sale_items, accounting, payment ledger, batch, and cylinder/customer-cylinder mutation layers. It is ready for careful auth/session hardening and transaction replay wiring design, but it is not ready for automatic sync.

## Current Backend Cylinder Replay

Backend replay now includes authoritative cylinder/customer-cylinder mutation for cylinder/gas items.

Current cylinder behavior:

- detection uses item category containing `gas` or `cylinder`, or an existing `cylinders` row
- non-cylinder items skip safely
- `Sale` decreases filled cylinders, increases with-customer cylinders, and creates or updates customer holding
- `Customer Return` decreases with-customer cylinders, increases empty cylinders, and reduces customer holding
- `Purchase` increases filled cylinders and total cylinder stock
- `Supplier Return` decreases filled cylinders and total cylinder stock
- cylinder and customer-cylinder rows are locked with `FOR UPDATE`
- replay enforces `qtyInStock = filledCylinders + emptyCylinders + withCustomers`
- failures roll back the full replay chain
- terminal-state protection prevents duplicate cylinder mutation

Verified result:

- `test:transactions:cylinder-mutation` => `46 passed, 0 failed`

Still not implemented after the full backend replay chain:

- frontend/`syncEngine` transaction replay wiring
- auth/session hardening
- pull/hydration
- conflict resolution
- auto-sync

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




## Brand Sync Plumbing Fix Snapshot

The low-risk CRUD sync plumbing now includes a specific local-dev fix verified against brand creation from the UI.

Fix details:

- Vite dev defaults to `http://localhost/jawad-bro/api` when served from `http://localhost:5173`.
- `VITE_API_BASE_URL` remains the environment override and should be used for staging, production, or alternate local paths.
- Shared sync normalization unwraps PHP `{ success, data }` responses before applying local mirrors or storing remote-created records.
- Queued CRUD payloads include `localId`, preserving stable offline `client_id` mapping during replay.
- `processPending()` diagnostics now count pending rows as `skipped` with safe error summaries when the API is unreachable.

Manual UI verification:

1. Restart `npm run dev`.
2. With Laragon running, create a brand in the app and verify the MySQL `brands` table.
3. Stop Laragon, create a second brand, and verify Settings -> Developer Sync Replay shows a pending row after `Refresh Counts`.
4. Restart Laragon and run manual replay.
5. Verify the second brand appears in MySQL and the local row receives `serverId`.

Verified results:

- `npx.cmd tsc -b` passed
- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`

This fix does not change the roadmap boundary: sync remains manual/dev-triggered, with no auto-sync, no startup replay, no intervals, and no online/offline replay listeners.

## Reconciliation Diagnostics Snapshot

The roadmap now includes a dev-only reconciliation report:

```powershell
npm.cmd run sync:report-reconciliation
```

This report is read-only and exists to identify local/backend sync inconsistencies before any auto-sync or repair tooling is introduced. It does not replay queue rows, does not call `syncEngine.processPending()`, does not mutate IndexedDB, does not mutate MySQL, and does not print payload bodies or passwords.

Diagnostic categories:

- `missingServerIds`
- `orphanQueueRows`
- `orphanedPendingRows`
- `duplicateServerIds`
- `missingBackendRows`
- `failedReplayRows`
- `stuckReplayRows`
- `countMismatchWarnings`

Current observed findings:

- `sync:report-reconciliation` passed
- `missingServerIds`: `4`
- `orphanQueueRows`: `0`
- `duplicateServerIds`: `0`
- `missingBackendRows`: `0`
- `failedReplayRows`: `144`
- `stuckReplayRows`: `0`
- local `sync_queue` total rows from `sync:report`: `0`

Classification:

- `missingServerIds` likely represent old local rows created before sync plumbing was fixed, or local rows not yet mirrored. These need inspection, not automatic repair.
- `failedReplayRows` are expected to include backend dev/test replay failures from validation, rollback, insufficient-stock, and cylinder/batch failure scenarios. These should be treated as test/development history unless proven to be production data.
- `orphanQueueRows`, duplicate `serverId`s, missing backend rows, and stuck replay rows are currently not observed.
- Local/backend count mismatch warnings can be normal in the current architecture because IndexedDB is a partial local cache and MySQL contains rows from repeated dev/test runs.

Recommended next phase:

1. Add read-only detail reporting for `missingServerIds`.
2. Add read-only detail reporting for `failedReplayRows`.
3. Draft dry-run repair plans only after detail reports are reviewed.
4. Add explicit `--apply` repair scripts only for narrowly scoped, reviewed fixes.

Verified results:

- `sync:report-reconciliation` passed
- `sync:report` passed with `totalRows: 0`
- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`

No repair, mutation, auto-sync, listeners, intervals, or startup replay were added.
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


## Auth/Session Foundation Status

A backend auth/session foundation now exists for future replay and CRUD authorization. `api/lib/auth.php` supports shared-hosting friendly bearer tokens from either `REPLAY_WORKER_TOKEN` or hashed rows in `api_auth_tokens`. The authorized replay wrapper validates replay actors before calling the existing replay processor, and unauthorized callers do not acquire locks or increment replay attempts.

Replay audit attribution is available through optional `transaction_replay_audit` columns: `actor_type`, `actor_id`, `actor_role`, and `session_id`. Raw tokens, passwords, and payload bodies must not be logged.

This is foundation-only. CRUD endpoints are not auth-enforced yet, frontend login still uses the existing local app flow, and auto-sync remains disabled. No startup replay, intervals, polling, online/offline listeners, or background replay were added.

Related document: [backend-auth-session-foundation.md](./backend-auth-session-foundation.md)

Checkpoint reference: [release-checkpoint-replay-auth-foundation.md](./release-checkpoint-replay-auth-foundation.md)

## CRUD Optional Auth Audit Mode

Low-risk CRUD endpoints now include optional auth audit mode. This parses bearer tokens when present and exposes safe auth status metadata without enforcing auth yet. Existing sync and manual replay flows remain compatible.

Current behavior:

- no auth header: request proceeds and is marked `absent`
- valid bearer token: request proceeds and safe actor metadata is available
- invalid bearer token: request still proceeds for now and is marked `invalid`
- no payload bodies, passwords, raw tokens, or full records are logged

Hard CRUD auth enforcement is intentionally deferred. Auto-sync remains disabled.

Verified result:

- `test:crud:auth-audit` covers optional absent/valid/invalid auth behavior.

Checkpoint reference: [release-checkpoint-crud-auth-audit-mode.md](./release-checkpoint-crud-auth-audit-mode.md)

## Frontend Auth Token Plumbing Status

Frontend token plumbing now exists in preparation for future hard CRUD auth enforcement:

- `getAuthToken()`, `setAuthToken()`, and `clearAuthToken()` are available in `src/api/authToken.ts`.
- `apiClient` sends `Authorization: Bearer <token>` only when a token exists.
- missing tokens still work because backend CRUD auth remains audit-only.
- invalid tokens still do not block CRUD yet because hard enforcement is deferred.
- offline IndexedDB writes and sync queue creation are unchanged.
- manual replay diagnostics can display safe auth-related failures if future `401` or `403` responses occur.

Auto-sync remains disabled. No startup replay, listeners, polling, or intervals were added.

Checkpoint reference: [release-checkpoint-frontend-token-plumbing.md](./release-checkpoint-frontend-token-plumbing.md)

## CRUD Auth Enforcement Flag Status

A backend config flag now exists for future hard CRUD auth enforcement:

```text
CRUD_AUTH_ENFORCEMENT=true
```

Default remains audit-only. With the flag off, missing and invalid auth are still allowed. With the flag on, protected CRUD endpoints reject missing or invalid auth with safe `401` responses while valid bearer auth proceeds.

`health.php` remains public. The flag does not change transaction replay semantics and does not enable auto-sync.

Checkpoint reference: [release-checkpoint-crud-auth-enforcement-flag.md](./release-checkpoint-crud-auth-enforcement-flag.md)

## Dev-Only Settings Auth Diagnostics

The Settings Developer Sync Replay section now includes safe auth diagnostics:

- token present: yes/no
- backend enforcement: on/off/unknown
- backend auth status: absent/valid/invalid/unknown
- last replay auth status for future 401/403 failures
- safe actor metadata when available

No raw token, password, payload body, or full record is displayed. This does not add login UI, does not enable enforcement, and does not add auto-sync.

Checkpoint reference: [release-checkpoint-auth-diagnostics-visibility.md](./release-checkpoint-auth-diagnostics-visibility.md)

## Login/Session Flow Foundation Status

A minimal production-oriented login/session lifecycle now exists without enabling hard CRUD auth enforcement or auto-sync.

Backend endpoints:

- `POST /api/login.php` validates `users.username` and `users.password_hash` with `password_verify(...)`.
- `POST /api/logout.php` revokes only the presented bearer token.
- `GET /api/session.php` validates the bearer token and returns safe actor metadata.

Token lifecycle:

- successful login creates an `api_auth_tokens` row with only a SHA-256 token hash stored server-side.
- the raw token is returned once to the frontend and stored through the existing token helper.
- logout clears the frontend token and revokes the backend token when reachable.
- no passwords, password hashes, payload bodies, or raw tokens are displayed in diagnostics or returned from session metadata.

Frontend behavior:

- `authRepository` attempts backend login first, then preserves local IndexedDB login fallback for offline-first operation.
- app session restoration can validate an existing token through `session.php`.
- session restoration does not call `syncEngine.processPending()` and does not replay queues.
- Settings auth diagnostics continue to show token/enforcement/auth status safely.

Current boundaries remain unchanged:

- CRUD auth is still not globally hard-enforced.
- `CRUD_AUTH_ENFORCEMENT` remains default-off/audit-only.
- no auto-sync, startup replay, listeners, intervals, or polling were added.

Verified results:

- `test:auth:session` => `12 passed, 0 failed`
- `test:frontend:auth-token` => `18 passed, 0 failed`
- `test:crud:auth-audit` => `9 passed, 0 failed`
- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`
Checkpoint reference: [release-checkpoint-login-session-foundation.md](./release-checkpoint-login-session-foundation.md)

## Dev/Staging CRUD Auth Enforcement Validation

A dev/staging-only validation flow now exercises hard CRUD auth enforcement without enabling it by default.

Validated behavior when `CRUD_AUTH_ENFORCEMENT` is enabled in a controlled PHP test server:

- authenticated CRUD requests with a valid bearer token succeed
- missing-token CRUD requests receive safe `401` responses
- invalid-token CRUD requests receive safe `401` responses
- `health.php` remains public
- response bodies and diagnostics do not leak raw tokens, passwords, payload bodies, or full records

Offline-first validation:

- local IndexedDB writes still succeed without a token
- pending `sync_queue` rows can still be created locally without a token
- manual replay against an auth-enforced backend returns safe auth diagnostics instead of marking the row done
- the replay diagnostic includes safe `401`/`authError` metadata
- the queue row remains not-done with a safe authentication-required message

Frontend safety expectations:

- `401` maps to an authentication-required message
- `403` maps to an insufficient-permission message
- manual replay does not silently auto-logout the user
- manual replay does not start retry loops
- duplicate clicks are blocked while replay is running
- no auto-sync, startup replay, intervals, or online/offline replay listeners are added

This validation flow is for dev/staging readiness only. `CRUD_AUTH_ENFORCEMENT` remains default-off/audit-only until explicitly enabled in a controlled environment.

Verified results:

- `test:crud:auth-enforcement` validates enforcement on/off behavior plus offline queue/auth-failure diagnostics.
- `test:frontend:auth-token` validates frontend auth failure handling and no token leakage.
Checkpoint reference: [release-checkpoint-crud-auth-enforcement-validation.md](./release-checkpoint-crud-auth-enforcement-validation.md)

## Pull-Sync/Hydration Architecture Design Status

The pull-sync, hydration, and conflict-resolution architecture is now designed but not implemented. See [pull-sync-hydration-conflict-architecture.md](./pull-sync-hydration-conflict-architecture.md).

Key status:

- replay-only sync is documented as insufficient for multi-device correctness
- backend-authoritative transaction replay remains the source of truth
- hydration/conflict handling is required before auto-sync
- planned phases are read-only hydration diagnostics, safe entity hydration, soft-delete propagation, conflict detection, and controlled background sync eligibility
- no pull-sync implementation exists yet
- no auto-sync, startup replay, polling, online/offline replay listeners, or background workers exist yet

Checkpoint reference: [release-checkpoint-pull-sync-architecture.md](./release-checkpoint-pull-sync-architecture.md)
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
## Detailed Hydration Divergence Report

A second developer-only hydration report now provides per-entity detail and classification hints:

```powershell
npm.cmd run sync:report-hydration-details
```

The report breaks down each scoped entity by:

- `localCount`
- `remoteCount`
- `localOnlyCount`
- `remoteOnlyCount`
- `possibleDivergenceCount`
- `softDeleteMismatchCount`

For `localOnly` and `remoteOnly` rows, it prints safe metadata only: entity, local/server id, safe label fields such as name/key/invoice number, delete flags, and update timestamps where present. It never prints payload bodies, passwords, raw tokens, or full sensitive records.

Classification hints are intentionally advisory only:

- `likelyDevTestData` means the safe label or identifier resembles known dev/test data.
- `likelyNeedsHydration` means an active backend-only row has no obvious dev/test marker and may represent data a future hydration phase should consider.
- `needsManualReview` means the row or divergence should not be repaired or hydrated without inspection.

This tooling is still read-only. It does not mutate IndexedDB, mutate backend rows, repair records, trigger replay, apply hydration, start background sync, add listeners, or enable auto-sync.
Checkpoint reference: [release-checkpoint-hydration-diagnostics.md](./release-checkpoint-hydration-diagnostics.md)
## Dry-Run Hydration Planning Foundation

A developer-only dry-run hydration action planner now exists:

```powershell
npm.cmd run sync:plan-hydration
```

The planner compares local IndexedDB rows with backend rows for the current hydration scope and calculates what a future hydration apply step might do. It does not apply those actions.

Dry-run action categories:

- `createLocalFromRemote`
- `updateLocalFromRemote`
- `possibleConflict`
- `skipSoftDeleted`
- `skipLocalNewer`
- `skipRemoteOlder`
- `manualReviewRequired`

Planning rules are intentionally conservative:

- newer backend rows may be planned as local updates only when timestamps are available and no conflict is detected
- backend-only active rows without obvious dev/test markers may be planned as local creates
- local-only rows are always manual review and are never overwritten or deleted by the planner
- soft-deleted backend-only rows are skipped
- user rows do not plan auth/session/security field overwrites
- suspicious or ambiguous cases are classified for manual review

This is still not hydration apply. It performs no IndexedDB writes, no backend writes, no replay, no repair, no merge, no conflict resolution, no background sync, no startup replay, no polling, and no online/offline listeners. Auto-sync remains disabled.
Checkpoint reference: [release-checkpoint-hydration-planning.md](./release-checkpoint-hydration-planning.md)

## Controlled Create-Local Hydration Apply

A controlled hydration apply tool now exists for the first narrow hydration mutation path:

```powershell
npm.cmd run sync:hydrate-create-local:dry
npm.cmd run sync:hydrate-create-local
```

The dry-run command is the default safety path. The apply command requires explicit `--apply` and only creates local IndexedDB rows for planner actions where `action = createLocalFromRemote`.

Current boundaries:

- no `updateLocalFromRemote` apply
- no overwrite behavior
- no delete behavior
- no conflict resolution
- no `manualReviewRequired` hydration
- direct IndexedDB writes only
- no repository `create()` / `update()` calls
- no `sync_queue` rows created
- no backend mutation
- no replay triggering
- no auto-sync, background sync, startup replay, polling, or online/offline listeners

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

Checkpoint reference: [release-checkpoint-hydration-create-local-applied.md](./release-checkpoint-hydration-create-local-applied.md)

## Dry-Run Update Hydration Planning

`sync:plan-hydration` now includes dry-run classifications for matched rows that already have `serverId`.

Additional summary fields:

- `noOpRows`
- `remoteNewerCandidates`
- `localNewerRows`
- `conflictCandidates`
- `timestampMissingRows`

Safe update planning is limited to:

- units
- taxes
- discounts
- brands
- categories
- customers profile fields only
- suppliers profile fields only
- settings safe fields
- held header fields only

Excluded fields remain out of update planning:

- customer/supplier accounting fields
- passwords and password hashes
- stock fields
- transaction/replay fields
- cylinder quantities
- batch quantities

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

This is still planning only. It does not apply updates, overwrite local rows, resolve conflicts, mutate backend rows, trigger replay, or add auto-sync/background sync/startup replay/listeners.

Checkpoint reference: [release-checkpoint-hydration-update-planning.md](./release-checkpoint-hydration-update-planning.md)

## Hydration Manual Review Classification Report

A read-only manual review classifier now exists:

```powershell
npm.cmd run sync:report-hydration-manual-review
```

Purpose:

- break down `manualReviewRequired` hydration rows before any cleanup or hydration decision
- separate likely dev/test backend noise from possible real production candidates
- provide safe metadata and suggested dispositions only

Classification groups:

- `likelyDevTestData`
- `localOnlyUnmatched`
- `remoteOnlyDevTest`
- `timestampMissing`
- `auth/security-sensitive`
- `unsafeEntityOrField`

Suggested dispositions are advisory only:

- `keep`
- `ignoreDevTest`
- `reviewForHydration`
- `reviewForCleanup`

The report never prints passwords, tokens, payload bodies, full customer bodies, full user bodies, or auth/session data. It does not mutate IndexedDB, mutate backend rows, apply hydration, delete/cleanup rows, trigger replay, or add auto-sync/background sync/startup replay/listeners.

Checkpoint reference: [release-checkpoint-hydration-manual-review.md](./release-checkpoint-hydration-manual-review.md)

## Auto-Sync Eligibility Gate

The controlled auto-sync eligibility gate is documented in [auto-sync-eligibility-gate.md](./auto-sync-eligibility-gate.md).

The gate defines the runtime checks and product rules required before any automatic sync, background sync, startup replay, polling, online/offline listeners, or background worker behavior can be considered. It keeps the current system manual-only and requires a default-deny decision model for future automation.

The gate requires, at minimum:

- authenticated user/session state
- known CRUD auth enforcement state
- reachable backend
- healthy local `sync_queue`
- no stale replay locks
- no unresolved dangerous reconciliation findings
- no unsafe hydration planner actions
- recent successful manual replay baseline
- no active POS billing/cart transaction
- operator-visible sync status and pause/disable control

The future allowed scope is phased:

- Phase 0: manual only, current state
- Phase 1: dev-only one-click safe sync all
- Phase 2: throttled background low-risk CRUD only
- Phase 3: authenticated transaction replay background sync
- Phase 4: controlled hydration background sync

This is design-only. No auto-sync, background sync, startup replay, polling, online/offline listeners, or background worker behavior exists yet.

## Read-Only Auto-Sync Eligibility Evaluator

A dev-only/manual gate evaluator now exists:

```powershell
npm.cmd run sync:evaluate-auto-sync
```

It reports whether future auto-sync would be allowed based on auth, backend reachability, local queue health, replay lock health, reconciliation state, hydration safety, and active POS transaction detectability.

The evaluator is read-only and does not trigger replay, call `syncEngine.processPending()`, apply hydration, mutate IndexedDB/backend rows, start polling, add listeners, run background workers, or enable auto-sync.

## Auto-Sync Evaluator Checkpoint

The read-only auto-sync evaluator checkpoint is documented in [release-checkpoint-auto-sync-evaluator.md](./release-checkpoint-auto-sync-evaluator.md).

Current evaluator state remains blocked with `allowed: false`. This is expected because auth, failed replay rows, hydration manual-review rows, and active POS/cart detectability still need explicit resolution before any auto-sync phase can be considered.

## POS Activity Safety Signal

A read-only POS activity signal now exists for auto-sync safety tooling. The POS flow records only safe activity metadata: `active`, `startedAt`, and `source`. Settings Developer Sync Replay displays POS active status without cart contents, customer data, payment details, or item details.

`sync:evaluate-auto-sync` now uses this signal instead of treating POS activity as permanently unknown. Future auto-sync remains blocked whenever POS activity is active.

This is status-only foundation work. It does not trigger replay, apply hydration, mutate transaction data, add polling/listeners/background workers/startup replay, or enable auto-sync.

## POS Activity Sync Gate Checkpoint

The POS activity safety gate checkpoint is documented in [release-checkpoint-pos-activity-sync-gate.md](./release-checkpoint-pos-activity-sync-gate.md).

The active POS/cart signal now exists for future auto-sync eligibility checks. Current evaluator state reports POS activity as detectable and idle. Future auto-sync must block whenever POS activity is active.

## Manual Replay Auth Gate

Settings Developer Sync Replay now performs an auth/session gate before manual replay starts. When CRUD auth enforcement is on, missing or invalid sessions block manual replay before `syncEngine.processPending()` is called. When enforcement is off/audit-only, manual replay remains allowed and displays auth diagnostics.

The gate exposes safe states only: `authenticated`, `unauthenticated`, `authUnknown`, and `enforcementDisabled`. It records the last gate result and session validation timestamp without showing tokens, passwords, or sensitive session bodies.

This does not enable auto-sync, background replay, polling, listeners, startup replay, automatic retries, or hydration apply.

## Authenticated Manual Replay Gate Checkpoint

The authenticated manual replay gate checkpoint is documented in [release-checkpoint-authenticated-manual-replay-gate.md](./release-checkpoint-authenticated-manual-replay-gate.md).

Manual replay now validates auth/enforcement before `syncEngine.processPending()` is called. This keeps replay explicit and operator-controlled while preparing for future auth-enforced environments. No auto-sync or background replay exists.

## Consolidated Offline-First Sync Architecture Status

A consolidated high-level architecture/status reference now exists: [offline-first-sync-architecture-status.md](./offline-first-sync-architecture-status.md).

It summarizes the current local-first IndexedDB model, backend-authoritative replay chain, auth/session architecture, manual replay gates, reconciliation tooling, hydration status, auto-sync eligibility gate, POS activity safety gate, operational blockers, and future phased rollout. It is documentation-only and does not change runtime behavior.

## Consolidated Sync Architecture Baseline Checkpoint

The final consolidation checkpoint is documented in [release-checkpoint-consolidated-sync-architecture.md](./release-checkpoint-consolidated-sync-architecture.md).

It marks [offline-first-sync-architecture-status.md](./offline-first-sync-architecture-status.md) as the current stable architecture baseline before any auto-sync, background sync, update hydration, or conflict-resolution work begins.

## Failed Replay Archival Planning

A dry-run archival planner now exists for historical failed backend replay rows:

```powershell
npm.cmd run sync:plan-archive-failed-replays
```

It classifies failed replay rows as `archiveCandidateDevTest`, `keep`, or `manualReviewRequired` using safe metadata only. It is planning-only and does not archive, delete, update, replay, mutate backend rows, mutate IndexedDB, or enable auto-sync.

## Failed Replay Dev/Test Archival Outcome

The failed replay archival flow has moved from planning to one controlled manual apply for rows classified as dev/test noise.

Available commands:

```powershell
npm.cmd run sync:archive-failed-replays:dry
npm.cmd run sync:archive-failed-replays
```

Safety rules:

- dry-run is the default path
- apply requires explicit `--apply`
- the tool recomputes the plan internally
- only `archiveCandidateDevTest` rows are archived
- `keep` and `manualReviewRequired` rows are left untouched
- rows are not deleted
- audit rows are not deleted
- IndexedDB is not mutated
- replay is not triggered
- auto-sync/background sync/startup replay/listeners remain absent

Applied result:

- dry-run gate matched exactly: `archiveCandidateDevTest: 140`, `keep: 6`, `manualReviewRequired: 0`
- `140` rows were marked with `replay_status = archived_dev_test`
- `140` audit events were inserted with event type `failed_replay_archived_dev_test`
- remaining failed replay rows: `6`

Post-apply status:

- `sync:plan-archive-failed-replays` => `totalFailedRows: 6`, `archiveCandidateDevTest: 0`, `keep: 6`
- `sync:report-failed-replay-details` => `totalFailedRows: 6`
- `sync:evaluate-auto-sync` => `allowed: false`, `failedReplayRows: 6`

Auto-sync remains blocked. The remaining six failed replay rows require manual review or a later explicit plan; they were not archived by this tool.

Checkpoint reference: [release-checkpoint-failed-replay-archival.md](./release-checkpoint-failed-replay-archival.md)

## Remaining Failed Replay Manual-Review Blockers

The final `6` non-archived failed replay rows have a dedicated dry-run repair plan:

```powershell
npm.cmd run sync:plan-repair-duplicate-sales-failures
```

Planner result:

- `totalDuplicateSalesFailures: 6`
- all rows are classified as `duplicateFinalizedSalesRow`
- each row has one linked finalized `sales` row
- `saleItemsCount: 0` for each row
- no linked payment rows
- no linked batch rows
- audit lacks completed replay-chain evidence
- retry would likely fail again because the `sales.sync_transaction_id` unique key already exists
- proposed action: `manualReviewRequired`
- confidence: `medium`

The planner intentionally does not propose `markReplayCommittedHistorical`. A linked sales row alone is not enough evidence that the full replay chain committed. Marking these rows committed automatically could hide incomplete stock, sale item, accounting, payment, batch, or cylinder effects.

Recommended future handling:

- inspect the rows manually
- treat them as unresolved blockers for auto-sync
- do not auto-replay them
- optionally archive them later as historical failed implementation-test rows only after explicit human confirmation
- keep auto-sync blocked unless a future gate policy explicitly excludes documented historical manual-review rows

Checkpoint reference: [release-checkpoint-remaining-failed-replay-manual-review.md](./release-checkpoint-remaining-failed-replay-manual-review.md)

## Backup, Restore, And Migration Strategy

The backup/restore/migration strategy is documented in [backup-restore-migration-strategy.md](./backup-restore-migration-strategy.md).

This is a prerequisite architecture plan before any production auto-sync rollout. It defines how future tooling should handle IndexedDB exports, backend MySQL backups, sync metadata, queues, replay/audit history, auth/session restore policy, schema compatibility, rollback, and restore verification.

Important boundaries:

- export-only IndexedDB/MySQL backup tooling and validation/checksum tooling exist
- no IndexedDB or backend data is mutated by the strategy
- stale replay queues must never be restored blindly
- expired tokens and active sessions must not be restored
- partial transactional state must not be restored automatically
- server-authoritative transaction, stock, accounting, payment, batch, cylinder, replay, and auth state must remain backend-owned

Auto-sync remains disabled.

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
## Backup Export And Validation Checkpoint

Export-only backup and validation tooling is documented in [release-checkpoint-backup-export-validation.md](./release-checkpoint-backup-export-validation.md).

Available commands:

```powershell
npm.cmd run backup:indexeddb:export
npm.cmd run backup:mysql:export
npm.cmd run backup:validate -- backups/<backup-file>.json
```

Current validation status:

- IndexedDB backup `ok: true`
- MySQL backup `ok: true`
- count mismatches: `0`
- unsafe sensitive fields: `0`

The validator computes SHA-256 checksums and checks structure/count/sensitive-field leakage only. It does not prove restore success. Restore/import remains unimplemented, and no backup tooling triggers replay, hydration, IndexedDB/backend mutation, auto-sync, startup replay, polling, listeners, or background sync.
## Deployment And Environment Hardening Strategy

Production deployment and environment hardening is documented in [deployment-and-environment-hardening-strategy.md](./deployment-and-environment-hardening-strategy.md).

The strategy defines shared hosting versus VPS tradeoffs, production topology, frontend/backend deployment flows, MySQL operational requirements, environment variable and API URL strategy, HTTPS/TLS requirements, production auth/security expectations, backup scheduling, replay/audit retention, lock operations, storage growth, rate limiting, feature flags, rollback, migrations, disaster recovery, multi-device rollout, mobile/Capacitor considerations, and a phased rollout plan.

The current deployment strategy is design-only. No deployment automation, CI/CD, infrastructure automation, runtime behavior change, auto-sync, startup replay, polling, listeners, or background sync was added.
## Production Operational Tooling Strategy

Production operational/admin tooling is designed in [production-operational-tooling-strategy.md](./production-operational-tooling-strategy.md).

The plan defines read-only-first visibility for replay health, queue health, auth/session state, backup validation, hydration/reconciliation, auto-sync eligibility, POS activity, deployment verification, replay audit exploration, replay locks, failed replay investigation, storage growth, support workflow, and future background-sync operations.

Key boundary: operators should not directly mutate stock, balances, finalized sales, payment ledgers, batch balances, cylinder counts, replay payloads, idempotency hashes, or auth token records. Future mutation tools must follow report -> dry-run plan -> explicit apply -> audit/checkpoint.

This is documentation/design only. No dashboards/tools, runtime behavior changes, polling, listeners, startup replay, background workers, or auto-sync were added.
## Developer Control Panel Architecture

The future protected developer-support-only UI is designed in [developer-control-panel-architecture.md](./developer-control-panel-architecture.md).

The panel is intended for authenticated DB-backed users with exact role `Dev` only and should not expose advanced sync internals to admin or normal staff. Proposed sections include System Health, Sync Queue, Manual Replay, Replay Audit, Hydration/Reconciliation, Backup/Restore, Auth/Session, Deployment/Environment, Auto-sync Eligibility, POS Activity Safety, and Logs/Diagnostics.

Client-facing status should remain simplified: Online/Offline, Sync healthy/Needs attention, last successful sync, last backup, and support contact/action. The control panel is read-only-first, with explicit confirmation required for any future dangerous action. No UI/runtime behavior exists yet.
## Developer Control Panel Foundation UI

A first read-only Developer Control Panel foundation now exists in `src/DeveloperControlPanel.tsx`.

It is available from the dashboard only for exact role `Dev` and remains hidden from `admin`, `saleboy`, staff, cashier, and manager navigation. Current sections include System Health, Sync Status, Replay Status, Auth Status, Backup Status, Auto-sync Eligibility, and POS Activity Status.

This is visibility only. It uses manual refresh, does not add dangerous mutation tools, does not trigger replay automatically, does not expose payloads/tokens/passwords, and does not add auto-sync, startup replay, polling, listeners, workers, or background behavior.
Checkpoint reference: [release-checkpoint-developer-control-panel-foundation.md](./release-checkpoint-developer-control-panel-foundation.md)

This checkpoint records the read-only Developer Control Panel foundation before adding dangerous actions or runtime endpoints. Current behavior remains manual refresh only, with no replay trigger, mutation tool, auto-sync, polling, listener, worker, or background behavior.
## Production Deployment Preparation Assets

Production deployment preparation assets now exist:

- `.env.production.example`
- [production-deployment-checklist.md](./production-deployment-checklist.md)

The checklist requires backup validation before rollout, keeps auto-sync disabled initially, keeps replay manual/gated initially, and keeps dangerous tooling admin-only. This is operational preparation only and does not deploy, alter runtime sync behavior, or add CI/CD automation.
## Release Verification And Manifest Tooling

Manual release preparation tooling now exists:

```powershell
npm.cmd run release:verify
npm.cmd run release:manifest
```

The verifier improves deployment confidence by building and checking production output and required readiness assets. The manifest generator records timestamp, git/app metadata, included docs/checklists, backup tooling status, sync architecture status, auto-sync status, auth expectations, and known blockers/warnings under `releases/`.

This is preparation-only and does not deploy, enable auto-sync, add CI/CD, add background behavior, trigger replay, or change runtime sync behavior.
Checkpoint reference: [release-checkpoint-production-build-verification.md](./release-checkpoint-production-build-verification.md)

This checkpoint documents the release preparation baseline: production build succeeded, `dist/` exists with `index.html` and assets, localhost leakage matches were `0`, verifier errors/warnings were `0`, and the latest release manifest is `releases/release-manifest-2026-05-25T17-03-53-150Z.json`. Deployment, CI/CD, runtime sync changes, and auto-sync remain absent.

## Deployment Package Preparation

`npm.cmd run deployment:package` creates a local dry-run package under `deployment-package/` for client hosting review. It includes frontend build output, backend `api/`, selected public deployment docs, `.env.production.example`, and a `deployment-manifest.json` safety record.

The package tool does not deploy, upload, enable auto-sync, or change runtime sync behavior. Generated package output is ignored by Git. Real secrets, local `.env` files, backups, release manifests, logs, `node_modules/`, and `tsconfig.tsbuildinfo` are excluded; production secrets must be configured directly on the server or hosting provider.

## Hosting-Agnostic Deployment Rehearsal

A hosting-agnostic deployment rehearsal guide now exists at [hosting-agnostic-deployment-rehearsal.md](./hosting-agnostic-deployment-rehearsal.md). It prepares the exact manual steps to adapt once a shared-hosting or VPS target is known, including hosting capability collection, package upload layout, database import order, environment setup, HTTPS/CORS checks, first admin setup, health/login/CRUD/manual replay checks, Developer Control Panel checks, rollback steps, and go/no-go criteria.

This remains documentation-only. No hosting credentials are required, no deployment/upload occurs, no CI/CD is added, no runtime behavior changes, and auto-sync remains disabled.

## Local Production-Like Laragon Rehearsal

A Laragon-based local production-like rehearsal checklist now exists at [local-production-rehearsal-laragon.md](./local-production-rehearsal-laragon.md). It provides practical steps for rehearsing package generation, frontend/API copying, local schema import, local production-like API configuration, health/login/session checks, low-risk CRUD sync checks, manual replay checks, Developer Control Panel checks, backup/export validation, release verification, leakage checks, rollback rehearsal, and go/no-go review.

This is documentation/checklist only. It does not deploy to real hosting, does not add CI/CD, does not change runtime behavior, and does not enable auto-sync.

## Automated Local Production Rehearsal Verifier

`npm.cmd run rehearsal:local-production` now runs a safe read-only verifier for the local Laragon/deployment-package rehearsal. It checks package structure, expected frontend/API/schema/env-template assets, required deployment docs/scripts, Developer Control Panel source, runtime localhost/dev URL leakage, auto-sync signals, obvious background sync startup code, and dangerous restore/import tooling.

The command writes `deployment-rehearsal-report.json` and `deployment-rehearsal-report.md` as local generated reports. It does not deploy, upload, mutate IndexedDB/MySQL, trigger replay, apply hydration, restore/import data, change runtime behavior, add background sync, or enable auto-sync. Visual UI, invoice printing, accounting review, replay approval, rollback approval, and real hosting domain/SSL/CORS/server credential checks remain manual.
## Repository Sync Coverage Audit

Repository-level CRUD sync coverage and the focused `sync:verify-existing` verifier are documented in [repository-sync-coverage.md](./repository-sync-coverage.md).

Current summary:

- backend-sync-aware low-risk master repositories: units, taxes, discounts, brands, categories
- additional backend-sync-aware repositories: expenses, users/staff, settings, held carts
- customers/suppliers: profile-fields-only sync-aware; accounting fields remain transaction/replay-owned
- items: partial safe-profile update awareness only; create/delete/stock/cascade effects remain local-only
- sales, sale_items, payments, batches, cylinders, and customer-cylinder holdings remain direct-CRUD local-only and should not be migrated outside atomic transaction/replay endpoints

This is an audit/documentation update only. It does not migrate repositories, trigger replay, mutate local/backend data, add background sync, or enable auto-sync.

## Existing CRUD Delete Policy Alignment

Existing backend-aware CRUD deletion now matches the local frontend model:

- `units`, `brands`, `categories`, `discounts`, and `taxes` hard-delete backend lookup rows.
- `customers`, `suppliers`, and `expenses` keep soft-delete behavior because their local UI and IndexedDB flows already include deleted-row review, restore, and permanent-delete concepts.
- Packaged Laragon verification asserts lookup hard deletion and exercises customer/supplier/expense deleted-record modal restore plus permanent deletion end to end.
- Soft entities restore through `PATCH ?id=<serverId>&restore=1`; their permanent delete uses `DELETE ?id=<serverId>&permanent=1`.
- Lookup schema `is_deleted` / `deleted_at` columns remain harmlessly for shared-helper compatibility; no risky cleanup migration was added.
- No lookup-table restore UI, POS mutation behavior, replay behavior, or auto-sync behavior was added.
## Packaged Developer Control Panel And Backup Verification

`sync:verify-existing` now includes copied-Laragon frontend checks for the read-only Developer Control Panel. Isolated browser contexts prove that exact role `Dev` can open the panel while `admin`, `saleboy`, staff, cashier, and manager roles cannot see it. The test does not use the disabled frontend backdoor. The panel exposes informational Backup Status only, no destructive or replay actions, and no sentinel token/password/payload rendering.

Backup creation and checksum validation remain explicit CLI-only operations. IndexedDB and MySQL exports redact or omit sensitive fields; restore/import remains unimplemented. No POS mutation, replay, hydration, background sync, polling, listeners, workers, or auto-sync behavior was added.
## Laragon Packaged Manual Replay Verification

The packaged Laragon sync coverage verifier now exercises the real Settings manual replay workflow with isolated low-risk `brands` fixtures only.

Verified lifecycle:

- a clearly named rehearsal brand and matching `sync_queue` create row are inserted locally;
- the queue row remains `pending` and MySQL remains unchanged before the explicit `Run Manual Replay` click;
- the Settings auth gate is evaluated before `syncEngine.processPending()` runs;
- the explicit click creates exactly one backend brand row, marks the queue row `done`, and mirrors `serverId` into IndexedDB;
- a second explicit replay click does not submit the completed queue row again and does not duplicate the backend row;
- a separate invalid low-risk brand fixture receives a safe validation failure, increments retry metadata, transitions to `failed`, and renders only the safe error summary;
- all isolated rehearsal fixture rows are removed afterward.

The failure-state handling was tightened so a rejected CRUD replay row no longer remains stranded in `processing`: `syncEngine.processPending()` records retry metadata and then marks that queue row `failed`.

This verification does not use transactions, sales, sale items, payments, stock, accounting, batches, or cylinders. Replay remains explicitly triggered only. No startup replay, replay interval, replay worker, polling loop, or event-listener replay was added.

## Invoice Cancellation Temporarily Disabled

Invoice deletion/cancellation is intentionally unavailable from the client UI during handover. The previous local reversal path could not safely guarantee coordinated reversal of sale items, stock, batches, cylinders, customer/supplier balances, payments, and accounting.

Invoice viewing, search, filtering, and printing remain available. Existing repository reversal helpers are retained only as unexposed implementation history until a complete atomic reversal flow is designed and verified. No POS finalization, replay, or auto-sync behavior changed.

## Client Handover Auth Policy Tightening

Single-client production auth now has an explicit offline boundary:

- online login always validates backend credentials first;
- a reachable backend rejection never falls back to IndexedDB login;
- local IndexedDB login fallback requires `VITE_ALLOW_OFFLINE_LOGIN=true` and is used only when the API network request cannot be reached;
- startup validates `session.php` while reachable instead of trusting stale localStorage markers;
- invalid online sessions clear stale bearer/local login state;
- DB-backed exact-role `Dev` support login remains the supported handover path;
- `VITE_ENABLE_DEV_BACKDOOR` remains default-off and blocked by package/release checks.

The local IndexedDB `Password` field remains a documented legacy credential risk for explicitly enabled offline login. Replacing it with a local salted verifier is deferred to a focused migration. No POS, replay, queue, background sync, or auto-sync behavior changed.

## Finalized Sale Backend Replay Design Audit

The first production transaction-replay slice has been audited in
[finalized-sale-backend-replay-design-audit.md](./finalized-sale-backend-replay-design-audit.md).

The backend broad internal replay primitives remain unexposed. Completed,
non-postponed local Sales queue an explicit `finalizedSaleReplay` v1 contract with
separate local correlation ids and backend `serverId` mappings for items,
selected customers, exact resolved batches, and cylinders. Queue rows also
copy safe `replayReadiness` diagnostics with `ready` or `unsafe` status and
mapping reason codes. The read-only `sync:report` command summarizes those
codes without printing record bodies.

The hardened queue contract does not execute replay automatically and does not
block a locally completed Sale when a backend mapping is unavailable. The
narrow authenticated `api/replay/sale.php` endpoint is now implemented for
explicit manual processing of ready v1 payloads only. It rejects unsafe rows
before MySQL mutation and does not expose the broad helper directly. Purchase,
Returns, standalone payments, invoice cancellation, auto-sync, polling,
listeners, workers, startup replay, and background replay remain deferred.

## Item Profile Mapping Audit

The safe item profile boundary has been audited without migrating any new item
CRUD path.

- Existing mapped item rows may send profile-only updates for `name`,
  `barcode`, `description`, and purchase/retail/discount/wholesale prices.
- `availableStock`, opening-stock batches, cylinder state, category/brand/unit
  relationships, `ConvQty`, lookup usage counts, and delete lifecycle remain
  local or transaction-owned.
- Ordinary item creation remains local-only because the Items screen may create
  an opening-stock batch, a cylinder row, and lookup-counter cascades alongside
  the item row.
- Existing unmapped local items require controlled registration or hydration
  review. Local numeric ids, names, and barcodes must not be used as blind MySQL
  mutation keys.
- Future item mapping work should be a separately approved profile
  registration/bootstrap contract with strict allowlisting and explicit local
  `serverId` mirroring.

Reliable `serverItemId` mappings are required for finalized Sale replay, but
item mapping alone is not enough for batch-tracked or cylinder Sales. No item
migration, POS behavior change, background sync, or auto-sync is added by this
audit.

## Manual Finalized Sale Replay V1

The first narrow backend replay endpoint now exists at `api/replay/sale.php`.
It is manual-only and authenticated. Explicit manual queue processing stores a
ready finalized Sale, then calls the endpoint by `clientTransactionId`.

The backend reloads the stored payload and accepts only `finalizedSaleReplay`
v1 with `transactionType: "Sale"` and `replayReadiness: ready`. It builds a
server-id-only mutation envelope and applies the Sale header/items, item stock
decrease, exact mapped batch decrease, selected-customer accounting/payment
effect, and mapped cylinder issue in one MySQL transaction. Unsafe contracts
are rejected before mutation. Duplicate replay is terminal-state skipped
without duplicate business writes.

Run:

```powershell
npm.cmd run test:transactions:finalized-sale-manual-replay
```

Customer Return, Supplier Return, standalone payment replay, invoice
cancellation, startup replay, polling, listeners, workers, background replay,
and auto-sync remain deferred.

## Finalized Purchase Backend Replay Design Audit

The next transaction-replay slice has been audited in
[finalized-purchase-backend-replay-design-audit.md](./finalized-purchase-backend-replay-design-audit.md).

Local finalized Purchase behavior remains the IndexedDB reference:

- one atomic local commit stores the Purchase header and line items;
- item stock increases;
- one local batch row is created per Purchase cart line;
- an optional selected supplier summary and non-zero supplier payment row are
  updated atomically;
- mapped cylinder Purchase lines increase filled cylinders and total cylinder
  stock;
- direct Purchases remain valid without a selected supplier.

Backend schema coverage and internal replay primitives already exist.
Completed, non-postponed local Purchases now queue an explicit
`finalizedPurchaseReplay` v1 contract with Purchase-specific
`replayReadiness`, server-only item targets, safe local batch-create
correlation metadata, optional selected-supplier mapping, and optional
cylinder mapping. Direct Purchase remains valid without a supplier server id
because it has no supplier accounting mutation.

Unsafe Purchase mappings do not block a successful local IndexedDB Purchase.
They annotate the queue row with safe reason codes and remain ineligible for
backend-authoritative replay.

The narrow authenticated `api/replay/purchase.php` endpoint now exists for
explicit manual replay of ready `finalizedPurchaseReplay` v1 rows. Manual queue
processing stores a ready finalized Purchase, then calls the Purchase endpoint
by `clientTransactionId`. The adapter builds a server-id-only mutation envelope
and applies the Purchase header/items, item stock increase, backend batch
creation, optional selected-supplier accounting/payment effect, and optional
mapped cylinder increase in one MySQL transaction. Duplicate replay is
terminal-state skipped without duplicate business writes. Direct Purchase is
accepted without supplier mutation.

No POS behavior change, Sale replay change, Customer Return replay, Supplier
Return replay, standalone payment replay, background replay, startup replay,
polling, listeners, workers, or auto-sync is added by finalized Purchase
manual replay.

## Finalized Customer Return Backend Replay Design Audit

The Customer Return replay slice has been audited in
[finalized-customer-return-backend-replay-design-audit.md](./finalized-customer-return-backend-replay-design-audit.md).

Local finalized Customer Return behavior remains the IndexedDB reference:

- the local header uses `transactionType: "Return"` with customer return mode
  and the existing `RET-C` invoice sequence;
- item stock increases;
- one return batch is created per returned cart line;
- selected customer payable decreases, negative paid amounts are applied when
  entered, balance is recomputed, and invoices increment;
- optional non-zero customer payment rows are negative and use return
  adjustment remarks;
- cylinder Customer Return moves customer holding to empty cylinders by
  decreasing `withCustomers`, increasing `emptyCylinders`, and leaving
  `filledCylinders` unchanged.

Completed, non-postponed local Customer Returns now queue an explicit
`finalizedCustomerReturnReplay` v1 contract with Customer Return-specific
`replayReadiness`, server-only customer/item targets, safe local return-batch
correlation metadata, optional cylinder mapping, and optional customer holding
mapping for gas/cylinder returns. Supplier Return is covered separately by its
own queue payload hardening and narrow manual replay endpoint.

Unsafe Customer Return mappings do not block a successful local IndexedDB
Customer Return. They annotate the queue row with safe reason codes and remain
ineligible for backend-authoritative replay.

The manual endpoint `api/replay/customer-return.php` now accepts only ready
`finalizedCustomerReturnReplay` v1 rows by `clientTransactionId`, builds a
server-id-only mutation envelope, and applies the Customer Return header/items,
item stock increase, return-batch creation, customer accounting/payment effect,
and optional cylinder/holding movement in one MySQL transaction. Sale and
Purchase replay are unchanged. Standalone payment replay, background replay,
startup replay, polling, listeners, workers, and auto-sync remain deferred.

## Finalized Supplier Return Backend Replay Design Audit

The Supplier Return replay slice has been audited in
[finalized-supplier-return-backend-replay-design-audit.md](./finalized-supplier-return-backend-replay-design-audit.md).

Local finalized Supplier Return behavior remains the IndexedDB reference:

- the local header uses `transactionType: "Return"` with supplier return mode
  and the existing `RET-S` invoice sequence;
- item stock decreases;
- selected/source purchase batches decrease `qtyPurchased` and `balance` while
  leaving `qtySold` unchanged;
- selected supplier payable decreases, negative paid amounts are applied when
  entered, balance is recomputed, and invoices increment;
- optional non-zero supplier payment rows are negative and use Supplier Return
  adjustment remarks;
- cylinder Supplier Return currently decreases filled cylinders and recomputes
  total cylinder stock from the local cylinder fields.

Completed, non-postponed local Supplier Returns now queue an explicit
`finalizedSupplierReturnReplay` v1 contract with Supplier Return-specific
`replayReadiness`, server-only supplier/item targets, selected/source batch
metadata, optional cylinder mapping, negative payment metadata, and safe
before/after batch/cylinder values where available.

Unsafe Supplier Return mappings do not block a successful local IndexedDB
Supplier Return. They annotate the queue row with safe reason codes and remain
ineligible for backend-authoritative replay.

`test:local:finalized-supplier-return-queue-readiness-fixture` now creates an
isolated packaged-Laragon Supplier Return fixture in a temporary IndexedDB
database, queues exactly one pending `finalizedSupplierReturnReplay` v1 row,
and proves ready/unsafe classification without calling backend replay. It
verifies mapped Supplier Return readiness, non-cylinder readiness without
cylinder metadata, missing supplier/item/source-batch/server-batch/cylinder
mapping failures, and unsafe cylinder clamping classification.

The manual endpoint `api/replay/supplier-return.php` now accepts only ready
`finalizedSupplierReturnReplay` v1 rows by `clientTransactionId`, builds a
server-id-only mutation envelope, and applies the Supplier Return header/items,
item stock decrease, selected/source batch reduction, supplier
accounting/payment effect, and optional cylinder `filledDecrease` in one MySQL
transaction. Duplicate replay is terminal-state skipped without duplicate
business writes. Unsafe Supplier Return rows are rejected before business
mutation.

Sale, Purchase, and Customer Return replay remain unchanged. Standalone payment
replay, background replay, startup replay, polling, listeners, workers, and
auto-sync remain deferred.
