# Transaction Payload Reference

This document describes the current storage-only transaction sync payload shape plus the implemented dev replay processor behavior for validation, mutation planning, stock mutation, finalized sales/sale_items persistence, customer/supplier accounting summary mutation, payment ledger persistence, backend batch mutation, and cylinder/customer-cylinder mutation.

## Current Backend Storage

`api/transactions.php` currently accepts `POST` requests only. It validates required payload fields, computes an idempotency hash, stores the full transaction payload, and returns a storage-only response.

Current tables:

- `sync_transactions`
  - `id`
  - `client_transaction_id`
  - `transaction_type`
  - `payload_json`
  - `status`
  - `created_at`
  - `updated_at`
- `transaction_idempotency`
  - `id`
  - `client_transaction_id`
  - `transaction_type`
  - `status`
  - `request_hash`
  - `response_json`
  - `error_message`
  - `created_at`
  - `updated_at`

The endpoint currently returns:

```json
{
  "success": true,
  "data": {
    "accepted": true,
    "storedOnly": true,
    "clientTransactionId": "txn_...",
    "transactionType": "sale"
  }
}
```

`storedOnly: true` means no stock, accounting, payment, batch, cylinder, customer, supplier, or sale item mutation has been applied by the backend.

## Current Payload Structure

The top-level payload is `OfflineTransactionPayload`:

```json
{
  "transactionType": "sale",
  "clientTransactionId": "txn_1779000000000_abcd",
  "createdAt": 1779000000000,
  "payload": {}
}
```

Required top-level fields:

- `transactionType`
- `clientTransactionId`
- `createdAt`
- `payload`

`payload` must be an object.

## Current Storage-Only Validation Rules

`transactions.php` now performs shallow storage validation before storing a payload. This validation is intentionally limited to shape and basic type checks. It is not business replay validation.

Required top-level fields:

- `clientTransactionId`
- `transactionType`
- `createdAt`
- `payload`

Top-level validation rules:

- `clientTransactionId` must be present and non-empty.
- `transactionType` must be present, non-empty, and one of the accepted values.
- `createdAt` must be numeric.
- `payload` must be an object.

Accepted `transactionType` values:

- `sale`
- `return`
- `invoice_delete`
- `payment`
- `stock_adjustment`
- `cylinder_adjustment`

Shape validation by transaction type:

- `sale`
  - requires `payload.sale` as an object
  - requires `payload.saleItems` or `payload.items` as a non-empty array
- `return`
  - requires `payload.sale` as an object
  - requires `payload.saleItems` or `payload.items` as a non-empty array
  - requires `payload.returnMode` to be `customer` or `supplier`
- `invoice_delete`
  - requires `payload.invoice` as an object
  - requires `payload.saleItems` or `payload.items` as a non-empty array
- `payment`
  - requires `payload.payment` as an object
  - requires `payload.partyType` to be `customer` or `supplier`
- `stock_adjustment`
  - accepted as a reserved transaction type, but no business replay validation exists yet
- `cylinder_adjustment`
  - accepted as a reserved transaction type, but no business replay validation exists yet

Item array validation is shallow:

- each item must be an object
- `qty`, when present, must be numeric
- `price`, when present, must be numeric

Rejected malformed shapes include:

- malformed JSON
- missing required top-level fields
- unsupported `transactionType`
- non-object `payload`
- missing or non-object sale/invoice/payment objects for types that require them
- missing, non-array, or empty item arrays where required
- invalid `returnMode`
- invalid `partyType`
- non-numeric `createdAt`
- non-numeric `qty` or `price` when those fields are present

This storage validation does not confirm item existence, stock availability, batch availability, invoice uniqueness, customer/supplier validity, payment correctness, totals, taxes, discounts, or cylinder state. Replay processing now covers business references, deduction-style inventory sufficiency, mutation planning, stock mutation, finalized sales/sale_items persistence, customer/supplier accounting summary mutation, payment ledger persistence, backend batch mutation, and cylinder/customer-cylinder mutation when explicitly invoked by dev replay tests.

## Current Replay Business-Reference Validation

`api/lib/transactionReplayProcessor.php` performs business-reference checks before replay can apply stock, sales persistence, accounting summary mutation, and payment ledger persistence.

Implemented checks:

- `customerId` exists if provided anywhere in the transaction payload.
- `supplierId` exists if provided anywhere in the transaction payload.
- referenced customers and suppliers must not be soft-deleted.
- `saleItems` or `items`, when present, must be arrays.
- each item entry must be an object.
- each item entry must include `originalItemId` or `itemId`.
- referenced items must exist and must not be soft-deleted.

