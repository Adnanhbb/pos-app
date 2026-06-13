# Backup And Restore Audit

This audit covers client-handover backup readiness before real hosting. It does
not add a production restore/import command and does not permit restoring into
the live `POSDatabase`.

## Current Backup Coverage

The IndexedDB exporter enumerates the database's runtime `objectStoreNames`, so
the backup includes every store present in the opened database. The required
business-critical inventory is:

- `users`
- `settings`
- `customers`
- `suppliers`
- `items`
- `categories`
- `brands`
- `units`
- `discounts`
- `taxes`
- `sales`
- `sale_items`
- `customer_payments`
- `supplier_payments`
- `expenses`
- `expCategories`
- `item_batches`
- `held`
- `held_items`
- `cylinders`
- `cylinder_customers`
- `sync_queue`

Run the source and export-contract coverage gate:

```powershell
npm.cmd run test:backup:coverage
```

A missing required store is a handover no-go.

## Isolated Restore Rehearsal

Run:

```powershell
npm.cmd run test:backup:restore-rehearsal
```

The rehearsal:

1. Starts a temporary local browser origin.
2. Creates two randomly named temporary IndexedDB databases.
3. Inserts clearly marked rehearsal rows into all required stores.
4. Creates an in-memory backup envelope.
5. rejects an intentionally incomplete envelope.
6. Restores the valid envelope into the clean temporary target database.
7. Compares all store counts.
8. Verifies sale/item, held/item, item/batch, cylinder/item, cylinder/customer,
   customer/payment, and supplier/payment relationships.
9. Confirms failed `sync_queue` state remains failed.
10. Deletes both temporary databases.

The rehearsal never opens `POSDatabase`, contacts MySQL, calls replay, or starts
the application sync engine. It proves a structural round-trip only. It is not
a production restore tool.

## Restore Safety Findings

- Exported row IDs and relationship fields are retained in the backup JSON.
- Store counts are validated before a backup is considered structurally valid.
- Missing required stores cause validation failure.
- Failed or unsent queue records are not converted to synced/done state.
- Active browser tokens and sessions are not exported.
- Password-like fields are redacted. A replacement device therefore requires
  an approved fresh login or support-led credential recovery.
- Unknown future stores are exported by the runtime exporter, but a future
  production restore planner must classify them before apply.
- Direct overwrite of live IndexedDB is unavailable, preventing accidental
  silent replacement today.

## Client Handover Routine

Before deployment, browser replacement, Windows reinstall, or app upgrade:

1. Stop POS activity.
2. Export IndexedDB.
3. Export MySQL when backend data exists.
4. Validate both files and retain their SHA-256 checksums.
5. Run both backup verification tests.
6. Keep one protected local copy and one protected off-device copy.
7. Record the browser profile/origin used for the IndexedDB export.

Daily:

- export and validate IndexedDB after closing transactions
- export MySQL if manual replay/backend writes were used
- protect the backup as sensitive business data

## No-Go Conditions

Do not proceed with client handover when:

- any required IndexedDB store is missing
- backup validation reports count or sensitive-field errors
- the isolated restore rehearsal fails
- the backup source browser profile is unknown
- no off-device backup exists
- MySQL backup ownership is unclear
- anyone expects one-click live restore/import
- restored queue rows would be replayed automatically

## Remaining Handover Risk

Production restore/import remains intentionally unimplemented. In a real device
loss event, preserve the validated backup, stop replay, and involve support
before any recovery attempt. A future restore tool must stage data in a
quarantine database, require explicit confirmation, preserve IDs, quarantine
queue rows, and produce a post-restore reconciliation report.
