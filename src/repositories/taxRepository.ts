import { db } from "../db";
import type { Tax } from "../db";

export const taxRepository = {
  async getAll(): Promise<Tax[]> {
    const conn = await db.open();
    return new Promise((resolve, reject) => {
      const tx = conn.transaction("taxes", "readonly");
      const store = tx.objectStore("taxes");
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },
};
