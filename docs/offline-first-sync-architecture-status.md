# Offline-First Sync Architecture Status

This document is the consolidated high-level reference for the current offline-first sync architecture, implemented guarantees, remaining gaps, and future rollout phases.

Current stable architecture tag references:

- `full-backend-replay-chain-before-sync-wiring`
- `ui-crud-sync-working-before-auto-sync`
- `reconciliation-tools-with-controlled-serverid-repair`
- `hydration-create-local-applied-before-update-merge`
- `auto-sync-gate-designed-before-background-sync`
- `authenticated-manual-replay-gate-before-autosync`

## Current Architecture Overview

The application is local-first at runtime. User-facing CRUD and POS workflows primarily operate against IndexedDB so the app remains usable when the backend is unavailable.

Backend communication is split into controlled layers:

- low-risk CRUD sync and local mirror updates
- backend-authoritative transaction replay
- read-only diagnostics and reconciliation tooling
- limited manual hydration apply
- auth/session/token foundation
- manual replay controls
- auto-sync eligibility design and evaluator

Auto-sync is still disabled. There is no polling, no online/offline listener replay, no background worker replay, and no startup replay.

## Local-First IndexedDB Runtime Model

IndexedDB remains the runtime source for app interaction and offline continuity.

Implemented local-first pieces include:

- local entity stores for low-risk CRUD data
- `sync_queue` for queued offline/failed CRUD operations
- local mirror patching after successful replay
- local POS transaction capture and queued transaction payload storage
- read-only POS activity state for sync safety gates

Local mirror writes use direct IndexedDB/db helpers where implemented and avoid repository update paths that enqueue additional sync rows.

## Backend-Authoritative Replay Model

Transactional replay is backend-authoritative. The sync engine and frontend must not compute stock, accounting, batch, cylinder, payment, or finalized sale side effects as part of remote replay.

The backend transaction replay processor owns:

- validation
- lock acquisition/release
- idempotency protection
- DB transaction boundaries
- stock mutation
- finalized sales/sale_items persistence
- accounting summary mutation
- payment ledger persistence
- batch mutation
- cylinder mutation
- audit events

CRUD mirrors remain separated from transactional state.

## Replay Protections And Idempotency

Implemented replay protections include:

- replay metadata on `sync_transactions`
- `transaction_replay_audit`
- replay lock acquire/release primitives
- terminal-state protection for `committed`, `rolled_back`, and `duplicate`
- replay attempt tracking
- audit attribution foundation
- auth/session foundation for authorized replay wrappers
- stale replay lock reporting
- read-only replay audit reporting

Duplicate replay must not duplicate stock, sales, accounting, payment, batch, or cylinder effects.

## Transaction Replay Chain

The backend replay chain now includes business mutations in one backend DB transaction.

### Stock

- mutates only `items.availableStock`
- uses row locking where appropriate
- re-checks stock before decreases
- prevents negative stock
- rolls back fully on failure

### Sales And Sale Items

- persists finalized `sales` row
- persists linked `sale_items` rows
- happens atomically with stock mutation
- terminal-state protection prevents duplicate insertion

### Accounting

- mutates customer/supplier summary fields only:
  - `invoices`
  - `payable`
  - `paid`
  - `balance`
- uses backend calculations, not client balance fields
- runs inside the same backend DB transaction

### Payments

- persists customer/supplier payment ledger rows when paid amount is non-zero
- payment rows are ledger/audit persistence
- no separate payment reconciliation exists yet

### Batches

- purchase creates batch rows
- sale consumes batches
- customer return creates/restocks batches
- supplier return decrements/reverses batches
- explicit batch id is used when present, otherwise FIFO applies where supported

### Cylinders

- cylinder/gas items trigger cylinder mutation
- sale moves filled cylinders to customer-held state
- customer return reduces customer holding and increases empty cylinders
- purchase increases filled/stock where appropriate
- supplier return decreases filled/stock where appropriate
- cylinder/customer-cylinder rows are locked and invariant checks apply

