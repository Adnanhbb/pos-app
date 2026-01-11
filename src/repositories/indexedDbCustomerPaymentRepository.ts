// src/repositories/indexedDbCustomerPaymentRepository.ts
import {
  initDB,
  CustomerPayment,
  addCustomerPayment,
  updateCustomerPayment,
  deleteCustomerPayment,
  getAllCustomerPayments,
  getCustomerPaymentsByCustomer,
} from "../db";

/**
 * IndexedDB-based repository for customer payments.
 * Implementation uses `void` return types for add/update to match your current db functions.
 */
export const indexedDbCustomerPaymentRepository = {
  /** Get all payments */
  getAll: async (): Promise<CustomerPayment[]> => {
    return getAllCustomerPayments();
  },

  /** Get payments for a specific customer */
  getByCustomer: async (customerId: number): Promise<CustomerPayment[]> => {
    return getCustomerPaymentsByCustomer(customerId);
  },

  /** Add a new payment */
  add: async (payment: Omit<CustomerPayment, "id">): Promise<void> => {
    await addCustomerPayment(
      payment.customerId,
      payment.amount,
      payment.paymentDate,
      payment.remarks ?? "",
      payment.payableSnapshot
    );
  },

  /** Update an existing payment */
  update: async (payment: CustomerPayment): Promise<void> => {
    await updateCustomerPayment(
      payment.id!,
      payment.customerId,
      payment.amount,
      payment.paymentDate,
      payment.remarks ?? "",
      payment.payableSnapshot
    );
  },

  /** Delete a payment by ID */
  delete: async (id: number): Promise<void> => {
    await deleteCustomerPayment(id);
  },

  /** Delete all payments for a specific invoice number */
  deleteByInvoiceNo: async (invoiceNo: string): Promise<void> => {
    const all = await getAllCustomerPayments();
    for (const p of all.filter((p) => p.invoiceNo === invoiceNo)) {
      await deleteCustomerPayment(p.id!);
    }
  },
};
