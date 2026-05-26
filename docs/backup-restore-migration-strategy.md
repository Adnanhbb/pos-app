# Backup, Restore, And Migration Strategy

This document defines the production-grade backup, restore, export/import, and schema migration architecture before any tooling is implemented.

It is design-only. It does not implement backup/export/import, mutate IndexedDB, mutate backend MySQL, add migration execution code, trigger replay, or enable auto-sync.

## Why Backup/Restore Matters Before Auto-Sync Rollout

Offline-first systems can accumulate important local-only state before the backend has seen it. Once auto-sync exists, the blast radius grows: a bad local cache, stale queue, corrupted IndexedDB store, or accidental replay can affect backend state.

Backup and restore must exist before broad automation because operators need a safe way to:

- preserve local business data before schema upgrades
- inspect and recover local-only rows
- recover from device loss or browser storage corruption
- preserve evidence for replay/audit investigations
- avoid duplicate replay after restore
- verify local/backend convergence before enabling background behavior

The goal is not just copying data. The goal is preserving enough context to safely decide what may be restored, what must remain manual review, and what must stay backend-authoritative.

## IndexedDB Backup/Export Strategy

IndexedDB export should be explicit, manual, and operator-visible. It should capture the local database in a versioned envelope rather than dumping stores without context.

A safe export should include:

- export metadata: app version, IndexedDB version, export timestamp, device/browser label if available
- store list and schema version
- low-risk entity stores
- sync metadata stores such as `sync_queue`
- local server id mappings
- hydration/reconciliation metadata if available
- POS local transaction queues where applicable
- checksums per store or per export section

Exports should avoid lossy transformations. Dates, booleans, numeric fields, deleted flags, and `serverId` fields must round-trip predictably.

The first implementation should be read-only export only. Import/restore should come later with dry-run validation and explicit apply.

## Backend MySQL Backup Strategy

Backend backup remains separate from IndexedDB export. MySQL backup should use database-native tooling or hosting-control-panel backup primitives.

A backend backup should preserve:

- all business tables
- `sync_transactions`
- `transaction_idempotency`
- `transaction_replay_audit`
- auth token metadata, but not raw tokens
- schema migration state
- replay status/lock metadata
- created/updated timestamps

Backend backups should be taken before:

- schema migrations
- replay processor upgrades
- auth enforcement changes
- cleanup/archive operations
- any future auto-sync rollout

Restoring backend MySQL has higher risk than restoring local IndexedDB because backend is authoritative for transaction side effects. Backend restore must be treated as an administrative operation, not a user-facing convenience feature.

## Sync Metadata Preservation Requirements

Sync metadata is not optional noise. It controls idempotency and replay safety.

Local exports should preserve:

- `serverId` mappings
- local ids
- `sync_queue` row ids and statuses when included
- queue entity/operation/status metadata
- queue timestamps and retry metadata
- last safe errors, without payload leakage in reports

Backend backups should preserve:

- `sync_transactions.client_transaction_id`
- replay status and attempts
- lock metadata
- idempotency request hashes
- transaction audit rows
- archived/manual-review replay states

Any restore/import tool must validate these relationships before apply.

## Queue Preservation Vs Exclusion Policy

Queues are dangerous because restoring a queue can cause old operations to replay.

Default policy:

- export queues for forensic completeness
- do not automatically restore queues into an active replayable state
- restore queue rows as disabled/quarantined candidates until reviewed
- require explicit operator action before any restored queue row becomes pending again

Queue restore categories should include:

- safe to ignore because backend already has the row
- needs local mirror patch only
- needs manual replay after auth/backend checks
- stale and should remain archived/quarantined
- unsafe because it references missing local rows or risky transaction state

## Replay/Audit/History Preservation

Replay and audit history must be preserved because it explains what happened and prevents duplicate mutation.

Preserve:

- `sync_transactions`
- `transaction_idempotency`
- `transaction_replay_audit`
- replay status transitions
- archival states such as `archived_dev_test`
- manual-review classifications where stored later

Do not strip audit rows during backup or restore. Audit history is part of the safety model.

## Full-Device Restore Expectations

Full-device restore means restoring a local IndexedDB backup onto the same or replacement device.

Expected flow:

1. Import backup into a quarantine/staging database or dry-run validator.
2. Validate schema version compatibility.
3. Validate local ids and `serverId` mappings.
4. Compare backend rows when reachable.
5. Classify queue rows before activation.
6. Require manual approval for risky rows.
7. Apply only safe local data after dry-run.
8. Run reconciliation reports after restore.

A full-device restore should never silently trigger replay.

## Partial Entity Restore Risks

Partial restore is risky because entity relationships cross store boundaries.

Examples:

- restoring customers without payments can corrupt perceived balances
- restoring items without batches/cylinders can corrupt inventory views
- restoring sales without sale_items can corrupt invoice history
- restoring sync queues without local rows creates orphan queue rows
- restoring users without auth policy review may reintroduce stale/security-sensitive records

Partial restore should be manual-review by default and must be entity-aware.

## Multi-Device Restore Risks

Multi-device restore introduces additional dangers:

- duplicate local ids across devices
- stale `serverId` mappings
- stale sync queues replayed from an old device
- auth tokens copied to a different device
- offline writes from one device overwriting another device's newer data
- transaction replay duplication if `clientTransactionId` is reused incorrectly

A restored backup from one device must not be treated as a normal active device state until hydration/reconciliation confirms it is safe.

## Export Formats

Recommended format strategy:

- JSON envelope for portable logical export
- one top-level metadata section
- per-store arrays or chunks
- per-store checksums
- optional compressed archive wrapper
- future encrypted archive wrapper

Example high-level shape:

```json
{
  "format": "jawad-bro-offline-export",
  "formatVersion": 1,
  "appVersion": "...",
  "indexedDbVersion": "...",
  "exportedAt": "...",
  "stores": {
    "brands": [],
    "sync_queue": []
  },
  "checksums": {}
}
```

Large stores should support chunked export to avoid browser memory pressure.

## Encryption/Security Considerations

Backups may contain sensitive business data. Production exports should support encryption before leaving the device.

Security requirements:

- never export raw bearer tokens as reusable credentials
- never print passwords or password hashes in reports
- protect customer/supplier/contact data
- protect transaction history
- support operator-provided passphrase or platform-secure key where feasible
- include integrity checks to detect tampering/corruption

Unencrypted exports should be clearly marked as sensitive.

## Auth Token/Session Restore Policy

Auth/session data should not be restored as active credentials.

Policy:

- raw bearer tokens must never be exported
- expired/revoked tokens must never be restored
- active tokens should not be restored onto another device
- restored app state should require login/session validation before replay
- backend session metadata may be preserved for audit only, not authentication

A restore should clear frontend token state unless the future security model explicitly supports device-bound token recovery.

## Version Compatibility Strategy

Every export must declare:

- app version
- IndexedDB schema version
- export format version
- entity schema/version metadata where available
- backend schema version snapshot if known

Restore tooling should classify compatibility:

- compatible
- compatible with migration
- manual review required
- unsupported

Unsupported backups should never be partially applied by default.

## IndexedDB Schema Migration Philosophy

IndexedDB migrations must be deterministic and reversible by backup, not necessarily by downgrade code.

Principles:

- export before destructive local schema changes
- prefer additive migrations
- preserve local ids and `serverId`
- do not drop queue metadata without archival/export
- do not migrate transactional stores without validation
- run post-migration reconciliation diagnostics

Migration failures should leave the previous database intact where possible or require restore from backup.

## Backend Schema Migration/Versioning Philosophy

Backend schema migrations must be tracked and auditable.

Principles:

- use `schema_migrations` consistently
- keep migrations additive where possible
- backup before migrations
- avoid destructive column/table drops during active sync rollout
- preserve replay/idempotency/audit tables
- make migration scripts idempotent where practical
- run replay/storage/auth regression tests after migration

Backend migrations that affect transaction replay must include rollback and recovery guidance.

## Rollback Strategy

Rollback means returning the system to a known safe checkpoint.

Rollback tools should distinguish:

- app code rollback
- IndexedDB local restore
- backend MySQL restore
- replay status repair
- queue quarantine/restore

A backend rollback after some clients have continued offline work is especially dangerous. Operators must reconcile post-backup writes before putting clients back online.

## Restore Verification Checks

After any restore/import, run verification before replay or auto-sync:

- local store counts
- backend count comparison
- missing `serverId` report
- duplicate `serverId` report
- orphan queue rows report
- failed replay rows report
- stale replay lock report
- hydration divergence report
- auth/session validation
- POS activity idle check
- manual replay dry-run or controlled low-risk replay where appropriate

No restored queue should replay until these checks pass.

## Operator/Admin Tooling Expectations

Future tooling should include:

- read-only export summary
- dry-run import validation
- restore plan with action categories
- quarantine mode for restored queues
- explicit `--apply` for import/restore
- safe metadata-only reporting
- backup integrity validation
- encryption status display
- post-restore reconciliation checklist
- rollback instructions

Production tooling should be boring, explicit, and hard to misuse.

## What Should Never Be Restored Automatically

Never automatically restore:

- raw bearer tokens
- active sessions
- stale pending replay queues
- failed replay rows as active pending rows
- transaction payloads into a replayable state without idempotency checks
- partial stock/accounting/batch/cylinder state
- client-authoritative balances
- client-authoritative stock quantities
- archived/manual-review replay rows as active replay candidates
- corrupted or schema-incompatible backups

## What Requires Manual Review

Manual review is required for:

- local-only rows without backend match
- backend-only rows that are not clearly safe hydration candidates
- rows with missing or conflicting timestamps
- duplicate `serverId` mappings
- queue rows referencing missing local rows
- failed replay rows
- transaction restore candidates
- user/auth/security-sensitive rows
- partial entity restores
- multi-device restore attempts

## What Must Remain Server-Authoritative

Server-authoritative domains:

- finalized transaction replay status
- stock mutation results
- accounting summaries
- payment ledger persistence
- batch balances
- cylinder counts/customer holdings
- transaction idempotency
- replay audit history
- backend auth/session validation

