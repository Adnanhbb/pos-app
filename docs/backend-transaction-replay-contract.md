# Backend Transaction Replay Contract

This document defines the future backend replay contract for transaction-level sync. It is a specification only. The current `transactions.php` endpoint remains storage-only with shallow validation; the dev replay helper now performs backend-authoritative stock mutation, finalized sales/sale_items persistence, customer/supplier accounting summary mutation, payment ledger persistence, backend batch mutation, and cylinder/customer-cylinder mutation when explicitly invoked by backend tests.

## Scope

Future replay may use:

```http
POST /api/transactions.php
```

or a dedicated endpoint such as:

```http
POST /api/transaction-replay.php
```

The final endpoint name can change, but the contract requirements in this document must hold before replay is broadened beyond the current stock, finalized sales/sale_items, accounting summary mutation, payment ledger persistence, and batch mutation layer.

## Replay Ownership Model

The backend owns final transaction replay.

Backend responsibilities:

- validate the transaction payload against current server state
- lock affected rows
- compute final stock changes
- compute final customer/supplier accounting changes
- compute batch mutations
- compute cylinder mutations
- create payment rows when applicable
- create sale/purchase/return records when applicable
- apply mutations atomically
- write audit/replay status
- return authoritative results

Frontend and `syncEngine` responsibilities:

- send the queued transaction payload
- preserve `clientTransactionId`
- handle success/failure response metadata
- mark local queue state appropriately
- avoid computing final stock/accounting/batch/cylinder changes

## Required Request Fields

A replay request must include:

```json
{
  "clientTransactionId": "txn_...",
  "transactionType": "sale",
  "createdAt": 1779000000000,
  "payload": {}
}
```

Required fields:

- `clientTransactionId`: stable idempotency key
- `transactionType`: transaction intent
- `createdAt`: client creation timestamp
- `payload`: transaction details and snapshots

Expected transaction types:

- `sale`
- `return`
- `invoice_delete`
- `payment`
- `stock_adjustment`
- `cylinder_adjustment`

The backend may require additional fields later, such as operator id, device id, branch id, or schema version.

## Required Auth And Session Requirements

Replay must not be production-enabled without authentication.

Required auth/session behavior:

- request must identify an authenticated user/operator
- backend must verify permission for the transaction type
- backend must reject unauthorized replay attempts
- audit log must record authenticated user/operator context
- auth/session secrets must never be stored in payload logs or diagnostics

Recommended future auth response failures:

- `401 Unauthorized` for missing/invalid session
- `403 Forbidden` for authenticated users without permission

## Required Idempotency Guarantees

Backend idempotency must guarantee:

- same `clientTransactionId` and same canonical payload does not apply twice
- same `clientTransactionId` and same canonical payload returns the previously saved result
- same `clientTransactionId` and different canonical payload returns `409 Conflict`
- idempotency status changes occur inside the same DB transaction as business mutations
- duplicate replay cannot duplicate stock/accounting/payment/batch/cylinder mutations

The idempotency table must be locked or otherwise protected during replay.

## Required DB Transaction Guarantees

Replay must run inside one database transaction.

Required sequence:

1. Begin DB transaction.
2. Lock idempotency row or create and lock it.
3. Lock all affected business rows.
4. Validate current server state.
5. Apply all mutations.
6. Write audit/replay status.
7. Commit.
8. Return authoritative result.

If any step fails, the backend must roll back the full DB transaction.

## Replay States Lifecycle

Proposed replay states:

- `stored`: payload accepted and stored, no business replay applied
- `queued`: accepted for future replay but not yet processing
- `processing`: replay is actively being validated/applied
- `committed`: replay validation, stock mutation, finalized sales/sale_items persistence, customer/supplier accounting summary mutation, payment ledger persistence, backend batch mutation, and cylinder/customer-cylinder mutation committed successfully where applicable; current replay includes cylinders for cylinder/gas items
- `failed`: replay failed before commit and did not mutate business state
- `rolled_back`: replay attempted, encountered an error, and all mutations were rolled back
- `duplicate`: replay request matched a previously completed idempotent transaction

