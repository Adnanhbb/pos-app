//src/customerPaymentRepository.ts
import { initDB } from "../db"; // whatever your modern idb init function is
import type { CustomerPayment } from "../db";

export const customerPaymentRepository = {
  async getAll(): Promise<CustomerPayment[]> {
    const db = await initDB();
    return await db.getAll("customer_payments"); // simple idb call
  },

  async getByCustomer(customerId: number): Promise<CustomerPayment[]> {
    const db = await initDB();
    const all = await db.getAll("customer_payments");
    return all.filter(p => p.customerId === customerId);
  },

  async add(payment: Omit<CustomerPayment, "id">): Promise<number> {
    const db = await initDB();
    return await db.add("customer_payments", payment);
  },

  async update(payment: CustomerPayment): Promise<void> {
    const db = await initDB();
    await db.put("customer_payments", payment);
  },

  async delete(id: number): Promise<void> {
    const db = await initDB();
    await db.delete("customer_payments", id);
  },

  async deleteByInvoiceNo(invoiceNo: string): Promise<void> {
    const db = await initDB();
    const all = await db.getAll("customer_payments");
    for (const p of all.filter(p => p.invoiceNo === invoiceNo)) {
      await db.delete("customer_payments", p.id!);
    }
  },
};
