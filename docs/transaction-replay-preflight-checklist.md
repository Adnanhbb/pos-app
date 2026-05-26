# Transaction Replay Preflight Checklist

This checklist defines the requirements that must be satisfied before backend transaction replay is broadened beyond the current stock, finalized sales/sale_items, accounting summary mutation, payment ledger persistence, and batch mutation layer. The current `transactions.php` endpoint is storage-only with shallow validation; dev replay helpers now validate, plan, mutate `items.availableStock`, persist finalized sales/sale_items, update customer/supplier accounting summaries, and persist payment ledger rows.

## Current Baseline

- `transactions.php` stores validated payloads only.
- Shallow transaction storage validation is active.
- Transaction storage validation tests pass: `22 passed, 0 failed`.
- Transaction replay lock primitive tests pass: `8 passed, 0 failed`.
- Transaction replay skeleton tests pass: `9 passed, 0 failed`.
- Transaction business-reference validation tests pass: `18 passed, 0 failed`.
- Transaction terminal-state protection tests pass: `10 passed, 0 failed`.
- Transaction inventory sufficiency validation tests pass: `15 passed, 0 failed`.
- Transaction mutation planning tests pass: `22 passed, 0 failed`.
- Transaction stock mutation tests pass: `28 passed, 0 failed`.
- Transaction sales persistence tests pass: `26 passed, 0 failed`.
- Transaction accounting mutation tests pass: `29 passed, 0 failed`.
- Transaction payment persistence tests pass: `65 passed, 0 failed`.
- Transaction batch mutation tests pass: `39 passed, 0 failed`.
- Transaction replay mutates `items.availableStock`, persists finalized `sales`/`sale_items`, updates customer/supplier accounting summaries, and persists payment ledger rows for non-zero paid amounts. Cylinder mutation is now performed for cylinder/gas items inside the replay DB transaction.
- Low-risk sync remains stable.
- No auto-sync exists.

## Implemented Terminal-State Protection Baseline

Terminal replay states are protected before any replay lock or stock mutation is attempted:

- `committed`
- `rolled_back`
- `duplicate`

Rows in these states short-circuit before replay lock acquisition. The processor does not acquire a lock, does not change `locked_at` or `locked_by`, and does not increment `replay_attempts`.

The returned safe metadata includes `terminalStateSkipped: true`. For `committed` rows, `alreadyCommitted` compatibility is preserved. A safe audit event is written:

- `replay_terminal_state_skipped`

This baseline protects already committed stock mutations, finalized sales/sale_items insertion, customer/supplier accounting mutation, and payment ledger persistence from running again. It now updates cylinder inventory and customer-cylinder holdings for cylinder/gas items.

Verified result:

- `test:transactions:terminal-protection => 10 passed, 0 failed`

## Database Schema Requirements

Before replay is implemented, the backend schema must include all tables needed to represent final server truth.

Required schema areas:

- sales or transaction headers
- sale/purchase/return line items
- items and stock totals
- item batches if batch tracking is enabled
- customers
- suppliers
- customer payments
- supplier payments
- customer cylinder holdings
- transaction idempotency
- transaction audit logs
- transaction replay status/errors

Schema must support:

- server primary keys
- client transaction id references
- timestamps
- soft delete/reversal state where appropriate
- indexes for lookup and locking
- foreign keys where shared hosting MySQL/MariaDB configuration allows them

## Idempotency Requirements

Replay must be idempotent before it mutates any business state.

Required behavior:

- Every replay uses `clientTransactionId` as the idempotency key.
- Same `clientTransactionId` and same canonical payload returns the stored response.
- Same `clientTransactionId` and different canonical payload returns `409 Conflict`.
- A transaction already completed must never apply stock/accounting/payment/cylinder mutations a second time.
- Idempotency status must be updated inside the same DB transaction as business mutations.
- Idempotency response must be safe to return on retry.

## Transaction Locking Requirements

Replay must protect shared records from concurrent updates.

Required locking or equivalent protection:

- lock affected item rows before stock mutation
- lock affected batch rows before batch mutation
- lock affected customer/supplier rows before accounting mutation
- lock affected invoice/sale rows before deletion or reversal
- lock affected cylinder rows before cylinder mutation
- lock idempotency row before processing duplicate replay

