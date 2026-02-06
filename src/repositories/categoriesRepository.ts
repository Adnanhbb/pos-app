// src/repositories/categoriesRepository.ts
import {
  Category,
  getAllCategories,
  addCategory,
  updateCategory,
  deleteCategory,
} from "../db";

export type { Category };

export const categoriesRepository = {
  getAll: async (): Promise<Category[]> => {
    return await getAllCategories();
  },

  getById: async (id: number): Promise<Category | undefined> => {
    const all = await getAllCategories();
    return all.find(c => c.id === id);
  },

  create: async (category: Omit<Category, "id">): Promise<number> => {
    return await addCategory(category);
  },

  update: async (category: Category): Promise<void> => {
    await updateCategory(category);
  },

  remove: async (id: number): Promise<void> => {
    await deleteCategory(id);
  },

  /* ---------- USAGE HELPERS ---------- */

  incrementItemCount: async (id: number): Promise<void> => {
    const cat = await categoriesRepository.getById(id);
    if (!cat) return;

    await updateCategory({
      ...cat,
      itemCount: (cat.itemCount ?? 0) + 1,
    });
  },

  decrementItemCount: async (id: number): Promise<void> => {
    const cat = await categoriesRepository.getById(id);
    if (!cat) return;

    await updateCategory({
      ...cat,
      itemCount: Math.max(0, (cat.itemCount ?? 0) - 1),
    });
  },
};
