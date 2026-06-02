# Repository Sync Coverage Audit

Last reviewed: 2026-06-02

This document records which frontend repositories currently attempt backend CRUD writes during normal repository operations and which still write only to local IndexedDB. It is an audit snapshot only; it does not change runtime behavior, enable auto-sync, or migrate additional repositories.

## Classification Terms

- **Backend-sync-aware**: the repository attempts `entityApi` writes when `canUseApi()` reports the API is usable, mirrors returned `serverId` metadata locally, and queues a `sync_queue` row when the API write is unavailable or fails.
- **Profile-fields-only sync-aware**: the repository syncs safe identity/profile fields but intentionally does not sync accounting, stock, payment, batch, cylinder, or transactional fields as isolated CRUD changes.
- **Partial safe-update sync-aware**: only a narrow update path is backend-aware; create/delete or unsafe fields remain local-only.
- **IndexedDB-only**: repository methods write only local IndexedDB and do not call `entityApi` or enqueue CRUD sync rows.
- **Transaction/replay-owned**: mutations must flow through transaction queue/replay or future atomic endpoints, not direct CRUD repository writes.

## Backend-Sync-Aware Repositories

These repositories currently write to backend MySQL during CRUD operations when the backend is reachable, and fall back to local write plus `sync_queue` when it is not.

| Repository | Store/table | Current behavior | Notes |
| --- | --- | --- | --- |
| `unitRepository.ts` | `units` | create/update/delete sync-aware | Low-risk master data. |
| `taxRepository.ts` | `taxes` | create/update/delete sync-aware | Low-risk master data. |
| `discountRepository.ts` | `discounts` | create/update/delete sync-aware | Low-risk master data. |
| `brandsRepository.ts` | `brands` | create/update/delete sync-aware | Low-risk master data. |
| `categoriesRepository.ts` | `categories` | create/update/delete sync-aware | Low-risk master data. |
| `expenseRepository.ts` | `expenses` | create/update/delete sync-aware | Expense rows are backend-aware; expense category helper remains local-only. |
| `staffRepository.ts` | `users` | create/update/delete sync-aware | User CRUD can sync, but auth/password handling remains security-sensitive and must not expose secrets in diagnostics/backups. |
| `settingsRepository.ts` | `settings` | update/reset sync-aware | Uses update semantics against a default/settings remote id; queues settings update if offline. |
| `heldRepository.ts` | `held` + `held_items` | held-cart create/delete sync-aware as one logical payload | Held items are not synced independently. |

## Profile-Fields-Only Sync-Aware Repositories

Customers and suppliers are not local-only in this branch. They are profile-fields-only sync-aware.

| Repository | Store/table | Sync-aware fields | Intentionally excluded fields |
| --- | --- | --- | --- |
| `customerRepository.ts` | `customers` | create, profile update, soft/permanent delete, restore through profile update | `invoices`, `payable`, `paid`, `balance` are stripped or guarded. Accounting changes stay local unless produced by backend transaction replay/future atomic endpoints. |
| `suppliersRepository.ts` | `suppliers` | create, profile update, soft/permanent delete, restore through profile update | `invoices`, `payable`, `paid`, `balance` are stripped or guarded. Supplier payment/accounting changes stay local unless produced by backend transaction replay/future atomic endpoints. |

Important detail: if a customer/supplier update changes accounting summary fields, the repository intentionally writes local IndexedDB only and returns without calling `entityApi`. This prevents unsafe isolated balance mutation outside the transaction replay chain.

## Partial Safe-Update Sync-Aware Repositories

| Repository | Store/table | Backend-aware path | Local-only path |
| --- | --- | --- | --- |
| `itemsRepository.ts` | `items` | update only when the existing row has `serverId` and only safe profile fields changed: name, barcode, description, purchase/retail/discount/wholesale prices | create, delete, restore, permanent delete, stock changes, unit/category/brand conversion cascades, and unsafe updates remain local-only. |

Item create/delete should not be broadly migrated yet. Item creation can involve opening stock, batches, cylinders, and count/cascade effects. Stock and inventory relationships require backend-authoritative atomic endpoints.

