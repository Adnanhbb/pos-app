# Auto-Sync Eligibility Gate

This document defines the runtime checks, product rules, and no-go conditions required before any automatic sync, background sync, startup replay, polling, or online/offline listener behavior can ever be enabled.

Current state remains manual-only. This document is design-only and does not implement auto-sync.

## Purpose

Auto-sync must not be a simple timer around `syncEngine.processPending()`. It needs an explicit gate that proves the app, backend, queue, auth, hydration, reconciliation, and operator visibility are healthy enough before any automatic replay or hydration is allowed.

The gate should be evaluated before future background sync begins and periodically while it runs. Any blocking condition should pause automatic work and surface a safe operator-visible reason.

## Required Eligibility Checks

Before auto-sync is eligible, all of the following must pass.

### Authentication

- user is authenticated
- auth token/session is present
- auth token/session is valid
- auth actor metadata is known
- CRUD auth enforcement state is known
- replay authorization state is known where transaction replay is in scope

### Backend Reachability

- backend health endpoint is reachable
- required CRUD endpoints are reachable
- required transaction/replay endpoints are reachable if transaction replay is in scope
- API base URL is known and not using a bad/offline diagnostic override
- recent request failures are below threshold

### Local Sync Queue Health

- `sync_queue` can be read
- pending row count is below configured threshold
- failed row count is below configured threshold
- no queue row has malformed required metadata
- no queue row references missing local rows unless explicitly classified
- no unknown entity/operation rows are present
- no sensitive payload logging is required to inspect failures

### Backend Replay Health

- no stale replay locks older than threshold
- no unexpected `processing` rows without an active worker
- failed replay rows are either dev/test classified or below configured threshold
- transaction replay audit reporting is available
- rollback/audit visibility exists for transaction replay scope

### Reconciliation Health

- reconciliation report has no unresolved dangerous findings
- no duplicate local `serverId` values
- no local rows with `serverId` missing backend rows unless reviewed
- no queue rows reference missing local rows
- no suspicious backend/local count mismatch is unclassified
- known legacy local-only rows are documented or excluded from automatic handling

### Hydration Health

- hydration diagnostics are available
- hydration planner is available
- manual-review hydration rows are classified
- no unsafe `updateLocalFromRemote` action is pending
- no unresolved `possibleConflict` action is pending
- no non-dev/test `manualReviewRequired` row is pending
- hydration apply scope is separately gated before any automatic hydration

### Manual Replay Baseline

- manual low-risk replay has succeeded recently
- manual replay diagnostics returned a safe result object
- recent manual replay had `failed = 0`
- recent manual replay had no auth failures
- recent manual replay did not mark rows done after a failed remote write

### UI And User Activity

- no active POS transaction is in progress
- no billing/cart session is open
- no modal or workflow is holding unsaved transaction state
- operator can see sync status
- operator can pause/disable automatic sync

### Device And Network Considerations

Future versions may also gate on:

- metered network status
- low battery or power-saver mode
- app foreground/background state
- browser storage quota pressure
- long-running tab suspension risk

These checks are optional until the runtime environment exposes them reliably.

## Blocking Conditions

Any of the following blocks auto-sync:

- auth missing
- auth invalid
- auth enforcement state unknown
- backend unreachable
- API base URL unknown or unhealthy
- failed queue rows above threshold
- malformed queue rows
- stale replay locks
- transaction replay failures above threshold
- unresolved reconciliation conflicts
- duplicate server ids
- missing backend rows for local server ids without review
- non-dev/test manual-review hydration rows
- `possibleConflict` hydration rows
- unsafe `updateLocalFromRemote` candidates
- active POS billing/cart session
- active finalized transaction workflow
- no recent successful manual replay baseline
- no operator-visible sync status
- no pause/disable control

When blocked, future auto-sync must not silently retry forever. It should stop, expose safe status, and require manual/operator action or a later explicit gate pass.

## Future Allowed Auto-Sync Scope

Auto-sync should roll out by scope, not all at once.

### Low-Risk CRUD Replay First

Initial automatic sync scope may only include already-stabilized low-risk CRUD queue replay:

- units
- taxes
- discounts
- brands
- categories
- expenses
- customers profile fields
- suppliers profile fields
- users safe profile fields
- settings safe fields
- held headers

This scope must still obey auth, queue health, reconciliation, and manual replay baseline checks.

### Transaction Replay Later

Background transaction replay is only eligible after:

- replay auth is enforced
- backend replay chain is stable
- stale lock reporting exists
- failed replay reporting exists
- audit visibility exists
- terminal-state protection is verified
- rollback behavior is verified
- operator status/pausing is available

### Hydration Separately Gated

Hydration must have its own gate. Passing the replay gate does not imply hydration is safe.

Hydration background sync requires:

- read-only diagnostics
- dry-run planning
- manual-review classification
- safe create/update apply paths
- conflict detection
- soft-delete policy
- auth expiry behavior
- idempotent page/cursor handling