For MySQL/MariaDB, `SELECT ... FOR UPDATE` inside a transaction is the expected baseline where available.


## Implemented Lock Primitive Baseline

Replay lock helpers now exist in `api/lib/transactionReplayLock.php`:

- `acquireReplayLock($pdo, $syncTransactionId, $workerId)`
- `releaseReplayLock($pdo, $syncTransactionId, $workerId, $finalStatus = null, $error = null)`

Current tested behavior:

- a stored transaction can be locked for future replay preparation
- a second worker cannot acquire the same locked row
- a worker that does not own the lock cannot release it
- the owning worker can release the lock
- `replay_attempts` increments once on acquisition
- lock acquire/release/failure attempts create safe `transaction_replay_audit` rows

Allowed pre-processing states for acquisition are currently `stored` and `failed`. Acquisition moves the row to `processing`; release can return it to a metadata status such as `stored`, `failed`, or `rolled_back`.

These helpers are replay primitives. The replay processor uses them for validation and stock plus sales persistence, but the helpers themselves do not inspect payload bodies or mutate business tables.


## Implemented Replay Skeleton Baseline

A backend skeleton helper now exists in `api/lib/transactionReplayProcessor.php`:

- `replayStoredTransaction($pdo, $syncTransactionId, $workerId)`

The skeleton currently validates replay metadata and payload shape, runs business-reference and inventory checks, generates a mutation plan, applies stock adjustments, persists finalized sales/sale_items, and updates customer/supplier accounting summaries. It exercises lock acquisition, DB transaction boundaries, `FOR UPDATE` row loading, safe audit events, metadata status transitions, rollback on validation or stock failure, and duplicate/already-committed handling.

Current `committed` status means validation, stock mutation, finalized sales/sale_items persistence, customer/supplier accounting summary mutation, payment ledger persistence, backend batch mutation, and cylinder/customer-cylinder mutation committed successfully when applicable. It includes cylinder replay for cylinder/gas items when applicable.

Current audit events include:

- `replay_validation_started`
- `replay_mutation_plan_generated`
- `replay_validation_completed`
- `replay_sales_persistence_started`
- `replay_sales_persistence_completed`
- `replay_sales_persistence_failed`
- `replay_failed`
- `replay_terminal_state_skipped`

Current failure behavior:

- validation failure rolls back the DB transaction if one was opened
- lock is released with final status `failed`
- `replay_error` is set
- no payload bodies are printed or stored in audit messages

This baseline now inserts `sales` and `sale_items` atomically with stock mutation, then updates customer/supplier accounting summaries inside the same DB transaction. It now updates cylinder inventory and customer-cylinder holdings for cylinder/gas items, wire frontend `syncEngine`, or enable auto-sync.

## Implemented Business-Reference Validation Baseline

The validation-only replay skeleton now checks referenced business entities before metadata commit.

Current implemented checks:

- `customerId` exists and is not soft-deleted when provided
- `supplierId` exists and is not soft-deleted when provided
- `saleItems` or `items` must be arrays when present
- each item must be an object
- each item must include `originalItemId` or `itemId`
- referenced items must exist and not be soft-deleted

Successful business-reference validation now proceeds to inventory checks, mutation planning, stock mutation, and finalized sales/sale_items persistence. Current `committed` includes accounting summary mutation and payment ledger persistence when applicable, but does not mean cylinder replay happened.

Failure behavior is intentionally non-mutating:

- validation failure rolls back the backend DB transaction
- `replay_status` becomes `failed`
- `replay_error` is populated with a safe message
- `replay_business_validation_failed` is written to `transaction_replay_audit`
- payload bodies are not logged in audit messages

Verified test status:

- `test:transactions:business-validation` => `18 passed, 0 failed`

## Backend Atomic Transaction Requirements

Replay must run inside one backend DB transaction.

Required behavior:

1. Begin DB transaction.
2. Lock idempotency and affected business rows.
3. Validate the full payload against current server state.
4. Apply all mutations.
5. Write audit/replay status.
6. Commit only after every mutation succeeds.
7. Roll back on any validation or mutation failure.

Partial commits are not allowed.

