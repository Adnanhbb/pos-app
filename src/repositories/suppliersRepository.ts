// src/supplierRepository.ts
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
  getPaged: (
    page: number,
    pageSize: number,
    query?: string,
    includeDeleted?: boolean
  ) => Promise<{ data: Supplier[]; total: number }>;
  search: (q: string) => Promise<Supplier[]>;
  create: (supplier: Omit<Supplier, "id">) => Promise<number>;
  update: (supplier: Supplier) => Promise<void>;
  remove: (id: number) => Promise<void>;
  restore?: (id: number) => Promise<void>;
  permanentDelete?: (id: number) => Promise<void>;
  getDeleted?: () => Promise<Supplier[]>;

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
    const all = await getAllSuppliers();
    return all.filter(s => !s.isDeleted);
  },

  getById: async (id: number): Promise<Supplier | undefined> => {
    return await getSupplierById(id);
  },

  getPaged: async (
    page: number,
    pageSize: number,
    query?: string,
    includeDeleted: boolean = false
  ) => {
    const { total, data } = await getSuppliersPaged(page, pageSize, query ?? null);
    const filtered = includeDeleted ? data : data.filter(s => !s.isDeleted);
    return { total: filtered.length, data: filtered };
  },

  search: async (q: string): Promise<Supplier[]> => {
    const all = await searchSuppliers(q);
    return all.filter(s => !s.isDeleted);
  },

  create: async (supplier: Omit<Supplier, "id">): Promise<number> => {
    const sup: Omit<Supplier, "id"> = {
      ...supplier,
      isDeleted: supplier.isDeleted ?? false,
      deletedAt: supplier.deletedAt ?? null,
    };
    return await addSupplier(sup);
  },

  update: async (supplier: Supplier): Promise<void> => {
    await updateSupplier(supplier);
  },

  remove: async (id: number): Promise<void> => {
    const supplier = await getSupplierById(id);
    if (!supplier) throw new Error("Supplier not found");
    await updateSupplier({ ...supplier, isDeleted: true, deletedAt: Date.now() });
  },

  restore: async (id: number): Promise<void> => {
    const supplier = await getSupplierById(id);
    if (!supplier) throw new Error("Supplier not found");
    await updateSupplier({ ...supplier, isDeleted: false, deletedAt: null });
  },

  permanentDelete: async (id: number): Promise<void> => {
    await deleteSupplier(id);

    // Delete related supplier payments
    const allPayments = await getAllSupplierPayments();
    for (const p of allPayments.filter(p => p.supplierId === id)) {
      await deleteSupplierPayment(p.id!);
    }
  },

  getDeleted: async (): Promise<Supplier[]> => {
    const all = await getAllSuppliers();
    return all.filter(s => s.isDeleted);
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