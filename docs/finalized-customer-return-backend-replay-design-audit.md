# Finalized Customer Return Backend Replay Design Audit

Status: queue payload hardening and manual backend replay endpoint implemented.
Customer Return replay remains manual-only and gated to replay-ready
`finalizedCustomerReturnReplay` v1 rows.

This document records the backend-authoritative replay path for finalized
Customer Return transactions only. The current IndexedDB Customer Return
finalization path remains the reference implementation. MySQL replay must
match that local behavior exactly and uses the same manual, idempotent,
contract-gated pattern already used for finalized Sale and finalized Purchase
replay.

This implementation does not change successful local POS behavior, does not
change Sale or Purchase replay, and does not add Supplier Return replay,
standalone payment replay, auto-sync, polling, listeners, workers, startup
replay, or background replay.

## Current Local Customer Return Outcome

The local POS flow treats Customer Return as `transactionType: "Return"` with
`returnMode: "customer"`.

`src/POS.tsx` preflights the return before local persistence:

- missing return mode defaults to customer return for Return transactions;
- stock-increasing UI behavior applies to Customer Return;
- cylinder Customer Return lines require a mapped cylinder row;
- cylinder Customer Return rejects before persistence if the selected customer
  does not hold enough cylinders;
- supplier-return batch consumption rules are not used for Customer Return.

After validation, `src/services/localPOSFinalizationService.ts` commits the
following stores in one IndexedDB `readwrite` transaction:

| Store | Current finalized Customer Return outcome |
| --- | --- |
| `sales` | Adds one header with `transactionType: "Return"`, customer context, `RET-C` invoice number, negative paid amount, return totals, profit impact, and `isPostponed` state. |
| `sale_items` | Adds one row per returned cart line linked to the local sale id. |
| `items` | Increases `availableStock` by each returned quantity. |
| `item_batches` | Creates a new return batch per returned cart line with `qtyPurchased = qty`, `qtySold = 0`, `balance = qty`, `costPrice = original item cost`, `invoiceNo = RET-C...`, and `sourceSaleId = local sale id`. |
| `customers` | For a selected customer, decreases `payable` by the return amount, adds a negative paid value when payment is entered, recomputes `balance`, and increments `invoices`. |
| `customer_payments` | Creates a payment row only when the effective paid amount is non-zero. The amount is negative and remarks use `Return adjustment <invoiceNo>`. |
| `cylinders` | For cylinder/gas return lines, decreases `withCustomers`, increases `emptyCylinders`, leaves `filledCylinders` unchanged, and preserves the existing `qtyInStock = filled + empty + withCustomers` invariant. |
| `cylinder_customers` | Decreases the selected customer's holding for the returned cylinder quantity. Missing/insufficient holding rejects before persistence. |

For Customer Return, local accounting uses the current invoice math:

- `baseAmount = subtotal - discount + tax`;
- `invoicePayable = dues - baseAmount`;
- `grandTotal = dues - baseAmount`;
- `paid` is stored as `-abs(paidAmountRaw)`;
- `arrears = grandTotal - paid`;
- selected customer `payable` decreases by `baseAmount`;
- selected customer `paid` increases by the negative effective paid value;
- selected customer `balance = payable - paid`;
- selected customer `invoices` increments by 1.

Invoice numbering uses the existing `RET-C` prefix and must remain unchanged.

## Current Queue Behavior

After the local IndexedDB transaction commits, `src/POS.tsx` calls
`buildReturnTransactionPayload(...)`. Completed, non-postponed Customer Return
rows now include a hardened `finalizedCustomerReturnReplay` v1 contract:

- outer `transactionType: "return"`;
- `payload.returnMode: "customer"`;
- `payload.sale` with local Customer Return header;
- local `saleId`;
- local-id-based `saleItems`;
- `payload.finalizedCustomerReturnReplay` v1;
- top-level `replayReadiness` copied from the contract.

The hardened Customer Return queue envelope omits broad customer, supplier,
stock, batch, and cylinder snapshots for finalized Customer Return rows. Local
IndexedDB ids remain correlation metadata only. Future MySQL mutation targets
must use explicit backend `serverId` fields from the contract.

Supplier Return still uses the existing generic return payload and is not
migrated by this Customer Return hardening.

## Existing MySQL And Backend Coverage

The current schema already has the core tables needed for Customer Return
replay:

- `sync_transactions`
- `transaction_replay_audit`
- `sales`
- `sale_items`
- `items`
- `item_batches`
- `customers`
- `customer_payments`
- `cylinders`
- `cylinder_customers`

