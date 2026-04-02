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

  /** Get active suppliers only */
  getAll: async (): Promise<Supplier[]> => {
    const db = await initDB();
    const all = await db.getAll("suppliers");
    return all.filter(s => !s.isDeleted);
  },

  /** Get deleted suppliers (for modal) */
  getDeleted: async (): Promise<Supplier[]> => {
    const db = await initDB();
    const all = await db.getAll("suppliers");
    return all.filter(s => s.isDeleted);
  },

  getById: async (id: number): Promise<Supplier | undefined> => {
    const db = await initDB();
    const supplier = await db.get("suppliers", id);
    return supplier ?? undefined;
  },

  getPaged: async (page: number, pageSize: number, query?: string | null) => {
    const result = await getSuppliersPaged(page, pageSize, query ?? null);

    return {
      total: result.data.filter(s => !s.isDeleted).length,
      data: result.data.filter(s => !s.isDeleted),
    };
  },

  create: async (supplier: Omit<Supplier, "id">) => {
    return addSupplier({
      ...supplier,
      isDeleted: supplier.isDeleted ?? false,
      deletedAt: supplier.deletedAt ?? null,
    });
  },

  update: async (supplier: Supplier) => {
    await updateSupplier(supplier);
  },

  /** Soft delete */
  remove: async (id: number) => {
    const db = await initDB();
    const supplier = await db.get("suppliers", id);
    if (!supplier) throw new Error("Supplier not found");

    await updateSupplier({
      ...supplier,
      isDeleted: true,
      deletedAt: Date.now(),
    });
  },

  /** Restore supplier */
  restore: async (id: number) => {
    const db = await initDB();
    const supplier = await db.get("suppliers", id);
    if (!supplier) throw new Error("Supplier not found");

    await updateSupplier({
      ...supplier,
      isDeleted: false,
      deletedAt: null,
    });
  },

  /** Permanent delete */
  permanentDelete: async (id: number) => {
    await deleteSupplier(id);

    // cleanup payments (same as your existing logic)
    const allPayments = await getAllSupplierPayments();
    for (const p of allPayments.filter(p => p.supplierId === id)) {
      await deleteSupplierPayment(p.id!);
    }
  },

  search: async (query: string) => {
    const results = await searchSuppliers(query);
    return results.filter(s => !s.isDeleted);
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