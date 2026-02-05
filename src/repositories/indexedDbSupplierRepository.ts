import {
  initDB,
  Supplier,
  SupplierPayment,
  addSupplier,
  getSuppliersPaged,
  updateSupplier,
  deleteSupplier,
  searchSuppliers,
  addSupplierPayment,
  getAllSupplierPayments,
  deleteSupplierPayment,
} from "../db";

import type { SuppliersRepository } from "./suppliersRepository";

export const indexedDbSupplierRepository: SuppliersRepository = {
  /* ---------------- Suppliers ---------------- */
  getAll: async (): Promise<Supplier[]> => {
    const db = await initDB();
    return db.getAll("suppliers");
  },

  getById: async (id: number): Promise<Supplier | undefined> => {
    const db = await initDB();
    const supplier = await db.get("suppliers", id);
    return supplier ?? undefined;
  },

  getPaged: async (page: number, pageSize: number, query?: string | null) => {
    return getSuppliersPaged(page, pageSize, query ?? null);
  },

  create: async (supplier: Omit<Supplier, "id">) => {
    return addSupplier(supplier);
  },

  update: async (supplier: Supplier) => {
    await updateSupplier(supplier);
  },

  remove: async (id: number) => {
    await deleteSupplier(id);

    // Delete related supplier payments
    const allPayments = await getAllSupplierPayments();
    for (const p of allPayments.filter(p => p.supplierId === id)) {
      await deleteSupplierPayment(p.id!);
    }
  },

  search: async (query: string) => {
    return searchSuppliers(query);
  },

  /* ---------------- Payments ---------------- */
  addPayment: async (payment: Omit<SupplierPayment, "id">): Promise<void> => {
  await addSupplierPayment(
    payment.supplierId,
    payment.amount,
    payment.paymentDate,
    payment.remarks,
    payment.payableSnapshot,
    payment.balanceSnapshot
  );
},

  getPaymentsBySupplier: async (supplierId: number): Promise<SupplierPayment[]> => {
    const all = await getAllSupplierPayments();
    return all.filter(p => p.supplierId === supplierId);
  },

  deletePayment: async (id: number) => {
    await deleteSupplierPayment(id);
  },
};
