import {
  Item,
  getAllItems,
  addItem,
  updateItem,
  deleteItem,
  searchItems,
  getItemsPaged,
} from "../db";

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
};
