# Finalized Purchase Backend Replay Design Audit

## Decision

Do not add a finalized `Purchase` replay endpoint yet.

The local IndexedDB Purchase path is already atomic and the backend internal
replay processor already contains useful Purchase mutation primitives.
Completed Purchases now queue a versioned `finalizedPurchaseReplay` v1
contract with Purchase-specific `replayReadiness`. The contract is a safe
future adapter boundary: local ids remain correlation metadata, while mapped
backend ids are explicit wherever future MySQL mutation will require them.

The next implementation task may add a narrow authenticated
`POST /api/replay/purchase.php` endpoint for ready v1 payloads only.

## Current IndexedDB Purchase Outcome

`src/POS.tsx` treats local IndexedDB finalization as the runtime source of
truth. It stages the Purchase mutations before calling
`finalizeLocalPOSTransaction(...)`.

`src/services/localPOSFinalizationService.ts` commits the following stores in
one IndexedDB `readwrite` transaction:

| Store | Current finalized `Purchase` outcome |
| --- | --- |
| `sales` | Adds one header with a `PUR` invoice number, date, `Purchase` type, supplier display fields, totals, paid amount, arrears, zero Sale profit, and `isPostponed`. |
| `sale_items` | Adds one row per cart line linked to the local sale id. The line uses the min-unit quantity and Purchase price. |
| `items` | Increases `availableStock` by cart quantity. |
| `item_batches` | Creates one new batch row per Purchase cart line. The row starts with `qtyPurchased = qty`, `qtySold = 0`, and `balance = qty`; stores Purchase date, Purchase price as `costPrice`, invoice number, and local `sourceSaleId`. |
| `suppliers` | When a selected supplier exists, increments invoices, increases payable by the Purchase base amount, increases paid by the captured payment, and recomputes balance. |
| `supplier_payments` | When a selected supplier exists and paid amount is non-zero, adds one invoice-linked supplier payment row. |
| `cylinders` | For recognized cylinder/gas items with a local cylinder mapping and a full converted-cylinder quantity, increases filled cylinders and recomputes total cylinder stock. |

Direct Purchases have `supplierId: null` and display name `Direct Purchase`.
They do not mutate a supplier summary or create a supplier payment row.

Purchase arithmetic follows the existing POS model:

- `baseAmount = subtotalAfterDiscount + invoiceTax`
- `dues = prior supplier balance`
- `grandTotal = dues + baseAmount`
- `paid = captured paid amount`
- `arrears = grandTotal - paid`

For a selected supplier, local payment `payableSnapshot` is the invoice payable
including prior dues. `balanceSnapshot` is the supplier balance after the
Purchase.

After a successful local Purchase, invoice numbering advances through the
existing `PUR` prefix. This behavior must remain unchanged.

## Current Queue Behavior And Gap

After local commit, `src/POS.tsx` calls `buildSaleTransactionPayload(...)` for
Purchase because Sale and Purchase still share the established local queue
entry path.

For a completed, non-postponed Purchase, the builder now emits:

- outer `transactionType: "sale"`
- `payload.sale` with header `transactionType: "Purchase"`
- local `saleId`
- local-id-based `saleItems`
- `payload.finalizedPurchaseReplay` v1
- Purchase-specific top-level `replayReadiness`
- explicit `serverItemId` mutation targets
- an explicit selected-supplier `serverId` when supplier accounting applies
- direct-Purchase metadata when no supplier accounting applies
- safe local batch-create correlation metadata captured after atomic local
  commit
- explicit mapped cylinder identity for Purchase when required

The hardened storage envelope omits broad supplier, stock, batch, and cylinder
snapshots. Local IndexedDB ids remain diagnostic and correlation metadata
only. They must never become MySQL mutation ids.

Current explicit manual queue processing stores the Purchase through
`POST /api/transactions.php`. Because there is no narrow Purchase adapter, it
does not apply backend Purchase business mutations. The local queue row can be
marked `done` after storage acceptance. This is a known storage-only boundary,
not proof of authoritative Purchase replay.

## Existing MySQL Coverage

The canonical schema already contains the tables needed by a future
Purchase-only replay adapter:

| Table | Future Purchase use |
| --- | --- |
| `sync_transactions` | Stores the immutable queued envelope and replay status. |
| `transaction_idempotency` | Deduplicates storage by `clientTransactionId`. |
| `transaction_replay_audit` | Records actor-attributed replay lifecycle events. |
| `sales` | Stores the Purchase header with `transactionType = Purchase`. |
| `sale_items` | Stores linked Purchase line rows. |
| `items` | Receives stock increases only. |
| `item_batches` | Receives one newly created batch row per Purchase line. |
| `suppliers` | Receives optional supplier summary mutation. |
| `supplier_payments` | Receives an optional non-zero Purchase payment ledger row. |
| `cylinders` | Receives optional filled-cylinder and total-stock increases. |

No schema migration is required merely to design the first Purchase payload.

## Existing Internal Backend Primitives

`api/lib/transactionReplayProcessor.php` already contains internal helpers
that understand Purchase outcomes:

- Purchase stock adjustment direction is `increase`
- `persistReplayFinalizedSale(...)` stores a Purchase-shaped header in `sales`
  and linked rows in `sale_items`
- supplier summary mutation increases payable and paid and recomputes balance
- non-zero Purchase payment persists to `supplier_payments`
- Purchase creates new `item_batches` rows
- cylinder Purchase increases `filledCylinders` and `qtyInStock`
- the whole chain can run inside one MySQL transaction with lock, terminal
  state, audit, and rollback protection

These helpers remain internal. Their existence reduces implementation risk,
but does not make the broad processor safe to expose directly. The broad
processor still infers transaction meaning from legacy payload fields and can
operate on identifiers supplied in that envelope.

## Purchase Differences From Sale Replay

| Concern | Finalized Sale v1 | Required finalized Purchase v1 |
| --- | --- | --- |
| Stock | Decrease mapped item stock. | Increase mapped item stock. |
| Batches | Consume an exact existing mapped batch. | Create one backend batch per local Purchase batch. |
| Party | Optional mapped customer. | Optional mapped supplier. |
| Accounting | Mutate customer summary. | Mutate supplier summary. |
| Payment ledger | Optional `customer_payments` row. | Optional `supplier_payments` row. |
| Cylinders | Issue filled cylinder to customer and update holding. | Increase filled cylinders and total cylinder stock; no customer holding mutation. |
| Response mappings | Backend sale id is enough for current Sale flow. | Backend-created batch ids should be returned with local batch correlation ids for later mirror support. |

## Implemented `finalizedPurchaseReplay` V1 Contract

The hardened queue payload adds a Purchase-specific safe contract:

```json
{
  "payloadVersion": 1,
  "transactionType": "Purchase",
  "localSaleId": 12,
  "invoiceNo": "PUR-0001",
  "clientTransactionId": "txn_...",
  "createdAt": 1770000000000,
  "supplier": {
    "localId": 7,
    "serverId": 42,
    "nameSnapshot": "Supplier snapshot",
    "directPurchase": false
  },
  "items": [
    {
      "localItemId": 17,
      "serverItemId": 81,
      "originalItemId": 17,
      "nameSnapshot": "Item snapshot",
      "qty": 4,
      "price": 10,
      "quantityUnit": "min",
      "selectedUnit": "min",
      "conversion": {
        "minUnit": "piece",
        "maxUnit": "box",
        "convQty": 1,
        "quantityInMinUnit": 4
      },
      "batchCreate": {
        "localBatchId": 27,
        "sourceSaleId": 12,
        "purchaseDate": "2026-06-02T00:00:00.000Z",
        "qtyPurchased": 4,
        "balance": 4,
        "costPrice": 10,
        "invoiceNo": "PUR-0001"
      },
      "requiresCylinderMutation": false
    }
  ],
  "payments": {
    "paidAmount": 5,
    "source": "pos-finalization",
    "method": null
  },
  "cylinders": [],
  "totals": {
    "subtotal": 40,
    "discount": 0,
    "tax": 0,
    "dues": 20,
    "grandTotal": 60,
    "paid": 5,
    "arrears": 55
  },
  "replayReadiness": {
    "scope": "finalized_purchase",
    "payloadVersion": 1,
    "status": "ready",
    "reasons": []
  }
}
```

Rules:

- local ids remain diagnostic and correlation metadata only
- every Purchase item requires `serverItemId`
- selected supplier Purchase requires `supplier.serverId`
- Direct Purchase uses `directPurchase: true` and may omit a supplier server id
- every local Purchase batch creation requires explicit safe batch-create
  metadata, including local correlation id
- Purchase must not require an existing backend batch id because replay creates
  the backend batch
- cylinder Purchase requires mapped backend item and cylinder ids when a
  cylinder movement is included
- broad item, supplier, auth, and security snapshots do not belong in the
  hardened contract
- unsafe rows remain locally valid but must not be replayed