## Implemented Inventory Sufficiency Validation Baseline

The replay processor checks inventory sufficiency for deduction-style transactions before applying stock decreases.

Current implemented rules:

- referenced item rows must exist and be active
- deduction quantities must be numeric
- deduction quantities must be greater than zero
- `availableStock` must be present and numeric
- `availableStock` must be sufficient for deduction-style transactions

Transaction types currently checked:

- `Sale`
- supplier return / `returnMode: "supplier"`

Transaction types currently skipped:

- purchase-style payloads, because current POS semantics increase stock
- customer returns, because current POS semantics increase stock

Failure behavior is intentionally non-mutating:

- validation failure rolls back the backend DB transaction
- `replay_status` becomes `failed`
- `replay_error` is populated with a safe message
- `replay_inventory_validation_failed` is written to `transaction_replay_audit`
- payload bodies are not logged

Successful inventory validation now proceeds to mutation planning, stock mutation, finalized sales/sale_items persistence, and accounting summary mutation. Current `committed` still does not mean cylinder replay happened.

Verified test status:

- `test:transactions:inventory-validation` => `15 passed, 0 failed`

## Implemented Mutation Planning, Stock Replay, Sales Persistence, And Accounting Baseline

The replay processor now generates a deterministic mutation plan after payload shape, business-reference, and applicable inventory sufficiency validation succeeds. It applies the `stockAdjustments` portion, persists finalized `sales` and `sale_items`, and then updates customer/supplier accounting summaries.

Current in-memory plan shape:

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

Only `stockAdjustments` are currently populated and applied; finalized sales/sale_items persistence and accounting summary mutation are derived from the transaction payload after stock mutation succeeds. Current planning rules follow POS semantics:

- `Sale` => stock `decrease`
- `Purchase` => stock `increase`
- `Customer Return` => stock `increase`
- `Supplier Return` => stock `decrease`

Stock, sales persistence, and accounting behavior:

- only `items.availableStock` is mutated
- mutation runs inside the backend DB transaction
- item rows are locked with `FOR UPDATE`
- decreases re-check stock sufficiency immediately before update
- negative stock results are rejected
- any failure rolls back the full DB transaction
- terminal-state protection prevents duplicate stock mutation and duplicate sales insertion
- finalized `sales` insertion happens after stock mutation succeeds
- linked `sale_items` rows are inserted from `payload.saleItems` or `payload.items`
- stock mutation and sales persistence are inside the same backend DB transaction
- failure rolls back stock mutation, sales insertion, and accounting summary mutation
- customer/supplier rows are locked with `FOR UPDATE` before accounting mutation
- accounting mutates only `invoices`, `payable`, `paid`, and `balance`
- `balance = payable - paid` and `invoices` increments by 1
- backend calculations are used instead of trusting client balance fields
- `Sale` updates customer summary
- `Purchase` updates supplier summary
- `Customer Return` updates customer summary with negative payable/paid deltas
- `Supplier Return` updates supplier summary with negative payable/paid deltas

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

This baseline now inserts finalized sales and `sale_items` and updates customer/supplier accounting summaries. It now updates cylinder inventory and customer-cylinder holdings for cylinder/gas items, wire frontend `syncEngine`, or enable auto-sync.

Verified test status:

- `test:transactions:mutation-planning` => `22 passed, 0 failed`
- `test:transactions:stock-mutation` => `28 passed, 0 failed`
- `test:transactions:sales-persistence` => `26 passed, 0 failed`
- `test:transactions:accounting-mutation` => `29 passed, 0 failed`
- `test:transactions:payment-persistence` => `65 passed, 0 failed`

## Implemented Payment Ledger Persistence Baseline

The replay processor now persists payment ledger rows after stock mutation, finalized sales/sale_items persistence, and customer/supplier accounting mutation have succeeded.

Current implemented behavior:

- payment rows are created only when the effective paid amount is non-zero
- `Sale` and customer returns write to `customer_payments`
- `Purchase` and supplier returns write to `supplier_payments`
- return transactions use negative payment amounts
- payment rows are inserted inside the same backend DB transaction as stock, sales, and accounting
- payment persistence failure rolls back stock, sales, and accounting mutations
- terminal-state protection prevents duplicate payment rows on repeated replay
- if the expected payment table is absent, replay skips payment persistence safely

