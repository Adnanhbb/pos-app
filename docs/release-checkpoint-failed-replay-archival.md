# Release Checkpoint: Failed Replay Dev/Test Archival

Suggested git tag:

```text
failed-replay-devtest-archived
```

## Milestone Summary

Historical backend replay failures that were clearly classified as dev/test noise have been archived with a controlled manual tool. This reduces failed replay noise for diagnostics while preserving all original rows and audit history.

This checkpoint does not enable auto-sync, background sync, startup replay, polling, listeners, hydration apply, or replay execution.

## Tools Added

```powershell
npm.cmd run sync:archive-failed-replays:dry
npm.cmd run sync:archive-failed-replays
```

`sync:archive-failed-replays:dry` is the default safety path. `sync:archive-failed-replays` requires explicit `--apply` through the npm script.

## Dry-Run Gate

Apply was allowed only because the dry-run classification matched the expected safe gate exactly:

- `archiveCandidateDevTest: 140`
- `keep: 6`
- `manualReviewRequired: 0`

The tool recomputes the plan internally before apply and refuses to apply when manual-review rows are present or expected counts do not match.

## Applied Result

- applied archive count: `140`
- updated status: `replay_status = archived_dev_test`
- audit event: `failed_replay_archived_dev_test`
- audit rows inserted: `140`
- remaining failed rows: `6`

No rows were deleted. No audit rows were deleted. No payload bodies, response bodies, passwords, tokens, or full records were printed.

## Post-Apply Status

Current reports after archival:

- `sync:plan-archive-failed-replays` => `totalFailedRows: 6`, `archiveCandidateDevTest: 0`, `keep: 6`
- `sync:report-failed-replay-details` => `totalFailedRows: 6`
- `sync:evaluate-auto-sync` => `allowed: false`, `failedReplayRows: 6`

The remaining failed replay rows are intentionally left as `keep` and require manual review or a future explicit plan.

## Auto-Sync Status

Auto-sync remains blocked. Current known blockers still include:

- no frontend bearer token in the current dev profile
- remaining failed replay rows: `6`
- hydration manual-review rows remain
- unresolved review-only reconciliation/hydration state

The system remains manual-first.

## Safety Boundary

This checkpoint confirms:

- no `sync_transactions` rows were deleted
- no `transaction_replay_audit` rows were deleted
- no IndexedDB rows were mutated
- no replay was triggered
- no hydration apply was triggered
- no auto-sync, background sync, startup replay, polling, or listeners were added
