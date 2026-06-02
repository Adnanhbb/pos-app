# Finalized Sale Backend Replay Design Audit

## Decision

Do not expose backend finalized `Sale` replay through a production HTTP endpoint yet.

The backend already contains a broad internal replay processor in
`api/lib/transactionReplayProcessor.php`. It can apply stock, `sales`,
`sale_items`, customer accounting, payment, batch, and cylinder mutations in
one MySQL transaction when invoked by backend tests. However, the real POS
queue payload still contains local IndexedDB identifiers in places where that
processor expects MySQL primary keys.

The queued finalized-Sale payload contract is now hardened and versioned. The
next backend implementation may add a narrow authenticated Sale-only replay
endpoint after the remaining schema and parity prerequisites are resolved. It
should not expose the existing broad replay helper directly.

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

Completed, non-postponed `Sale` queue rows now also include
`payload.finalizedSaleReplay` with `payloadVersion: 1`. This explicit contract
keeps local ids as correlation metadata and carries backend `serverId`
mappings separately for the customer, items, exact resolved batches, and
cylinders. It includes safe name snapshots, min-unit conversion metadata,
payment amount metadata, and totals without broad customer/item snapshots or
sensitive fields.

The queue row copies a safe `replayReadiness` summary beside the payload.
`ready` means the currently required backend mappings are present. `unsafe`
keeps the locally valid Sale queued while reporting safe reason codes such as
`missing_server_item_id`, `missing_server_batch_id`,
`missing_customer_server_id`, `missing_cylinder_mapping`, and
`missing_server_cylinder_id`. Readiness never executes replay and never blocks
the completed local Sale.

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

The canonical SQL schema now defines `customer_payments` and
`supplier_payments` with replay metadata columns. Finalized Sale v1 replay
requires the customer payment table when a selected-customer Sale has a
non-zero paid amount.

## Resolved And Deferred Contract Notes

| Note | Current handling |
| --- | --- |
| Legacy storage envelope still exists | The queue keeps legacy `sale` and `saleItems` fields for storage compatibility. The narrow adapter consumes and enforces the `finalizedSaleReplay` v1 contract, then constructs an in-memory server-id-only envelope. The broad processor remains unexposed. |
| Item profile mapping is incomplete | Item create remains local-only. A locally sold item may not have a MySQL row or `serverId`. The current mapped-row update path safely allowlists profile fields only, but ordinary item creation also creates opening-stock batches, optional cylinder rows, and lookup-count cascades. Existing unmapped rows require controlled registration or hydration review; local ids, names, and barcodes are not safe blind matching keys. |
| Exact batch identity | The queued v1 line stores the resolved backend batch id. The narrow adapter rejects missing or insufficient mapped batches before mutation and feeds the exact backend batch id into transactional consumption. |
| Cylinder Sale identity | The queued v1 contract carries mapped backend item and cylinder ids. The narrow adapter validates both and rejects inconsistent or insufficient cylinder mappings before mutation. |
| Customer payment snapshot semantics | The narrow adapter aligns `customer_payments.payableSnapshot` to local invoice payable including prior dues. Lifetime customer accounting totals remain separately updated. |
| Canonical payment schema | `api/sql/schema.sql` now defines customer and supplier payment-ledger tables with replay metadata columns. |
| Storage-to-replay orchestration | Explicit manual processing stores the payload first, then calls `api/replay/sale.php` by `clientTransactionId`. The endpoint reloads the stored body server-side. |
| Broad helper accepts more than finalized Sale | The broad helper remains internal. The narrow endpoint rejects Purchase, Returns, Quotation, postponed rows, standalone payment replay, and invoice deletion. |
| Sale-item response correlation is absent | Backend persistence returns a sale id and item count, but not stable mapped sale-item ids. Add client line ids only if local mirror correlation is needed. |

## Implemented First Endpoint

The first dedicated manual replay endpoint is now implemented:

```http
POST /api/replay/sale.php
Authorization: Bearer <replay-authorized token>
Content-Type: application/json
```

Request:

```json
{
  "clientTransactionId": "txn_..."
}
```

The endpoint replays only an already-stored transaction. It loads
the stored payload server-side instead of accepting a second mutable business
payload body.

Safe response:

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

## Implemented Sale-Only Payload Version

The explicit finalized-Sale replay payload version now exists before the HTTP
bridge is enabled. Server references are separate from local correlation ids.

Minimum required concepts:

```json
{
  "payloadVersion": 1,
  "transactionType": "Sale",
  "localSaleId": 12,
  "invoiceNo": "SAL-0001",
  "clientTransactionId": "txn_...",
  "customer": {
    "localId": 7,
    "serverId": 42,
    "nameSnapshot": "Customer snapshot"
  },
  "items": [
    {
      "localItemId": 7,
      "serverItemId": 81,
      "qty": 2,
      "price": 100,
      "resolvedBatch": {
        "localBatchId": 9,
        "serverBatchId": 15,
        "consumedQty": 2
      }
    }
  ],
  "replayReadiness": {
    "scope": "finalized_sale",
    "payloadVersion": 1,
    "status": "ready",
    "reasons": []
  }
}
```

Rules:

- local ids may remain for diagnostics and correlation only
- backend mutation must use server ids only
- selected customer Sale replay requires `customerServerId`
- every sold item requires `itemServerId`
- tracked batch Sale replay requires the exact resolved backend batch id
- cylinder Sale replay must use the mapped backend item and locked cylinder row
- unresolved mappings are marked `unsafe` locally and must fail safely before
  any future backend mutation

## Required Backend Sequence

The narrow endpoint:

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

## Implemented Replay Boundary

- `api/replay/sale.php` accepts only a stored `clientTransactionId`.
- Authentication is required before replay execution.
- The server reloads the stored payload and accepts only
  `finalizedSaleReplay` v1 with `replayReadiness: ready`.
- The narrow adapter builds an in-memory server-id-only envelope. Local
  IndexedDB ids remain correlation metadata and never become MySQL mutation
  ids.
- One MySQL transaction applies Sale header/items, stock, exact batch,
  customer accounting, optional customer payment, and mapped cylinder issue.
- Duplicate replay returns the existing terminal committed result without
  applying business mutations again.
- Unsafe payloads are rejected before lock acquisition or business mutation.
- The frontend calls this endpoint only from explicit manual queue processing.

## Payload Readiness Verification

Run:

```powershell
npm.cmd run test:local:finalized-sale-payload-readiness
```

The verifier executes the real payload builder against safe fixtures. It
checks a fully mapped `ready` payload, missing-mapping `unsafe` reasons, safe
snapshot omission, queue-row readiness metadata, exact resolved-batch mapping,
local/server id separation, unchanged local atomic finalization, and the
presence of the narrow authenticated `api/replay/sale.php` endpoint.

Run the backend replay verifier:

```powershell
npm.cmd run test:transactions:finalized-sale-manual-replay
```

It creates isolated rehearsal rows, replays one ready Sale, verifies duplicate
idempotency, rejects an unsafe Sale without mutation, proves local ids are not
used as MySQL mutation ids, and cleans up its fixture rows.

## Safety Boundary

Finalized Sale replay remains explicit and manual-only. It does not change
successful local POS finalization outcomes or IndexedDB business mutations.
Purchase, Returns, standalone payments, invoice cancellation, background
replay, startup replay, polling, listeners, workers, and auto-sync remain
disabled or unimplemented.