The internal replay primitives in `api/lib/transactionReplayProcessor.php`
already understand Customer Return direction in broad form:

- stock planning treats Customer Return as an item stock increase;
- accounting mutation applies negative payable and paid deltas to customers;
- customer payment persistence writes negative customer payment rows;
- batch mutation creates batch rows for Customer Return;
- cylinder mutation decreases customer holding, increases empty cylinders, and
  leaves filled cylinders unchanged.

These helpers are used through a Customer Return-specific adapter. The broad
processor is not exposed directly; `api/lib/finalizedCustomerReturnReplayV1.php`
validates `finalizedCustomerReturnReplay` v1 and constructs an in-memory
server-id-only envelope before calling shared mutation helpers.

## Customer Return Differences From Sale Replay

| Concern | Finalized Sale v1 | Required Customer Return v1 |
| --- | --- | --- |
| Stored transaction type | Existing queue envelope uses outer `sale`. | Existing queue envelope uses outer `return` with `returnMode: "customer"`. |
| Stock | Decrease mapped item stock. | Increase mapped item stock. |
| Batches | Consume an exact existing mapped batch. | Create one backend return batch per local return batch. |
| Party | Optional selected customer. | Selected customer is required when customer accounting or cylinder holding mutation applies. |
| Accounting | Increase customer payable and optionally paid. | Decrease customer payable and apply negative paid amount. |
| Payment ledger | Optional positive `customer_payments` row. | Optional negative `customer_payments` row with Return adjustment remarks. |
| Cylinders | Move filled cylinders to with-customer holding. | Move with-customer holding to empty cylinders; filled cylinders unchanged. |
| Validation | Requires sufficient item/batch/cylinder stock before decrease. | Requires mapped item/cylinder rows and sufficient customer cylinder holding when cylinder lines are returned. |

## Implemented `finalizedCustomerReturnReplay` V1 Contract

The Customer Return-specific contract keeps local finalization successful even
when backend replay readiness is unsafe:

```json
{
  "payloadVersion": 1,
  "transactionType": "Return",
  "returnMode": "customer",
  "localSaleId": 12,
  "invoiceNo": "RET-C-0001",
  "clientTransactionId": "txn_...",
  "createdAt": 1770000000000,
  "customer": {
    "localId": 7,
    "serverId": 42,
    "nameSnapshot": "Customer snapshot"
  },
  "items": [
    {
      "localItemId": 17,
      "serverItemId": 99,
      "nameSnapshot": "Returned item snapshot",
      "qty": 2,
      "price": 120,
      "costPrice": 85,
      "unit": "min",
      "conversion": {
        "convQty": 1,
        "unitMode": "min"
      },
      "returnBatchCreate": {
        "localBatchId": 31,
        "sourceSaleId": 12,
        "qtyReturned": 2,
        "balance": 2,
        "costPrice": 85,
        "invoiceNo": "RET-C-0001"
      }
    }
  ],
  "payments": {
    "paidAmount": -50,
    "source": "customer-return"
  },
  "cylinders": [
    {
      "localItemId": 17,
      "serverItemId": 99,
      "localCylinderId": 5,
      "serverCylinderId": 8,
      "localHoldingId": 9,
      "customerNameSnapshot": "Customer snapshot",
      "qtyReturned": 1,
      "emptyIncrease": 1,
      "withCustomerDecrease": 1,
      "filledDelta": 0
    }
  ],
  "totals": {
    "subtotal": 240,
    "discount": 0,
    "tax": 0,
    "dues": 500,
    "grandTotal": 260,
    "paid": -50,
    "arrears": 310
  },
  "replayReadiness": {
    "scope": "finalized_customer_return",
    "status": "ready",
    "reasons": []
  }
}
```

The queue row should copy this readiness summary to its top-level
`replayReadiness` field. `ready` means the row is eligible for explicit manual
backend replay later. `unsafe` keeps the local Customer Return valid and queued
but blocks backend-authoritative replay.

## Required Readiness Rules

Customer Return readiness should be `unsafe` when any required mapping is
missing or inconsistent.

Required unsafe reason codes:

- `missing_finalized_customer_return_replay_contract`
- `missing_local_sale_id`
- `missing_customer_server_id`
- `missing_server_item_id`
- `missing_return_batch_create_metadata`
- `missing_cylinder_mapping`
- `missing_server_cylinder_id`
- `missing_customer_holding_reference`
- `insufficient_customer_cylinder_holding`
- `invalid_customer_return_cylinder_delta`

