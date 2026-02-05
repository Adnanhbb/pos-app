import { Supplier, SupplierPayment } from "../db";
import {
  addSupplier,
  updateSupplier,
  deleteSupplier,
  getAllSuppliers,
  getSuppliersPaged,
  getSupplierById,
  searchSuppliers,
  addSupplierPayment,
  getAllSupplierPayments,
  deleteSupplierPayment,
} from "../db";

// Export types
export type { Supplier, SupplierPayment };

// ------------------------
// Repository type
// ------------------------
export type SuppliersRepository = {
  // Suppliers
  getAll: () => Promise<Supplier[]>;
  getById: (id: number) => Promise<Supplier | undefined>;
  getPaged: (page: number, pageSize: number, query?: string) => Promise<{ data: Supplier[]; total: number }>;
  search: (q: string) => Promise<Supplier[]>;
  create: (supplier: Omit<Supplier, "id">) => Promise<number>;
  update: (supplier: Supplier) => Promise<void>;
  remove: (id: number) => Promise<void>;

  // Payments
  addPayment?: (payment: Omit<SupplierPayment, "id">) => Promise<void>;
  getPaymentsBySupplier?: (supplierId: number) => Promise<SupplierPayment[]>;
  deletePayment?: (id: number) => Promise<void>;
};

// ------------------------
// Runtime repository
// ------------------------
export const suppliersRepository: SuppliersRepository = {
  // ---------------- Suppliers ----------------
  getAll: async (): Promise<Supplier[]> => {
    return await getAllSuppliers();
  },

  getById: async (id: number): Promise<Supplier | undefined> => {
    return await getSupplierById(id);
  },

  getPaged: async (page: number, pageSize: number, query?: string) => {
    return await getSuppliersPaged(page, pageSize, query ?? null);
  },

  search: async (q: string): Promise<Supplier[]> => {
    return await searchSuppliers(q);
  },

  create: async (supplier: Omit<Supplier, "id">): Promise<number> => {
    return await addSupplier(supplier);
  },

  update: async (supplier: Supplier): Promise<void> => {
    await updateSupplier(supplier);
  },

  remove: async (id: number): Promise<void> => {
    await deleteSupplier(id);

    // Ensure related supplier payments are also deleted
    const allPayments = await getAllSupplierPayments();
    for (const p of allPayments.filter(p => p.supplierId === id)) {
      await deleteSupplierPayment(p.id!);
    }
  },

  // ---------------- Payments ----------------
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

  deletePayment: async (id: number): Promise<void> => {
    await deleteSupplierPayment(id);
  },
};
