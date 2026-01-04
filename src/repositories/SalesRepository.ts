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
    const index = store.index("saleId");
    return promisify(index.getAll(saleId));
  },

  async getSale(id: number): Promise<DBSale | undefined> {
    const conn = await db.open();
    const tx = conn.transaction("sales", "readonly");
    const store = tx.objectStore("sales");
    return promisify(store.get(id));
  },
};
