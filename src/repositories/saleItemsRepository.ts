// src/repositories/SaleItemsRepository.ts

import { db } from "../db";
import type { DBSaleItem } from "../db";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const saleItemsRepository = {
  async getBySaleId(saleId: number): Promise<DBSaleItem[]> {
    const conn = await db.open();
    const tx = conn.transaction("sale_items", "readonly");
    const store = tx.objectStore("sale_items");

    const allItems = await promisify(store.getAll());
    return allItems.filter(item => item.saleId === saleId);
  },

  async deleteBySaleId(saleId: number): Promise<void> {
    const conn = await db.open();
    const tx = conn.transaction("sale_items", "readwrite");
    const store = tx.objectStore("sale_items");

    const allItems = await promisify(store.getAll());

    for (const item of allItems) {
      if (item.saleId === saleId && item.id != null) {
        store.delete(item.id);
      }
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};
