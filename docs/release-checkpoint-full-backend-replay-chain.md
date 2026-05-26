# Release Checkpoint: Full Backend Replay Chain Before Sync Wiring

Suggested git tag: `full-backend-replay-chain-before-sync-wiring`

## Milestone Summary

This checkpoint records the state after the backend transaction replay chain became complete for the current POS mutation layers, while frontend transaction replay wiring and auto-sync remain intentionally disabled.

The backend replay processor now performs the full authoritative replay chain when explicitly invoked by backend/dev tooling:

1. replay lock acquisition and terminal-state protection
2. payload shape validation
3. business-reference validation
4. inventory sufficiency validation
5. deterministic mutation planning
6. stock mutation
7. finalized `sales` row persistence
8. linked `sale_items` persistence
9. customer/supplier accounting summary mutation
10. payment ledger persistence
11. batch mutation
12. cylinder/customer-cylinder mutation
13. audit/status updates and lock release

All mutation stages run inside the backend DB transaction. Failure in any stage rolls back the entire replay chain.

## Completed Replay Chain

Implemented backend replay capabilities:

- stock mutation of `items.availableStock`
- finalized `sales` insertion
- linked `sale_items` insertion
- customer/supplier accounting summary mutation
- payment ledger row persistence
- batch creation/consumption/reversal
- cylinder inventory mutation
- customer-cylinder holding mutation
- replay locks
- terminal-state duplicate protection
- rollback on failure
- safe replay audit events

## Cylinder Replay Summary

Cylinder/gas items are detected by item category containing `gas` or `cylinder`, or by an existing `cylinders` row. Non-cylinder items skip safely.

Current cylinder effects:

- `Sale`: filled cylinders decrease, with-customer cylinders increase, and customer holding is created or updated.
- `Customer Return`: with-customer cylinders decrease, empty cylinders increase, and customer holding is reduced.
- `Purchase`: filled cylinders increase and total cylinder stock increases.
- `Supplier Return`: filled cylinders decrease and total cylinder stock decreases.

Replay locks cylinder rows and customer-cylinder holding rows with `FOR UPDATE`, enforces no negative counts, and enforces `qtyInStock = filledCylinders + emptyCylinders + withCustomers`.

## Verified Test Counts

Current verified results:

- `test:transactions:cylinder-mutation` => `46 passed, 0 failed`
- `test:transactions:batch-mutation` => `39 passed, 0 failed`
- `test:transactions:payment-persistence` => `65 passed, 0 failed`
- `test:transactions:accounting-mutation` => `29 passed, 0 failed`
- `test:transactions:sales-persistence` => `26 passed, 0 failed`
- `test:transactions:stock-mutation` => `28 passed, 0 failed`
- `test:transactions:mutation-planning` => `22 passed, 0 failed`
- `test:transactions:inventory-validation` => `15 passed, 0 failed`
- `test:transactions:terminal-protection` => `10 passed, 0 failed`
- `test:transactions:business-validation` => `18 passed, 0 failed`
- `test:transactions:replay-skeleton` => `9 passed, 0 failed`
- `test:transactions:locks` => `8 passed, 0 failed`
- `test:transactions:storage` => `22 passed, 0 failed`
- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`

## Remaining Not Implemented

Still intentionally not implemented:

- frontend transaction replay wiring
- `syncEngine` transaction replay wiring
- auth/session hardening
- production write authorization
- pull/hydration from server truth
- conflict resolution UI/workflow
- automatic sync

## Boundaries For Next Phase

Do not enable automatic replay from the frontend until auth, conflict handling, retry policy, recovery workflow, and pull/hydration are designed and tested.

Do not treat backend replay success as local IndexedDB hydration. Replay commits server truth; a separate pull/hydration path must update local state later.

Do not bypass terminal-state protection or replay locks.

## Rollback Value

This checkpoint is useful because it captures the last known state where the backend replay chain is complete but not yet connected to frontend transaction syncing. If future frontend wiring, auth hardening, or auto-sync work causes instability, this milestone can be used as the clean backend replay baseline.

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



