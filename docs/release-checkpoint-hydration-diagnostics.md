# Release Checkpoint: Hydration Diagnostics Before Apply

Suggested git tag:

```text
hydration-diagnostics-before-apply
```

## Milestone Summary

Read-only pull-sync and hydration diagnostics are now in place before any hydration apply, merge, overwrite, or background sync behavior is implemented.

This checkpoint exists to preserve the current state where developers can inspect local IndexedDB versus backend divergence safely, classify likely dev/test rows, and identify possible hydration candidates without mutating either side.

## Available Diagnostics

```powershell
npm.cmd run sync:report-hydration-divergence
npm.cmd run sync:report-hydration-details
```

`sync:report-hydration-divergence` provides the high-level count and row-mismatch report.

`sync:report-hydration-details` provides per-entity counts, safe row snippets, and classification hints for:

- `likelyDevTestData`
- `likelyNeedsHydration`
- `needsManualReview`

Both scripts are developer-only diagnostics.

## Current Findings

Latest detailed hydration diagnostics snapshot:

- `localOnlyRows`: `3`
- `remoteOnlyRows`: `850`
- `possibleDivergenceRows`: `0`
- `softDeleteMismatchRows`: `0`
- `likelyDevTestData`: `843`
- `likelyNeedsHydration`: `7`
- `needsManualReview`: `3`

Per-entity findings are available from:

```powershell
npm.cmd run sync:report-hydration-details
```

## Interpretation

Most remote-only rows are classified as likely dev/test data from the low-risk sync, real replay, auth, and transaction validation suites.

Seven active backend-only rows have no obvious dev/test marker and may be hydration candidates when a future read/apply path exists.

Three local-only rows need manual review before any repair or hydration behavior is considered.

## Safety Boundaries

The hydration diagnostics are read-only only:

- no IndexedDB mutation
- no backend mutation
- no hydration apply behavior
- no merge behavior
- no overwrite behavior
- no queue replay triggering
- no repair behavior
- no auto-sync
- no background sync
- no startup replay
- no polling
- no online/offline listeners

Reports print safe metadata only and must not print payload bodies, passwords, raw tokens, or full sensitive records.

## Verified Results

- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`
- `npx.cmd tsc -b` passed

## Next Phase

The next phase may design or implement hydration apply behavior only after explicit idempotency, conflict detection, auth-expiry handling, soft-delete handling, rollback/recovery, and test coverage are defined.

Auto-sync remains blocked until both push replay and pull hydration are safe.