### Never Allowed

These must never be auto-synced as generic CRUD:

- direct stock CRUD replay
- direct customer/supplier balance CRUD replay
- direct batch quantity CRUD replay
- direct cylinder quantity CRUD replay
- client-authoritative accounting mutation
- client-authoritative inventory mutation

Stock, accounting, payment, batch, and cylinder effects must remain backend-authoritative transaction replay or backend-authoritative hydration outputs.

## UI And Operator Expectations

Before auto-sync is enabled, the app should expose:

- visible sync status
- auto-sync eligible / blocked state
- last successful sync timestamp
- last attempted sync timestamp
- pending queue count
- failed queue count
- current auth state
- current backend reachability state
- safe failed queue details
- safe auth error visibility
- pause/resume control
- manual override / manual replay button
- clear indication when POS/cart activity blocks auto-sync

The UI must not display payload bodies, passwords, raw tokens, full customer records, full user records, or auth/session secrets.

## Suggested Gate Result Shape

Future runtime code should return a safe result object similar to:

```json
{
  "eligible": false,
  "scope": "lowRiskCrud",
  "checks": {
    "authenticated": false,
    "backendReachable": true,
    "queueHealthy": true,
    "reconciliationHealthy": false,
    "hydrationHealthy": false,
    "manualReplayRecentlySucceeded": true,
    "posIdle": true
  },
  "blockingReasons": [
    {
      "code": "auth_missing",
      "message": "User is not authenticated."
    }
  ]
}
```

Only safe metadata should be returned. Payload bodies, token values, passwords, and full records must not be included.

## Phased Rollout

### Phase 0: Manual Only

Current state.

- manual Settings replay exists
- sync diagnostics exist
- hydration diagnostics and planning exist
- no auto-sync exists
- no startup replay exists
- no polling or listeners exist

### Phase 1: Dev-Only Safe Sync All

Add a dev-only one-click action that runs eligible manual steps in sequence only after the gate passes.

This should still be user-clicked and must not run in the background.

### Phase 2: Throttled Background Low-Risk CRUD

Allow background sync for low-risk CRUD only, behind a feature flag, with:

- backoff
- pause/resume
- visible status
- auth handling
- no active POS workflow
- strict queue health limits

### Phase 3: Authenticated Transaction Replay Background Sync

Allow transaction replay only after the transaction replay gate passes and operator diagnostics are mature.

Transaction replay must remain backend-authoritative and idempotent.

### Phase 4: Controlled Hydration Background Sync

Allow background hydration only after hydration apply, conflict detection, soft-delete handling, and cursor/idempotency behavior are stable.

Hydration must remain separately observable and pausable.

## No-Go Conditions

Do not enable auto-sync if any no-go condition exists:

- no auth
- auth enforcement unknown
- no hydration diagnostics
- no hydration planner
- unresolved conflicts
- no reconciliation tooling
- no rollback/audit visibility
- stale replay locks
- failed queue rows above threshold
- transaction replay failures above threshold
- active POS transaction
- no operator-visible sync status
- no pause/disable control
- no safe auth error visibility
- no bounded retry/backoff policy

## Final Boundary

This document is design-only. It does not implement auto-sync, background sync, startup replay, polling, online/offline listeners, background workers, hydration apply, cleanup behavior, or queue replay changes.


## Read-Only Gate Evaluator

A dev-only/manual evaluator is available:

```powershell
npm.cmd run sync:evaluate-auto-sync
```

The evaluator produces a safe readiness result with:

- `allowed`
- `blockers`
- `warnings`
- `checks.auth`
- `checks.backendReachable`
- `checks.queueHealth`
- `checks.replayLockHealth`
- `checks.reconciliationHealth`
- `checks.hydrationHealth`
- `checks.activePOSTransaction`

It is read-only. It does not call `syncEngine.processPending()`, replay queue rows, apply hydration, mutate IndexedDB, mutate backend rows, start polling, install listeners, run background workers, or enable auto-sync.

The evaluator is a readiness report only. A blocked result is expected until all auto-sync gate requirements are implemented and healthy.

## Evaluator Checkpoint

The first read-only evaluator checkpoint is documented in [release-checkpoint-auto-sync-evaluator.md](./release-checkpoint-auto-sync-evaluator.md).

Current evaluated state remains blocked: `allowed: false`. The evaluator is a readiness report only and does not call `syncEngine.processPending()`, apply hydration, mutate IndexedDB/backend rows, or enable auto-sync.

## POS Activity Safety Signal

A lightweight POS activity state exists for future auto-sync safety checks:

- `markPOSActivityStarted()`
- `markPOSActivityStopped()`
- `getPOSActivityState()`

The state contains safe metadata only:

- `active`
- `startedAt`
- `source`