Failure behavior:

- the replay DB transaction rolls back
- `replay_status` becomes `failed`
- `replay_error` is populated with a safe validation message
- `replay_business_validation_failed` is written to `transaction_replay_audit`
- full payload bodies are not logged

Successful behavior:

- replay proceeds to inventory validation, mutation planning, stock mutation, finalized sales/sale_items persistence, and accounting summary mutation
- cylinder mutation occurs only for cylinder/gas items and non-cylinder items skip safely

Verified test status:

- `test:transactions:business-validation` => `18 passed, 0 failed`

## Current Replay Inventory Sufficiency Validation

`api/lib/transactionReplayProcessor.php` performs inventory sufficiency checks before applying deduction-style stock adjustments.

Implemented rules:

- referenced item rows must exist and be active
- deduction quantities must be numeric
- deduction quantities must be greater than zero
- `availableStock` must be present and numeric on the referenced item row
- `availableStock` must be sufficient for the total required deduction quantity per item

Transaction types checked:

- `Sale`
- supplier return / `returnMode: "supplier"`

Transaction types skipped for sufficiency checks:

- purchase-style payloads, because current POS semantics increase stock
- customer returns, because current POS semantics increase stock

Failure behavior:

- the replay DB transaction rolls back
- `replay_status` becomes `failed`
- `replay_error` is populated with a safe validation message
- `replay_inventory_validation_failed` is written to `transaction_replay_audit`
- no stock mutation is committed
- full payload bodies are not logged

Successful behavior:

- replay proceeds to mutation planning, stock mutation, finalized sales/sale_items persistence, and accounting summary mutation
- cylinder mutation occurs only for cylinder/gas items and non-cylinder items skip safely

Verified test status:

- `test:transactions:inventory-validation` => `15 passed, 0 failed`

## Current Replay Mutation Planning, Stock Mutation, Sales Persistence, Accounting Mutation, And Payment Persistence

`api/lib/transactionReplayProcessor.php` generates a deterministic in-memory mutation plan after payload shape, business-reference, and applicable inventory sufficiency validation succeeds. It then applies the `stockAdjustments` portion, persists finalized `sales`/`sale_items`, updates customer/supplier accounting summaries, and persists payment ledger rows when paid amount is non-zero.

Current returned plan shape:

```json
{
  "stockAdjustments": [],
  "accountingAdjustments": [],
  "paymentEffects": [],
  "cylinderEffects": [],
  "batchEffects": [],
  "warnings": []
}
```

Only `stockAdjustments` are currently populated and applied. Finalized sales/sale_items persistence, accounting summary mutation, and payment ledger persistence are derived from the sale/purchase/return payload after stock mutation succeeds. Current stock effect rules:

- `Sale` => stock `decrease`
- `Purchase` => stock `increase`
- `Customer Return` => stock `increase`
- `Supplier Return` => stock `decrease`

Each stock adjustment includes:

- `itemId`
- `transactionType`
- `direction`
- `qty`
- `reason`

Stock mutation behavior:

- only `items.availableStock` is mutated
- mutation runs inside the backend DB transaction
- item rows are locked with `FOR UPDATE`
- decreases re-check stock sufficiency immediately before update
- negative stock results are rejected
- any failure rolls back the full DB transaction
- terminal-state protection prevents duplicate stock mutation and duplicate sales insertion
- replay inserts one finalized `sales` row for sale/purchase/customer-return/supplier-return style payloads
- replay inserts linked `sale_items` rows from `payload.saleItems` or `payload.items`
- stock mutation and sales persistence run inside the same backend DB transaction
- any stock, sales persistence, accounting mutation, or payment persistence failure rolls back the full replay
- accounting runs after stock mutation and sales/sale_items persistence
- customer/supplier rows are locked with `FOR UPDATE`
- only `invoices`, `payable`, `paid`, and `balance` are mutated
- `balance = payable - paid`
- `invoices` increments by 1
- Sale updates customer summary
- Purchase updates supplier summary
- Customer Return updates customer summary with negative payable/paid deltas
- Supplier Return updates supplier summary with negative payable/paid deltas
- backend calculations are used instead of trusting client balance fields
- payment rows are persisted only when the effective paid amount is non-zero
- Sale and Customer Return write to `customer_payments`
- Purchase and Supplier Return write to `supplier_payments`
- return transactions use negative payment amounts
- missing payment tables are skipped safely

