# Transaction Sync Architecture

This document designs the future transaction-level sync architecture for POS, accounting, inventory, batches, cylinders, and balance mutations. It is a design checkpoint only. No transaction replay, reconciliation, or auto-sync behavior is implemented by this document.

## Current Baseline

- Low-risk mirror architecture is stabilized.
- Simulated mirror suite: `79 passed, 0 failed`.
- Real `syncEngine.processPending()` replay suite: `39 passed, 0 failed`.
- Auto-sync is intentionally not enabled.
- `transactions.php` currently performs shallow storage validation, stores transaction payloads, and enforces idempotency only.
- Low-risk CRUD mirrors are separate from transactional state.

## Why Generic CRUD Replay Is Unsafe

Sales, purchases, returns, payments, stock changes, batches, cylinders, and accounting balances are not independent records. They are connected mutations across several tables and business rules.

Generic CRUD replay is unsafe because:

- A sale can change sale headers, sale items, stock, item batches, customer balances, payments, and cylinders.
- A return can reverse or partially reverse inventory and accounting effects.
- A payment can affect customer or supplier balances and payment history.
- Invoice deletion can reverse stock, balances, payments, and cylinder movements.
- Batch inventory must not drift from item totals.
- Cylinder customer assignments must remain consistent with sale/return state.
- Replaying one row without the others can create broken financial or inventory state.

Low-risk CRUD mirrors can patch `serverId` and profile fields. Transaction sync must not follow that pattern.

## Required Atomicity Guarantees

Every POS/accounting/inventory transaction must be processed atomically on the backend.

The backend transaction processor must:

- Start one MySQL transaction.
- Validate the entire payload.
- Apply all related writes together.
- Commit only when all writes succeed.
- Roll back everything if any stock, accounting, batch, cylinder, payment, or invoice step fails.
- Return one final transaction result.

Partial server-side application must be treated as a critical bug.

## Idempotency Requirements

Every transaction replay must be idempotent.

The backend must guarantee:

- The same `clientTransactionId` with the same payload cannot apply twice.
- Replaying the same transaction twice must not duplicate stock mutations.
- Replaying the same transaction twice must not duplicate accounting mutations.
- Replaying the same transaction twice must not duplicate payments, sale items, batches, or cylinder effects.
- The same `clientTransactionId` with a different payload must return `409 Conflict`.

The existing `transaction_idempotency` table is the starting point for this behavior.

## clientTransactionId Strategy

Each offline transaction payload must include a stable `clientTransactionId`.

The ID should be generated before local commit and retained in the queued transaction payload. A practical format is:

```text
tx-<timestamp>-<random>
```

The ID must be:

- Unique per local POS transaction attempt.
- Stable across retries.
- Stored in `sync_queue.localId`.
- Stored inside the `OfflineTransactionPayload`.
- Used by the backend for idempotency.

## Transaction Replay Lifecycle

Future replay should follow this lifecycle:

1. POS completes the full local transaction first.
2. App queues one `sync_queue` row:
   - `entity: "transactions"`
   - `operation: "transaction"`
   - `localId: clientTransactionId`
   - `payload: OfflineTransactionPayload`
3. `syncEngine.processPending()` sends the payload to `transactions.php`.
4. Backend validates idempotency.
5. Backend applies all related mutations inside one MySQL transaction.
6. Backend returns a final transaction result.
7. `syncEngine` marks the queue row `done`.
8. Later pull/hydration updates local mirrors from server state.

`syncEngine` should not patch individual stock, customer, supplier, payment, batch, or cylinder records from a transaction response until a dedicated hydration/reconciliation design exists.

## Backend Transaction Ownership

The backend transaction processor should own all durable server-side transactional mutations.

It should be responsible for:

- Sale headers.
- Sale items.
- Purchase headers if represented through the same transaction model.
- Returns.
- Payments.
- Customer balance changes.
- Supplier balance changes.
- Item stock changes.
- Batch quantity changes.
- Cylinder quantity and customer-cylinder changes.
- Invoice deletion and reversal effects.

The frontend may build a payload and keep local offline state, but the backend must decide the final authoritative server state.

## Stock Mutation Ownership

`syncEngine` must not compute stock.

Stock mutation rules should live in the backend transaction processor. The backend must:

- Validate item existence.
- Validate available stock when required.
- Apply sale stock decreases.
- Apply purchase stock increases.
- Apply return stock reversals.
- Keep item totals consistent with batch totals where batches are used.
- Reject or flag conflicts when server stock cannot satisfy an offline sale.

Frontend local stock changes remain immediate offline behavior, not server truth.

## Accounting Mutation Ownership

`syncEngine` must not compute accounting.

Customer and supplier accounting fields are transactional and must be mutated by the backend transaction processor:

- `invoices`
- `payable`
- `paid`
- `balance`

Customer/supplier CRUD mirrors must remain profile-only and must not overwrite these accounting fields.

## Batch Mutation Ownership

Batch mutation rules should be centralized in the backend transaction processor.

The processor must:

- Decide which batches are consumed or restored.
- Keep batch quantities consistent with item stock.
- Handle expired or unavailable batches.
- Reject or conflict transactions that reference invalid batch state.

The frontend should not replay batch rows as generic CRUD.

## Cylinder Mutation Ownership

Cylinder movement is transaction-linked and must be processed atomically.

The backend should own:

- Cylinder stock changes.
- Customer cylinder balances.
- Cylinder sale/return effects.
- Cylinder adjustment effects.

Cylinder repositories should remain local/offline support until backend transaction processing can guarantee consistency.

## Retry Behavior

Transaction replay should use normal queue retry mechanics:

- Network or temporary server failure increments retry metadata.
- Idempotent replay means retrying the same payload is safe.
- Permanent validation conflicts should become `failed` or `conflict`, not infinite retries.
- Diagnostic reports should expose safe metadata only.

Retry logs must not include full transaction payloads, payment details, customer private data, or passwords.

## Duplicate Replay Handling

Backend duplicate handling should be:

- Same `clientTransactionId` and same payload hash: return the original saved response.
- Same `clientTransactionId` and different payload hash: return `409 Conflict`.
- Missing `clientTransactionId`: reject with `400`.
- Duplicate local queue rows for the same transaction: safe because the backend idempotency table prevents double application.

## Failure Recovery Strategy

Failures should be categorized:

- Temporary: network down, API unavailable, database lock, timeout.
- Validation: missing item, deleted customer, invalid supplier, invalid payment data.
- Conflict: insufficient server stock, invoice collision, stale batch state, duplicate id with different payload.
- Backend bug: partial mutation, unexpected exception, inconsistent response.

Recovery should preserve the local queue row and expose safe diagnostics. Manual tools may reset failed rows to pending, but they must not edit payloads.

## Queue Repair Strategy

Queue repair should remain manual and explicit.

Allowed dev tools:

- Report queue state.
- Report stuck pending rows.
- Report old completed cleanup candidates.
- Reset failed rows to pending with explicit apply.
- Delete old completed rows with explicit apply.

Not allowed:

- Deleting pending transaction rows.
- Editing transaction payloads without a dedicated repair workflow.
- Replaying high-risk transactions through generic CRUD.
- Marking transaction rows done without backend acceptance.

## Offline-First Guarantees

The POS must keep its current offline-first behavior:

- Local transaction commit happens first.
- UI reset and local state should not depend on the remote API.
- Queue failure must not roll back a completed local sale.
- One transaction payload should represent the complete logical operation.
- Individual sale, stock, payment, batch, customer, supplier, and cylinder rows should not be queued separately for the same transaction.

## Future Auth Considerations

Before production transaction sync:

- Backend auth must be enforced.
- `transactions.php` must require an authenticated user/session/token.
- Transaction payloads should include operator/user context.
- Server should validate permissions for sales, returns, payments, deletions, and stock adjustments.
- Passwords must never appear in sync diagnostics.

## Future Pull And Hydration Considerations

Transaction replay alone is not enough. The app will need a pull/hydration strategy to align local IndexedDB with server truth.

Future hydration should handle:

- Server-assigned IDs.
- Updated stock values.
- Updated customer/supplier balances.
- Payment records.
- Sale headers and items.
- Batch states.
- Cylinder states.
- Deleted or merged records.

Hydration should be separate from transaction replay to avoid mixing command processing with state projection.

## Conflict Resolution Considerations

Likely conflicts include:

- Server stock lower than offline sale quantity.
- Batch no longer available.
- Customer or supplier deleted remotely.
- Item deleted or changed remotely.
- Invoice number collision.
- Duplicate payment or return.
- Cylinder quantities changed remotely.

Conflict handling should be explicit. The system should not silently overwrite server state or local accounting state.

Possible outcomes:

- Reject transaction and mark queue row `failed` or `conflict`.
- Accept with server-side adjustment and return reconciliation data.
- Require manual review.
- Preserve local transaction as unsynced until resolved.

## Future Auto-Sync Prerequisites

Auto-sync must not be enabled until:

- Backend auth exists.
- Transaction processor is atomic.
- Idempotency is fully tested.
- Conflict policy is implemented.
- Retry/backoff rules are documented.
- Queue diagnostics remain available.
- Sensitive data logging is prohibited.
- Pull/hydration strategy exists.
- High-risk transaction replay is separated from low-risk CRUD mirrors.
- A disable switch or feature flag exists.

## Replay Preflight Checklist

Before implementing any transaction replay or mutation logic, review [transaction-replay-preflight-checklist.md](transaction-replay-preflight-checklist.md). Replay must not proceed while any no-go condition in that checklist is still true.

## Backend Replay Contract

The future replay API contract is defined in [backend-transaction-replay-contract.md](backend-transaction-replay-contract.md). It describes replay states, idempotency, atomicity, rollback behavior, response shapes, conflict handling, and anti-patterns that must be avoided.
## Recommended Implementation Order

### Phase 1: Low-Risk CRUD Sync

Already stabilized for low-risk entities and safe mirror patching.

### Phase 2: Diagnostics And Stabilization

Already established with queue reports, stuck reports, cleanup candidate reports, failed reset tooling, and controlled cleanup tooling.

### Phase 2.5: Storage-Only Transaction Validation

Current status: `transactions.php` rejects unsupported transaction types, malformed top-level payloads, malformed required sale/return/invoice/payment shapes, invalid `returnMode`/`partyType`, and non-numeric `createdAt`, `qty`, or `price` values. This is shallow validation only and does not validate stock, accounting, invoices, batches, cylinders, or payments as business mutations.

### Phase 3: Transaction Replay Backend

Implement real `transactions.php` processing for one transaction type at a time, starting with the simplest finalized sale shape.

Requirements:

- One MySQL transaction.
- Idempotent processing.
- No partial commits.
- Clear validation errors.
- Safe response shape.

### Phase 4: Stock And Accounting Reconciliation

Add server-owned reconciliation outputs and local hydration planning.

This phase should verify that server stock, batch state, customer balances, supplier balances, payments, and local mirrors converge safely.

### Phase 5: Auth

Protect all write endpoints and transaction replay endpoints.

The backend should verify authenticated users and permissions before applying transaction payloads.

### Phase 6: Controlled Auto-Sync

Only after the above phases are stable, add opt-in auto-sync guarded by a feature flag or developer setting.

Auto-sync should start with low-risk CRUD only, then transaction replay only after backend atomic processing and conflict handling are proven.

## Non-Negotiable Boundaries

- `syncEngine` must not compute accounting.
- `syncEngine` must not compute stock.
- `syncEngine` must not mutate batches or cylinders directly from transaction payloads.
- Backend transaction processor must own transactional mutations.
- `transactions.php` must eventually become atomic before production transaction replay.
- Transaction replay must be idempotent.
- Replaying the same transaction twice must not duplicate stock or accounting mutations.
- CRUD mirrors must remain separated from transactional state.
- Low-risk mirror flow must not be expanded into stock/accounting/POS side effects.


## Replay Preflight Checklist

Before implementing any transaction replay or mutation logic, review [transaction-replay-preflight-checklist.md](transaction-replay-preflight-checklist.md). Replay must not proceed while any no-go condition in that checklist is still true.

## Replay Preflight Checklist

Before implementing any transaction replay or mutation logic, review [transaction-replay-preflight-checklist.md](transaction-replay-preflight-checklist.md). Replay must not proceed while any no-go condition in that checklist is still true.

## Backend Replay Contract

The future replay API contract is defined in [backend-transaction-replay-contract.md](backend-transaction-replay-contract.md). It describes replay states, idempotency, atomicity, rollback behavior, response shapes, conflict handling, and anti-patterns that must be avoided.
## Recommended Implementation Order