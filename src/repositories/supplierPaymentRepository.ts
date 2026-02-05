// src/supplierPaymentRepository.ts
import { initDB } from "../db";
import type { SupplierPayment } from "../db";

export const supplierPaymentRepository = {
  async getAll(): Promise<SupplierPayment[]> {
    const db = await initDB();
    return await db.getAll("supplier_payments");
  },

  async getBySupplier(supplierId: number): Promise<SupplierPayment[]> {
    const db = await initDB();
    const all = await db.getAll("supplier_payments");
    return all.filter(p => p.supplierId === supplierId);
  },

  async add(payment: Omit<SupplierPayment, "id">): Promise<number> {
    const db = await initDB();
    return await db.add("supplier_payments", payment);
  },

  async update(payment: SupplierPayment): Promise<void> {
    const db = await initDB();
    await db.put("supplier_payments", payment);
  },

  async delete(id: number): Promise<void> {
    const db = await initDB();
    await db.delete("supplier_payments", id);
  },

  async deleteByInvoiceNo(invoiceNo: string): Promise<void> {
    const db = await initDB();
    const all = await db.getAll("supplier_payments");
    for (const p of all.filter(p => p.invoiceNo === invoiceNo)) {
      await db.delete("supplier_payments", p.id!);
    }
  },
};