Audit events:

- `replay_mutation_plan_generated`
- `replay_stock_mutation_started`
- `replay_stock_mutation_completed`
- `replay_stock_mutation_failed`
- `replay_sales_persistence_started`
- `replay_sales_persistence_completed`
- `replay_sales_persistence_failed`
- `replay_accounting_mutation_started`
- `replay_accounting_mutation_completed`
- `replay_accounting_mutation_failed`
- `replay_payment_persistence_started`
- `replay_payment_persistence_completed`
- `replay_payment_persistence_failed`

Still not implemented:

- frontend/`syncEngine` replay wiring
- auto-sync

Verified test status:

- `test:transactions:mutation-planning` => `22 passed, 0 failed`
- `test:transactions:stock-mutation` => `28 passed, 0 failed`
- `test:transactions:sales-persistence` => `26 passed, 0 failed`
- `test:transactions:accounting-mutation` => `29 passed, 0 failed`
- `test:transactions:payment-persistence` => `65 passed, 0 failed`
## Current Payment Ledger Replay Mapping

Payment ledger persistence is now implemented for replayed sale, purchase, customer return, and supplier return payloads.

Current mapping:

- non-zero paid amount creates one payment ledger row
- `Sale` writes to `customer_payments`
- `Customer Return` writes to `customer_payments` with a negative amount
- `Purchase` writes to `supplier_payments`
- `Supplier Return` writes to `supplier_payments` with a negative amount
- payment rows are persisted inside the same backend DB transaction as stock mutation, sales/sale_items persistence, and accounting mutation
- payment persistence failure rolls back stock, sales, and accounting
- terminal-state protection prevents duplicate payment rows
- missing payment tables are skipped safely for development/shared-hosting compatibility

Payment rows are ledger records for replayed transactions. Accounting summaries remain backend-authoritative, and current replay does not recalculate summaries from payment rows.

Verified test status:

- `test:transactions:payment-persistence` => `65 passed, 0 failed`

Still deferred:

- frontend/`syncEngine` replay wiring
- auto-sync


## Current Batch Replay Mapping

Backend replay now mutates authoritative inventory batch records in `item_batches` when the replayed transaction has batch-relevant stock effects.

Current mapping:

- `Purchase` creates batch rows and records purchased quantity plus remaining balance.
- `Customer Return` creates/restocks batch rows from returned quantity.
- `Sale` consumes active batch balances.
- `Supplier Return` decrements/reverses active batch balances.
- explicit `batchId` in an item payload targets that batch.
- missing `batchId` uses FIFO consumption by purchase date and id.
- legacy payloads with no existing batch rows and no explicit `batchId` may skip batch mutation safely.
- explicit missing or insufficient batch inventory fails safely.

Atomicity and failure behavior:

- batch mutation runs inside the same backend DB transaction as stock, sales, accounting, and payment persistence.
- batch rows are locked before consumption.
- batch failure rolls back stock, sales, accounting, and payment changes.
- terminal-state protection prevents duplicate batch mutation.

Audit events:

- `replay_batch_mutation_started`
- `replay_batch_mutation_completed`
- `replay_batch_mutation_failed`

Verified test status:

- `test:transactions:batch-mutation` => `39 passed, 0 failed`

Still deferred:

- frontend/`syncEngine` replay wiring
- auto-sync

## Duplicate Idempotency Behavior

`clientTransactionId` is protected by the idempotency table.

Current behavior:

- new `clientTransactionId` and valid payload: stores a row in `sync_transactions`, writes a matching `transaction_idempotency` row, and returns `201`
- same `clientTransactionId` and same canonical payload: returns the saved response with `success: true`
- same `clientTransactionId` and different canonical payload: returns `409 Conflict`

This endpoint behavior is storage-only. It prevents duplicate storage/replay attempts from becoming ambiguous; the separate dev replay processor is responsible for the currently implemented stock, finalized sales/sale_items, accounting summary mutation, payment ledger persistence, and batch mutation path.

## Transaction Type Values

Current supported type names:

- `sale`
- `return`
- `invoice_delete`
- `payment`
- `stock_adjustment`
- `cylinder_adjustment`

The current frontend builders create:

- `sale`
- `return`
- `invoice_delete`
- `payment`

`stock_adjustment` and `cylinder_adjustment` are reserved for future dedicated workflows.

## clientTransactionId Usage