## Item Profile Sync Audit

The existing item repository boundary is intentionally narrow and should remain
in place until a dedicated mapping/bootstrap contract is approved.

### Safe Profile Fields

The following fields may be sent by a profile-only item update when the local
row already has a trusted backend `serverId`:

- `name`
- `barcode`
- `description`
- `purchasePrice`
- `retailPrice`
- `discountPrice`
- `wholesalePrice`

`itemsRepository.update()` already applies this allowlist through
`pickSafeItemProfilePayload()`. If any stock or cascade field changes, it
stores the update locally and does not send an isolated backend item update.

### Transaction-Owned And Cascade-Sensitive Fields

The following fields and relationships must not be synchronized as direct item
profile CRUD:

- transaction-owned stock: `availableStock`
- batch balances and opening-stock batch creation
- cylinder counts, cylinder-customer holdings, and cylinder row lifecycle
- lookup/cascade fields: `category`, `brand`, `minunit`, `maxunit`, `ConvQty`
- lookup usage counters for categories, brands, and units
- item deletion state: `isDeleted`, `deletedAt`
- the UI-only derived `openingStockMax` value

The normal Items screen creation flow writes more than one local concept: it
creates the item, may create an opening-stock batch, may create a cylinder row,
and increments lookup usage counters. Edit, delete, restore, and permanent
delete can also update related lookup, batch, cylinder, and cylinder-customer
rows. A direct item POST or DELETE cannot safely represent those cascades.

### Current Frontend And Backend Gap

`api/items.php` exists, but its POST allowlist still accepts stock and cascade
fields for a backend item row. It does not atomically create or reconcile the
related batch, cylinder, or lookup-counter effects produced by the local Items
screen. The frontend therefore deliberately keeps ordinary item creation
local-only.

Backend item updates are safer: `api/items.php` rejects stock and cascade
fields during PUT/PATCH and accepts only the safe profile allowlist. This
matches the existing mapped-row profile update path.

### ServerId Mapping Rules

- A future backend-aware item create or registration flow must persist the
  returned backend id into the local row as `serverId`; the local IndexedDB id
  remains a local correlation id only.
- Existing local items without `serverId` require controlled reconciliation or
  hydration review. They must not be blindly matched by local numeric id,
  item name, or barcode.
- Names and barcodes are indexed but not unique in the current MySQL schema.
  Duplicate names or barcodes must become manual-review conflicts unless a
  separate business uniqueness rule is approved.
- MySQL `items.client_id` is unique, but a future multi-device registration
  flow must define a device-safe namespace instead of assuming that a local
  numeric id is globally unique.
- The generic queue executor currently falls back from `serverId` to `localId`
  for update targeting. An unmapped item profile update must not rely on that
  fallback because a local id is not a safe MySQL item id.

### Recommendation

Do not migrate ordinary item create, delete, restore, or permanent delete yet.
Keep the existing strict profile-only update behavior for rows that already
have a trusted `serverId`.

The smallest safe future implementation is a separately approved item
profile-registration/bootstrap design with a strict profile allowlist,
explicit handling for opening-stock/cascade effects, controlled matching for
legacy local items, local `serverId` mirroring, and a queue rule that treats
unmapped updates as registration-required or manual-review instead of backend
updates. Reliable `serverItemId` mappings are necessary for finalized Sale
replay readiness, but they are not sufficient by themselves: mapped batches
and cylinders are still required when those mutations apply.

## IndexedDB-Only Repositories

These repositories currently write only to IndexedDB in their normal repository methods.

