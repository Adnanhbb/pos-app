import { db } from "../db";
import type { CustomerPayment } from "../db";

export const customerPaymentRepository = {
  // Get all customer payments
  async getAll(): Promise<CustomerPayment[]> {
    const conn = await db.open();
    return new Promise((resolve, reject) => {
      const tx = conn.transaction("customer_payments", "readonly");
      const store = tx.objectStore("customer_payments");
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result as CustomerPayment[] || []);
      req.onerror = () => reject(req.error);
    });
  },

  // Get payments by a specific customer
  async getByCustomer(customerId: number): Promise<CustomerPayment[]> {
    const conn = await db.open();
    return new Promise((resolve, reject) => {
      const tx = conn.transaction("customer_payments", "readonly");
      const store = tx.objectStore("customer_payments");
      const results: CustomerPayment[] = [];

      const cursorReq = store.openCursor();
      cursorReq.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (!cursor) return resolve(results);

        if (cursor.value.customerId === customerId) {
          results.push(cursor.value as CustomerPayment);
        }
        cursor.continue();
      };

      cursorReq.onerror = () => reject(cursorReq.error);
    });
  },

  // Add a new payment
  async add(payment: Omit<CustomerPayment, "id">): Promise<number> {
    const conn = await db.open();

    // Ensure required fields exist
    if (
      payment.customerId === undefined ||
      payment.customerName === undefined ||
      payment.invoiceNo === undefined ||
      payment.amount === undefined ||
      payment.paymentDate === undefined ||
      payment.payableSnapshot === undefined ||
      payment.balanceSnapshot === undefined
    ) {
      throw new Error("Missing required fields in CustomerPayment");
    }

    return new Promise((resolve, reject) => {
      const tx = conn.transaction("customer_payments", "readwrite");
      const store = tx.objectStore("customer_payments");
      const req = store.add(payment);

      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    });
  },

  // Update an existing payment
  async update(payment: CustomerPayment): Promise<void> {
    const conn = await db.open();
    return new Promise((resolve, reject) => {
      const tx = conn.transaction("customer_payments", "readwrite");
      const store = tx.objectStore("customer_payments");
      const req = store.put(payment);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  // Delete a payment
  async delete(id: number): Promise<void> {
    const conn = await db.open();
    return new Promise((resolve, reject) => {
      const tx = conn.transaction("customer_payments", "readwrite");
      const store = tx.objectStore("customer_payments");
      const req = store.delete(id);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
};
