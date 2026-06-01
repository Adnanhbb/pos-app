# Production Operational Tooling Strategy

This document defines the production operational tooling and admin visibility architecture before dashboards, admin tools, or background operations are implemented.

It is documentation/design only. It does not implement dashboards/tools, change runtime behavior, enable auto-sync, add background workers, polling, listeners, or startup replay.

## Operational Visibility Philosophy

Production tooling should make system state visible before it makes state mutable.

Principles:

- read-only visibility first
- safe metadata only by default
- explicit operator intent before any apply action
- separate diagnostics from repair
- separate repair planning from repair execution
- preserve audit trails for all mutating admin actions
- never hide unresolved risk behind a green status

Admin tooling should help operators decide whether sync, replay, hydration, backup, and auth state are safe. It should not silently repair, replay, delete, hydrate, or merge data.

## Replay Health Monitoring

Replay health visibility should include:

- count by `replay_status`
- recent replay attempts
- failed replay categories
- processing rows
- stale lock rows
- archived/manual-review rows
- last successful replay timestamp
- audit event counts by type

Display safe metadata only:

- sync transaction id
- client transaction id
- transaction type
- replay status
- replay attempts
- safe replay error summary
- timestamps

Never display payload bodies, response JSON, customer/supplier bodies, item bodies, token values, or passwords.

## Queue Health Monitoring

Queue visibility should include local `sync_queue` state:

- total rows
- pending rows
- failed rows
- done rows
- stuck pending rows
- queue rows by entity
- queue rows by operation
- oldest/newest pending timestamps
- orphaned queue rows

Initial queue tooling should remain read-only except existing explicit dry-run/apply scripts for controlled maintenance.

## Auth/Session Monitoring

Auth/session admin visibility should include:

- CRUD auth enforcement state
- token present yes/no for current frontend session
- safe actor metadata
- invalid/expired session counts where available
- login/logout endpoint health
- revoked token counts
- recent invalid auth attempts by safe category

Operators must never see raw bearer tokens, token hashes, password hashes, or passwords.

## Backup/Export Verification Visibility

Backup visibility should include:

- latest IndexedDB backup export status
- latest MySQL backup export status
- latest validation result
- backup file checksum
- file timestamp and size
- count mismatch status
- unsafe sensitive field status
- restore/import availability status

Validation does not prove restore success, so admin UI should label it as backup-file integrity and structure validation only.

## Hydration/Reconciliation Visibility

Hydration and reconciliation visibility should show:

- missing local server ids
- duplicate server ids
- missing backend rows
- local-only rows
- remote-only rows
- possible divergence rows
- soft-delete mismatches
- manual-review rows by disposition
- planned hydration actions by category

Hydration apply must remain narrow and explicit. Update hydration, overwrite, delete, and conflict resolution must remain unavailable until separately designed and tested.

## Auto-Sync Eligibility Visibility

Auto-sync eligibility visibility should expose the read-only gate result:

- allowed yes/no
- blockers
- warnings
- auth check
- backend reachability
- queue health
- replay lock health
- reconciliation health
- hydration health
- POS activity state

The UI must make clear that evaluator visibility does not start auto-sync.

## POS Activity Safety Visibility

POS safety visibility should show only:

- active yes/no
- startedAt
- source

It must never show cart contents, customer identity, payment details, item details, or invoice body data in generic sync/admin status panels.

## Deployment/Environment Verification Tooling

Deployment verification tooling should report:

- frontend build version/checkpoint if available
- API base URL
- backend health endpoint status
- PHP/API environment status
- database connectivity status
- CRUD auth enforcement flag state
- HTTPS/TLS status where detectable
- CORS/auth diagnostic headers where safe

This should be read-only. It should not change environment flags or deploy code.

## Replay/Audit Exploration Tooling

Replay audit exploration should support:

- filter by sync transaction id
- filter by client transaction id
- filter by event type
- filter by actor id/type/role where safe
- recent audit rows
- status transition history

Audit tooling must not expose payload JSON, response JSON, passwords, tokens, or full business records.

