//src/repositories/SalesRepository

import { db } from "../db";
import type { DBSale, DBSaleItem } from "../db";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const salesRepository = {
  async addSale(
    sale: Omit<DBSale, "id">,
    items: Omit<DBSaleItem, "id" | "saleId">[]
  ): Promise<number> {
    const conn = await db.open();

    return new Promise((resolve, reject) => {
      const tx = conn.transaction(["sales", "sale_items"], "readwrite");
      const salesStore = tx.objectStore("sales");
      const saleItemsStore = tx.objectStore("sale_items");

      const saleReq = salesStore.add(sale);

      saleReq.onsuccess = () => {
        const saleId = saleReq.result as number;

        for (const item of items) {
          saleItemsStore.add({
            ...item,
            saleId,
          });
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
    const store = tx.objectStore("sales");
    return promisify(store.getAll());
  },

  async getSaleItems(saleId: number): Promise<DBSaleItem[]> {
  const conn = await db.open();
  const tx = conn.transaction("sale_items", "readonly");
  const store = tx.objectStore("sale_items");

  const allItems: DBSaleItem[] = await promisify(store.getAll());
  return allItems.filter(item => item.saleId === saleId);
},


  async getSale(id: number): Promise<DBSale | undefined> {
    const conn = await db.open();
    const tx = conn.transaction("sales", "readonly");
    const store = tx.objectStore("sales");
    return promisify(store.get(id));
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

  const results: DBSale[] = [];
  let total = 0;
  let skipped = 0;
  const offset = (page - 1) * pageSize;

  return new Promise((resolve, reject) => {
const request = store.openCursor(null, "prev");

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve({ data: results, total });
        return;
      }

      const sale = cursor.value as DBSale;

      // FILTER: transaction type
      if (transactionType && sale.transactionType !== transactionType) {
        cursor.continue();
        return;
      }

      // FILTER: invoice number search
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

      // page filled
      resolve({ data: results, total });
    };
  });
},

async getSalesCount(): Promise<number> {
  const conn = await db.open();
  const tx = conn.transaction("sales", "readonly");
  const store = tx.objectStore("sales");
  return promisify(store.count());
},

async getSalesPage(
  page: number,
  pageSize: number
): Promise<DBSale[]> {
  if (page < 1) throw new Error("Page must be >= 1");

  const conn = await db.open();
  const tx = conn.transaction("sales", "readonly");
  const store = tx.objectStore("sales");

  const offset = (page - 1) * pageSize;
  const result: DBSale[] = [];

  return new Promise((resolve, reject) => {
    let skipped = 0;

    const request = store.openCursor(null, "prev");

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      const cursor = request.result;

      if (!cursor) {
        resolve(result);
        return;
      }

      if (skipped < offset) {
        skipped++;
        cursor.continue();
        return;
      }

      if (result.length < pageSize) {
        result.push(cursor.value as DBSale);
        cursor.continue();
        return;
      }

      resolve(result);
    };
  });
},


};