`clientTransactionId` is the stable idempotency key for the full logical transaction.

It must:

- Be generated before the local commit is queued.
- Stay unchanged across retries.
- Be stored as `sync_queue.localId`.
- Be stored in `sync_transactions.client_transaction_id`.
- Be stored in `transaction_idempotency.client_transaction_id`.

The same `clientTransactionId` with the same canonical payload hash returns the saved response. The same `clientTransactionId` with a different payload returns `409 Conflict`.

## Sale And Purchase Payload Structure

The current sale builder returns:

```json
{
  "transactionType": "sale",
  "clientTransactionId": "txn_...",
  "createdAt": 1779000000000,
  "payload": {
    "sale": {},
    "saleId": 123,
    "saleItems": [],
    "customer": {},
    "supplier": {},
    "stockMovements": [],
    "batchMutations": [],
    "cylinderMutations": []
  }
}
```

`sale.transactionType` or equivalent sale fields distinguish sale-like and purchase-like flows in the local app model.

Expected sale header fields may include:

- invoice number
- transaction type
- date
- customer or supplier reference
- subtotal
- discount
- tax
- grand total
- paid amount
- due/balance-related values

The backend must not blindly trust calculated totals. It should eventually recompute or validate totals from sale items, discounts, taxes, and payment rules.

## Return Payload Structure

The current return builder returns:

```json
{
  "transactionType": "return",
  "clientTransactionId": "txn_...",
  "createdAt": 1779000000000,
  "payload": {
    "returnMode": "customer",
    "sale": {},
    "saleId": 123,
    "saleItems": [],
    "customer": {},
    "supplier": {},
    "stockMovements": [],
    "batchMutations": [],
    "cylinderMutations": []
  }
}
```

`returnMode` values:

- `customer`
- `supplier`

The backend must use `returnMode` to choose customer-side or supplier-side accounting and inventory reversal rules.

## Invoice Delete Payload Structure

The invoice deletion builder returns:

```json
{
  "transactionType": "invoice_delete",
  "clientTransactionId": "txn_...",
  "createdAt": 1779000000000,
  "payload": {
    "invoice": {},
    "saleItems": [],
    "originalTransactionType": "Sale",
    "customer": {},
    "supplier": {},
    "stockMovements": [],
    "batchMutations": [],
    "cylinderMutations": []
  }
}
```

Future replay must reverse all effects atomically. The backend must verify that the invoice exists, was not already deleted, and belongs to the expected transaction type.

## Payment Payload Structure

The payment builder returns:

```json
{
  "transactionType": "payment",
  "clientTransactionId": "txn_...",
  "createdAt": 1779000000000,
  "payload": {
    "partyType": "customer",
    "payment": {},
    "customer": {},
    "supplier": {}
  }
}
```

`partyType` values:

- `customer`
- `supplier`

Standalone payments should be distinct from payments embedded in a sale or return payload.

## Item Payload Structure

Sale and return payloads include `saleItems`.

Expected item-level data may include:

- local item id
- server item id when available
- barcode or name
- quantity
- unit
- unit conversion data
- purchase/retail/discount/wholesale price fields
- discount or tax data
- line total

Dangerous values to trust directly:

- line totals
- converted quantities
- stock deltas
- batch deductions
- discount calculations
- tax calculations

The backend should eventually recalculate or validate these values against authoritative item, unit, price, discount, tax, and batch state.

## Payment Fields

Payment objects may include:

- party id
- party name
- amount
- date
- note or description
- invoice reference
- payment mode if added later

Dangerous values to trust directly:

- new balance
- paid total
- payable total
- invoice count

The backend transaction processor owns final balance mutation for sale, purchase, customer return, and supplier return replay. Current replay uses paid/totals metadata to update customer/supplier summaries and to create customer/supplier payment ledger rows when paid amount is non-zero. It still does not recalculate balances from payment rows or implement standalone payment replay beyond stored payment payload validation.

## Customer And Supplier Fields

Customer and supplier snapshots may include:

- `before`
- `after`
- embedded payment snapshot
- deleted payment snapshots for invoice deletion

Authoritative client fields:

- local reference ids
- visible profile snapshot for audit/debug context

Values that must be recomputed server-side:

- `invoices`
- `payable`
- `paid`
- `balance`

Customer/supplier accounting fields are dangerous to trust directly because a replay can otherwise duplicate or corrupt financial totals.

## returnMode Behavior

`returnMode` must drive the future backend rules:

- `customer`: reverse or reduce customer-facing sale effects.
- `supplier`: reverse or reduce supplier/purchase effects.

The backend should validate that the payload contains the correct party context for the return mode.

## Unit Conversion Considerations

Unit conversion affects stock and line quantity.

The backend must validate:

- item base unit
- min/max unit
- conversion quantity
- sale unit
- returned unit
- converted stock delta

Client-provided converted quantities are useful for audit but should not be blindly authoritative.

## Cylinder Considerations

Cylinder transactions may affect:

- cylinder inventory
- customer cylinder holdings
- gas/cylinder sale quantities
- cylinder returns
- cylinder deposits or related pricing if present

The backend must eventually process cylinder changes atomically with sale, return, or adjustment transactions. Cylinder rows must not be replayed as generic CRUD side effects.

## Fields Authoritative From Client

The client is authoritative for:

- `clientTransactionId`
- offline transaction creation time as a client timestamp
- local ids used to correlate offline records
- captured before/after snapshots for diagnostics
- user-entered note/description fields
- the user action intent represented by transaction type and payload shape

These are inputs to validation, not proof that all resulting values are correct.

## Values To Recompute Server-Side

The backend should recompute or strongly validate:

- item stock deltas
- batch deltas
- customer balances
- supplier balances
- invoice counts
- payable totals
- paid totals
- sale totals
- return totals
- tax totals
- discount totals
- cylinder quantities
- payment totals

## Dangerous Values To Trust Directly

Do not blindly trust:

- `balance`
- `paid`
- `payable`
- `invoices`
- `availableStock`
- batch quantities
- cylinder quantities
- line totals
- grand totals
- converted quantities
- client-supplied server ids without lookup
- deleted flags for transactional records

## Mutations That Must Be Atomic

The future backend transaction processor must atomically mutate:

- sale header (implemented for current sale/purchase/return replay)
- sale items (implemented for current sale/purchase/return replay)
- payment rows
- customer balance (implemented for current sale/purchase/return replay summaries)
- supplier balance (implemented for current sale/purchase/return replay summaries)
- item stock
- batch stock
- cylinder inventory
- customer cylinder holdings
- invoice deletion/reversal state
- idempotency status

If any part fails, all parts must roll back.

## Future Validations Required

Before real replay:

- Validate auth/session/user permission.
- Validate `clientTransactionId` uniqueness and hash.
- Validate transaction type.
- Validate party existence.
- Validate item existence.
- Validate stock availability.
- Validate batch availability.
- Validate cylinder availability.
- Validate invoice number uniqueness.
- Validate return source invoice if applicable.
- Validate payment amount rules.
- Validate totals against server-side calculations.
- Validate deleted/archived records are not mutated unexpectedly.

## Future Replay Ownership Notes

The backend transaction processor must own all durable server mutations.

`syncEngine` should:

- send the queued transaction payload
- receive success/failure
- mark the queue row accordingly
- avoid computing stock
- avoid computing accounting
- avoid mutating cylinders or batches directly

CRUD mirrors must remain separate from transactional state.

## Current Cylinder Replay Mapping

Backend replay now mutates cylinder inventory and customer-cylinder holding rows for cylinder/gas items when replay is explicitly invoked by backend tooling.

Cylinder/gas detection:

- item category contains `gas` or `cylinder`
- or an existing `cylinders` row exists for the referenced item
- non-cylinder items skip safely

Current mapping:

- `Sale`: `filledCylinders` decreases, `withCustomers` increases, customer holding is created or updated.
- `Customer Return`: `withCustomers` decreases, `emptyCylinders` increases, customer holding is reduced.
- `Purchase`: `filledCylinders` increases and `qtyInStock` increases.
- `Supplier Return`: `filledCylinders` decreases and `qtyInStock` decreases.

Validation and atomicity:

- cylinder rows are locked with `FOR UPDATE`
- customer-cylinder holding rows are locked with `FOR UPDATE` when applicable
- customer returns reject insufficient held cylinders
- negative cylinder counts are rejected
- `qtyInStock = filledCylinders + emptyCylinders + withCustomers` is enforced
- cylinder failure rolls back stock, sales, sale_items, accounting, payment, batch, and cylinder changes
- terminal-state protection prevents duplicate cylinder mutation

Audit events:

- `replay_cylinder_mutation_started`
- `replay_cylinder_mutation_completed`
- `replay_cylinder_mutation_failed`

Verified test status:

- `test:transactions:cylinder-mutation` => `46 passed, 0 failed`