| Repository | Store/table | Reason / current boundary |
| --- | --- | --- |
| `customerPaymentRepository.ts` | `customer_payments` | Payment ledger mutations must be transaction/replay-owned, not isolated direct CRUD. |
| `supplierPaymentRepository.ts` | `supplier_payments` | Payment ledger mutations must be transaction/replay-owned, not isolated direct CRUD. |
| `batchRepository.ts` | `item_batches` | Batch quantity/remaining-balance changes must stay atomic with stock/sales/replay logic. |
| `cylinderRepository.ts` | `cylinders` | Cylinder counts and invariants must stay atomic with transaction replay/future authoritative endpoints. |
| `cylinderCustomerRepository.ts` | `cylinder_customers` | Customer-held cylinder quantities must stay atomic with cylinder transaction logic. |
| `salesRepository.ts` | `sales`, `sale_items`, item stock, customer/supplier balances, batches | Local POS transaction persistence and edit/delete flows are complex multi-store mutations. Backend authoritative mutation is handled by transaction replay, not direct CRUD sync. |
| `saleItemsRepository.ts` | `sale_items` | Sale items are children of transaction/sales persistence and should not sync independently. |
| `batchRepository.ts` delete-by-invoice/permanent-delete helpers | `item_batches` | Local cleanup helpers only. |
| Expense category helper in `expenseRepository.ts` | `expCategories` | Local-only helper; no backend endpoint/plumbing observed. |
| IndexedDB compatibility repositories (`indexedDbCustomerRepository.ts`, `indexedDbSupplierRepository.ts`, `indexedDbCustomerPaymentRepository.ts`, `indexedDbSupplierPaymentRepository.ts`) | local compatibility paths | Local-only compatibility helpers. |

## Transaction/Replay-Owned Domains

These should not be migrated as direct CRUD repository writes yet:

- `sales`
- `sale_items`
- `items.availableStock`
- customer/supplier accounting summaries
- `customer_payments`
- `supplier_payments`
- `item_batches`
- `cylinders`
- `cylinder_customers`

The backend replay chain is the authoritative path for transaction effects. Direct CRUD sync for these domains risks partial stock/accounting/payment/batch/cylinder divergence.

## Current Backend-Visible Behavior During Laragon Rehearsal

Expected backend writes from normal CRUD screens include:

- categories
- brands
- units
- discounts
- taxes
- expenses
- users/staff, when backend accepts the request
- settings updates, when backend accepts the request
- held carts, when backend accepts the request
- customer/supplier profile rows, when backend accepts the request

If only categories, brands, units, discounts, and taxes are observed in MySQL during a specific rehearsal, likely explanations include endpoint availability/validation, auth/config state, selected UI pages, or repository fallback after API rejection. The repository code itself shows broader backend-sync awareness than those five low-risk masters.

## Customers/Suppliers Answer

Customers and suppliers are currently **profile-fields-only sync-aware**, not fully transaction/accounting sync-aware and not local-only.

They may create/update/delete backend profile rows when online. They intentionally do not sync accounting fields as isolated CRUD changes.

## Items/Stock/Batches/Cylinders/Sales/Payments Answer

These are intentionally not broadly direct-CRUD migrated yet:

- items: partial safe profile update only; create/delete and unsafe fields local-only
- stock: transaction/replay-owned
- batches: transaction/replay-owned/local-only repository
- cylinders/customer-cylinder holdings: transaction/replay-owned/local-only repository
- sales/sale_items: transaction/replay-owned/local-only repository
- payments: transaction/replay-owned/local-only repository

## Candidate Next Low-Risk Migration Work

Do not migrate transactional domains next. Safer next candidates are:

1. Verify and harden existing backend-aware repositories that are less visibly tested in rehearsal: `expenses`, `settings`, `users`, `held`, `customers`, `suppliers`.
2. Add focused diagnostics/tests per repository to prove backend endpoint acceptance and local `serverId` mirroring.
3. Consider `expCategories` only if a backend endpoint and safe schema exist.
4. Consider item safe-profile create/update only after separating item profile from stock, batch, cylinder, category/brand/unit cascade effects.

## Current Safety Boundary

- No auto-sync is enabled.
- No background sync, polling, startup replay, or listeners are added by this audit.
- No data repair, replay, hydration, or backend mutation is performed by this document.
- POS transaction/accounting/stock behavior must remain governed by local POS flow and backend replay, not direct CRUD repository sync.

## Focused Verification Script

A focused verifier now exists:

```powershell
npm.cmd run sync:verify-existing
```