## Replay Lock Monitoring

Replay lock monitoring should include:

- total processing rows
- stale lock rows
- locked_by distribution
- oldest/newest locked_at
- affected sync transaction ids
- safe replay status and attempt metadata

Lock release must not be automatic. Any future lock release tool should require explicit dry-run and apply phases with audit logging.

## Failed Replay Investigation Tooling

Failed replay tooling should help classify failures:

- validation failure
- inventory failure
- batch failure
- cylinder failure
- duplicate finalized sales row
- auth failure
- historical dev/test failure
- manual review required

Initial tooling should remain read-only. Repair/archive tooling should require a dry-run plan, explicit `--apply`, and audit events.

## Manual Replay Operator Workflow

Manual replay workflow should be explicit:

1. check auth/session state
2. check POS activity is idle
3. check queue health
4. check replay locks and failed replay status
5. run manual replay from Settings only when safe
6. inspect diagnostics
7. run reconciliation if needed
8. do not retry blindly after failures

Manual replay should remain button-driven and duplicate-click guarded. No automatic retry loops should exist.

## Backup Rotation/Retention Visibility

Admin visibility should show:

- latest backup timestamps
- latest validation checksums
- backup age warnings
- retained backup count
- off-host backup status where available
- restore/import status: not implemented until future phase

A backup retention plan should exist before background sync or broad multi-device rollout.

## Storage Growth Monitoring

Storage growth monitoring should cover:

- MySQL table counts
- `sync_transactions` growth
- `transaction_replay_audit` growth
- sales/sale_items growth
- payment/batch/cylinder growth
- local IndexedDB store counts
- backup directory size

Operators need thresholds before automated background sync increases write volume.

## Health Endpoint Expectations

Health endpoint expectations:

- public but safe
- no secrets
- no detailed stack traces
- indicates backend reachability
- may include API version/build metadata later
- may include database connectivity only if safe and not overly revealing

Health checks should not require auth for basic uptime, but deeper diagnostics should be admin-auth protected in the future.

## Multi-Device Operational Concerns

Multi-device operations need visibility into:

- active sessions/devices
- device-specific pending queues where detectable
- server id mapping health
- hydration status per device
- conflict categories
- last successful manual sync per device
- auth expiry impact

Replay-only visibility is not enough for multi-device correctness.

## Recommended Admin-Only UI Areas

Recommended future admin-only areas:

- Sync Overview
- Queue Health
- Replay Health
- Replay Audit
- Reconciliation
- Hydration Planning
- Backup/Validation
- Auth/Sessions
- Deployment Health
- POS Activity Safety
- Storage/Retention

Initial UI should be read-only dashboards with links to documented manual scripts. Mutating actions should arrive later and remain explicit.

## Safe Logging Philosophy

Production logs should be useful for diagnosis while staying safe.

Log:

- event category
- endpoint/method
- status code
- safe actor metadata
- replay transaction id
- error category
- timestamps

Do not log:

- passwords
- password hashes
- raw bearer tokens
- token hashes
- full request payloads
- full response bodies
- session secrets
- customer/supplier/user full records

## Sensitive-Data Redaction Philosophy

Redaction must be default-on for admin tooling.

Sensitive data classes:

- auth credentials
- tokens and hashes
- passwords and hashes
- payload bodies
- response bodies
- session data
- customer/supplier/user full records
- payment details beyond safe ledger metadata

Admin screens should prefer counts, ids, labels, status, timestamps, and short error summaries.

## Production Support Workflow

Support workflow for sync/replay incidents:

1. collect safe environment and version metadata
2. run read-only reports
3. classify the issue
4. export/validate backup if data mutation may be needed
5. create a dry-run repair plan
6. review plan with operator/human approval
7. run explicit apply only when safe
8. capture audit/checkpoint after apply
9. re-run validation/reconciliation

Support should never ask operators to paste raw tokens, passwords, payload JSON, or full database dumps into tickets.

## Future Background-Sync Operational Requirements

Before background sync exists, operators need:

