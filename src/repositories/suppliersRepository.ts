import { Supplier } from "../db"; // domain model
import * as db from "../db";       // direct IndexedDB access

export interface SupplierRepository {
  getAll(): Promise<Supplier[]>;
  getPaged(page: number, pageSize: number, query?: string | null): Promise<{ total: number; data: Supplier[] }>;
  add(supplier: Omit<Supplier, "id">): Promise<number>;
  update(supplier: Supplier): Promise<void>;
  delete(id: number): Promise<void>;
}

export const indexedDbSupplierRepository: SupplierRepository = {
  getAll: () => db.getAllSuppliers(),
  getPaged: (page, pageSize, query) => db.getSuppliersPaged(page, pageSize, query ?? null),
  add: (supplier) => db.addSupplier(supplier),
  update: (supplier) => db.updateSupplier(supplier),
  delete: (id) => db.deleteSupplier(id),
};