Local restore must not overwrite these as client-authoritative truth.

## No-Go Conditions

Do not implement or run restore/apply when any no-go condition exists:

- restoring stale replay queues blindly
- restoring expired auth tokens
- restoring active sessions from backup
- replay duplication risk is unresolved
- partial transactional state would be restored
- backend schema compatibility is unknown
- local backup integrity cannot be verified
- conflict/reconciliation reports are unavailable
- operator cannot review the restore plan
- no rollback path exists

## Recommended Phased Implementation Roadmap

Phase 1: Read-only export diagnostics

- list stores
- count rows
- estimate export size
- show schema/export compatibility metadata

Phase 2: IndexedDB export only

- produce versioned JSON export
- include checksums
- no import yet

Phase 3: Import dry-run validator

- validate export format
- classify restore actions
- identify queue/replay risks
- no local mutation

Phase 4: Controlled local restore apply

- explicit `--apply`
- create quarantined restore state first
- no queue activation
- post-restore reconciliation required

Phase 5: Backend backup integration guidance

- document MySQL backup/restore operational flow
- connect schema migrations to backup checkpoints

Phase 6: Migration-aware restore

- support compatible local schema migrations
- reject unsupported backups safely

Phase 7: Operator UI and production hardening

- safe admin UI
- encryption support
- audit-friendly restore logs
- staging validation before production use

Phase 8: Auto-sync eligibility integration

- auto-sync gate checks backup/restore/migration health
- restored devices remain blocked until reconciliation passes

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

## IndexedDB Export Tool Status

An export-only local IndexedDB backup tool now exists:

```powershell
npm.cmd run backup:indexeddb:export
```

Current behavior:

- opens the app with the shared dev/admin Playwright profile
- reads local IndexedDB stores in read-only transactions
- writes a JSON backup under `backups/`
- includes backup metadata, DB name/version, store counts, store classifications, index names, redaction summary, and restore warnings
- includes low-risk CRUD stores, customers/suppliers, settings, held stores, sync metadata, and POS/sales-related stores when present
- recursively redacts password/auth/session/token/secret-like fields
- does not export raw frontend bearer tokens from localStorage

Important boundaries:

- restore/import is not implemented
- backup files still contain sensitive business data and must be protected
- POS/sales/payment/batch/cylinder stores are included for backup completeness only and must not be restored or replayed blindly
- sync queues are metadata only and must be quarantined by any future restore flow
- no IndexedDB mutation, backend mutation, replay, auto-sync, startup replay, polling, or listener behavior is added
## Backend MySQL Export Tool Status

An export-only backend MySQL backup tool now exists:

```powershell
npm.cmd run backup:mysql:export
```

Current behavior:

- connects through the existing backend `api/config/database.php` `get_pdo()` helper
- reads selected backend MySQL tables with `SELECT` queries only
- writes a JSON backup under `backups/`
- includes backup metadata, database name, table counts, exported row counts, exported fields, omitted tables, omitted fields, redaction summary, and restore warnings
- includes low-risk CRUD tables, customers/suppliers, settings/users, sync/replay metadata, replay audit metadata, sales/sale_items, payments, batches, and cylinder tables when present
- exports `api_auth_tokens` metadata only when present
- omits password/auth/session/token/hash columns and sync payload/response JSON columns

Sensitive fields are omitted rather than exported:

- `password`, `Password`, and `password_hash`
- token hashes and bearer/session token fields
- secret/API-key/credential-like fields
- `payload_json`, `response_json`, and request hash fields

Important boundaries:

- restore/import is not implemented
- backup files still contain sensitive business data and must be protected
- transactional tables are included for backup completeness only and must not be restored, replayed, or merged blindly
- sync/replay metadata is exported without payload bodies and must be quarantined by any future restore flow
- no backend mutation, IndexedDB mutation, replay, auto-sync, startup replay, polling, listener, or background sync behavior is added
## Backup Validation Tool Status

A validation-only backup inspection tool now exists:

```powershell
npm.cmd run backup:validate -- backups/<backup-file>.json
```

Current behavior:

- accepts one generated backup JSON file path
- validates that the JSON parses
- validates backup metadata is present
- detects whether the backup is an IndexedDB or MySQL export envelope
- validates store/table exported row counts against exported arrays
- scans exported data rows for unsafe sensitive fields
- allows explicitly redacted local fields such as `[redacted]` values while still failing unredacted secrets
- computes a SHA-256 checksum for file identity/integrity tracking
- prints only a safe validation summary, counts, checksum, and issue metadata

Sensitive validation covers exported data fields such as:

- `password`, `Password`, and `password_hash`
- token hash and bearer/session token fields
- `payload_json` and `response_json`
- secret/API-key/credential-like fields

Important boundaries:

- validation does not prove restore success
- restore/import is still not implemented
- the validator does not mutate backup files, IndexedDB, or backend MySQL
- the validator does not trigger replay, hydration, auto-sync, startup replay, polling, listeners, or background sync
- backup files still contain business data and must be protected even when validation passes
