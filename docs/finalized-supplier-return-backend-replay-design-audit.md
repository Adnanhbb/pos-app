# Finalized Supplier Return Backend Replay Design Audit

Status: design/audit only. No Supplier Return replay endpoint has been added.

This document prepares the backend-authoritative replay path for finalized
Supplier Return transactions only. The current IndexedDB Supplier Return
finalization path remains the reference implementation. Any future MySQL replay
must match that local behavior exactly, stay manual-only, and follow the
contract-gated/idempotent pattern already used for finalized Sale, Purchase,
and Customer Return replay.

This audit does not change successful local POS behavior, does not change Sale,
Purchase, or Customer Return replay, and does not add Supplier Return replay,
standalone payment replay, invoice cancellation, auto-sync, polling, listeners,
workers, startup replay, or background replay.

## Current Local Supplier Return Outcome

The local POS flow treats Supplier Return as `transactionType: "Return"` with
`returnMode: "supplier"`.

`src/POS.tsx` preflights Supplier Return before local persistence:

- Supplier Return is a stock-decreasing transaction.
- Supplier Return uses supplier context and the existing `RET-S` invoice
  sequence.
- Item pricing uses purchase price semantics, the same side of the UI as
  Purchase.
- If purchase batches exist for a returned item, the UI requires an explicitly
  selected purchase batch.
- Missing selected batch, missing batch row, or insufficient selected batch
  balance rejects before the local sale header is written.
- The selected batch approved during preflight is reused during mutation.
- If no tracked batch rows exist for the item, current local behavior can still
  reduce item stock without a batch mutation.

After validation, `src/services/localPOSFinalizationService.ts` commits the
following stores in one IndexedDB `readwrite` transaction:

| Store | Current finalized Supplier Return outcome |
| --- | --- |
| `sales` | Adds one header with `transactionType: "Return"`, supplier context, `RET-S` invoice number, negative paid amount, return totals, profit value currently left at 0, and `isPostponed` state. |
| `sale_items` | Adds one row per returned cart line linked to the local sale id. Each line keeps the local item id, quantity, price, discounts/tax fields, `costPrice`, and selected local `batchId` when present. |
| `items` | Decreases `availableStock` by each returned quantity. |
| `item_batches` | For selected batch-tracked lines, decreases the selected local batch `qtyPurchased` by returned quantity and decreases `balance` by returned quantity. `qtySold` is unchanged. |
| `suppliers` | For a selected supplier, decreases `payable` by the return amount, applies a negative paid value when payment is entered, recomputes `balance`, and increments `invoices`. |
| `supplier_payments` | Creates a payment row only when the effective paid amount is non-zero. The amount is negative and remarks use `Supplier Return adjustment <invoiceNo>`. |
| `cylinders` | For gas/cylinder lines, decreases `filledCylinders` by the full-cylinder quantity and recomputes `qtyInStock = filled + empty + withCustomers` after local non-negative clamping. `emptyCylinders` and `withCustomers` are not intentionally changed. |
| `cylinder_customers` | No supplier-return customer holding row is created or updated. |

For Supplier Return, local accounting uses the current invoice math:

- `baseAmount = subtotal - discount + tax`;
- `invoicePayable = dues - baseAmount`;
- `grandTotal = dues - baseAmount`;
- `paid` is stored as `-abs(paidAmountRaw)`;
- `arrears = grandTotal - paid`;
- selected supplier `payable` decreases by `baseAmount`;
- selected supplier `paid` increases by the negative effective paid value;
- selected supplier `balance = payable - paid`;
- selected supplier `invoices` increments by 1.

Invoice numbering uses the existing `RET-S` prefix and must remain unchanged.

## Current Queue Behavior

After the local IndexedDB transaction commits, `src/POS.tsx` calls
`buildReturnTransactionPayload(...)`.

Completed, non-postponed Supplier Return rows currently still use the generic
return queue envelope:

- outer `transactionType: "return"`;
- `payload.returnMode: "supplier"`;
- `payload.sale` with the local Supplier Return header;
- local `saleId`;
- local-id-based `saleItems`;
- broad supplier before/after snapshot when available;
- stock, batch, and cylinder mutation snapshots;
- no `finalizedSupplierReturnReplay` v1 contract;
- no Supplier Return-specific top-level `replayReadiness` scope.

This means Supplier Return queue rows are not yet eligible for a narrow
backend-authoritative replay endpoint. Local IndexedDB ids remain useful only as
correlation metadata. Future MySQL mutation targets must use explicit backend
`serverId` fields from a Supplier Return-specific contract.

## Existing MySQL And Backend Coverage

The current schema already has the core tables needed for future Supplier
Return replay:

- `sync_transactions`
- `transaction_replay_audit`
- `transaction_idempotency`
- `sales`
- `sale_items`
- `items`
- `item_batches`
- `suppliers`
- `supplier_payments`
- `cylinders`

The internal replay primitives in `api/lib/transactionReplayProcessor.php`
already understand Supplier Return direction in broad form:

- stock planning treats Supplier Return as an item stock decrease;
- accounting mutation applies negative payable and paid deltas to suppliers;
- supplier payment persistence writes negative supplier payment rows with
  Supplier Return adjustment remarks;
- batch mutation can consume a requested batch, decreasing `qtyPurchased` and
  `balance` while leaving `qtySold` unchanged;
- cylinder mutation decreases `filledCylinders` and `qtyInStock`.

These helpers are useful but should not be exposed directly. A future
Supplier Return-specific adapter should validate `finalizedSupplierReturnReplay`
v1, construct a server-id-only in-memory envelope, and then call shared mutation
helpers inside one MySQL transaction.

## Supplier Return Differences From Purchase Replay

| Concern | Finalized Purchase v1 | Required Supplier Return v1 |
| --- | --- | --- |
| Stored transaction type | Outer `sale`, header `transactionType: "Purchase"`. | Outer `return`, `returnMode: "supplier"`, header `transactionType: "Return"`. |
| Stock | Increase mapped item stock. | Decrease mapped item stock. |
| Batches | Create a backend batch row per purchased cart line. | Reduce the explicitly selected/source backend batch; do not create a new batch. |
| Party | Direct Purchase can be valid with no supplier. | Supplier Return should require a selected mapped supplier when supplier accounting/payment mutation exists. |
| Accounting | Increase supplier payable and optionally paid. | Decrease supplier payable and apply negative paid amount. |
| Payment ledger | Optional positive `supplier_payments` row. | Optional negative `supplier_payments` row with Supplier Return adjustment remarks. |
| Cylinders | Increase filled cylinders and total cylinder stock. | Decrease filled cylinders and total cylinder stock according to the current local model. |
| Validation | Requires item mapping and local batch-create metadata. | Requires item mapping, selected/source batch mapping when batch mutation applies, supplier mapping, and cylinder mapping when cylinder mutation applies. |

## Proposed `finalizedSupplierReturnReplay` V1 Contract

The Supplier Return-specific contract should keep local finalization successful
even when backend replay readiness is unsafe:

