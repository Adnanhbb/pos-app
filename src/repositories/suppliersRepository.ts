import { Supplier, CustomerPayment, SupplierPayment } from "../db";

export interface SupplierRepository {
  getAll(): Promise<Supplier[]>;
  getPaged(page: number, pageSize: number, query?: string | null): Promise<{ total: number; data: Supplier[] }>;
  add(supplier: Omit<Supplier, "id">): Promise<number>;
  update(supplier: Supplier): Promise<void>;
  delete(id: number): Promise<void>;
  search(query: string): Promise<Supplier[]>;
  // Optional: add payment functions if POS needs them
  addPayment(supplierId: number, amount: number, paymentDate: string, remarks?: string, payableSnapshot?: number): Promise<void>;
  getPaymentsBySupplier(supplierId: number): Promise<SupplierPayment[]>;
  deletePayment(id: number): Promise<void>;
}
