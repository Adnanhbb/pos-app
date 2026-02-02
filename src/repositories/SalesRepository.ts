// src/repositories/SalesRepository.ts

import { db } from "../db";
import type { DBSale, DBSaleItem, Item } from "../db";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const salesRepository = {
  /**
   * Add a SALE or PURCHASE transaction
   */
  // Accept sale items along with the sale object
async addTransaction(
  transaction: Omit<DBSale, "id"> & { items?: Omit<DBSaleItem, "id" | "saleId">[] }
): Promise<number> {
  const conn = await db.open();

  return new Promise((resolve, reject) => {
    const tx = conn.transaction(["sales", "sale_items"], "readwrite");
    const salesStore = tx.objectStore("sales");
    const saleItemsStore = tx.objectStore("sale_items");

    const { items, ...saleData } = transaction; // ✅ now TypeScript knows 'items' exists
    const saleReq = salesStore.add(saleData);

    saleReq.onsuccess = () => {
      const saleId = saleReq.result as number;

      if (items && Array.isArray(items)) {
        for (const item of items) {
          saleItemsStore.add({ ...item, saleId });
        }
      }

      tx.oncomplete = () => resolve(saleId);
    };

    saleReq.onerror = () => reject(saleReq.error);
    tx.onerror = () => reject(tx.error);
  });
},

  async getAllSales(): Promise<DBSale[]> {
    const conn = await db.open();
    const tx = conn.transaction("sales", "readonly");
    return promisify(tx.objectStore("sales").getAll());
  },

  async getSale(id: number): Promise<DBSale | undefined> {
    const conn = await db.open();
    const tx = conn.transaction("sales", "readonly");
    return promisify(tx.objectStore("sales").get(id));
  },

  async getSaleItems(saleId: number): Promise<DBSaleItem[]> {
    const conn = await db.open();
    const tx = conn.transaction("sale_items", "readonly");
    const store = tx.objectStore("sale_items");

    const all = await promisify(store.getAll());
    return all.filter(i => i.saleId === saleId);
  },

  async getSalesCount(): Promise<number> {
    const conn = await db.open();
    const tx = conn.transaction("sales", "readonly");
    return promisify(tx.objectStore("sales").count());
  },

  async getSalesPage(page: number, pageSize: number): Promise<DBSale[]> {
    const conn = await db.open();
    const tx = conn.transaction("sales", "readonly");
    const store = tx.objectStore("sales");

    const offset = (page - 1) * pageSize;
    const result: DBSale[] = [];

    return new Promise((resolve, reject) => {
      let skipped = 0;
      const req = store.openCursor(null, "prev");

      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve(result);

        if (skipped < offset) {
          skipped++;
          cursor.continue();
          return;
        }

        if (result.length < pageSize) {
          result.push(cursor.value);
          cursor.continue();
          return;
        }

        resolve(result);
      };
    });
  },

  async getSalesPaged(
    page: number,
    pageSize: number,
    transactionType?: DBSale["transactionType"],
    invoiceNo?: string
  ): Promise<{ data: DBSale[]; total: number }> {
    const conn = await db.open();
    const tx = conn.transaction("sales", "readonly");
    const store = tx.objectStore("sales");

    const offset = (page - 1) * pageSize;
    const results: DBSale[] = [];
    let skipped = 0;
    let total = 0;

    return new Promise((resolve, reject) => {
      const req = store.openCursor(null, "prev");

      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve({ data: results, total });

        const sale = cursor.value as DBSale;

        if (transactionType && sale.transactionType !== transactionType) {
          cursor.continue();
          return;
        }

        if (invoiceNo && sale.invoiceNo !== invoiceNo) {
          cursor.continue();
          return;
        }

        total++;

        if (skipped < offset) {
          skipped++;
          cursor.continue();
          return;
        }

        if (results.length < pageSize) {
          results.push(sale);
          cursor.continue();
          return;
        }

        resolve({ data: results, total });
      };
    });
  },

  /**
   * 🔴 DELETE SALE/PURCHASE + RESTORE STOCK (MIN UNITS)
   */
  async deleteSaleAndRestoreStock(saleId: number): Promise<void> {
    const conn = await db.open();

    return new Promise((resolve, reject) => {
      const tx = conn.transaction(
        ["sales", "sale_items", "items"],
        "readwrite"
      );

      const salesStore = tx.objectStore("sales");
      const saleItemsStore = tx.objectStore("sale_items");
      const itemsStore = tx.objectStore("items");

      const saleItemsReq = saleItemsStore.getAll();

      saleItemsReq.onsuccess = () => {
        const saleItems = (saleItemsReq.result as DBSaleItem[]).filter(
          i => i.saleId === saleId
        );

        // 1️⃣ Restore stock (MIN units)
        for (const si of saleItems) {
          const itemReq = itemsStore.get(si.originalItemId);
          itemReq.onsuccess = () => {
            const item = itemReq.result as Item;
            if (!item) return;

            item.availableStock += si.qty;
            itemsStore.put(item);
          };
        }

        // 2️⃣ Delete sale items
        for (const si of saleItems) {
          if (si.id != null) saleItemsStore.delete(si.id);
        }

        // 3️⃣ Delete sale/purchase
        salesStore.delete(saleId);
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};