Audit events:

- `replay_payment_persistence_started`
- `replay_payment_persistence_completed`
- `replay_payment_persistence_failed`

Verified test status:

- `test:transactions:payment-persistence` => `65 passed, 0 failed`

Still deferred:

- frontend/`syncEngine` replay wiring
- auto-sync


## Implemented Batch Mutation Baseline

The replay processor now persists and mutates backend inventory batch rows after stock mutation, finalized sales/sale_items persistence, customer/supplier accounting mutation, and payment ledger persistence succeed.

Current implemented behavior:

- `item_batches` exists as the backend batch schema foundation.
- `Purchase` creates batch rows and records purchased quantity plus remaining balance.
- `Customer Return` creates/restocks batch rows from returned quantity.
- `Sale` consumes active batch balances.
- `Supplier Return` decrements/reverses active batch balances.
- explicit `batchId` is honored when present in the item payload.
- when no `batchId` is provided, batch consumption uses FIFO by purchase date and id.
- legacy payloads with no existing batch rows and no explicit `batchId` may skip batch mutation safely.
- explicit missing or insufficient batch inventory fails safely.

Atomicity behavior:

- batch mutation runs inside the same backend DB transaction as stock, sales, accounting, and payment persistence.
- batch mutation failure rolls back stock, sales, accounting, and payment changes.
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

## Item And Stock Validation Requirements

For current and future stock mutation:

- item must exist and not be deleted
- server item id or mapping must be resolved safely
- quantity must be numeric and positive where required
- unit conversion must be validated
- sale stock deduction must not make stock invalid unless explicitly allowed
- purchase stock increase must update stock consistently
- return stock restoration must match the original transaction rules
- item total stock must remain consistent with batch totals when batches are used

Client-provided `availableStock`, stock deltas, and converted quantities are inputs for validation, not authoritative truth.

## Batch Mutation Requirements

If batches are involved:

- target batch must exist and belong to the item
- batch quantity must be locked before mutation
- batch deduction must not go below zero unless policy explicitly allows it
- batch restoration must match return or invoice reversal rules
- batch creation from purchases must be validated
- item total stock and batch totals must remain consistent

Batch rows must not be replayed through generic CRUD for finalized POS effects.

## Customer And Supplier Accounting Requirements

Accounting fields must be owned by backend transaction replay.

Protected fields:

- `invoices`
- `payable`
- `paid`
- `balance`

Requirements:

- customer/supplier must exist and be valid for the transaction type
- balances must be locked before mutation
- sale, purchase, return, payment, and invoice deletion rules must be explicit
- server must recompute final balance changes
- client-provided balances must not be blindly trusted
- customer/supplier CRUD mirrors must remain profile-only

## Payment Mutation Requirements

Payment replay must be atomic with related accounting changes.

Requirements:

- payment amount must be numeric and valid
- party type must be `customer` or `supplier`
- payment must reference the correct party
- invoice-linked payments must reference the correct transaction when applicable
- duplicate payment replay must be idempotent
- payment insertion and balance update must commit together
- current replay persists payment ledger rows for non-zero paid amounts in the same transaction as stock, sales, and accounting
- current replay safely skips payment persistence if the expected payment table is absent

## Cylinder Mutation Requirements

Cylinder mutations must be handled atomically with the transaction that caused them.

Requirements:

- cylinder row must exist and be locked
- cylinder quantity must be validated
- customer cylinder holding must be locked or created safely
- cylinder sale and return behavior must be explicit
- cylinder inventory and customer holdings must stay consistent
- cylinder mutation must roll back if the related sale/return/payment fails

Cylinder repositories must not replay finalized cylinder effects as generic CRUD.

## Return Transaction Requirements

Return replay must validate both the return payload and the original transaction context.

Requirements:

- `returnMode` must be `customer` or `supplier`
- original invoice or transaction reference must be resolved when available
- returned quantities must not exceed allowed original quantities
- stock/batch/cylinder restoration must follow the original transaction type
- customer/supplier accounting reversal must be recomputed server-side
- duplicate returns must be prevented by idempotency and/or original transaction constraints

## Rollback And Failure Behavior

