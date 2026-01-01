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

  create: async (brand: Omit<Brand, "id">): Promise<number> => {
    return await addBrand(brand);
  },

  update: async (brand: Brand): Promise<void> => {
    await updateBrand(brand);
  },

  remove: async (id: number): Promise<void> => {
    await deleteBrand(id);
  },
};