The verifier performs three safe checks:

- static source coverage inspection for the repositories listed in this document
- backend endpoint create/update/delete or create/delete checks with clearly named `Rehearsal Verify ...` test records
- packaged Laragon browser delete lifecycles for lookup UI paths plus customer, supplier, and expense UI lifecycles, with safety skip reporting for settings live mutation, item safe-profile update without a fixture, and transaction/replay-owned domains

The verifier now drives the copied Laragon frontend with Playwright. It records safe method, URL, response-status, and DELETE-mode metadata only. Lookup-table UI fixtures prove that DELETE targets `?id=<serverId>`, reports `deleteMode: hard`, and removes the row from normal backend reads. Customer, supplier, and expense UI lifecycles prove POST create, PUT update, `deleteMode: soft`, and hidden follow-up GET behavior.

Remote create rows are now localized before IndexedDB insert: the backend id is preserved as serverId, while IndexedDB receives its own local key. This avoids key collisions that could otherwise leave a UI row without serverId and cause later delete operations to fall back to local-only deletion/queueing. Backend delete still uses HTTP DELETE, with endpoint-specific semantics: units, brands, categories, discounts, and taxes hard-delete; customers, suppliers, and expenses soft-delete with is_deleted/deleted_at because their frontend models expose deleted-row restore workflows.

Generated local reports:

- `sync-coverage-verification-report.json`
- `sync-coverage-verification-report.md`

The verifier intentionally does not migrate any new repository, does not trigger replay, does not enable auto-sync, and does not touch sales, sale_items, payment ledgers, batch balances, cylinder counts, item stock, or POS transaction/accounting behavior.

## Fully Automated CRUD Lifecycle Verification

`npm.cmd run sync:verify-existing` now verifies the full safe lifecycle for existing backend-aware low-risk repositories:

- categories
- brands
- units
- taxes
- discounts
- expenses
- customers profile fields only
- suppliers profile fields only

For each repository fixture, the verifier creates a clearly named `Rehearsal Verify ...` backend row, confirms the returned `serverId`, reads the row back, and updates it through `PUT ?id=<serverId>`. Lookup-table fixtures then require a hard delete and verify that the backend row is gone. Customer, supplier, and expense fixtures require soft delete, hidden normal reads, explicit restore through `PATCH ?id=<serverId>&restore=1`, a second soft delete, and final hard removal through `DELETE ?id=<serverId>&permanent=1`.

The verifier also inspects UI source paths so customer and supplier pages cannot silently regress to IndexedDB-only compatibility repositories. Customer and supplier create/update test payloads exclude `invoices`, `payable`, `paid`, and `balance`, and backend checks confirm those accounting summaries remain unchanged. Backend-returned summary values are normalized to local numbers for display only. Customer edits preserve mirrored `serverId`, and expense IndexedDB normalization preserves mirrored `serverId`, so subsequent UI updates and soft deletes target MySQL correctly.

Live settings mutation, authentication actor mutation, item profile mutation, and transaction-owned domains remain skipped with explicit reasons. Held carts now have a dedicated isolated packaged-frontend lifecycle verification. No new repository is migrated and no auto-sync is enabled.
## Backend Delete Policy Alignment

Backend deletion now follows the existing frontend and IndexedDB model instead of applying soft delete uniformly:

| Repository/table | Backend DELETE behavior | Reason |
| --- | --- | --- |
| `units` | hard delete | Lookup UI and IndexedDB remove rows directly; no restore model exists. |
| `brands` | hard delete | Lookup UI and IndexedDB remove rows directly; no restore model exists. |
| `categories` | hard delete | Lookup UI and IndexedDB remove rows directly; no restore model exists. |
| `discounts` | hard delete | Lookup UI and IndexedDB remove rows directly; no restore model exists. |
| `taxes` | hard delete | Lookup UI and IndexedDB remove rows directly; no restore model exists. |
| `customers` | soft delete | UI and IndexedDB already support deleted rows, restore, and permanent delete. |
| `suppliers` | soft delete | UI and IndexedDB already support deleted rows, restore, and permanent delete. |
| `expenses` | soft delete | UI and IndexedDB already support deleted rows, restore, and permanent delete. |

