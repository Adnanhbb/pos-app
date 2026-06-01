# Finalized Sale Backend Replay Design Audit

## Decision

Do not expose backend finalized `Sale` replay through a production HTTP endpoint yet.

The backend already contains a broad internal replay processor in
`api/lib/transactionReplayProcessor.php`. It can apply stock, `sales`,
`sale_items`, customer accounting, payment, batch, and cylinder mutations in
one MySQL transaction when invoked by backend tests. However, the real POS
queue payload still contains local IndexedDB identifiers in places where that
processor expects MySQL primary keys.

The next implementation should first harden the queued finalized-Sale payload
contract, then add a narrow authenticated Sale-only replay endpoint. It should
not expose the existing broad replay helper directly.

## Current IndexedDB Sale Outcome

`src/POS.tsx` treats local IndexedDB finalization as the runtime source of
truth. A completed `Sale` prepares all business changes before calling
`finalizeLocalPOSTransaction(...)`.

`src/services/localPOSFinalizationService.ts` commits the following stores in
one IndexedDB `readwrite` transaction:

| Store | Current finalized `Sale` outcome |
| --- | --- |
| `sales` | Adds one sale header with invoice number, date, `Sale` type, party display fields, totals, paid amount, arrears, profit, and `isPostponed`. |
| `sale_items` | Adds one row per cart line linked to the local sale id. |
| `items` | Decreases `availableStock` by cart quantity. |
| `item_batches` | Decreases one resolved purchase batch balance per tracked cart line and increases that batch `qtySold`. |
| `customers` | When a selected customer exists, increments invoices, increases payable by the Sale base amount, increases paid by the captured payment, and recomputes balance. |
| `customer_payments` | When a selected customer exists and paid amount is non-zero, adds one invoice-linked customer payment row. |
| `cylinders` | For recognized cylinder/gas items with a local cylinder mapping, decreases filled cylinders, increases cylinders with customers, and recomputes the cylinder invariant. |
| `cylinder_customers` | Creates or updates the customer-name holding for issued cylinders. |

Walk-in sales have `customerId: null`. They do not mutate a customer accounting
row or create a customer payment row.

The local line subtotal is not simply `qty * price`. `calcLine(...)` applies
line discount and tax first. The sale header subtotal is the sum of those line
totals, then invoice-level discount and tax are applied.

## Current Queue And Ingestion Flow

After the local IndexedDB transaction commits, `src/POS.tsx` creates a stable
`clientTransactionId`, builds an `OfflineTransactionPayload`, and queues it
through `queueOfflineTransaction(...)`.

The queue insertion is intentionally post-commit containment: if queueing
fails, the finalized local Sale remains committed and a safe warning is
reported.

When manually processed, `src/services/syncEngine.ts` sends transaction rows to
`POST /api/transactions.php`. That endpoint currently:

- performs shallow payload validation
- hashes and deduplicates the request by `clientTransactionId`
- stores the payload in `sync_transactions`
- writes a storage audit event
- returns `storedOnly: true`

It does not execute business replay. The local queue row can currently become
`done` after backend storage acceptance even though MySQL Sale mutations have
not run.

## Existing Backend Replay Foundation

`api/lib/transactionReplayProcessor.php` already provides a useful internal
foundation:

- replay locks and terminal-state protection
- safe replay audit events
- one MySQL transaction for stock, sales, accounting, payments, batches, and
  cylinders
- rollback on mutation failure
- authorized wrapper `replayStoredTransactionAuthorized(...)`
- strict stock, batch, and cylinder validation

This helper is intentionally broader than the first production endpoint. It
can infer Purchase and Return behavior from stored payload data. There is no
HTTP replay endpoint that safely constrains it to finalized `Sale` only.

## MySQL Schema Coverage

The canonical schema already defines:

- `transaction_idempotency`
- `sync_transactions`
- `transaction_replay_audit`
- `sales`
- `sale_items`
- `items`
- `item_batches`
- `customers`
- `cylinders`
- `cylinder_customers`

The replay helper can also write `customer_payments` when that table exists,
but `api/sql/schema.sql` does not currently define the customer/supplier
payment-ledger tables. A production Sale replay migration must define and
require the customer payment table instead of silently skipping it.

## Blocking Contract Gaps

| Gap | Why it blocks a safe Sale endpoint |
| --- | --- |
| Local ids are sent as authoritative references | POS queues local `customerId`, item `originalItemId`, and optional local `batchId`. The replay processor interprets them as MySQL ids. Local and server ids are not guaranteed to match. |
| Item profile mapping is incomplete | Item create remains local-only. A locally sold item may not have a MySQL row or `serverId`. |
| Batch identity and consumption rules drift | Local Sale resolves one selected or first-available FIFO batch per cart line and rejects if that one batch is insufficient. Backend replay can consume across multiple FIFO batches when `batchId` is absent. The queued line stores the cart `batchId`, not the resolved fallback batch id. |
| Cylinder Sale rules are not yet identical | Local Sale detects category-based cylinder items and currently skips some missing mappings or invalid conversions and clamps negative filled counts. Backend replay is stricter and also treats an existing cylinder row as cylinder detection. The strict rule is safer, but parity must be decided before exposure. |
| Customer payment snapshot semantics drift | Local payment `payableSnapshot` uses invoice payable including prior dues. Backend replay currently derives the post-mutation lifetime payable summary. |
| Canonical payment schema is incomplete | Local paid customer Sales create a payment row. The canonical MySQL schema must include that ledger table and replay metadata columns. |
| Storage response is insufficient for replay orchestration | `transactions.php` does not return `syncTransactionId`, and the frontend currently treats `storedOnly` acceptance as queue completion. |
| Broad helper accepts more than finalized Sale | A production first-slice endpoint must reject Purchase, Returns, Quotation, postponed rows, standalone payment replay, and invoice deletion. |
| Sale-item response correlation is absent | Backend persistence returns a sale id and item count, but not stable mapped sale-item ids. Add client line ids only if local mirror correlation is needed. |

