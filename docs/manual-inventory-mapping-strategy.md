# Manual Inventory Mapping Strategy

## Purpose

This foundation maps verified local item profiles and their Opening Stock
batches to exact backend rows before finalized Sale replay. It does not weaken
Sale replay readiness checks and does not run automatically.

## Mapping Policy

- Customers continue to use the existing customer profile create/mirror path.
  A local customer receives `serverId` only from an exact backend create result
  or an explicitly reviewed `client_id` match.
- Item profile plus Opening Stock uses
  `POST /api/replay/item-opening-stock.php`.
- The endpoint requires replay authentication and one explicit versioned
  request. It creates the backend item and Opening Stock batch in one MySQL
  transaction.
- The backend item is correlated by `items.client_id = localItemId`.
- The backend batch is correlated by a deterministic
  `item_batches.client_transaction_id` containing both local item and batch IDs.
- The response returns the exact `serverItemId` and `serverBatchId`. Names,
  barcodes, or array positions are never used as IDs.

## Opening Stock Baseline

The backend baseline is the current local balance plus consumption from the
failed/pending Sales selected for recovery. Consumption from explicitly archived
test Sales is excluded. The backend batch starts with `qtySold = 0`, and only
the selected manual replays consume it.

The mapper rejects records unless:

- `sourceSaleId` is `0`
- `invoiceNo` is `Opening Stock`
- `qtyPurchased = qtySold + balance`
- `backendOpeningQuantity = qtyPurchased - archivedConsumptionExcluded`
- IDs and quantities are valid
- an existing `client_id` or mapping key does not conflict

## Purchase-Created Batches

Finalized Purchase replay now returns exact `localBatchId -> serverBatchId`
mappings. The manual sync path writes each returned ID to the corresponding
local `item_batches` row. A conflicting existing mapping fails safely.

## Existing Failed Sales

Mappings do not silently rewrite failed Sale payloads. After customer, item, and
batch mappings are verified, support must explicitly call the Sale readiness
refresh service. It rebuilds the contract through the existing strict v1
builder. The row remains failed while any mapping is missing and is changed to
pending only by the explicit prepare-for-manual-replay operation after readiness
is `ready`.

## SAL-0004

`SAL-0004` remains untouched. Its prerequisites are:

- customer local ID `1`
- item local ID `2`
- Opening Stock batch local ID `1`

Support should first map the customer through the existing customer profile
path, then apply the item/opening-stock mapper using the verified local fixture.
Only after exact IDs are written locally should the failed Sale contract be
explicitly refreshed and manually replayed.

## Safety Boundaries

- No background or startup mapping
- No automatic replay
- No natural-key guessing
- No fake server IDs
- No raw payload or secret logging
- No change to local POS save or stock arithmetic