State transitions should be auditable.

Recommended normal path:

```text
stored -> processing -> committed
```

Recommended retry duplicate path:

```text
committed -> duplicate response returned
```

Recommended failure path:

```text
stored -> processing -> rolled_back/failed
```


## Implemented Lock Primitives

The backend now has replay lock primitives in `api/lib/transactionReplayLock.php`:

- `acquireReplayLock($pdo, $syncTransactionId, $workerId)`
- `releaseReplayLock($pdo, $syncTransactionId, $workerId, $finalStatus = null, $error = null)`

Current lock behavior:

- acquisition is allowed only when `replay_status` is `stored` or `failed`
- acquisition sets `replay_status` to `processing`
- acquisition increments `replay_attempts` once
- acquisition sets `locked_at`, `locked_by`, and `replay_started_at`
- release succeeds only when `locked_by` matches the supplied worker id
- release clears `locked_at` and `locked_by`
- release sets `replay_finished_at`
- release may set a final metadata status such as `stored`, `failed`, or `rolled_back`
- lock events write safe rows to `transaction_replay_audit`

Audit event types currently produced by the primitives:

- `lock_acquired`
- `lock_acquire_failed`
- `lock_release_failed`
- `lock_released`

These helpers are replay primitives. The replay processor now uses them for validation, stock mutation, sales persistence, and accounting summary mutation, but the lock helpers themselves do not inspect payload bodies or mutate stock, accounting, cylinders, batches, payments, sales, or sale items.

Verified test status:

- `test:transactions:locks` => `8 passed, 0 failed`


## Implemented Replay Skeleton, Stock Mutation, Sales Persistence, Accounting Mutation, And Payment Persistence

The backend now has a replay helper in `api/lib/transactionReplayProcessor.php`:

- `replayStoredTransaction($pdo, $syncTransactionId, $workerId)`

Current replay flow:

1. Check whether the stored transaction is in a terminal state: `committed`, `rolled_back`, or `duplicate`.
2. If terminal, short-circuit before lock acquisition, do not increment `replay_attempts`, write `replay_terminal_state_skipped`, and return safe metadata. `committed` keeps `alreadyCommitted` compatibility.
3. Acquire the replay lock with `acquireReplayLock(...)`.
4. Begin a backend DB transaction.
5. Load the `sync_transactions` row with `FOR UPDATE`.
6. Validate that `payload_json` exists and decodes to an object.
7. Validate that payload `clientTransactionId` matches the `sync_transactions` row.
8. Write `replay_validation_started` audit event.
9. Run business-reference and inventory sufficiency checks.
10. Generate an in-memory mutation plan.
11. Apply planned `stockAdjustments` to `items.availableStock`.
12. Insert one finalized `sales` row for sale/purchase/customer-return/supplier-return style payloads.
13. Insert linked `sale_items` rows from `payload.saleItems` or `payload.items`.
14. Lock the referenced customer or supplier row with `FOR UPDATE` when accounting applies.
15. Update only `invoices`, `payable`, `paid`, and `balance` using backend calculations.
16. Persist customer/supplier payment ledger rows when paid amount is non-zero.
17. Write `replay_validation_completed` audit event.
18. Commit the backend DB transaction.
19. Release the lock with final status `committed`.


Current meaning of `committed`:

`committed` currently means replay validation, stock mutation, finalized sales/sale_items persistence, customer/supplier accounting summary mutation, payment ledger persistence, backend batch mutation, and cylinder/customer-cylinder mutation committed successfully when applicable. It includes cylinder replay for cylinder/gas items when applicable.

Failure behavior:

- roll back the DB transaction if validation, stock mutation, sales persistence, accounting mutation, or payment persistence fails after it starts
- write a safe `replay_failed` audit event when possible
- release the lock with final status `failed`
- store the validation/mutation error in `replay_error`
- do not print or audit full payload bodies

Audit events currently produced by the processor:

- `replay_validation_started`
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
- `replay_validation_completed`
- `replay_failed`
- `replay_terminal_state_skipped`

Verified test status:

- `test:transactions:replay-skeleton` => `9 passed, 0 failed`
- `test:transactions:business-validation` => `18 passed, 0 failed`
- `test:transactions:inventory-validation` => `15 passed, 0 failed`
- `test:transactions:mutation-planning` => `22 passed, 0 failed`
- `test:transactions:stock-mutation` => `28 passed, 0 failed`
- `test:transactions:sales-persistence` => `26 passed, 0 failed`
- `test:transactions:accounting-mutation` => `29 passed, 0 failed`
- `test:transactions:payment-persistence` => `65 passed, 0 failed`

The processor now inserts finalized sales and sale_items together with stock mutation, updates customer/supplier accounting summaries, and persists customer/supplier payment ledger rows in the same backend DB transaction. It now updates cylinder inventory and customer-cylinder holdings for cylinder/gas items, call frontend `syncEngine`, or enable auto-sync.

## Implemented Terminal-State Protection

The replay processor protects explicit terminal replay states before any lock is acquired:

- `committed`
- `rolled_back`
- `duplicate`

When a terminal row is passed to `replayStoredTransaction($pdo, $syncTransactionId, $workerId)`, the processor short-circuits before lock acquisition. It does not increment `replay_attempts`, does not set `locked_at` or `locked_by`, and does not run validation or stock mutation steps again.

The safe result includes `terminalStateSkipped: true`. For `committed` rows, the result also preserves `alreadyCommitted` compatibility so existing dev tooling can continue to treat already replayed rows as safe duplicate requests.

A safe audit event is written:

- `replay_terminal_state_skipped`

This terminal-state protection is what prevents duplicate stock mutation for already committed transactions.

Verified result:

- `test:transactions:terminal-protection => 10 passed, 0 failed`

This protection now prevents duplicate stock mutation, duplicate finalized sales/sale_items insertion, duplicate customer/supplier accounting mutation, and duplicate payment ledger persistence. Non-cylinder items skip cylinder mutation safely, and there is still no frontend, `syncEngine`, or auto-sync wiring.

## Implemented Business-Reference Validation

The replay processor checks referenced business entities before a stored transaction can become committed.

Current checks:

- `customerId` must reference an existing, non-deleted customer when provided anywhere in the transaction payload.
- `supplierId` must reference an existing, non-deleted supplier when provided anywhere in the transaction payload.
- `saleItems` or `items`, when present, must be arrays.
- Each item entry must be an object and include `originalItemId` or `itemId`.
- Referenced items must exist and must not be soft-deleted.

Successful behavior:

- validation allows replay to proceed to mutation planning, stock mutation, and finalized sales/sale_items persistence
- cylinder mutation occurs only for cylinder/gas items and non-cylinder items skip safely

Failure behavior:

- the backend DB transaction rolls back
- `replay_status` becomes `failed`
- `replay_error` is populated with a safe validation message
- `replay_business_validation_failed` is written to `transaction_replay_audit`
- full payload bodies are not logged in audit rows or test output

Verified test status:

- `test:transactions:business-validation` => `18 passed, 0 failed`

## Implemented Inventory Sufficiency Validation

The replay processor performs inventory sufficiency checks before applying stock decreases.

Current inventory validation rules:

- referenced item rows must exist and be active
- deduction quantities must be numeric
- deduction quantities must be greater than zero
- `availableStock` must be present and numeric on the referenced item row
- `availableStock` must be sufficient for the total required deduction quantity per item

Transaction types checked for stock sufficiency:

- sale payloads that represent `Sale`
- supplier return payloads, including `returnMode: "supplier"`

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