- live status and pause control
- last sync timestamp
- current sync phase
- failed row visibility
- auth error visibility
- backoff/retry visibility
- POS activity blocking visibility
- gate blocker visibility
- audit trail for automated runs

Background sync without operator visibility is a no-go.

## What Operators Should Never Mutate Directly

Operators should never directly mutate:

- `items.availableStock`
- customer/supplier balances
- finalized sales/sale_items
- payment ledger rows
- batch balances
- cylinder counts/customer holdings
- `sync_transactions.payload_json`
- idempotency hashes
- raw auth token records/hashes
- active session secrets

These require backend-owned processors, migrations, or explicit audited repair tools.

## Manual-Review-Only Areas

Manual review is required for:

- failed replay rows
- duplicate finalized-sales failures
- local-only rows without backend match
- hydration conflicts
- manualReviewRequired hydration rows
- stale replay locks
- archived replay state decisions
- partial restore candidates
- multi-device conflict candidates

## Read-Only Initially

These tooling areas should remain read-only at first:

- replay audit exploration
- replay lock monitoring
- failed replay investigation
- hydration/reconciliation dashboards
- backup validation visibility
- deployment/environment verification
- storage growth monitoring
- auth/session monitoring
- auto-sync eligibility dashboard

## Explicit Apply Confirmation Required

Any future mutating tool must require explicit apply confirmation for:

- serverId repair
- failed replay archival
- queue cleanup
- failed queue reset
- hydration create-local apply
- future hydration update apply
- replay lock release
- restore/import
- cleanup/delete operations

The safe pattern is: read-only report, dry-run plan, explicit apply, audit/checkpoint.

## Recommended Phased Implementation Roadmap

Phase 1: Consolidate read-only reports

- expose current script outputs in admin-friendly summaries
- no mutation

Phase 2: Admin-only status UI

- sync/replay/backup/auth/hydration health panels
- safe metadata only

Phase 3: Guided operator workflows

- checklists for manual replay, backup validation, and incident triage
- links to dry-run commands

Phase 4: Controlled apply UI for existing safe tools

- explicit confirmation
- audit logging
- restricted roles

Phase 5: Background-sync readiness dashboard

- gate status
- blockers and warnings
- no background sync yet

Phase 6: Controlled background sync operations

- pause/resume
- run history
- retry/backoff visibility
- alerting and audit trail
## Developer Control Panel Reference

The future protected developer-support-only UI is designed in [developer-control-panel-architecture.md](./developer-control-panel-architecture.md).

The control panel should separate client-facing status from developer diagnostics. Normal staff should see only simplified health such as Online/Offline, Sync healthy/Needs attention, last successful sync, last backup, and support action. Only authenticated DB-backed users with exact role `Dev` may see advanced sync, replay, backup, auth, hydration, deployment, and auto-sync eligibility diagnostics.

Initial implementation should be read-only-first. Dangerous actions must follow the report -> dry-run plan -> explicit apply -> audit/checkpoint pattern and must never expose payloads, tokens, passwords, direct stock edits, direct accounting edits, or direct transactional table edits.
## Developer Control Panel Foundation Status

The first Developer Control Panel UI foundation is implemented as a read-only developer-support-only dashboard area.

Implemented sections:

- System Health
- Sync Status
- Replay Status
- Auth Status
- Backup Status
- Auto-sync Eligibility
- POS Activity Status

The foundation uses manual refresh only and intentionally leaves dangerous tools deferred. It does not trigger replay automatically, does not add auto-sync/background behavior, does not add polling/listeners/workers, and does not expose payloads, tokens, passwords, direct stock edits, or accounting mutation tools.
Checkpoint reference: [release-checkpoint-developer-control-panel-foundation.md](./release-checkpoint-developer-control-panel-foundation.md)

This checkpoint confirms the current Developer Control Panel is read-only, manually refreshed, role-limited in the Dashboard, and contains no mutation tools, replay triggers, polling, listeners, workers, auto-sync, or backend runtime endpoint additions.