The shared PHP CRUD handler exposes safe `deleteMode` response markers for verification. Lookup deletes require `deleteMode: hard`. Customer, supplier, and expense normal deletes require `deleteMode: soft`; deleted-record modal restore calls `PATCH ?id=<serverId>&restore=1`; deleted-record modal permanent delete calls `DELETE ?id=<serverId>&permanent=1` and removes the MySQL row. Offline fallbacks keep using the existing manual sync queue with explicit restore/permanent-delete action markers.

The lookup tables still retain harmless `is_deleted` / `deleted_at` schema columns for compatibility with shared CRUD list/get/update helpers. Those columns are not used by lookup DELETE behavior. Removing them safely would require a broader helper/schema migration, so no risky cleanup migration was added. No soft-delete UI or IndexedDB fields were added to lookup tables.
## Held Cart Save And Restore Verification

Held carts are backend-aware bundles, not finalized transactions. The frontend `heldRepository` persists a held header and its `held_items` together as one logical payload through `held.php`. When online, the returned MySQL id is mirrored into the local IndexedDB held header as `serverId`. Offline fallback remains local-first and queues the same bundled held-cart payload; `held_items` are never replayed independently.

The packaged Laragon verifier now uses local-only, clearly named `Rehearsal Held Cart ...` and `Rehearsal Held Item ...` fixtures. It adds the rehearsal item to the POS cart, clicks Hold Sale, confirms `held.php` receives a bundled POST with one item, opens Held Sales, resumes the record, confirms cart restoration, and confirms `held.php?id=<serverId>` receives DELETE. Backend held DELETE remains a soft delete so the resumed bundle disappears from normal lists without deleting finalized business history.

The verification explicitly checks that backend item stock remains unchanged and that no finalized-sale, accounting, payment, batch, or cylinder API writes occur. It never clicks Complete or Postpone. Two held-cart bugs were fixed: PHP `{ success, data }` create responses are now unwrapped before local mirroring, and POS awaits the bundled hold save before refreshing held rows and clearing the active cart. No auto-sync or background behavior was added.
## Developer Control Panel And Backup Verification Boundary

The packaged Laragon verifier now checks the read-only Developer Control Panel role boundary in isolated browser contexts. Only exact role `Dev` can see and open the panel; `admin`, `saleboy`, staff, cashier, and manager roles cannot see its navigation entry. The test injects local role state only to exercise packaged UI authorization guards. It does not use the disabled frontend backdoor, create a support account, create bearer tokens, or trigger replay.

The panel Backup Status section is informational only. It confirms that export and validation tooling exists and that restore/import is not implemented. It exposes no restore, import, delete, apply, replay, or export action buttons and does not render a sentinel bearer token, password hash, or sync payload field.

Backup export and validation remain explicit CLI operations:

```powershell
npm.cmd run backup:indexeddb:export
npm.cmd run backup:mysql:export
npm.cmd run backup:validate -- backups/<backup-file>.json
```

The IndexedDB exporter recursively redacts secret-like fields. The MySQL exporter omits password, token/hash, session-secret, payload JSON, and response JSON columns. The validator checks structure, collection counts, sensitive-field leakage, and SHA-256 identity. Restore/import and destructive backup actions remain absent.

## Finalized Sale Replay Design Boundary

The finalized `Sale` backend replay audit is documented in
[finalized-sale-backend-replay-design-audit.md](./finalized-sale-backend-replay-design-audit.md).

Current transaction queue processing still sends finalized POS payloads to
`transactions.php` for storage-only ingestion. The existing internal backend
replay processor is not exposed as a production HTTP bridge. A Sale-only
endpoint must wait for server-id payload mapping, exact resolved-batch
targeting, cylinder Sale parity, customer-payment schema parity, and safe
storage-to-replay orchestration.

This audit does not migrate sales, sale items, stock, batches, cylinders,
customer balances, or payments into direct CRUD sync. Those domains remain
transaction/replay-owned.