## Auth, Session, And Token Architecture

The auth/session foundation includes:

- `login.php`
- `logout.php`
- `session.php`
- bearer token helper
- SHA-256 token hashes in `api_auth_tokens`
- frontend token plumbing through `getAuthToken`, `setAuthToken`, and `clearAuthToken`
- token-backed session restoration
- replay auth foundation and audit attribution

Passwords are never stored in the token helper or displayed by diagnostics.

## CRUD Auth Enforcement Model

CRUD endpoints currently support auth audit mode and configurable enforcement.

Current model:

- `CRUD_AUTH_ENFORCEMENT` exists
- default remains off/audit-only
- enforcement off allows missing, invalid, and valid auth while exposing safe diagnostics
- enforcement on rejects missing/invalid auth with safe 401 responses
- health endpoint remains public

CRUD auth is not globally enforced by default.

## Manual Replay Architecture

Manual replay is exposed through Settings Developer Sync Replay.

Implemented safeguards:

- explicit user click required
- duplicate-click guard while replay runs
- safe diagnostics for processed/succeeded/failed/skipped/errors
- safe auth error summaries
- auth diagnostics visibility
- POS activity visibility
- authenticated manual replay gate before `syncEngine.processPending()`

Manual replay remains manual-first. There are no automatic retry loops.

## Reconciliation Tooling

Read-only and controlled repair tooling exists for local/backend sync health.

Tools include:

- `sync:report-reconciliation`
- `sync:report-missing-serverids`
- `sync:report-failed-replay-details`
- `sync:plan-repair-serverids`
- `sync:plan-cleanup-failed-replays`
- `sync:repair-serverids:dry`
- `sync:repair-serverids`

Only one high-confidence local serverId repair has been applied: users local id `1` patched to serverId `63`. Remaining unresolved local-only rows remain intentionally untouched.

## Hydration Diagnostics, Planning, And Apply Status

Hydration work is intentionally staged.

Implemented:

- read-only hydration divergence diagnostics
- detailed hydration reports
- dry-run hydration planning
- manual-review classification
- controlled create-local hydration apply for safe `createLocalFromRemote` only

Current limits:

- hydration apply is extremely limited
- only `createLocalFromRemote` has an explicit apply path
- no `updateLocalFromRemote` apply exists
- no overwrite behavior exists
- no conflict auto-resolution exists
- no automatic hydration exists

## Auto-Sync Eligibility Gate

The auto-sync eligibility gate is designed and has a read-only evaluator.

Implemented references:

- [auto-sync-eligibility-gate.md](./auto-sync-eligibility-gate.md)
- `sync:evaluate-auto-sync`

Current evaluator status remains blocked.

Known blocking categories include:

- auth missing or invalid in current dev profile
- failed backend replay rows above threshold
- hydration manual-review rows remain
- unresolved manual review state

Auto-sync remains disabled.

## POS Activity Safety Gate

POS activity detection exists for future sync safety checks.

Implemented:

- `src/services/posActivityState.ts`
- safe metadata only: `active`, `startedAt`, `source`
- Settings Developer Sync Replay POS activity display
- evaluator `checks.activePOSTransaction`

Future auto-sync must block whenever POS activity is active.

## Current Operational Blockers

Current blockers before any auto-sync/background rollout:

- auto-sync evaluator is blocked
- current dev profile has no frontend bearer token
- backend failed replay rows remain above strict threshold
- hydration manual-review rows remain
- missing serverId rows remain under review
- update hydration/conflict resolution is not implemented
- production auth enforcement rollout is not complete
- pull-sync/hydration convergence is not complete
- no bounded background retry/backoff runtime exists

## Explicitly Not Implemented Yet

Still not implemented:

- auto-sync
- background sync
- startup replay
- polling
- online/offline listener replay
- service worker/background worker replay
- automatic retry loops
- automatic hydration
- update hydration apply
- conflict resolution
- pull-sync convergence
- production CRUD auth enforcement by default
- multi-device conflict handling

