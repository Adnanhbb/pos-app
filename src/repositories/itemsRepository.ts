// src/repositories/itemsRepository.ts

import {
  Item,
  getAllItems,
  addItem,
  updateItem,
  deleteItem,
  searchItems,
  getItemsPaged,
} from "../db";

import { db } from "../db";

export type { Item };

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
    const { data, total } =
      await getItemsPaged(page, pageSize, query ?? null);

    const filtered = data.filter(i => !i.isDeleted);

    return {
      data: filtered,
      total: filtered.length,
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
    return await addItem({
      ...item,
      isDeleted: item.isDeleted ?? false,
      deletedAt: item.deletedAt ?? null,
    });
  },

  update: async (item: Item): Promise<void> => {
    await updateItem(item);
  },

  /* ---------------- SOFT DELETE ---------------- */

  /** Soft delete item */
  remove: async (id: number): Promise<void> => {
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
    await deleteItem(id);
  },
};