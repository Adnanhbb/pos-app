import { db } from "../db";
import type { Discount } from "../db";

export const discountRepository = {
  async getAll(): Promise<Discount[]> {
    const conn = await db.open();
    return new Promise((resolve, reject) => {
      const tx = conn.transaction("discounts", "readonly");
      const store = tx.objectStore("discounts");
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },
};
