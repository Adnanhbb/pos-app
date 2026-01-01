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

  create: async (category: Omit<Category, "id">): Promise<number> => {
    return await addCategory(category);
  },

  update: async (category: Category): Promise<void> => {
    await updateCategory(category);
  },

  remove: async (id: number): Promise<void> => {
    await deleteCategory(id);
  },
};
