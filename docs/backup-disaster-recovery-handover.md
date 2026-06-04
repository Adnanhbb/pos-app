# Backup And Disaster Recovery Handover

This handover note defines the current safe backup and disaster recovery routine
for the single-client offline-first POS deployment.

Restore/import is not implemented. Current tooling is export and validation
only. Do not promise one-click restore until a future quarantined restore
planner and explicit apply workflow exists.

For the broader handover checklist, including login/POS workflow checks,
support steps, and go/no-go criteria, use
[client-handover-operational-checklist.md](./client-handover-operational-checklist.md).

## Current Tools

Create a local IndexedDB backup:

```powershell
npm.cmd run backup:indexeddb:export
```

Create a backend MySQL backup:

```powershell
npm.cmd run backup:mysql:export
```

Validate a generated backup:

```powershell
npm.cmd run backup:validate -- backups/<backup-file>.json
```

Audit backup/restore readiness:

```powershell
npm.cmd run backup:audit-readiness
```

These commands do not restore/import data, do not replay sync rows, do not
mutate MySQL, do not mutate IndexedDB, and do not enable auto-sync.

## What IndexedDB Backups Must Include

The expected IndexedDB store inventory is:

- users
- customers
- suppliers
- items
- categories
- brands
- units
- discounts
- taxes
- expenses
- expCategories
- settings
- customer_payments
- supplier_payments
- sales
- sale_items
- held
- held_items
- item_batches
- cylinders
- cylinder_customers
- sync_queue

The backup validator now checks this inventory. A backup missing any expected
store must not be treated as handover-ready.

## Where To Store Backups

- Keep at least one local copy on the client machine.
- Keep one off-device copy controlled by the owner or trusted operator.
- Do not store unencrypted backups in public folders, shared chat, or email.
- Treat backups as sensitive business records even when passwords and tokens
  are redacted or omitted.
- Record the backup filename, creation time, checksum, and device/browser used.

## Safe Restore Rehearsal Today

Because restore/import is not implemented, restore rehearsal is validation-only:

1. Export IndexedDB.
2. Export MySQL.
3. Validate both backup files.
4. Run `backup:audit-readiness`.
5. Confirm expected stores are present.
6. Confirm sensitive-field validation passes.
7. Confirm restore/import flags remain false.
8. Confirm no replay or auto-sync is triggered.

This validates backup integrity and coverage. It does not prove that restore
will succeed, because no restore apply tool exists yet.

## Future Restore Safety Requirements

A future restore tool must:

- run a dry-run validation before apply
- require explicit operator confirmation before overwrite
- preserve local IDs and relationships
- validate sales, sale_items, payments, batches, cylinders, and party balances
- quarantine restored sync_queue rows
- never mark unsynced or failed rows as synced
- never replay restored rows automatically
- never restore active auth tokens or sessions
- produce a restore summary/report
- remain Dev/admin gated according to the final operational policy

## What Not To Do

- Do not restore stale replay queues blindly.
- Do not restore expired auth tokens.
- Do not restore partial transactional state.
- Do not import only `sales` without `sale_items`, payments, stock, batches,
  cylinders, and balances.
- Do not merge backups from different devices without reconciliation.
- Do not run replay immediately after copying old local data.
- Do not mark failed or unsent sync rows as synced.
- Do not edit backup JSON by hand.
- Do not use backup files as a substitute for MySQL operational backups.

## Post-Restore Verification For Future Restore Tooling

When restore exists later, verify before allowing normal use:

- users can log in with current policy
- customers and suppliers open with expected balances
- item stock totals match batches/cylinders where applicable
- sales and sale_items relationships are intact
- customer_payments and supplier_payments match balances
- held and held_items relationships are intact
- sync_queue rows are quarantined or reviewed, not auto-replayed
- backup checksum and restore report are saved
- manual replay remains gated and explicit

## Recommended Client Handover Routine

Daily:

- export IndexedDB at close of business
- export MySQL at close of business if backend was used
- validate both backups
- store one off-device copy

Weekly:

- run `backup:audit-readiness`
- record backup checksums
- confirm backup files are not stored with public access
- review Sync Status before archiving or replaying anything

Before updates or schema changes:

- export IndexedDB
- export MySQL
- validate both backups
- confirm restore/import remains disabled unless a future restore tool has been
  explicitly approved and rehearsed