## Implemented Mutation Planning, Stock Application, Sales Persistence, And Accounting Mutation

After payload shape, business-reference, and applicable inventory sufficiency validation succeeds, the replay processor builds a deterministic in-memory mutation plan and applies only the stock adjustment portion.

Current plan shape:

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

Only `stockAdjustments` are currently populated and applied. Finalized `sales` and `sale_items` are persisted after stock mutation succeeds. Customer/supplier accounting summaries are then updated from backend calculations. The other arrays remain placeholders for future cylinder and batch planning. Payment ledger persistence is currently derived directly during replay rather than from `paymentEffects`.

Current stock effect rules:

- `Sale` => stock `decrease`
- `Purchase` => stock `increase`
- `Customer Return` => stock `increase`
- `Supplier Return` => stock `decrease`

Each stock plan entry includes safe metadata only:

- `itemId`
- `transactionType`
- `direction`
- `qty`
- `reason`

Stock, sales persistence, accounting, and payment behavior:

- only `items.availableStock` is mutated
- mutation runs inside the backend DB transaction
- item rows are locked with `FOR UPDATE`
- decreases re-check stock sufficiency immediately before update
- negative stock results are rejected
- any failure rolls back the whole DB transaction
- terminal-state protection prevents duplicate stock mutation and duplicate sales insertion on repeat replay
- finalized `sales` insertion happens after stock mutation succeeds
- linked `sale_items` rows are inserted from `payload.saleItems` or `payload.items`
- stock mutation and sales persistence run inside the same backend DB transaction
- failure in stock mutation, sales persistence, accounting mutation, or payment persistence rolls back the entire replay
- customer/supplier rows are locked with `FOR UPDATE` before accounting mutation
- only `invoices`, `payable`, `paid`, and `balance` are mutated for accounting
- `balance = payable - paid`
- `invoices` increments by 1
- client-supplied balance fields are not trusted as authoritative
- `Sale` updates the customer summary
- `Purchase` updates the supplier summary
- `Customer Return` updates the customer summary with negative payable/paid deltas
- `Supplier Return` updates the supplier summary with negative payable/paid deltas
- payment rows are persisted only when effective paid amount is non-zero
- `Sale` and customer returns write to `customer_payments`
- `Purchase` and supplier returns write to `supplier_payments`
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


## Implemented Backend Batch Mutation

Replay now persists and mutates authoritative inventory batch rows as part of the same backend DB transaction used for stock mutation, finalized sales/sale_items persistence, customer/supplier accounting mutation, and payment ledger persistence.

Current batch schema foundation:

- `item_batches` exists as the backend inventory-batch table foundation.
- Batch rows can store item linkage, purchase/restock quantity, sold quantity, remaining balance, cost price, invoice number, source replay metadata, and a compact JSON snapshot for diagnostics.

Current batch behavior:

- `Purchase` creates new `item_batches` rows and initializes purchased quantity plus remaining balance.
- `Customer Return` creates/restocks batch rows using the returned quantity.
- `Sale` consumes existing active batches.
- `Supplier Return` decrements/reverses existing batch quantities.
- When an item payload includes an explicit `batchId`, replay targets that batch.
- When no `batchId` is provided, replay consumes batches FIFO by purchase date and then id.
- Legacy payloads with no existing batch rows and no explicit `batchId` may skip batch mutation safely so older non-batch replay payloads remain compatible.
- Explicit missing or insufficient batch inventory fails safely.

Atomicity and idempotency:

- Batch mutation runs inside the same DB transaction as stock, sales, accounting, and payment persistence.
- Batch rows are locked with `FOR UPDATE` before consumption.
- Batch failure rolls back stock, sales, accounting, and payment changes.
- Terminal-state protection prevents duplicate batch mutation on repeated replay.

Audit events:

- `replay_batch_mutation_started`
- `replay_batch_mutation_completed`
- `replay_batch_mutation_failed`

