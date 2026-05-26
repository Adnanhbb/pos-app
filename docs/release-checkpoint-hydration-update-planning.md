# Release Checkpoint: Hydration Update Planning

Suggested git tag:

```text
hydration-update-planning-no-apply
```

## Milestone Summary

This checkpoint records dry-run update hydration planning for matched local/backend rows that already have `serverId`.

The planner can now classify possible update states, but it does not apply updates, overwrite local rows, resolve conflicts, mutate backend data, or enable automatic sync.

## What Exists

Matched-row update diagnostics now exist in:

```powershell
npm.cmd run sync:plan-hydration
```

The planner compares only explicit safe fields and reports:

- `noOpRows`
- `remoteNewerCandidates`
- `localNewerRows`
- `conflictCandidates`
- `timestampMissingRows`

Safe-field comparison is limited to low-risk/profile/header fields for:

- units
- taxes
- discounts
- brands
- categories
- customers profile fields
- suppliers profile fields
- settings safe fields
- held header fields

`users` are excluded from automatic update planning. User/auth/session/security fields require manual review.

## Excluded Fields

The planner explicitly excludes:

- customer/supplier accounting fields
- passwords
- password hashes
- stock fields
- transaction/replay fields
- cylinder quantities
- batch quantities

## Current Planner Summary

Latest dry-run planner summary:

```text
createLocalFromRemote: 0
updateLocalFromRemote: 0
possibleConflict: 0
manualReviewRequired: 884
noOpRows: 7
remoteNewerCandidates: 0
localNewerRows: 0
conflictCandidates: 0
timestampMissingRows: 0
```

Current state has no safe update hydration actions to apply.

## Safety Boundary

This checkpoint does not add:

- update apply
- local overwrite behavior
- conflict auto-resolution
- backend mutation
- replay triggering
- auto-sync
- background sync
- startup replay
- polling
- online/offline listeners