The current POS cart flow marks activity active when cart/invoice work is in progress and marks it inactive when the cart is cleared. Settings Developer Sync Replay shows this state as safe diagnostics only.

The auto-sync evaluator reads this state and blocks future eligibility when POS activity is active. This is read-only/status-only safety plumbing. It does not start auto-sync, trigger replay, apply hydration, or mutate sales/accounting/stock/cylinder/batch state.

## POS Activity Checkpoint

The POS activity safety gate checkpoint is documented in [release-checkpoint-pos-activity-sync-gate.md](./release-checkpoint-pos-activity-sync-gate.md).

The current evaluator result reports POS activity as detectable and idle. Future auto-sync must block when POS activity is active.

## Manual Replay Auth Gate

Settings Developer Sync Replay now validates auth before manual replay execution.

Behavior:

- enforcement on + missing/invalid session: manual replay is blocked safely before `syncEngine.processPending()` is called
- enforcement off/audit-only: manual replay remains allowed and shows auth diagnostics
- enforcement unknown: manual replay is blocked safely
- duplicate-click protection remains in place while replay is running

Safe replay auth states:

- `authenticated`
- `unauthenticated`
- `authUnknown`
- `enforcementDisabled`

The UI displays the last replay auth gate result and session validation timestamp. It never displays raw bearer tokens, passwords, or sensitive session bodies.

This remains manual-only. No auto-sync, polling, listeners, background workers, startup replay, automatic retry loop, or hydration apply behavior is added.

## Authenticated Manual Replay Gate Checkpoint

The authenticated manual replay gate checkpoint is documented in [release-checkpoint-authenticated-manual-replay-gate.md](./release-checkpoint-authenticated-manual-replay-gate.md).

Settings Developer Sync Replay validates auth/enforcement before calling `syncEngine.processPending()`. Enforcement-on missing/invalid sessions block safely, enforcement-off audit mode still allows manual replay with diagnostics, and unknown enforcement blocks safely.

## Failed Replay Archival Status

Historical failed backend replay rows that were clearly classified as dev/test noise have been archived through an explicit manual apply tool:

```powershell
npm.cmd run sync:archive-failed-replays:dry
npm.cmd run sync:archive-failed-replays
```

The dry-run gate required exact safe counts before apply:

- `archiveCandidateDevTest: 140`
- `keep: 6`
- `manualReviewRequired: 0`

The apply operation preserved rows and changed only the archival status for approved candidates:

- `140` rows were marked `replay_status = archived_dev_test`
- audit event written: `failed_replay_archived_dev_test`
- no rows were deleted
- no replay was triggered
- no IndexedDB rows were mutated

Current post-apply gate inputs:

- `sync:plan-archive-failed-replays` => `totalFailedRows: 6`, `archiveCandidateDevTest: 0`, `keep: 6`
- `sync:report-failed-replay-details` => `totalFailedRows: 6`
- `sync:evaluate-auto-sync` => `allowed: false`, `failedReplayRows: 6`

Auto-sync remains blocked. The remaining failed replay rows are above the strict failed replay threshold of `0` and must stay manual-review until a separate explicit plan exists.

Checkpoint reference: [release-checkpoint-failed-replay-archival.md](./release-checkpoint-failed-replay-archival.md)

## Remaining Failed Replay Manual-Review Gate Status

The remaining `6` failed replay rows are documented manual-review blockers.

Dry-run planner:

```powershell
npm.cmd run sync:plan-repair-duplicate-sales-failures
```

Findings:

- all `6` rows are `duplicateFinalizedSalesRow`
- each has a linked finalized `sales` row
- each has `saleItemsCount: 0`
- no linked payment rows were found
- no linked batch rows were found
- audit metadata does not show completed stock/sales/accounting/payment/batch/cylinder replay-chain evidence
- retry would likely fail again on the existing `sales.sync_transaction_id` unique key
- marking committed automatically is unsafe
- status remains `manualReviewRequired`

Gate implication:

Auto-sync remains blocked while these failed rows remain unresolved. Future policy may explicitly exclude documented historical manual-review rows, but that must be a separate gate decision. These rows must not be auto-replayed.

Checkpoint reference: [release-checkpoint-remaining-failed-replay-manual-review.md](./release-checkpoint-remaining-failed-replay-manual-review.md)

## Mandatory But Deferred Advanced Sync Phases

Controlled background sync, conflict resolution, and advanced hydration automation are mandatory long-term phases. Deferred does not mean abandoned. These phases are required for mature multi-device production sync, but must wait until production hardening, backup/restore, auth rollout, and operational visibility are stable.

Delivery can proceed with manual/gated sync first, but the architecture must continue reserving room for:

- controlled background low-risk CRUD sync
- authenticated background transaction replay
- conflict detection and resolution
- advanced hydration apply/automation
- multi-device convergence
- operator-visible pause/resume/recovery controls

These phases remain deferred for safety, not skipped.