Verified test status:

- `test:transactions:batch-mutation` => `39 passed, 0 failed`

Still deferred:

- frontend/`syncEngine` replay wiring
- auto-sync

## Implemented Payment Ledger Persistence

The replay processor now persists backend-authoritative payment ledger rows after stock mutation, finalized sales/sale_items persistence, and customer/supplier accounting summary mutation have succeeded.

Current payment behavior:

- payment rows are created only when the effective paid amount is non-zero
- `Sale` and customer returns write to `customer_payments`
- `Purchase` and supplier returns write to `supplier_payments`
- return transactions use negative payment amounts
- payment persistence runs inside the same backend DB transaction as stock, sales, and accounting
- payment persistence failure rolls back stock mutation, sales persistence, and accounting summary mutation
- terminal-state protection prevents duplicate payment rows on repeated replay
- if the expected payment table is absent, replay skips payment persistence safely instead of failing the transaction

Payment rows are ledger/audit persistence for replayed transactions. Accounting summaries remain backend-authoritative and are not recalculated from payment rows during this phase.

Audit events:

- `replay_payment_persistence_started`
- `replay_payment_persistence_completed`
- `replay_payment_persistence_failed`

Verified test status:

- `test:transactions:payment-persistence` => `65 passed, 0 failed`

Still not implemented:

- frontend/`syncEngine` replay wiring
- auto-sync

## Safe Retry Semantics

A client may retry the same transaction payload after network failure or timeout.

Safe retry requirements:

- retry with same `clientTransactionId` and same payload must be safe
- backend must return existing committed response if replay already succeeded
- backend must not apply duplicate mutations
- backend should provide retry guidance for temporary failures
- backend should distinguish retryable and non-retryable failures

## Duplicate Replay Semantics

Duplicate replay cases:

- same id, same payload, already committed: return saved committed response
- same id, same payload, currently processing: return conflict or retry-later response
- same id, different payload: return `409 Conflict`
- same logical invoice with different id: reject or create conflict depending on policy

Duplicate replay must never produce duplicate stock, accounting, batch, cylinder, sale item, or payment rows.

## Atomicity Guarantees

The backend must guarantee all-or-nothing mutation.

These must commit together:

- transaction header
- transaction line items
- item stock changes
- batch changes
- customer/supplier accounting changes
- payment records
- cylinder inventory changes
- customer cylinder holding changes
- idempotency final status
- audit status

Partial commit acceptance is not allowed.

## Rollback Guarantees

On failure:

- no item stock changes remain
- no batch changes remain
- no customer/supplier balance changes remain
- no payment rows remain
- no cylinder changes remain
- no partial sale or sale item records remain
- idempotency/audit state clearly records failure without pretending success

The response must make it clear that business mutation did not commit.

## Failure Response Contract

Recommended failure response shape:

```json
{
  "success": false,
  "message": "Transaction replay failed.",
  "details": {
    "clientTransactionId": "txn_...",
    "transactionType": "sale",
    "replayStatus": "failed",
    "retryable": false,
    "errorCode": "INSUFFICIENT_STOCK",
    "errors": [
      {
        "field": "payload.saleItems.0.qty",
        "message": "Insufficient stock for item.",
        "safeMetadata": {
          "itemId": 123
        }
      }
    ]
  }
}
```

Failure responses must not include sensitive full payload bodies.

## Partial Failure Handling

Partial failure must be represented as rollback, not partial success.

Examples:

- sale header insert succeeds but stock update fails: rollback sale header
- stock update succeeds but payment insert fails: rollback stock update
- batch deduction succeeds but customer balance fails: rollback batch deduction
- cylinder update succeeds but sale item insert fails: rollback cylinder update

The backend must never return success for a partially committed replay.

## Audit Logging Expectations

Replay audit logs should record:

- `clientTransactionId`
- transaction type
- authenticated user/operator
- replay state
- server transaction id when committed
- safe affected entity ids
- error code when failed
- retryable flag
- timestamps

Audit logs must avoid storing passwords, auth secrets, and unnecessary sensitive full payloads.

## Replay Observability And Logging

Observability should include safe counters and metadata:

- replay attempts
- committed count
- failed count
- duplicate count
- rollback count
- conflicts by reason
- average processing time

Logs must redact:

- passwords
- auth/session tokens
- full customer private data
- full transaction payloads unless explicitly stored in protected audit storage

## Queue Reconciliation Expectations

After replay response:

- successful committed replay should allow the frontend queue row to become `done`
- duplicate same-payload committed replay should also allow `done`
- retryable failure should remain pending/failed according to client queue policy
- non-retryable conflict should become failed/conflict later
- local IndexedDB hydration should happen through a separate pull/reconciliation path, not by guessing side effects in `syncEngine`

## Future Pull-Sync Interactions

Replay and pull/hydration should be separate responsibilities.

Replay answers: did the server accept and commit the transaction?

Pull/hydration answers: what is the authoritative server state now?

After replay, future pull-sync should refresh:

- item stock
- batches
- customer/supplier balances
- payments
- sales and sale items
- cylinders and cylinder customer holdings
- transaction status

## Conflict Resolution Expectations

Conflicts must be explicit and safe.

Likely conflict codes:

- `INSUFFICIENT_STOCK`
- `MISSING_ITEM`
- `MISSING_CUSTOMER`
- `MISSING_SUPPLIER`
- `MISSING_BATCH`
- `MISSING_CYLINDER`
- `INVOICE_COLLISION`
- `DUPLICATE_TRANSACTION_PAYLOAD_MISMATCH`
- `RETURN_EXCEEDS_ORIGINAL_QTY`
- `PAYMENT_EXCEEDS_BALANCE`

Conflict responses should include safe metadata and clear retry guidance.

## Eventual Consistency Expectations

Offline-first behavior means the local app may temporarily differ from the server.

Expected convergence path:

1. Local transaction commits offline.
2. Transaction is queued.
3. Backend replay commits atomically later.
4. Pull/hydration updates local state to authoritative server values.
5. Conflicts are surfaced for manual resolution when automatic convergence is unsafe.

The backend remains authoritative for final computed stock and balances.

## Expected Future Success Response Structure

Recommended committed response shape:

```json
{
  "success": true,
  "data": {
    "accepted": true,
    "storedOnly": false,
    "replayStatus": "committed",
    "clientTransactionId": "txn_...",
    "transactionType": "sale",
    "serverTransactionId": 1001,
    "authoritativeBalances": {
      "customer": {
        "id": 15,
        "balance": 250,
        "paid": 750,
        "payable": 1000,
        "invoices": 3
      }
    },
    "authoritativeStock": [
      {
        "itemId": 20,
        "availableStock": 42
      }
    ],
    "warnings": [],
    "errors": [],
    "retry": {
      "retryable": false,
      "retryAfterSeconds": null
    }
  }
}
```

Fields may evolve, but replay status, idempotency identity, authoritative ids, warnings/errors, and retry guidance must remain clear.

## Backend Guarantees

The backend must guarantee:

- replaying the same `clientTransactionId` twice does not duplicate mutations
- replay is atomic
- future stock/accounting/batch/cylinder changes commit together when those layers are enabled
- failure rolls back fully
- backend computes authoritative balances and stock
- frontend snapshots are validation inputs, not final truth

## Explicit Anti-Patterns

Do not implement:

- CRUD-style replay for stock/accounting
- client-authoritative stock mutation
- client-authoritative customer/supplier balances
- partial commit acceptance
- replay without row locking or equivalent protection
- replay without idempotency
- future full sale/purchase replay that mutates stock but omits required accounting in the same transaction
- replay that returns success after rollback
- frontend `syncEngine` calculation of stock/accounting side effects