```json
{
  "payloadVersion": 1,
  "transactionType": "Return",
  "returnMode": "supplier",
  "localSaleId": 12,
  "invoiceNo": "RET-S-0001",
  "clientTransactionId": "txn_...",
  "createdAt": 1770000000000,
  "supplier": {
    "localId": 7,
    "serverId": 42,
    "nameSnapshot": "Supplier snapshot"
  },
  "items": [
    {
      "localItemId": 17,
      "serverItemId": 99,
      "nameSnapshot": "Returned item snapshot",
      "qty": 2,
      "price": 85,
      "costPrice": 85,
      "quantityUnit": "min",
      "selectedUnit": "min",
      "conversion": {
        "minUnit": "piece",
        "maxUnit": "carton",
        "convQty": 1,
        "quantityInMinUnit": 2
      },
      "sourceBatch": {
        "localBatchId": 31,
        "serverBatchId": 88,
        "returnedQty": 2,
        "qtyPurchasedDecrease": 2,
        "balanceDecrease": 2
      },
      "requiresCylinderMutation": false
    }
  ],
  "payments": {
    "paidAmount": -50,
    "source": "pos-finalization",
    "method": null
  },
  "cylinders": [
    {
      "localItemId": 17,
      "serverItemId": 99,
      "localCylinderId": 5,
      "serverCylinderId": 8,
      "qtyReturned": 1,
      "movement": "filledToSupplier"
    }
  ],
  "totals": {
    "subtotal": 170,
    "discount": 0,
    "tax": 0,
    "dues": 500,
    "grandTotal": 330,
    "paid": -50,
    "arrears": 380
  },
  "replayReadiness": {
    "scope": "finalized_supplier_return",
    "payloadVersion": 1,
    "status": "ready",
    "reasons": []
  }
}
```

The queue row should copy this readiness summary to its top-level
`replayReadiness` field. `ready` means the row is eligible for explicit manual
backend replay later. `unsafe` keeps the local Supplier Return valid and queued
but blocks backend-authoritative replay.

## Required Readiness Rules

Supplier Return readiness should be `unsafe` when any required mapping is
missing or inconsistent.

Required unsafe reason codes:

- `missing_finalized_supplier_return_replay_contract`
- `missing_local_sale_id`
- `missing_supplier_server_id`
- `missing_server_item_id`
- `missing_supplier_return_batch_metadata`
- `missing_server_batch_id`
- `missing_cylinder_mapping`
- `missing_server_cylinder_id`
- `invalid_supplier_return_batch_delta`
- `missing_supplier_return_cylinder_decision`

Backend implementation-time validation should additionally reject:

- selected backend batch missing, deleted, or belonging to another item;
- selected backend batch balance lower than returned quantity;
- selected backend batch `qtyPurchased` lower than returned quantity;
- mapped item stock lower than returned quantity;
- mapped cylinder filled/stock quantity lower than returned cylinder quantity,
  unless a separate approved local behavior decision explicitly preserves the
  current local clamping semantics.

## Proposed Endpoint Contract

The future narrow endpoint should be:

```http
POST /api/replay/supplier-return.php
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

- outer stored transaction type `return`;
- `payload.returnMode === "supplier"`;
- header `transactionType === "Return"`;
- `isPostponed !== true`;
- `finalizedSupplierReturnReplay.payloadVersion === 1`;
- `finalizedSupplierReturnReplay.transactionType === "Return"`;
- `finalizedSupplierReturnReplay.returnMode === "supplier"`;
- top-level and contract `replayReadiness.status === "ready"`;
- no readiness reasons.

Required sequence:

1. Authenticate and authorize before lock acquisition.
2. Load the stored transaction by `clientTransactionId`.
3. Validate Supplier Return-only contract and server mappings.
4. Lock replay metadata and enforce terminal-state protection.
5. Begin one MySQL transaction.
6. Lock mapped supplier, mapped items, selected backend batches, and optional
   mapped cylinders.
7. Validate arithmetic, selected batch ownership/sufficiency, stock
   sufficiency, cylinder sufficiency, and invoice ownership.
8. Insert one `sales` Supplier Return header and linked `sale_items`.
9. Decrease mapped item stock.
10. Decrease selected/source backend batch `qtyPurchased` and `balance` while
    leaving `qtySold` unchanged.
11. Update selected supplier summary and create optional non-zero negative
    `supplier_payments` row.
12. Apply optional mapped cylinder Supplier Return mutation according to the
    approved local rule.
13. Align supplier payment `payableSnapshot` with local invoice payable
    including prior dues.
14. Commit, release lock as committed, and return safe metadata only.

## Idempotency Strategy

Use `clientTransactionId` as the stable logical Supplier Return replay key.

Required protections:

- `transaction_idempotency.client_transaction_id` remains unique;
- `sync_transactions.client_transaction_id` remains unique;
- `sales.sync_transaction_id` remains unique;
- `sales.client_transaction_id` remains unique;
- terminal committed replay short-circuits before mutation;
- retry never duplicates Supplier Return header, line items, stock decrease,
  batch decrease, supplier summary mutation, payment ledger row, or cylinder
  movement;
- conflicting invoice number ownership is rejected safely.

`invoiceNo` is a conflict check, not the primary idempotency key.

## MySQL/API Gaps

The table coverage is mostly present, but the Supplier Return slice is not
implementation-ready yet:

- no `finalizedSupplierReturnReplay` TypeScript contract exists;
- no Supplier Return `TransactionReplayReadiness` scope exists;
- no Supplier Return payload builder captures server ids and selected/source
  batch mapping;
- no Supplier Return queue-readiness fixture exists;
- no `api/lib/finalizedSupplierReturnReplayV1.php` adapter exists;
- no `api/replay/supplier-return.php` endpoint exists;
- `src/api/transactionApi.ts` has no Supplier Return replay method;
- `src/services/syncEngine.ts` has no finalized Supplier Return replay branch;
- no transaction verifier exists for ready/unsafe Supplier Return replay.

## Payload Readiness Gaps

Supplier Return currently uses the generic return payload, so its queued rows
cannot prove the server-id-only mutation target set needed by a narrow replay
endpoint.

Required prerequisites before implementation:

1. Add `finalizedSupplierReturnReplay` v1 builder types and readiness
   diagnostics.
2. Capture explicit mapped backend supplier id.
3. Capture explicit mapped backend item ids for every returned line.
4. Capture explicit selected/source batch metadata and mapped backend batch ids
   when batch mutation applies.
5. Capture optional mapped cylinder ids for cylinder supplier returns.
6. Decide whether the current local Supplier Return cylinder clamping behavior
   is intended or a business bug. The shared backend helper currently rejects
   insufficient filled/stock cylinders, which does not exactly mirror local
   non-negative clamping.
7. Keep local Supplier Return finalization successful even when replay
   readiness is unsafe.
8. Add a safe payload verifier for ready and unsafe Supplier Return payloads.
9. Add a queue-readiness fixture that does not call a backend Supplier Return
   replay endpoint.

## Minimal Reuse Strategy

Do not expose or broaden `replayStoredTransaction(...)`.

Keep a separate Supplier Return endpoint and a separate contract-specific
adapter parallel to the Sale, Purchase, and Customer Return v1 adapters. Reuse
internal mutation primitives only after the adapter builds a server-id-only
in-memory envelope.

Small shared helpers may be extracted later where duplication is mechanical:

- stored transaction lookup by `clientTransactionId`;
- terminal-state and replay-lock handling;
- numeric and required-string validators;
- invoice ownership check;
- safe endpoint response formatting;
- payment snapshot alignment with the correct ledger table;
- server-id-only envelope construction for stock-decreasing batch-consumption
  transactions.

## Recommended Next Step

Do not implement Supplier Return replay immediately.

The next safe step is payload hardening only:

1. Add `finalizedSupplierReturnReplay` v1 queue contract and readiness
   classification.
2. Add local payload verifier coverage for ready and unsafe cases.
3. Add a queue-readiness fixture that proves Supplier Return rows become ready
   only when supplier, item, selected batch, and optional cylinder mappings are
   present.
4. Revisit Supplier Return cylinder clamping versus rejection before the
   backend endpoint mutates cylinders.

Only after those checks are stable should a narrow
`api/replay/supplier-return.php` endpoint be added.

## Explicitly Deferred

This audit does not add or expose replay execution for:

- Supplier Return
- standalone payments
- invoice cancellation or reversal
- stock adjustment
- standalone cylinder adjustment
- auto-sync
- background replay
- startup replay
- polling, listeners, or workers

Sale, Purchase, and Customer Return replay behavior remain unchanged.
