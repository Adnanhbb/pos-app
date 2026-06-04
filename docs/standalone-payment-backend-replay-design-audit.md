# Standalone Payment Backend Replay Design Audit

This audit prepares backend-authoritative replay for standalone Customer and
Supplier payments only. The design audit has now been followed by payload
hardening for create-only standalone payment queue rows. No backend payment
replay endpoint, backend payment mutation, finalized transaction replay change,
auto-sync, polling, workers, listeners, startup replay, or invoice cancellation
behavior is added.

Project rule: the current IndexedDB behavior is the reference implementation
unless a behavior is explicitly identified as a business bug and fixed in a
separate task.

## Scope

In scope:

- `CustPayments.tsx`
- `SupPayments.tsx`
- `customer_payments`
- `supplier_payments`
- customer/supplier `paid` and `balance` effects caused by standalone payment
  create/update/delete
- `payableSnapshot` and `balanceSnapshot` handling

Out of scope:

- Sale/Purchase/Customer Return/Supplier Return replay behavior
- standalone Payment replay endpoint implementation
- POS finalization behavior
- invoice cancellation/reversal
- auto-sync/background sync

## Current Frontend Entry Points

Customer standalone payments use:

- UI: `src/CustPayments.tsx`
- repository: `indexedDbCustomerPaymentRepository`
- DB helpers: `addCustomerPayment`, `updateCustomerPayment`,
  `deleteCustomerPayment`

Supplier standalone payments use:

- UI: `src/SupPayments.tsx`
- payment repository: `indexedDbSupplierPaymentRepository`
- supplier repository: `indexedDbSupplierRepository`
- DB helpers: `addSupplierPayment`, `updateSupplierPayment`,
  `deleteSupplierPayment`, `updateSupplier`

Both pages still preserve their existing local IndexedDB payment behavior. On
successful create only, they now enqueue a safe future-replay payload with
`standaloneCustomerPaymentReplay` v1 or `standaloneSupplierPaymentReplay` v1
readiness metadata. They do not call backend payment replay endpoints and do not
mark standalone payments as backend-replayed.

## Current IndexedDB Customer Payment Behavior

### Create

Visible in the Customer Payments UI.

Input:

- selected `customerId`
- positive `amount`
- `paymentDate`
- optional `remarks`
- `payableSnapshot` from the selected customer's current `balance`

Local write:

- inserts one `customer_payments` row
- stores:
  - `customerId`
  - `amount`
  - `paymentDate`
  - `remarks`
  - `payableSnapshot`
  - `balanceSnapshot = currentBalance - amount`
- the repository helper does not preserve `customerName` or `invoiceNo` from
  the UI payload; the DB helper writes only the fields above.

Customer summary mutation:

- `paid = existing paid + amount`
- `balance = existing balance - amount`
- `payable` is not changed
- `invoices` is not changed

### Update

Code exists, but the current UI does not expose an edit button in the table or
card actions. `openEdit()` and update helpers are present but not reachable from
normal visible controls.

If called, local behavior is:

- overwrites the payment row by `id`
- sets `payableSnapshot` from the form value, or current customer balance
- sets `balanceSnapshot = payableSnapshot - amount`
- sets customer `paid = amount`
- sets customer `balance = balanceSnapshot`

This does not apply a delta from the old payment amount. Before backend replay
implementation, this should be reviewed as a likely local behavior bug rather
than blindly mirrored.

### Delete

Visible in the Customer Payments UI.

Local behavior:

- loads the payment row
- if the customer exists:
  - `paid = existing paid - payment.amount`
  - `balance = customer.payable - newPaid`
- hard-deletes the `customer_payments` row

There is no payment soft-delete/restore model.

## Current IndexedDB Supplier Payment Behavior

### Create

Visible in the Supplier Payments UI.

Input:

- selected `supplierId`
- positive `amount`
- `paymentDate`
- optional `remarks`
- UI computes `currentPayable = supplier.payable - supplier.paid`

Local write:

- inserts one `supplier_payments` row
- stores:
  - `supplierId`
  - `amount`
  - `paymentDate`
  - `remarks`
  - `payableSnapshot = currentPayable`
  - `balanceSnapshot = currentPayable - amount`
- the DB payment helper intentionally saves the row only and does not update the
  supplier summary.

Supplier summary mutation:

- the UI then calls `supplierRepo.update()`
- `paid = existing paid + amount`
- `balance = supplier.payable - (existing paid + amount)`
- `payable` is not changed
- `invoices` is not changed

Because accounting fields changed, `suppliersRepository.update()` stores this
locally only and does not send supplier profile CRUD to MySQL.

### Update