## Recommended Backend Internal Implementation Order

1. Add replay status columns/tables if needed.
2. Add authenticated user/session checks.
3. Review existing replay lock primitives and add any missing stale-lock policy.
4. Add idempotency row locking.
5. Review the existing stock, sales persistence, accounting, and payment ledger replay processor and expand it only after tests exist for the next business mutation layer.
6. Add transaction wrapper rollback tests for real business replay.
7. Implement read-only validation against server state.
8. Implement sale replay for a narrow non-cylinder, non-batch case.
9. Stock mutation inside the DB transaction is implemented for planned stock adjustments.
10. Finalized sales/sale_items persistence inside the same DB transaction is implemented.
11. Customer/supplier accounting mutation inside the same DB transaction is implemented for sale, purchase, customer return, and supplier return summaries.
12. Add payment mutation inside the same DB transaction.
13. Batch handling is implemented.\r\n14. Add cylinder handling.
15. Add invoice deletion/reversal.
16. Add conflict response handling.
17. Add audit logging and observability.
18. Add pull/hydration integration.
19. Only then consider controlled auto-sync.

## Contract Gate

This contract must be reviewed with the replay preflight checklist before implementation. If the backend cannot provide idempotency, locking, atomic commit, rollback, and safe failure responses, replay must remain disabled.

## Implemented Cylinder Mutation

Replay now mutates cylinder inventory and customer-cylinder holding rows for cylinder/gas items as part of the same backend DB transaction as stock, finalized sales/sale_items, accounting summaries, payment ledger rows, and batch mutation.

Cylinder/gas item detection:

- item category containing `gas` or `cylinder`
- or an existing `cylinders` row for the referenced item
- non-cylinder items skip cylinder mutation safely

Current cylinder behavior:

- `Sale`: `filledCylinders` decreases, `withCustomers` increases, and a customer holding row is created or updated.
- `Customer Return`: `withCustomers` decreases, `emptyCylinders` increases, and the customer holding row is reduced.
- `Purchase`: `filledCylinders` increases and `qtyInStock` increases.
- `Supplier Return`: `filledCylinders` decreases and `qtyInStock` decreases.

Locking and invariants:

- cylinder rows are locked with `FOR UPDATE`
- customer-cylinder holding rows are locked with `FOR UPDATE` when present
- customer returns fail if the customer does not hold enough cylinders
- negative cylinder counts are rejected
- replay enforces `qtyInStock = filledCylinders + emptyCylinders + withCustomers`

Atomicity and idempotency:

- cylinder mutation runs inside the same DB transaction as the rest of replay
- cylinder failure rolls back stock, sales, sale_items, accounting, payments, batches, and cylinder changes
- terminal-state protection prevents duplicate cylinder mutation on repeat replay

Audit events:

- `replay_cylinder_mutation_started`
- `replay_cylinder_mutation_completed`
- `replay_cylinder_mutation_failed`

Verified test status:

- `test:transactions:cylinder-mutation` => `46 passed, 0 failed`



## Implemented Auth Foundation

A minimal replay auth/session foundation now exists before any future auto-sync rollout. Bearer token validation supports environment worker tokens and hashed `api_auth_tokens` rows. Authorized replay should use `replayStoredTransactionAuthorized(...)` so replay audit rows can include safe actor attribution.

Current guarantees:

- unauthorized replay is rejected before lock acquisition
- replay attempts are not incremented for unauthorized calls
- authorized replay audit rows can record actor type, actor id, role, and session id
- raw tokens are not stored or returned

This does not enable a production replay endpoint by itself, does not enforce CRUD auth yet, and does not add auto-sync/background replay.

See [backend-auth-session-foundation.md](./backend-auth-session-foundation.md).

Checkpoint reference: [release-checkpoint-replay-auth-foundation.md](./release-checkpoint-replay-auth-foundation.md)