Suggested safe reason codes:

- `missing_local_sale_id`
- `missing_supplier_server_id`
- `missing_server_item_id`
- `missing_batch_create_metadata`
- `missing_cylinder_mapping`
- `missing_server_cylinder_id`
- `missing_finalized_purchase_replay_contract`

## Proposed Narrow Endpoint

After payload hardening and fixture verification, add:

```http
POST /api/replay/purchase.php
Authorization: Bearer <replay-authorized token>
Content-Type: application/json
```

Request:

```json
{
  "clientTransactionId": "txn_..."
}
```

The endpoint should reload the stored payload server-side and accept only:

- outer stored transaction type compatible with the existing Purchase storage
  envelope
- header `transactionType: "Purchase"`
- `isPostponed !== true`
- `finalizedPurchaseReplay.payloadVersion === 1`
- `replayReadiness.status === "ready"`
- no readiness reasons

Required sequence:

1. Authenticate and authorize before lock acquisition.
2. Load the stored transaction by `clientTransactionId`.
3. Validate the Purchase-only contract and server mappings.
4. Lock replay metadata and enforce terminal-state protection.
5. Begin one MySQL transaction.
6. Lock mapped items, optional supplier, and optional cylinders.
7. Validate arithmetic and invoice ownership.
8. Insert one `sales` Purchase header and linked `sale_items`.
9. Increase mapped item stock.
10. Create backend batch rows from the explicit Purchase batch-create
   contract.
11. Update optional supplier summary and create optional non-zero
   `supplier_payments` row.
12. Apply optional mapped cylinder Purchase increase.
13. Align supplier payment `payableSnapshot` with local invoice payable
   including prior dues.
14. Commit, release lock as `committed`, and return safe identifiers.

Safe response metadata may include:

- `syncTransactionId`
- `clientTransactionId`
- `purchaseReplayContract`
- `payloadVersion`
- `replayStatus`
- `alreadyCommitted`
- backend `saleId`
- `invoiceNo`
- `saleItemsInserted`
- backend-created batch mappings with local correlation ids

Do not return full payloads, broad record bodies, tokens, password data, or
session secrets.

## Idempotency Strategy

Use `clientTransactionId` as the stable logical Purchase replay key.

Required protections:

- `transaction_idempotency.client_transaction_id` remains unique
- `sync_transactions.client_transaction_id` remains unique
- `sales.sync_transaction_id` remains unique
- `sales.client_transaction_id` remains unique
- terminal committed replay short-circuits before mutation
- retry never duplicates Purchase header, line items, stock increase, created
  batches, supplier summary mutation, payment ledger row, or cylinder increase
- conflicting invoice number ownership is rejected safely

## Minimal Reuse Strategy

Do not expose or broadly generalize `replayStoredTransaction(...)`.

Keep a separate Purchase endpoint and a separate contract-specific adapter,
parallel to `api/lib/finalizedSaleReplayV1.php`. Reuse the existing internal
mutation primitives only after the Purchase adapter constructs a
server-id-only in-memory envelope.

Small shared helpers may be extracted later where duplication is mechanical:

- stored transaction lookup by `clientTransactionId`
- numeric and required-string validators
- invoice ownership check
- replay-authenticated endpoint response formatting
- payment snapshot alignment with a target ledger table

Leave Sale contract validation and Sale routing unchanged while Purchase is
introduced.

## Completed Payload Hardening And Remaining Endpoint Prerequisites

Before implementing `api/replay/purchase.php`:

1. Completed: add `finalizedPurchaseReplay` v1 builder types and readiness
   diagnostics.
2. Completed: capture locally created Purchase batch ids after atomic local
   commit.
3. Completed: store explicit mapped backend item ids and optional supplier id.
4. Completed: capture optional cylinder mapping metadata for gas/cylinder
   Purchase lines.
5. Completed: keep local Purchase finalization successful even when replay
   readiness is unsafe.
6. Completed: add a safe verifier for ready and unsafe Purchase payloads.
7. Remaining: add endpoint-specific fixtures before exposing a Purchase
   adapter.
8. Remaining: update manual sync routing only when the narrow Purchase
   endpoint exists.

## Explicitly Deferred

This hardening does not add or expose replay execution for:

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

## Safety Boundary

This hardening changes only the queued finalized Purchase metadata created
after a successful atomic local commit. It does not change successful local
Purchase outcomes, IndexedDB mutation order, Sale replay behavior, API
endpoints, database schema, queue processing behavior, auto-sync behavior, or
background behavior.
