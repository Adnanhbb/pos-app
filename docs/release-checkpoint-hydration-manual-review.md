# Release Checkpoint: Hydration Manual Review Classification

Suggested git tag:

```text
hydration-manual-review-before-cleanup
```

## Milestone Summary

This checkpoint records the read-only hydration manual-review classification report before any cleanup, delete, or additional hydration decisions are made.

The report exists to separate likely dev/test backend noise from rows that may need real review. It is not a repair tool, cleanup tool, hydration apply tool, or auto-sync mechanism.

## Available Command

```powershell
npm.cmd run sync:report-hydration-manual-review
```

## Current Summary

Latest report summary:

```text
totalManualReviewRows: 898
likelyDevTestDataRows: 894
localOnlyUnmatched: 3
remoteOnlyDevTest: 894
timestampMissing: 0
auth/security-sensitive: 1
unsafeEntityOrField: 0
```

Disposition summary:

```text
ignoreDevTest: 894
reviewForHydration: 3
keep: 1
```

## Interpretation

- The large `remoteOnlyDevTest` set is dev/test backend noise and should not be automatically hydrated.
- The `localOnlyUnmatched` rows still need manual review.
- The `auth/security-sensitive` row should be kept out of automatic update hydration.
- Cleanup/delete tooling must be separate, explicit, dry-run-first, and reviewed before any `--apply` behavior is considered.

## Safety Boundary

The report is read-only and prints safe metadata only.

It does not print:

- payload bodies
- passwords
- tokens
- full customer records
- full user records
- auth/session data

This checkpoint does not add:

- hydration apply
- cleanup/delete behavior
- backend mutation
- IndexedDB mutation
- replay triggering
- auto-sync
- background sync
- startup replay
- polling
- online/offline listeners

