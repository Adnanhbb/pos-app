// src/repositories/batchRepository.ts

import { db } from "../db";
import type { ItemBatch } from "../types/entities";
export type { ItemBatch };

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const batchRepository = {
  async addBatch(batch: Omit<ItemBatch, "id">): Promise<number> {
    const conn = await db.open();

    return new Promise((resolve, reject) => {
      const tx = conn.transaction("item_batches", "readwrite");
      const store = tx.objectStore("item_batches");

      const req = store.add(batch);

      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  },

async getBatchesByItem(itemId: number): Promise<ItemBatch[]> {
  const conn = await db.open();

  return new Promise((resolve, reject) => {
    const tx = conn.transaction("item_batches", "readonly");
    const store = tx.objectStore("item_batches");
    const index = store.index("by-item");

    const req = index.getAll(itemId);

    req.onsuccess = () => {
      const all = req.result as ItemBatch[];

      // 🔥 ONLY ACTIVE BATCHES
      const filtered = all.filter(b => !b.isDeleted);

      resolve(filtered);
    };

    req.onerror = () => reject(req.error);
  });
},

async updateBatch(batch: ItemBatch): Promise<void> {
  const conn = await db.open();

  return new Promise((resolve, reject) => {
    const tx = conn.transaction("item_batches", "readwrite");
    const store = tx.objectStore("item_batches");

    const req = store.put(batch);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
},

async getAllBatchesByItem(itemId: number): Promise<ItemBatch[]> {
  const conn = await db.open();

  return new Promise((resolve, reject) => {
    const tx = conn.transaction("item_batches", "readonly");
    const store = tx.objectStore("item_batches");
    const index = store.index("by-item");

    const req = index.getAll(itemId);

    req.onsuccess = () => resolve(req.result); // ✅ NO FILTER
    req.onerror = () => reject(req.error);
  });
},

async getBatchById(id: number): Promise<ItemBatch | undefined> {
  const conn = await db.open();

  return new Promise((resolve, reject) => {
    const tx = conn.transaction("item_batches", "readonly");
    const store = tx.objectStore("item_batches");

    const req = store.get(id);

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
},

async deleteByInvoiceNo(invoiceNo: string): Promise<void> {
  const conn = await db.open();

  return new Promise((resolve, reject) => {
    const tx = conn.transaction("item_batches", "readwrite");
    const store = tx.objectStore("item_batches");
    const index = store.index("by-invoice"); // ⚠️ must exist

    const req = index.openCursor(IDBKeyRange.only(invoiceNo));

    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };

    req.onerror = () => reject(req.error);
  });
},

async permanentDeleteByItem(itemId: number): Promise<void> {
  const conn = await db.open();

  return new Promise(async (resolve, reject) => {

    const tx = conn.transaction("item_batches", "readwrite");

    const store = tx.objectStore("item_batches");

    const index = store.index("by-item");

    const req = index.getAll(itemId);

    req.onsuccess = () => {

      const batches = req.result as ItemBatch[];

      for (const b of batches) {
        if (b.id != null) {
          store.delete(b.id);
        }
      }
    };

    tx.oncomplete = () => resolve();

    tx.onerror = () => reject(tx.error);

    req.onerror = () => reject(req.error);
  });
},

};