Customer Return should not have a Direct Return path. If customer accounting or
cylinder holding mutation is involved, a mapped customer server id is required.

## Implemented Endpoint Contract

The narrow endpoint is:

```http
POST /api/replay/customer-return.php
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

- outer stored transaction type compatible with current return storage;
- `payload.returnMode === "customer"`;
- header `transactionType: "Return"`;
- `isPostponed !== true`;
- `finalizedCustomerReturnReplay.payloadVersion === 1`;
- `finalizedCustomerReturnReplay.transactionType === "Return"`;
- `finalizedCustomerReturnReplay.returnMode === "customer"`;
- `replayReadiness.status === "ready"`;
- no readiness reasons.

Required sequence:

1. Authenticate and authorize before lock acquisition.
2. Load the stored transaction by `clientTransactionId`.
3. Validate Customer Return-only contract and server mappings.
4. Lock replay metadata and enforce terminal-state protection.
5. Begin one MySQL transaction.
6. Lock mapped items, selected customer, optional cylinders, and required
   active cylinder holding rows.
7. Validate arithmetic, return batch metadata, cylinder deltas, customer
   holding sufficiency, and invoice ownership.
8. Insert one `sales` Customer Return header and linked `sale_items`.
9. Increase mapped item stock.
10. Create backend return batch rows from the explicit return-batch contract.
11. Update selected customer summary and create optional non-zero negative
    `customer_payments` row.
12. Apply optional mapped cylinder Customer Return mutation: decrease
    `withCustomers`, increase `emptyCylinders`, leave `filledCylinders`
    unchanged, and decrease the matching customer holding.
13. Align customer payment `payableSnapshot` with local invoice payable
    including prior dues.
14. Commit, release lock as committed, and return safe metadata only.

## Idempotency Strategy

Use `clientTransactionId` as the stable logical Customer Return replay key.

Required protections:

- `transaction_idempotency.client_transaction_id` remains unique;
- `sync_transactions.client_transaction_id` remains unique;
- `sales.sync_transaction_id` remains unique;
- `sales.client_transaction_id` remains unique;
- terminal committed replay short-circuits before mutation;
- retry never duplicates Customer Return header, line items, stock increase,
  created return batches, customer summary mutation, payment ledger row,
  cylinder movement, or customer holding mutation;
- conflicting invoice number ownership is rejected safely.

`invoiceNo` is a conflict check, not the primary idempotency key.

## Minimal Reuse Strategy

Do not expose or broaden `replayStoredTransaction(...)`.

Keep a separate Customer Return endpoint and a separate
contract-specific adapter parallel to the Sale and Purchase v1 adapters. Reuse
internal mutation primitives only after the adapter builds a server-id-only
in-memory envelope.

Small shared helpers may be extracted later where duplication is mechanical:

- stored transaction lookup by `clientTransactionId`;
- terminal-state and replay-lock handling;
- numeric and required-string validators;
- invoice ownership check;
- safe endpoint response formatting;
- payment snapshot alignment with the correct ledger table;
- server-id-only envelope construction for stock-increase batch-creation
  transactions.

## Payload Readiness Gaps

The queue contract, queue-readiness fixture, and manual backend replay endpoint
now exist. The fixture still does not call backend replay; the backend replay
verifier uses isolated MySQL fixture rows and calls the adapter explicitly.

Completed prerequisites:

1. Completed: add `finalizedCustomerReturnReplay` v1 builder types and readiness
   diagnostics.
2. Completed: capture locally created Customer Return batch ids after atomic
   local commit.
3. Completed: store explicit mapped backend item ids and selected customer id.
4. Completed: capture optional mapped cylinder and holding metadata for
   cylinder returns.
5. Completed: keep local Customer Return finalization successful even when replay
   readiness is unsafe.
6. Completed: add a safe verifier for ready and unsafe Customer Return
   payloads.
7. Completed: add a queue-readiness fixture that does not call a backend
   Customer Return replay endpoint.
8. Completed: implement the narrow manual endpoint after ready/unsafe payload
   classifications were stable.

Remaining prerequisites for broader replay work:

1. Keep Supplier Return and standalone payment replay separate.
2. Keep future background/auto-sync gated by the existing eligibility checks.

## Explicitly Deferred

This audit and implementation do not add or expose replay execution for:

- Supplier Return
- standalone payments
- invoice cancellation or reversal
- stock adjustment
- standalone cylinder adjustment
- auto-sync
- background replay
- startup replay
- polling, listeners, or workers

Sale and Purchase replay behavior remain unchanged.