## Future Phased Roadmap

Recommended future phases:

1. Keep manual-only sync stable.
2. Resolve or classify current evaluator blockers.
3. Harden auth/session enforcement in staging.
4. Add safe read-only background eligibility display.
5. Implement controlled one-click safe sync all for dev/staging.
6. Implement throttled background low-risk CRUD replay behind a feature flag.
7. Implement authenticated transaction replay background sync only after gate pass.
8. Implement controlled hydration background sync only after hydration apply/conflict handling matures.

## Production Rollout Philosophy

Production rollout should remain conservative:

- default deny for automation
- operator-visible status before action
- manual override before background behavior
- feature flags for every background phase
- no generic CRUD replay for stock/accounting/cylinder/batch quantities
- backend remains authoritative for transaction side effects
- no silent repair, cleanup, delete, or overwrite behavior

## Rollback And Checkpoint Strategy

Checkpoint documents define safe rollback anchors before each high-risk phase.

Major references:

- [sync-stabilization-status.md](./sync-stabilization-status.md)
- [sync-roadmap-and-status.md](./sync-roadmap-and-status.md)
- [release-checkpoint-sync-stabilized.md](./release-checkpoint-sync-stabilized.md)
- [release-checkpoint-ui-crud-sync-working.md](./release-checkpoint-ui-crud-sync-working.md)
- [release-checkpoint-reconciliation-tools.md](./release-checkpoint-reconciliation-tools.md)
- [release-checkpoint-full-backend-replay-chain.md](./release-checkpoint-full-backend-replay-chain.md)
- [release-checkpoint-replay-auth-foundation.md](./release-checkpoint-replay-auth-foundation.md)
- [release-checkpoint-login-session-foundation.md](./release-checkpoint-login-session-foundation.md)
- [release-checkpoint-crud-auth-enforcement-validation.md](./release-checkpoint-crud-auth-enforcement-validation.md)
- [release-checkpoint-hydration-diagnostics.md](./release-checkpoint-hydration-diagnostics.md)
- [release-checkpoint-hydration-planning.md](./release-checkpoint-hydration-planning.md)
- [release-checkpoint-hydration-create-local-applied.md](./release-checkpoint-hydration-create-local-applied.md)
- [release-checkpoint-auto-sync-gate-design.md](./release-checkpoint-auto-sync-gate-design.md)
- [release-checkpoint-auto-sync-evaluator.md](./release-checkpoint-auto-sync-evaluator.md)
- [release-checkpoint-pos-activity-sync-gate.md](./release-checkpoint-pos-activity-sync-gate.md)
- [release-checkpoint-authenticated-manual-replay-gate.md](./release-checkpoint-authenticated-manual-replay-gate.md)
- [release-checkpoint-backup-export-validation.md](./release-checkpoint-backup-export-validation.md)
- [deployment-and-environment-hardening-strategy.md](./deployment-and-environment-hardening-strategy.md)
- [production-operational-tooling-strategy.md](./production-operational-tooling-strategy.md)
- [developer-control-panel-architecture.md](./developer-control-panel-architecture.md)

## Current Boundary Statement

The current system is offline-first and manual-first. It has strong diagnostics, controlled repair/hydration tooling, backend-authoritative transaction replay, and auth/session foundations. It does not yet have automatic sync or automatic convergence behavior.

## Failed Replay Archival Planning

Production hardening has started for historical failed backend replay rows with a dry-run planner:

```powershell
npm.cmd run sync:plan-archive-failed-replays
```

The planner classifies `sync_transactions` rows where `replay_status = failed` into:

- `archiveCandidateDevTest`
- `keep`
- `manualReviewRequired`

This is planning-only. It does not archive, delete, update, replay, mutate IndexedDB, mutate backend rows, or print payload bodies. No cleanup/delete behavior exists yet.

Auto-sync remains disabled.