Code exists, but the current UI does not expose an edit button in the table or
card actions. `openEdit()` and update helpers are present but not reachable from
normal visible controls.

If called, local behavior is split:

- `updateSupplierPayment()` computes a delta from the old payment row and writes
  supplier `paid`/`balance`
- `SupPayments.tsx` then also calls `supplierRepo.update()` using the stale
  supplier object and `paid + form.amount`

This double path can drift from intended delta semantics. Before backend replay
implementation, this should be reviewed/fixed separately if edit support is
made visible or included in replay scope.

### Delete

Visible in the Supplier Payments UI.

Local behavior:

- loads the payment row
- if the supplier exists:
  - `paid = existing paid - payment.amount`
  - `balance = supplier.payable - newPaid`
- hard-deletes the `supplier_payments` row

There is no payment soft-delete/restore model.

## Current Queue And Backend State

Standalone payment pages now queue create-only replay payloads after the local
payment save and party summary mutation succeeds. The queued payloads are
diagnostic/future-replay contracts only.

Implemented queue contracts:

- `standaloneCustomerPaymentReplay` v1
- `standaloneSupplierPaymentReplay` v1

Each contract includes:

- `operation = "create"`
- `localPaymentId`
- generated or provided `clientPaymentId`
- `clientTransactionId`
- party local id, backend `serverId`, and name snapshot
- amount, payment date, remarks, invoice number, payable snapshot, and balance
  snapshot
- `replayReadiness` with `ready` or `unsafe` status

Ready requires:

- local payment id
- mapped customer/supplier backend `serverId`
- positive finite amount
- non-empty payment date

Unsafe payment rows remain local-valid and queueable. They are annotated with
safe reason codes and are not eligible for backend payment replay.

Existing generic transaction storage can accept `transactionType = "payment"`
with:

- top-level `clientTransactionId`
- top-level `createdAt`
- `payload.payment` object
- `payload.partyType` of `customer` or `supplier`

This remains storage-shape validation only. The frontend now validates party
mappings, amount/date readiness, and safe snapshots in the queued payload before
future replay. The manual replay router explicitly blocks standalone payment
backend replay with a safe "not implemented yet" error, and `transactionApi`
has no standalone payment replay endpoint.

## MySQL Schema Readiness

`customer_payments` contains:

- `id`
- `customerId`
- `customerName`
- `invoiceNo`
- `amount`
- `paymentDate`
- `remarks`
- `payableSnapshot`
- `balanceSnapshot`
- `sync_transaction_id`
- `client_transaction_id`
- `sale_id`
- `source`
- `created_at`

`supplier_payments` contains equivalent supplier fields:

- `id`
- `supplierId`
- `supplierName`
- `invoiceNo`
- `amount`
- `paymentDate`
- `remarks`
- `payableSnapshot`
- `balanceSnapshot`
- `sync_transaction_id`
- `client_transaction_id`
- `sale_id`
- `source`
- `created_at`

The schema is close enough for insert-only standalone payment replay metadata,
but likely needs one or both of the following before update/delete replay is
safe:

- a stable `client_payment_id` or equivalent idempotency key per payment row
- explicit operation metadata for create/update/delete payment actions

`customers` and `suppliers` already have the accounting fields affected by
standalone payments:

- `payable`
- `paid`
- `balance`
- `invoices`

Standalone payments should not mutate `payable` or `invoices` unless a separate
business rule is introduced.

## Contract Recommendation

Use two narrow replay contracts and endpoints, backed by shared internal helper
code:

- `standaloneCustomerPaymentReplay` v1
- `standaloneSupplierPaymentReplay` v1

Do not use one public generic `PartyPaymentReplay` endpoint for the first
implementation. Customer and supplier payments are similar, but the project's
safe replay pattern has favored narrow endpoints per business type. Separate
contracts make it harder to accidentally apply a customer payment to a supplier
table or vice versa.

Shared internal helper code can normalize common fields such as amount, date,
remarks, snapshots, idempotency, and audit events.

## Proposed Customer Payment Contract

```json
{
  "payloadVersion": 1,
  "operation": "create",
  "partyType": "customer",
  "localPaymentId": 123,
  "clientPaymentId": "local-customer-payment-123",
  "clientTransactionId": "customer-payment-...",
  "createdAt": 1770000000000,
  "payment": {
    "amount": 100,
    "paymentDate": "2026-06-04",
    "remarks": "Standalone customer payment",
    "invoiceNo": "",
    "payableSnapshot": 500,
    "balanceSnapshot": 400
  },
  "customer": {
    "localId": 12,
    "serverId": 44,
    "nameSnapshot": "Customer name"
  },
  "accountingEffect": {
    "paidDelta": 100,
    "balanceDelta": -100,
    "payableDelta": 0,
    "invoiceDelta": 0
  },
  "replayReadiness": {
    "scope": "standalone_customer_payment",
    "payloadVersion": 1,
    "status": "ready",
    "reasons": []
  }
}
```