## Proposed First Endpoint

Add a dedicated endpoint only after the payload-contract prerequisites are
implemented:

```http
POST /api/replay/sale.php
Authorization: Bearer <replay-authorized token>
Content-Type: application/json
```

Recommended request:

```json
{
  "clientTransactionId": "txn_..."
}
```

The endpoint should replay only an already-stored transaction. It should load
the stored payload server-side instead of accepting a second mutable business
payload body.

Recommended safe response:

```json
{
  "success": true,
  "data": {
    "clientTransactionId": "txn_...",
    "syncTransactionId": 123,
    "replayStatus": "committed",
    "alreadyCommitted": false,
    "saleId": 456,
    "invoiceNo": "SAL-0001",
    "saleItemsInserted": 2
  }
}
```

Do not return full payload snapshots, token data, or sensitive record bodies.
Return sale-item mappings only if a later local mirror requirement proves they
are needed.

## Required Sale-Only Payload Version

Introduce an explicit finalized-Sale replay payload version before the HTTP
bridge is enabled. Server references must be separate from local correlation
ids.

Minimum required concepts:

```json
{
  "saleReplayVersion": 1,
  "sale": {
    "transactionType": "Sale",
    "isPostponed": false,
    "customerServerId": 42
  },
  "saleItems": [
    {
      "clientLineId": "line_...",
      "localItemId": 7,
      "itemServerId": 81,
      "resolvedBatchServerId": 15,
      "qty": 2,
      "price": 100
    }
  ]
}
```

Rules:

- local ids may remain for diagnostics and correlation only
- backend mutation must use server ids only
- selected customer Sale replay requires `customerServerId`
- every sold item requires `itemServerId`
- tracked batch Sale replay requires the exact resolved backend batch id
- cylinder Sale replay must use the mapped backend item and locked cylinder row
- unresolved mappings must fail safely before mutation

## Required Backend Sequence

The narrow endpoint should:

1. Authenticate and authorize the replay actor before lock acquisition.
2. Find the stored transaction by `clientTransactionId`.
3. Reject anything except outer `transactionType: "sale"`, sale header
   `transactionType: "Sale"`, and `isPostponed: false`.
4. Lock the replay metadata row and enforce terminal-state protection.
5. Begin one MySQL transaction.
6. Validate server-id mappings, invoice identity, arithmetic, stock, exact
   batch target, customer state, payment-ledger availability, and cylinder
   state where applicable.
7. Lock affected items, customer, batches, cylinders, and cylinder-customer
   holdings with `FOR UPDATE`.
8. Insert `sales` and linked `sale_items`.
9. Apply stock, exact batch, customer accounting, optional payment, and
   applicable cylinder mutations.
10. Write safe actor-attributed audit metadata.
11. Commit, release the replay lock as `committed`, and return safe ids.

Any failure must roll back the complete MySQL write set.

## Idempotency Strategy

Use `clientTransactionId` as the stable logical Sale idempotency key.

Required protections:

- `transaction_idempotency.client_transaction_id` remains unique
- `sync_transactions.client_transaction_id` remains unique
- `sales.sync_transaction_id` remains unique
- `sales.client_transaction_id` remains unique
- terminal `committed` replay short-circuits before mutation
- same key with a different canonical stored payload hash returns conflict
- retries never duplicate sale headers, items, stock deductions, customer
  balance changes, payments, batch consumption, or cylinder issues

`invoiceNo` should also be checked for conflicting ownership, but it should not
replace `clientTransactionId` as the idempotency key.

## Explicitly Deferred

This Sale-only design does not add or expose replay for:

- Purchase
- Customer Return
- Supplier Return
- standalone payments
- invoice cancellation or reversal
- stock adjustment
- standalone cylinder adjustment
- auto-sync
- background replay
- startup replay
- polling, listeners, or workers

## Recommended Next Task

Implement payload-contract hardening and tests first:

1. Add finalized-Sale replay payload versioning.
2. Capture server ids separately from local ids.
3. Capture the exact resolved batch mapping used by local Sale finalization.
4. Align or explicitly gate cylinder Sale handling.
5. Add canonical customer payment-ledger schema migration.
6. Define the local payment snapshot field semantics.
7. Return `syncTransactionId` from storage ingestion or locate stored rows by
   `clientTransactionId`.
8. Add tests proving local ids are never used as MySQL mutation ids.

After those prerequisites pass, add the Sale-only authenticated replay endpoint
as a separate task.

## Safety Boundary

This audit changes documentation only. It does not change POS finalization,
IndexedDB writes, transaction ingestion, replay semantics, sync queue behavior,
authentication behavior, or auto-sync behavior.