Every replay failure must leave server state unchanged.

Rollback triggers include:

- missing item
- missing customer/supplier
- insufficient stock
- invalid batch
- invalid cylinder state
- invalid payment amount
- invoice collision
- duplicate transaction with different payload
- unexpected database error

Failure responses should be clear, safe, and must not expose sensitive payload bodies.

## Replay Retry Behavior

Retries must be safe.

Requirements:

- temporary failures should leave queue rows retryable
- permanent validation failures should be marked failed/conflict by the client-side queue logic later
- same payload retry should not double-apply mutations
- backend should return prior completed response for duplicate-safe retry
- retry diagnostics must contain safe metadata only

## Audit Logging Requirements

Replay should produce an audit trail before production use.

Audit logs should record:

- `clientTransactionId`
- transaction type
- authenticated user/operator when auth exists
- replay status
- validation failure code/message
- created/updated server ids
- timestamps

Audit logs must not store plain passwords, auth secrets, or unnecessary full sensitive payload bodies.

## Manual Recovery Requirements

Before replay is enabled, operators/developers need safe recovery tooling.

Required capabilities:

- inspect queued transaction metadata
- inspect backend stored transaction metadata
- identify failed/conflicted transactions
- retry failed rows manually when appropriate
- mark or quarantine unrecoverable rows with audit trail
- avoid editing payloads without an explicit repair workflow

Existing queue report/reset/cleanup tools are dev-only and not a full production recovery system.

## Test Requirements Before Enabling Replay

Replay must not be enabled until automated tests prove atomic behavior.

Minimum future test matrix:

- sale
- purchase
- customer return
- supplier return
- customer payment
- supplier payment
- duplicate replay
- partial failure rollback
- insufficient stock
- missing customer
- missing supplier
- cylinder sale
- cylinder return
- batch stock deduction
- batch stock rollback after failure
- invoice deletion/reversal
- invalid idempotency collision
- concurrent replay attempt

Each test must verify both successful mutations and absence of partial mutation after failure.

## Explicit No-Go Conditions

Do not implement or enable replay if any of these are true:

- no auth/session model
- no row locking or equivalent protection
- no backend DB transaction wrapper
- no duplicate replay protection
- no stock validation
- no balance validation
- no rollback strategy
- no recovery/audit tooling
- no test coverage for partial failure rollback
- no test coverage for duplicate replay
- no safe diagnostic reporting
- no clear conflict handling policy

## Final Gate

Transaction replay may broaden beyond stock, finalized sales/sale_items persistence, accounting summary mutation, and payment ledger persistence only after this checklist is reviewed against the actual schema, backend code, and test plan. Until then, `transactions.php` must remain storage-only and replay helpers must remain limited to `items.availableStock`, finalized `sales`/`sale_items`, customer/supplier summaries, and payment ledger rows; cylinder, frontend, and auto-sync remain deferred.

## Implemented Cylinder Mutation Baseline

The replay processor now applies authoritative cylinder/customer-cylinder mutation after stock, finalized sales/sale_items, accounting, payment ledger, and batch mutation succeed.

Implemented behavior:

- cylinder/gas items are detected by item category containing `gas` or `cylinder`, or by an existing `cylinders` row for the item
- non-cylinder items skip cylinder mutation safely
- `Sale` decreases `filledCylinders`, increases `withCustomers`, and creates or updates customer holding
- `Customer Return` decreases `withCustomers`, increases `emptyCylinders`, and reduces customer holding
- `Purchase` increases `filledCylinders` and `qtyInStock`
- `Supplier Return` decreases `filledCylinders` and `qtyInStock`
- cylinder rows and customer-cylinder holding rows are locked with `FOR UPDATE`
- the invariant `qtyInStock = filledCylinders + emptyCylinders + withCustomers` is enforced
- insufficient customer holding or negative cylinder counts fail safely
- cylinder failure rolls back the entire replay chain
- terminal-state protection prevents duplicate cylinder mutation

Audit events:

- `replay_cylinder_mutation_started`
- `replay_cylinder_mutation_completed`
- `replay_cylinder_mutation_failed`

Verified test status:

- `test:transactions:cylinder-mutation` => `46 passed, 0 failed`


