// src/repositories/itemsRepository.ts

import {
  getAllItems,
  addItemWithOpeningStock,
  updateItem,
  planItemOpeningStockUpdate,
  updateItemWithOpeningStock,
  deleteItem,
  searchItems,
  getItemsPaged,
} from "../db";
import type { Item, ItemBatch } from "../types/entities";
import type { SyncMetadata } from "../types/sync";
import { entityApi } from "../api/entityApi";
import { inventoryMappingApi } from "../api/inventoryMappingApi";
import {
  canUseApi,
  getServerId,
  hasUnsafeItemFieldChange,
  pickSafeItemProfilePayload,
  queueEntityOperation,
} from "./helpers/syncRepositoryHelpers";

import { db } from "../db";

export type { Item };

type SyncableItem = Item & SyncMetadata;

export const itemsRepository = {

  /* ---------------- GET ---------------- */

  /** Get non-deleted items */
  getAll: async (): Promise<Item[]> => {
    const all = await getAllItems();
    return all.filter(i => !i.isDeleted);
  },

getPaged: async (
  page: number,
  pageSize: number,
  query?: string
) => {
  // 🔥 get ALL items first
  const all = await getAllItems();

  // 🔍 filter: non-deleted + search
  const filtered = all.filter(i =>
    !i.isDeleted &&
    (!query ||
      i.name.toLowerCase().includes(query.toLowerCase()) ||
      i.barcode?.toLowerCase().includes(query.toLowerCase()))
  );

  // ✅ correct total (used for page count)
  const total = filtered.length;

  // 📄 pagination slicing
  const start = (page - 1) * pageSize;
  const paged = filtered.slice(start, start + pageSize);

  return {
    data: paged,
    total,
  };
},

  search: async (q: string): Promise<Item[]> => {
    const all = await searchItems(q);
    return all.filter(i => !i.isDeleted);
  },

  async getById(id: number): Promise<Item | undefined> {
    const conn = await db.open();
    const tx = conn.transaction("items", "readonly");
    const store = tx.objectStore("items");

    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result as Item | undefined);
      req.onerror = () => reject(req.error);
    });
  },

  /* ---------------- CREATE / UPDATE ---------------- */

  create: async (item: Omit<Item, "id">): Promise<number> => {
    // Item create is intentionally local-only for now. The current UI can also
    // create opening stock batches, cylinders, and category/brand/unit counts.
    // Those must later sync through a dedicated atomic transaction endpoint.
    return await addItemWithOpeningStock({
      ...item,
      isDeleted: item.isDeleted ?? false,
      deletedAt: item.deletedAt ?? null,
    });
  },

  getOpeningStockBaseline: async (id: number): Promise<number | null> => {
    const batches = await db.open().then((conn) =>
      new Promise<ItemBatch[]>((resolve, reject) => {
        const tx = conn.transaction("item_batches", "readonly");
        const request = tx.objectStore("item_batches").index("by-item").getAll(id);
        request.onsuccess = () => resolve(request.result as ItemBatch[]);
        request.onerror = () => reject(request.error);
      })
    );
    const openingBatches = batches.filter(
      (batch) =>
        !batch.isDeleted &&
        batch.sourceSaleId === 0 &&
        batch.invoiceNo === "Opening Stock"
    );
    return openingBatches.length === 1
      ? openingBatches[0].qtyPurchased
      : null;
  },

  validateUpdate: async (item: Item): Promise<void> => {
    await planItemOpeningStockUpdate(item);
  },

  update: async (item: Item): Promise<void> => {
    const existing = item.id ? await itemsRepository.getById(item.id) : undefined;
    const openingStockPlan = await planItemOpeningStockUpdate(item);
    const itemToStore = openingStockPlan.item;

    if (hasUnsafeItemFieldChange(existing, itemToStore)) {
      // POS stock movement, batch changes, cylinder changes, and item relation
      // cascades must later sync through atomic transaction endpoints, not as
      // isolated item profile updates.
      const previousBatch = openingStockPlan.previousOpeningBatch;
      if (
        openingStockPlan.stockChanged &&
        previousBatch &&
        openingStockPlan.previousItem.serverId != null &&
        previousBatch.serverId != null
      ) {
        const response = await inventoryMappingApi.adjustMappedOpeningStock({
          adjustmentVersion: 1,
          localItemId: openingStockPlan.previousItem.id!,
          serverItemId: Number(openingStockPlan.previousItem.serverId),
          localBatchId: previousBatch.id!,
          serverBatchId: Number(previousBatch.serverId),
          expected: {
            itemAvailableStock: openingStockPlan.previousItem.availableStock,
            qtyPurchased: previousBatch.qtyPurchased,
            qtySold: previousBatch.qtySold,
            balance: previousBatch.balance,
          },
          requestedOpeningStock: openingStockPlan.openingBatch!.qtyPurchased,
        });
        if (
          response.serverItemId !== Number(openingStockPlan.previousItem.serverId) ||
          response.serverBatchId !== Number(previousBatch.serverId) ||
          Math.abs(response.availableStock - itemToStore.availableStock) > 0.000001 ||
          Math.abs(
            response.qtyPurchased -
              openingStockPlan.openingBatch!.qtyPurchased
          ) > 0.000001 ||
          Math.abs(response.qtySold - previousBatch.qtySold) > 0.000001 ||
          Math.abs(response.balance - openingStockPlan.openingBatch!.balance) >
            0.000001
        ) {
          throw new Error(
            "Backend returned an inconsistent Opening Stock adjustment."
          );
        }
      }
      await updateItemWithOpeningStock(item);
      return;
    }

    const syncableItem = itemToStore as SyncableItem;
    const serverId = getServerId(syncableItem);
    const safePayload = pickSafeItemProfilePayload(syncableItem);

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.update("items", serverId, safePayload);
        await updateItem(itemToStore);
        return;
      } catch {
        // Fall through to local update + queue when the API write fails.
      }
    }

    await updateItem(itemToStore);
    await queueEntityOperation("items", "update", safePayload);
  },

  /* ---------------- SOFT DELETE ---------------- */

  /** Soft delete item */
  remove: async (id: number): Promise<void> => {
    // Item delete is intentionally local-only for now because callers also
    // update batches, cylinders, cylinder customers, and usage counts.
    const item = await itemsRepository.getById(id);
    if (!item) throw new Error("Item not found");

    await updateItem({
      ...item,
      isDeleted: true,
      deletedAt: Date.now(),
    });
  },

  /** Get deleted items (for modal) */
  getDeleted: async (): Promise<Item[]> => {
    const all = await getAllItems();
    return all.filter(i => i.isDeleted);
  },

  /** Restore item */
  restore: async (id: number): Promise<void> => {
    // Item restore is intentionally local-only for now because callers also
    // restore batches, cylinders, cylinder customers, and usage counts.
    const item = await itemsRepository.getById(id);
    if (!item) throw new Error("Item not found");

    await updateItem({
      ...item,
      isDeleted: false,
      deletedAt: null,
    });
  },

  /** Permanent delete */
  permanentDelete: async (id: number): Promise<void> => {
    // Permanent item delete is intentionally local-only until item deletion and
    // related batch/cylinder/count cleanup can sync atomically.
    await deleteItem(id);
  },
};
