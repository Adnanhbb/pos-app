// src/repositories/SaleItemsRepository.ts

import { db } from "../db";
import type { DBSaleItem } from "../types/entities";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const saleItemsRepository = {

  /* -------------------------------------------
     GET ALL SALE ITEMS  ✅ (NEW)
     Required for reports & analytics
  --------------------------------------------*/
  async getAll(): Promise<DBSaleItem[]> {
    const conn = await db.open();
    const tx = conn.transaction("sale_items", "readonly");
    const store = tx.objectStore("sale_items");

    const items = await promisify(store.getAll());
    return items;
  },

  /* -------------------------------------------
     GET ITEMS BY SALE ID
  --------------------------------------------*/
  async getBySaleId(saleId: number): Promise<DBSaleItem[]> {
    const conn = await db.open();
    const tx = conn.transaction("sale_items", "readonly");
    const store = tx.objectStore("sale_items");

    const allItems = await promisify(store.getAll());
    return allItems.filter(item => item.saleId === saleId);
  },

  /* -------------------------------------------
     DELETE ITEMS BY SALE ID
  --------------------------------------------*/
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
