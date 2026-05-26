# Release Checkpoint Before Stock Mutation Replay

Suggested git tag: `before-stock-mutation-replay`

This checkpoint records the exact backend replay state before the first real stock mutation implementation begins. It exists so the project has a clean, documented return point before introducing irreversible business mutations.

## Current Replay Architecture State

The transaction replay backend is still validation-first and non-mutating. The current replay processor can load stored transaction payloads, acquire/release replay locks, validate payload and business references, validate inventory sufficiency for deduction-style transactions, generate a dry-run mutation plan, write safe audit events, and transition replay metadata.

Current replay pieces:

- `transactions.php` stores validated transaction payloads only.
- `sync_transactions` stores payloads and replay metadata.
- `transaction_idempotency` protects storage idempotency.
- `transaction_replay_audit` records safe replay/storage/lock events.
- `acquireReplayLock(...)` and `releaseReplayLock(...)` exist as lock primitives.
- `replayStoredTransaction(...)` exists as a validation-only replay skeleton.
- Dry-run mutation planning returns an in-memory `mutationPlan` for dev/test visibility.

No transaction replay path currently applies stock, accounting, payment, cylinder, batch, sale, or sale item mutations.

## Current Replay Guarantees

Current guarantees before stock mutation work:

- Stored transaction payloads are idempotency-protected by `clientTransactionId`.
- Replay lock acquisition is worker-owned and increments `replay_attempts` only on acquisition.
- Terminal replay states short-circuit before lock acquisition.
- Validation failures roll back the replay DB transaction and safely set `replay_status = failed`.
- Audit events do not include full payload bodies or sensitive customer/user/password data.
- `committed` currently means validation and dry-run planning metadata committed only.
- No stock totals are changed.
- No customer or supplier balances are changed.
- No payment rows are created.
- No cylinder or batch rows are changed.
- No finalized sales or `sale_items` rows are inserted.
- Frontend `syncEngine` is not auto-started.

## Implemented Validations

Implemented storage and replay validation includes:

- required top-level transaction fields
- accepted transaction type values
- shallow payload shape validation
- malformed JSON rejection
- duplicate `clientTransactionId` collision protection
- payload `clientTransactionId` matching the stored row during replay
- customer reference existence and non-deleted checks when provided
- supplier reference existence and non-deleted checks when provided
- `saleItems` / `items` array shape checks
- item references via `originalItemId` or `itemId`
- item existence and non-deleted checks
- inventory sufficiency checks for deduction-style transactions

Inventory sufficiency currently checks:

- `Sale` stock deductions
- supplier return / `returnMode: "supplier"` stock deductions

Inventory sufficiency currently skips:

- purchase-style payloads because current POS semantics increase stock
- customer returns because current POS semantics increase stock

## Implemented Replay Protections

Replay protections currently implemented:

- lock acquisition only for safe pre-processing states such as `stored` and `failed`
- lock ownership enforcement on release
- replay attempts increment once per successful lock acquisition
- terminal-state protection for `committed`, `rolled_back`, and `duplicate`
- terminal rows do not acquire locks and do not increment attempts
- safe failure state with `replay_error`
- safe audit events for lock, validation, terminal skip, and planning events

Relevant audit events include:

- `stored`
- `lock_acquired`
- `lock_acquire_failed`
- `lock_release_failed`
- `lock_released`
- `replay_validation_started`
- `replay_business_validation_failed`
- `replay_inventory_validation_failed`
- `replay_mutation_plan_generated`
- `replay_validation_completed`
- `replay_failed`
- `replay_terminal_state_skipped`

## Dry-Run Mutation Planning Summary

The replay processor now generates an in-memory `mutationPlan` after validation succeeds.

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

Only `stockAdjustments` are populated currently.

Current stock planning rules:

- `Sale` => stock `decrease`
- `Purchase` => stock `increase`
- `Customer Return` => stock `increase`
- `Supplier Return` => stock `decrease`

The plan is not persisted and not applied. It exists only for deterministic dev/test visibility before real mutation work begins.

## Verified Test Counts

Current verified results:

- `test:transactions:mutation-planning` => `22 passed, 0 failed`
- `test:transactions:inventory-validation` => `15 passed, 0 failed`
- `test:transactions:terminal-protection` => `10 passed, 0 failed`
- `test:transactions:business-validation` => `18 passed, 0 failed`
- `test:transactions:replay-skeleton` => `9 passed, 0 failed`
- `test:transactions:locks` => `8 passed, 0 failed`
- `test:transactions:storage` => `22 passed, 0 failed`
- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`

These tests validate the current non-mutating replay foundation. They do not prove real stock mutation replay is production-ready.

## Explicit Warnings Before The Next Phase

The next phase introduces the first irreversible business mutation in transaction replay. That is a major risk boundary.

Do not cross these boundaries casually:

- Stock mutation must be backend-authoritative only.
- Stock mutation must happen inside the backend DB transaction.
- Stock mutation must be idempotent for the same `clientTransactionId`.
- Stock mutation must not be computed or applied by frontend `syncEngine`.
- Accounting mutations must remain deferred.
- Payment mutations must remain deferred.
- Cylinder mutations must remain deferred.
- Batch mutations must remain deferred unless explicitly designed and tested.
- Finalized sales and `sale_items` insertion must remain deferred unless added in the same atomic replay design.
- Auto-sync must remain disabled.

## Rollback Value

This checkpoint is the last documented state where transaction replay can validate and plan stock effects without applying them. If stock mutation work introduces incorrect inventory behavior, this checkpoint should be used as the reference state for rollback or comparison.

## Recommended Commit And Tag Steps

Recommended commands after review:

```powershell
git status
git add docs/release-checkpoint-before-stock-mutation.md
git commit -m "docs: add pre-stock mutation replay checkpoint"
git tag before-stock-mutation-replay
```

Only tag this checkpoint after confirming the working tree state is intentional.

## Final Boundary Statement

At this checkpoint, transaction replay is still non-mutating. The system is ready to design and test the first backend-authoritative stock mutation path, but it is not ready for auto-sync, accounting replay, payment replay, cylinder replay, batch replay, or broad production transaction replay.