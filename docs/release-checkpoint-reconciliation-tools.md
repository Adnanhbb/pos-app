# Release Checkpoint: Reconciliation Tools With Controlled ServerId Repair

Suggested git tag:

```text
reconciliation-tools-with-controlled-serverid-repair
```

## Milestone Summary

This checkpoint records the sync reconciliation milestone after adding read-only reconciliation diagnostics, dry-run repair planning, and one narrowly scoped local `serverId` repair.

The reconciliation tooling is developer-only. It is intended to make local IndexedDB and backend MySQL sync state visible before any broader repair, replay, or auto-sync work is allowed.

## Reconciliation Scripts Added

Current reconciliation and repair-planning scripts:

```powershell
npm.cmd run sync:report-reconciliation
npm.cmd run sync:report-missing-serverids
npm.cmd run sync:report-failed-replay-details
npm.cmd run sync:plan-repair-serverids
npm.cmd run sync:plan-cleanup-failed-replays
npm.cmd run sync:repair-serverids:dry
npm.cmd run sync:repair-serverids
```

## Shared Dev Profile

The reconciliation and serverId repair tools use a shared dev-only Playwright profile so dry-run, apply, and follow-up reports inspect the same IndexedDB state.

Default profile:

```text
%TEMP%\jawad-bro-sync-tools-profile
```

Override variable:

```text
SYNC_TOOLS_USER_DATA_DIR
```

## Repair Outcome

One high-confidence local repair was applied:

- entity: `users`
- local id: `1`
- matched by: `Username`
- patched local `serverId`: `63`

Rows intentionally left untouched:

- `customers`: `1` missing `serverId` row
- `settings`: `2` missing `serverId` rows

Reason:

- no safe backend match exists for those rows
- they must not be automatically repaired
- any future repair must begin with read-only reporting and a dry-run plan

## Current Observations

Latest reconciliation observations after the controlled repair:

- local `sync_queue` total rows: `0`
- `orphanQueueRows`: `0`
- `duplicateServerIds`: `0`
- `missingBackendRows`: `0`
- `stuckReplayRows`: `0`
- `missingServerIds`: `3`
- remaining missing rows: `customers: 1`, `settings: 2`
- `failedReplayRows`: mostly backend dev/test replay failures from validation, rollback, insufficient-stock, batch, cylinder, and historical implementation test scenarios

## Safety Boundary

This checkpoint keeps the following boundaries intact:

- no automatic repair
- no backend mutation by reconciliation tools
- no backend row deletion
- no replay trigger from reconciliation tools
- no auto-sync
- no intervals
- no online/offline replay listeners
- no startup replay
- manual replay only

The only applied change in this milestone was a local IndexedDB `serverId` patch for one high-confidence `users` row.

## Verification Snapshot

Latest verified results around this checkpoint:

- `sync:report-reconciliation` => `missingServerIds: 3`
- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`
- `npx.cmd tsc -b` passed

## Rollback Value

This checkpoint is useful because it separates safe reconciliation tooling from future broader repair or auto-sync work.

If future sync changes introduce noisy reconciliation findings, duplicate queue rows, unexpected backend mutations, or unsafe auto-repair behavior, this checkpoint identifies the last known state where:

- reconciliation tooling was available
- one controlled high-confidence local repair was completed
- unsafe rows remained untouched
- auto-sync was still absent
- backend replay was not triggered by reconciliation tooling
