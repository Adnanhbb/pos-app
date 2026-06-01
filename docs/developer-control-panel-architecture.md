# Developer Control Panel Architecture

This document defines a protected developer-support-only control panel for sync, backup, auth, replay, hydration, and deployment diagnostics before any UI is implemented.

It is documentation/design only. It does not implement UI, expose tools to normal client/staff users, add auto-sync/background behavior, or change runtime behavior.

## Purpose Of Developer Control Panel

The Developer Control Panel is the protected workspace for developer-support operational visibility and carefully controlled future support actions.

Its purpose is to:

- expose sync/replay/backup/auth/deployment diagnostics to trusted operators
- keep advanced internals away from normal staff/client users
- centralize read-only health checks before any apply action exists
- support incident triage and production support workflows
- make auto-sync eligibility blockers visible without enabling auto-sync
- provide a future home for explicit dry-run/apply tools with audit trails

The panel is not a normal POS workflow screen and must not become a place for direct business data manipulation.

## Client-Facing Status Vs Developer Diagnostics

Client-facing status should be simple and non-alarming. It should answer whether the app is usable and whether support is needed.

Developer diagnostics can expose technical sync internals, replay state, lock state, backup validation, hydration blockers, and safe metadata.

Separation matters because normal users should not need to understand `sync_queue`, replay locks, hydration actions, payload validation, or archived replay states.

## Role And Permission Requirements

Access requires an authenticated DB-backed user with exact role `Dev`. The normal `admin` role must not receive Developer Control Panel access.

Recommended future roles:

- `staff`: normal POS/client workflow access only
- `manager`: limited operational status, no advanced internals by default
- `admin`: normal business owner/admin workflows only; no Developer Control Panel access
- `Dev`: database-backed developer support identity for full diagnostics and future dev/test maintenance tools
- `replay_worker`: non-UI service identity for backend replay only

The panel should be hidden from users without appropriate role claims. A route guard alone is not enough; backend diagnostics endpoints must also enforce role checks when implemented.

## Visibility Rules

Normal staff must not see:

- advanced sync queue internals
- replay audit internals
- transaction payload metadata beyond normal business screens
- hydration conflict categories
- auth token/session internals
- backup file checksums and operational paths
- deployment/environment internals
- auto-sync gate internals

Only authenticated DB-backed users with exact role `Dev` may see safe diagnostics. Admin and normal client roles remain excluded.

## Sensitive Data Redaction Rules

The panel must never display:

- raw bearer tokens
- token hashes
- passwords
- password hashes
- session secrets
- payload JSON bodies
- response JSON bodies
- full customer/supplier/user records in generic diagnostics
- full item/cart/payment bodies in sync diagnostics

Prefer safe metadata:

- ids
- entity names/labels where safe
- counts
- statuses
- timestamps
- short error categories
- actor type/id/role where safe

## Safe Read-Only-First Philosophy

The first implementation should be read-only.

Design pattern:

1. read-only report
2. dry-run plan
3. explicit apply confirmation
4. audit/checkpoint
5. post-action validation report

No mutating control-panel action should exist without a matching dry-run preview and safe audit path.

## Proposed Section: System Health

System Health should show:

- frontend build/checkpoint if available
- backend health status
- API base URL
- database reachability status
- HTTPS/TLS status where detectable
- current environment label
- app version/build metadata when available

This section is read-only.

## Proposed Section: Sync Queue

Sync Queue should show:

- total queue rows
- pending/failed/done counts
- stuck pending rows
- counts by entity/operation
- safe pending/failed row metadata
- queue cleanup candidates

Allowed future actions:

- refresh report
- dry-run reset failed rows
- dry-run cleanup done rows
- explicit apply only after confirmation and role check

## Proposed Section: Manual Replay

Manual Replay should show:

- pending queue count
- failed queue count
- auth gate state
- POS activity state
- last replay timestamp
- last replay diagnostics
- safe error summaries

Allowed action:

- explicit manual replay button after auth/enforcement gate passes

No automatic retry loops, startup replay, polling, or online/offline listener replay should be added.

## Proposed Section: Replay Audit

Replay Audit should show:

- audit event counts
- recent audit events
- filter by sync transaction id
- filter by client transaction id
- filter by event type
- actor attribution metadata where safe

No payload/response bodies should be displayed.

## Proposed Section: Hydration/Reconciliation

Hydration/Reconciliation should show:

- missing server ids
- duplicate server ids
- orphan queue rows
- missing backend rows
- hydration divergence counts
- manual-review classification
- dry-run hydration plan categories

Allowed future action:

- create-local hydration apply only where already explicitly designed and gated

No update hydration, overwrite, delete, or conflict auto-resolution should be exposed until implemented separately.

## Proposed Section: Backup/Restore

Backup/Restore should show:

- latest IndexedDB backup export status
- latest MySQL backup export status
- latest validation status
- SHA-256 checksum
- count mismatch status
- unsafe sensitive field status
- restore/import status

Current state:

- export exists
- validation exists
- restore/import does not exist

Future restore/import actions must be separate, dry-run-first, and explicit-apply only.

## Proposed Section: Auth/Session

Auth/Session should show:

- token present yes/no
- current session validation status
- safe actor metadata
- CRUD auth enforcement state
- recent invalid auth categories if available
- revoked/expired token counts where available

It must never display raw tokens, token hashes, passwords, or session secrets.

## Proposed Section: Deployment/Environment

Deployment/Environment should show:

- environment name
- API base URL
- backend health
- PHP/API version metadata if safe
- database connectivity status
- CORS/auth header diagnostics
- production feature flags
- deployment checkpoint/tag where available

No environment flags should be changed from this section in the initial version.

## Proposed Section: Auto-Sync Eligibility

Auto-sync Eligibility should show the read-only evaluator result:

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

It must clearly state that auto-sync is disabled and the evaluator does not start background behavior.

## Proposed Section: POS Activity Safety

POS Activity Safety should show:

- active yes/no
- startedAt
- source

It must not show cart contents, customer details, item rows, payment details, or invoice bodies.

## Proposed Section: Logs/Diagnostics

Logs/Diagnostics should expose safe operational summaries only:

- recent safe backend auth audit categories
- replay error categories
- queue error categories
- backup validation summaries
- deployment health summaries

No full raw logs should be shown unless a future redaction layer guarantees safety.

## Client-Facing Simplified Status

Normal client/staff-facing status should be minimal:

- Online/Offline
- Sync healthy / Needs attention
- Last successful sync
- Last backup
- Support contact/action

Normal users should receive clear action guidance without seeing internal replay or hydration details.

## Allowed Actions

Allowed by default:

- read-only diagnostics
- refresh diagnostics
- copy safe summary for support

Allowed only with explicit confirmation and future role checks:

- manual replay
- failed queue reset
- done queue cleanup
- serverId repair
- failed replay archival
- create-local hydration apply
- future backup export
- future restore dry-run

Not allowed from the control panel:

- direct stock edits
- direct accounting/balance edits
- direct finalized sales/sale_items edits
- direct payment ledger edits
- direct batch/cylinder quantity edits
- direct replay payload edits
- direct token/password/session edits

## Dangerous Tool Confirmation Rules

Dangerous tools should require:

- dry-run preview
- summary of exact affected rows
- explicit apply confirmation
- role/permission check
- audit event
- post-action validation report

The UI should never hide the difference between planning and applying.

## Future Implementation Phases

Phase 1: Read-only developer panel shell

- protected route
- role guard
- safe section navigation
- no mutation

Phase 2: Embed existing read-only reports

- queue
- replay audit
- backup validation
- hydration/reconciliation
- auto-sync evaluator

Phase 3: Manual replay integration hardening

- move existing Settings developer replay area into protected panel
- keep duplicate-click guard and auth gate

Phase 4: Controlled dry-run/apply workflows

- only for already-designed tools
- explicit confirmation
- audit trail

Phase 5: Production admin UX

- simplified client status
- admin support workflows
- operator-safe logs
- background-sync readiness dashboard

## No-Go Conditions

Do not implement or expose the panel when:

- role/permission model is absent
- auth enforcement behavior is unknown
- sensitive redaction is not guaranteed
- normal staff can access developer internals
- mutating tools lack dry-run/apply separation
- backup/restore status is ambiguous
- auto-sync could be started accidentally

## Current Boundary

This is design-only. No UI, route, dashboard, backend endpoint, permission enforcement, runtime behavior, replay, hydration, auto-sync, polling, listener, background worker, or startup replay behavior is implemented by this document.
## Foundation UI Implementation Status

The initial read-only Developer Control Panel foundation now exists in `src/DeveloperControlPanel.tsx`.

Access approach:

- reachable from the existing dashboard navigation only for exact role `Dev`
- hidden from `admin`, `saleboy`, staff, cashier, manager, and other normal client-role navigation
- component also contains an access guard that shows a restricted message if rendered for an unauthorized role

Initial read-only sections implemented:

- System Health
- Sync Status
- Replay Status
- Auth Status
- Backup Status
- Auto-sync Eligibility
- POS Activity Status

Current behavior:

- manual refresh only
- no polling
- no listeners
- no background workers
- no startup replay
- no automatic replay
- no hydration apply
- no restore/import
- no direct DB editing
- no stock/accounting/payment/batch/cylinder mutation tools

Sensitive data boundaries:

- raw bearer tokens are not displayed
- passwords and password hashes are not displayed
- `payload_json` and `response_json` are not displayed
- cart contents, customer/payment details, item rows, and invoice bodies are not displayed

Some deeper operational views remain CLI-only in this first foundation, including backend failed replay counts, replay audit details, replay lock details, and live backup file discovery. The panel labels those areas as CLI-only rather than adding new backend endpoints or runtime behavior.
## Read-Only Foundation Checkpoint

The read-only foundation checkpoint is documented in [release-checkpoint-developer-control-panel-foundation.md](./release-checkpoint-developer-control-panel-foundation.md).

It records that `DeveloperControlPanel.tsx` exists, is available only to exact role `Dev` through the Dashboard, self-guards unauthorized roles, remains hidden from normal staff, and currently provides read-only operational visibility only. Dangerous actions, replay triggers, mutation tools, backend runtime endpoints, and background behavior remain deferred.
