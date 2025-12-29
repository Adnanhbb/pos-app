import { Category } from "../db"; // domain model
import * as db from "../db";      // IndexedDB access

export interface CategoryRepository {
  getAll(): Promise<Category[]>;
  add(category: Omit<Category, "id">): Promise<number>;
  update(category: Category): Promise<void>;
  delete(id: number): Promise<void>;
}

export const indexedDbCategoryRepository: CategoryRepository = {
  getAll: () => db.getAllCategories(),
  add: (category) => db.addCategory(category),
  update: (category) => db.updateCategory(category),
  delete: (id) => db.deleteCategory(id),
};
