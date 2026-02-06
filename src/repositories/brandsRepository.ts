// src/repositories/brandsRepository.ts
import {
  Brand,
  getBrands,
  addBrand,
  updateBrand,
  deleteBrand,
} from "../db";

export type { Brand };

export const brandsRepository = {
  getAll: async (): Promise<Brand[]> => {
    return await getBrands();
  },

  getById: async (id: number): Promise<Brand | undefined> => {
    const all = await getBrands();
    return all.find(b => b.id === id);
  },

  create: async (brand: Omit<Brand, "id">): Promise<number> => {
    return await addBrand(brand);
  },

  update: async (brand: Brand): Promise<void> => {
    await updateBrand(brand);
  },

  remove: async (id: number): Promise<void> => {
    await deleteBrand(id);
  },

  /* ---------- USAGE HELPERS ---------- */

  incrementItemCount: async (id: number): Promise<void> => {
    const brand = await brandsRepository.getById(id);
    if (!brand) return;

    await updateBrand({
      ...brand,
      itemCount: (brand.itemCount ?? 0) + 1,
    });
  },

  decrementItemCount: async (id: number): Promise<void> => {
    const brand = await brandsRepository.getById(id);
    if (!brand) return;

    await updateBrand({
      ...brand,
      itemCount: Math.max(0, (brand.itemCount ?? 0) - 1),
    });
  },
};