## Failed Replay Dev/Test Archival Outcome

A controlled manual archival tool now exists for historical backend replay failures that are clearly classified as dev/test noise:

```powershell
npm.cmd run sync:archive-failed-replays:dry
npm.cmd run sync:archive-failed-replays
```

The dry-run command is the default. The apply command requires explicit `--apply` and recomputes the archive plan internally before changing anything.

The apply gate required this exact safe classification:

- `archiveCandidateDevTest: 140`
- `keep: 6`
- `manualReviewRequired: 0`

Applied archival result:

- `140` failed dev/test replay rows were archived.
- archived rows were preserved with `replay_status = archived_dev_test`.
- no `sync_transactions` rows were deleted.
- no `transaction_replay_audit` rows were deleted.
- `140` audit rows were inserted with event `failed_replay_archived_dev_test`.
- remaining failed rows: `6`.

Post-apply report status:

- `sync:plan-archive-failed-replays` => `totalFailedRows: 6`, `archiveCandidateDevTest: 0`, `keep: 6`.
- `sync:report-failed-replay-details` => `totalFailedRows: 6`.
- `sync:evaluate-auto-sync` => `allowed: false`, `failedReplayRows: 6`.

The evaluator still blocks auto-sync. The remaining failed rows are intentionally left for manual review, and auth/hydration blockers also remain. This archival did not trigger replay, mutate IndexedDB, delete backend data, add background workers, or enable auto-sync.

Checkpoint reference: [release-checkpoint-failed-replay-archival.md](./release-checkpoint-failed-replay-archival.md)

## Remaining Failed Replay Manual-Review Blockers

After dev/test archival, `6` failed backend replay rows remain. A focused dry-run repair planner inspected these rows with safe metadata only:

```powershell
npm.cmd run sync:plan-repair-duplicate-sales-failures
```

Current classification:

- remaining failed rows: `6`
- replay error category: `duplicateFinalizedSalesRow`
- linked finalized `sales` row exists for each row
- `saleItemsCount` is `0` for each row
- no linked customer/supplier payment rows were found
- no linked batch rows were found
- cylinder effects are not safely attributable by `sync_transaction_id`
- audit metadata lacks completed replay-chain evidence
- audit shows failure-oriented events, not committed replay completion
- retry would likely fail again because the linked `sales.sync_transaction_id` unique key already exists

The planner did not propose `markReplayCommittedHistorical`. Marking these rows committed would be unsafe because safe metadata does not prove that stock, sale items, accounting, payments, batches, and cylinders all committed.

Status remains `manualReviewRequired`.

Recommended future handling:

- inspect manually before any repair
- optionally archive later as historical failed implementation-test rows only after an explicit human decision
- do not include these rows in auto-replay
- keep auto-sync blocked while they remain unresolved, unless a future gate policy explicitly excludes documented historical manual-review rows

Checkpoint reference: [release-checkpoint-remaining-failed-replay-manual-review.md](./release-checkpoint-remaining-failed-replay-manual-review.md)

## Backup, Restore, And Migration Strategy

A production-grade backup/restore/migration architecture plan now exists: [backup-restore-migration-strategy.md](./backup-restore-migration-strategy.md).

The strategy is design-only and covers:

- IndexedDB export/backup
- backend MySQL backup
- sync metadata preservation
- queue preservation versus quarantine
- replay/audit/history preservation
- full-device and partial restore risks
- multi-device restore risks
- export formats
- encryption/security considerations
- auth token/session restore policy
- schema migration philosophy for IndexedDB and backend MySQL
- rollback and restore verification checks
- operator/admin tooling expectations

Current boundary: export-only backup tooling and validation/checksum tooling now exist for IndexedDB and backend MySQL. Restore/import tooling still does not exist, no migration execution code was added, no IndexedDB/backend data was changed by validation, and no auto-sync/background behavior was added.

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
## Backup Export And Validation Tooling

Export-only backup tooling now exists for local IndexedDB and backend MySQL:

```powershell
npm.cmd run backup:indexeddb:export
npm.cmd run backup:mysql:export
npm.cmd run backup:validate -- backups/<backup-file>.json
```

The validation tool checks JSON structure, metadata, store/table count integrity, sensitive-field leakage, and SHA-256 checksums. Latest validated backups both passed with `ok: true`, count mismatches `0`, and unsafe sensitive fields `0`.

Checkpoint reference: [release-checkpoint-backup-export-validation.md](./release-checkpoint-backup-export-validation.md)

Restore/import remains unimplemented. Backup validation does not prove restore success and does not mutate IndexedDB, backend MySQL, replay state, hydration state, or runtime sync behavior.
## Deployment And Environment Hardening Strategy

A production deployment and environment hardening strategy now exists: [deployment-and-environment-hardening-strategy.md](./deployment-and-environment-hardening-strategy.md).

It covers shared hosting versus VPS tradeoffs, recommended topology, frontend/backend deployment flows, MySQL operations, environment variables, API base URL strategy, HTTPS/TLS, auth/security requirements, backup scheduling, logging/audit expectations, replay lock operations, storage growth, rate limiting, feature flags, rollback, upgrades, disaster recovery, multi-device rollout, mobile considerations, and phased production rollout.

Current boundary: this is design-only. No deployment automation, CI/CD, infrastructure automation, runtime behavior change, auto-sync, startup replay, polling, listeners, or background sync was added.
## Production Operational Tooling Strategy

A production operational/admin tooling strategy now exists: [production-operational-tooling-strategy.md](./production-operational-tooling-strategy.md).

It defines the future admin visibility model for replay health, queue health, auth/session state, backup validation, hydration/reconciliation, auto-sync eligibility, POS activity, deployment/environment verification, replay audit exploration, replay lock monitoring, failed replay investigation, storage growth, support workflows, and background-sync operational requirements.

Current boundary: this is design-only. No dashboards, admin tools, runtime behavior changes, polling, listeners, startup replay, background workers, or auto-sync were added.
## Developer Control Panel Architecture

A protected Developer Control Panel architecture is now designed: [developer-control-panel-architecture.md](./developer-control-panel-architecture.md).

It defines the future admin/developer-only UI for System Health, Sync Queue, Manual Replay, Replay Audit, Hydration/Reconciliation, Backup/Restore, Auth/Session, Deployment/Environment, Auto-sync Eligibility, POS Activity Safety, and Logs/Diagnostics.

The design keeps normal staff on a simplified client-facing status surface and reserves advanced diagnostics for authorized admin/developer roles. It is read-only-first and prohibits payload/token/password display, direct stock/accounting edits, direct transactional table edits, and accidental auto-sync/background behavior.
## Developer Control Panel Foundation UI

The initial Developer Control Panel UI foundation is implemented as `src/DeveloperControlPanel.tsx` and is linked from the dashboard for `admin` and `Dev` roles only.

Current sections are read-only: System Health, Sync Status, Replay Status, Auth Status, Backup Status, Auto-sync Eligibility, and POS Activity Status. The panel uses manual refresh only and does not add automatic replay, auto-sync, polling, listeners, background workers, hydration apply, restore/import, direct DB edits, or mutation tools.
Checkpoint reference: [release-checkpoint-developer-control-panel-foundation.md](./release-checkpoint-developer-control-panel-foundation.md)

The checkpoint marks the current Developer Control Panel as a read-only foundation before any dangerous actions, replay triggers, mutation tools, backend runtime endpoints, polling, listeners, workers, auto-sync, or background behavior are added.
## Production Deployment Preparation Assets

Production hosting preparation assets now exist:

- `.env.production.example`
- [production-deployment-checklist.md](./production-deployment-checklist.md)

They prepare environment configuration and deployment verification for client hosting readiness. They do not deploy anything, change runtime behavior, enable auto-sync, add CI/CD, add startup replay, or add background behavior.
