import { Brand } from "../db"; // domain model
import * as db from "../db";   // direct IndexedDB access

export interface BrandRepository {
  getAll(): Promise<Brand[]>;
  add(brand: Omit<Brand, "id">): Promise<number>;
  update(brand: Brand): Promise<void>;
  delete(id: number): Promise<void>;
}

export const indexedDbBrandRepository: BrandRepository = {
  getAll: () => db.getBrands(),
  add: (brand) => db.addBrand(brand),
  update: (brand) => db.updateBrand(brand),
  delete: (id) => db.deleteBrand(id),
};
