// src/repositories/indexedDbSupplierPaymentRepository.ts
import {
  addSupplierPayment,
  updateSupplierPayment,
  deleteSupplierPayment,
  getAllSupplierPayments,
} from "../db";
import type { SupplierPayment } from "../types/entities";

export const indexedDbSupplierPaymentRepository = {
  /** Get all supplier payments */
  getAll: async (): Promise<SupplierPayment[]> => {
    return getAllSupplierPayments();
  },

  /** Get a payment by ID */
  getById: async (id: number): Promise<SupplierPayment | undefined> => {
    const all = await getAllSupplierPayments();
    return all.find(p => p.id === id);
  },

  /** Add a new supplier payment */
  add: async (payment: Omit<SupplierPayment, "id">): Promise<void> => {
    await addSupplierPayment(
      payment.supplierId,
      payment.amount,
      payment.paymentDate,
      payment.remarks ?? "",
      payment.payableSnapshot,
      payment.balanceSnapshot
    );
  },

  /** Update an existing supplier payment */
  update: async (payment: SupplierPayment): Promise<void> => {
    await updateSupplierPayment(
      payment.id!,
      payment.supplierId,
      payment.amount,
      payment.paymentDate,
      payment.remarks ?? "",
      payment.payableSnapshot
    );
  },

  /** Delete a payment by ID */
  delete: async (id: number): Promise<void> => {
    await deleteSupplierPayment(id);
  },

  /** Delete all payments for a specific invoice number */
  deleteByInvoiceNo: async (invoiceNo: string): Promise<void> => {
    const allPayments = await getAllSupplierPayments();
    const paymentsToDelete = allPayments.filter(p => p.invoiceNo === invoiceNo);

    for (const payment of paymentsToDelete) {
      if (payment.id != null) {
        await deleteSupplierPayment(payment.id);
      }
    }
  },
};
