# Release Checkpoint: Remaining Failed Replay Manual Review

## Milestone Summary

The final `6` non-archived failed backend replay rows have been inspected by a dry-run repair planner and are intentionally left as manual-review blockers.

This checkpoint records why they are not repaired automatically and why auto-sync remains blocked while they are unresolved.

## Review Tool

```powershell
npm.cmd run sync:plan-repair-duplicate-sales-failures
```

The planner is dry-run/read-only. It does not update backend rows, delete rows, trigger replay, mutate IndexedDB, or print payload/response bodies.

## Findings

- remaining failed rows: `6`
- all classified as `duplicateFinalizedSalesRow`
- a finalized `sales` row exists for each `sync_transaction_id`
- `saleItemsCount` is `0` for each row
- no linked customer/supplier payment rows were found
- no linked batch rows were found
- cylinder effects are not safely attributable by `sync_transaction_id`
- audit lacks completed replay-chain evidence
- audit does not show committed lock release
- retry would likely fail again because `sales.sync_transaction_id` already exists

## Why Automatic Repair Is Unsafe

A linked finalized `sales` row alone does not prove the full replay chain committed. Safe metadata does not prove that these effects were completed:

- stock mutation
- finalized `sale_items` insertion
- accounting mutation
- payment persistence
- batch mutation
- cylinder mutation

Because the chain is not proven complete, `markReplayCommittedHistorical` would be unsafe right now.

## Current Status

- proposed action: `manualReviewRequired`
- confidence: `medium`
- failed rows remain unresolved: `6`
- auto-sync evaluator remains blocked by failed replay rows

## Recommended Future Handling

- inspect each row manually
- verify whether the linked `sales` row is an intentional historical conflict-test row
- optionally archive these rows later as historical failed implementation-test rows only after explicit human decision
- do not auto-replay these rows
- keep auto-sync blocked while they remain unresolved, unless a future gate policy explicitly excludes documented historical manual-review rows

## Safety Boundary

This checkpoint is documentation-only. It confirms:

- no backend rows were updated
- no backend rows were deleted
- no audit rows were deleted
- no replay was triggered
- no IndexedDB rows were mutated
- no auto-sync, background sync, startup replay, polling, or listeners were added
