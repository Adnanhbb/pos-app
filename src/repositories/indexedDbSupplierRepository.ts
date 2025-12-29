import { initDB, Supplier, SupplierPayment, addSupplier, getSuppliersPaged, updateSupplier, deleteSupplier, searchSuppliers, addSupplierPayment, getAllSupplierPayments, deleteSupplierPayment } from "../db";
import { SupplierRepository} from "./suppliersRepository";

export const indexedDbSupplierRepository: SupplierRepository = {
  getAll: async () => {
    const db = await initDB();
    return db.getAll("suppliers");
  },

  getPaged: async (page: number, pageSize: number, query?: string | null) => {
    return getSuppliersPaged(page, pageSize, query ?? null);
  },

  add: async (supplier: Omit<Supplier, "id">) => {
    return addSupplier(supplier);
  },

  update: async (supplier: Supplier) => {
    return updateSupplier(supplier);
  },

  delete: async (id: number) => {
    return deleteSupplier(id);
  },

  search: async (query: string) => {
    return searchSuppliers(query);
  },

  addPayment: async (supplierId, amount, paymentDate, remarks = "", payableSnapshot) => {
    return addSupplierPayment(supplierId, amount, paymentDate, remarks, payableSnapshot);
  },

  getPaymentsBySupplier: async (supplierId) => {
    const all = await getAllSupplierPayments();
    return all.filter(p => p.supplierId === supplierId);
  },

  deletePayment: async (id) => {
    return deleteSupplierPayment(id);
  }
};
