// suppliersRepository.ts
import {
  getAllSuppliers,
  getSuppliersPaged,
  addSupplier,
  updateSupplier,
  deleteSupplier,
  searchSuppliers,
  addSupplierPayment,
  getAllSupplierPayments,
  deleteSupplierPayment,
  Supplier,
  SupplierPayment,
} from "../db";

export const SupplierRepository = {
  getAll: async (): Promise<Supplier[]> => {
    return await getAllSuppliers();
  },

  getPaged: async (page: number, pageSize: number, query?: string | null) => {
    return await getSuppliersPaged(page, pageSize, query ?? null);
  },

  add: async (supplier: Omit<Supplier, "id">) => {
    return await addSupplier(supplier);
  },

  update: async (supplier: Supplier) => {
    await updateSupplier(supplier);
  },

  delete: async (id: number) => {
    await deleteSupplier(id);
  },

  search: async (query: string) => {
    return await searchSuppliers(query);
  },

  addPayment: async (
    supplierId: number,
    amount: number,
    paymentDate: string,
    remarks: string = "",
    payableSnapshot?: number
  ) => {
    await addSupplierPayment(supplierId, amount, paymentDate, remarks, payableSnapshot);
  },

  getPaymentsBySupplier: async (supplierId: number): Promise<SupplierPayment[]> => {
    const allPayments = await getAllSupplierPayments();
    return allPayments.filter(p => p.supplierId === supplierId);
  },

  deletePayment: async (id: number) => {
    await deleteSupplierPayment(id);
  },
};
