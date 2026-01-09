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
  getAll: async (): Promise<Item[]> => {
    return await getAllItems();
  },

  getPaged: async (
    page: number,
    pageSize: number,
    query?: string
  ) => {
    return await getItemsPaged(page, pageSize, query ?? null);
  },

  search: async (q: string): Promise<Item[]> => {
    return await searchItems(q);
  },

  create: async (item: Omit<Item, "id">): Promise<number> => {
    return await addItem(item);
  },

  update: async (item: Item): Promise<void> => {
    await updateItem(item);
  },

  remove: async (id: number): Promise<void> => {
    await deleteItem(id);
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

};
