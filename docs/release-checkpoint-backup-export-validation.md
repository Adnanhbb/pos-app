# Release Checkpoint: Backup Export And Validation

Suggested git tag: `backup-export-validation-before-restore`

This checkpoint records the current backup tooling baseline before any restore/import tooling exists.

## Milestone Summary

Export-only backup tooling now exists for both local IndexedDB data and backend MySQL data. A validation/checksum tool also exists to inspect generated backup JSON files for structure, metadata, count integrity, and sensitive-field leakage.

This milestone is intentionally limited to export and validation. It does not restore, import, repair, replay, hydrate, merge, or start any background behavior.

## Implemented Commands

```powershell
npm.cmd run backup:indexeddb:export
npm.cmd run backup:mysql:export
npm.cmd run backup:validate -- backups/<backup-file>.json
```

## Latest Validated Backups

IndexedDB backup:

- path: `backups/indexeddb-backup-2026-05-25T15-40-10-403Z.json`
- validation `ok: true`
- SHA-256: `44e577dcd795a49b03a27ea3730d43b947489189070de3b8ed5ac5642b5ba510`
- count mismatches: `0`
- unsafe sensitive fields: `0`
- redacted sensitive fields: `1`

MySQL backup:

- path: `backups/mysql-backup-2026-05-25T15-46-55-642Z.json`
- validation `ok: true`
- SHA-256: `a446acfec5044a16d872f2ce560de9c5477f043d8f6c8a5abe52ac721ec3a4c2`
- count mismatches: `0`
- unsafe sensitive fields: `0`
- redacted sensitive fields: `0`

## Sensitive Field Handling

IndexedDB export recursively redacts password/auth/session/token/secret-like fields in exported rows. The latest IndexedDB backup contains one redacted `Password` field and no unsafe unredacted sensitive fields.

MySQL export omits sensitive columns instead of exporting them. Omitted fields include:

- `users.password_hash`
- `sync_transactions.payload_json`
- `transaction_idempotency.request_hash`
- `transaction_idempotency.response_json`
- `api_auth_tokens.token_hash`

The validator scans exported `stores` and `tables` data for unsafe sensitive field names such as `password`, `Password`, `password_hash`, `token_hash`, bearer/session token fields, `payload_json`, `response_json`, and secret-like fields.

## Validation Scope

`backup:validate` checks:

- JSON parseability
- metadata presence
- backup type detection
- IndexedDB store counts or MySQL exported row counts against exported arrays
- unsafe sensitive-field leakage in exported data
- SHA-256 checksum for file identity and integrity tracking

Validation does not prove that a backup can be restored successfully. Restore/import tooling does not exist yet.

## Safety Boundaries

Current tooling is export/validation only:

- no restore/import
- no IndexedDB mutation
- no backend MySQL mutation
- no replay trigger
- no hydration apply
- no repair/merge behavior
- no auto-sync
- no polling/listeners/background workers/startup replay

Backup files still contain business data and must be protected even when validation passes.

## Next Phase

Before restore/import is allowed, create dry-run restore validation that reads a backup file into a quarantine plan and classifies every potential action. No restored queue, replay row, auth/session state, or transactional state should become active without explicit review and a later `--apply` tool.