## Proposed Supplier Payment Contract

```json
{
  "payloadVersion": 1,
  "operation": "create",
  "partyType": "supplier",
  "localPaymentId": 456,
  "clientPaymentId": "local-supplier-payment-456",
  "clientTransactionId": "supplier-payment-...",
  "createdAt": 1770000000000,
  "payment": {
    "amount": 100,
    "paymentDate": "2026-06-04",
    "remarks": "Standalone supplier payment",
    "invoiceNo": "",
    "payableSnapshot": 500,
    "balanceSnapshot": 400
  },
  "supplier": {
    "localId": 18,
    "serverId": 55,
    "nameSnapshot": "Supplier name"
  },
  "accountingEffect": {
    "paidDelta": 100,
    "balanceDelta": -100,
    "payableDelta": 0,
    "invoiceDelta": 0
  },
  "replayReadiness": {
    "scope": "standalone_supplier_payment",
    "payloadVersion": 1,
    "status": "ready",
    "reasons": []
  }
}
```

## Required Replay Rules

For create replay:

- require `replayReadiness.status = "ready"`
- require `payloadVersion = 1`
- require explicit `serverId` for the customer or supplier
- require positive finite `amount`
- treat local payment id only as a correlation reference
- insert one payment ledger row with `source = "standalone_payment_replay"`
- update party `paid` and `balance` in the same MySQL transaction
- do not mutate `payable` or `invoices`
- write replay audit metadata
- mark the stored transaction committed only after all writes succeed

For update/delete replay:

- defer until local update semantics are reviewed and a stable server payment
  mapping exists
- do not infer a backend payment row by amount/date/name alone
- update/delete must be idempotent and must reverse old effects exactly

## Unsafe Reason Codes

Implemented and planned reason codes for payload hardening:

- `missing_standalone_customer_payment_replay_contract`
- `missing_standalone_supplier_payment_replay_contract`
- `unsupported_payment_operation`
- `missing_local_payment_id`
- `missing_party_server_id`
- `invalid_payment_amount`
- `missing_payment_date`
- `missing_client_payment_id`
- `missing_customer_server_id`
- `missing_supplier_server_id`
- `missing_payment_amount`
- `missing_accounting_effect`
- `missing_payment_server_mapping`
- `payment_update_semantics_unverified`
- `payment_delete_semantics_unverified`

## Idempotency Strategy

Use `clientTransactionId` for the stored replay row and transaction-level
idempotency, and add a stable payment-level idempotency key such as
`clientPaymentId`.

Recommended backend protections:

- `sync_transactions.client_transaction_id` remains unique
- payment ledger rows should store `client_transaction_id`
- add or enforce a unique payment-level key before update/delete replay
- second replay of a committed payment must terminal-state skip without
  inserting another payment row or mutating party totals again

## Endpoint Readiness Gaps

Payload hardening now exists, but backend endpoint implementation still needs
explicit work because:

- customer/supplier local rows may not have `serverId`
- update behavior is present in code but not visible in UI and has risky local
  semantics
- delete behavior hard-deletes local payment rows, so a future delete replay
  needs a tombstone/snapshot before the local row disappears
- no `api/replay/customer-payment.php` or `api/replay/supplier-payment.php`
  endpoint exists
- no backend payment-row idempotency key has been added yet beyond the stored
  transaction metadata

## Recommended Next Step

Payload hardening has been completed for create-only standalone Customer and
Supplier payments.

Recommended next slice, when explicitly approved:

1. Add narrow manual backend endpoints for ready Customer Payment create and
   Supplier Payment create.
2. Store each payment with backend idempotency metadata.
3. Mutate party `paid` and `balance` in one backend transaction.
4. Reject unsafe or unmapped rows before mutation.
5. Keep update/delete replay deferred until local semantics and tombstones are
   explicitly designed.
6. Add backend idempotency and duplicate-replay tests.

Only after that should narrow manual endpoints be implemented for ready
standalone Customer Payment create and Supplier Payment create.

## Explicit Non-Changes

This audit does not:

- implement `api/replay/customer-payment.php`
- implement `api/replay/supplier-payment.php`
- route manual replay for standalone payments
- change customer/supplier balance behavior
- change finalized Sale/Purchase/Return replay
- add backend standalone Payment replay
- add auto-sync/background behavior
- re-enable invoice cancellation
