// src/repositories/SalesRepository.ts

import { db } from "../db";
import type { DBSale, DBSaleItem, Item } from "../db";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

type TransactionFilter = "All" | DBSale["transactionType"];
type ReturnSubFilter = "All" | "Cus" | "Sup";

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

async update(sale: DBSale): Promise<void> {
  const conn = await db.open();

  return new Promise((resolve, reject) => {
    const tx = conn.transaction(["sales"], "readwrite");
    const store = tx.objectStore("sales");

    // ⚠️ Important: sale MUST have id
    if (!sale.id) {
      reject(new Error("Sale ID is required for update"));
      return;
    }

    const req = store.put(sale); // ✅ put = update or insert

    req.onsuccess = () => {
      tx.oncomplete = () => resolve();
    };

    req.onerror = () => reject(req.error);
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

  async getSalesCountFiltered(filters: {
  transactionType?: TransactionFilter;
  search?: string;
  showPostponedOnly?: boolean;
  returnSubFilter?: ReturnSubFilter;
}): Promise<number> {
  const conn = await db.open();
  const tx = conn.transaction("sales", "readonly");
  const store = tx.objectStore("sales");

  const q = filters.search?.toLowerCase() || "";
  let count = 0;

  return new Promise((resolve, reject) => {
    const req = store.openCursor(null, "prev");

    req.onerror = () => reject(req.error);

    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve(count);

      const sale = cursor.value as DBSale;

      // 🔹 postponed filter
      if (filters.showPostponedOnly && !sale.isPostponed) {
        cursor.continue();
        return;
      }

      // 🔹 type filter
      if (
        filters.transactionType &&
        filters.transactionType !== "All" &&
        sale.transactionType !== filters.transactionType
      ) {
        cursor.continue();
        return;
      }

      // 🔹 search filter
      if (q) {
        const match =
          sale.invoiceNo?.toLowerCase().includes(q) ||
          sale.customerName?.toLowerCase().includes(q) ||
          sale.supplierName?.toLowerCase().includes(q);

        if (!match) {
          cursor.continue();
          return;
        }
      }

      count++;
      cursor.continue();
    };
  });
},

async getSalesPagedFiltered(
  page: number,
  pageSize: number,
  filters: {
    transactionType?: TransactionFilter;
    search?: string;
    showPostponedOnly?: boolean;
    returnSubFilter?: ReturnSubFilter;
  }
): Promise<{ data: DBSale[]; total: number }> {

  const conn = await db.open();
  const tx = conn.transaction("sales", "readonly");
  const store = tx.objectStore("sales");

  const offset = (page - 1) * pageSize;

  const results: DBSale[] = [];
  let skipped = 0;
  let total = 0;

  const q = filters.search?.toLowerCase() || "";

  const isReturnFilter = filters.transactionType === "Return";

  return new Promise((resolve, reject) => {
    const req = store.openCursor(null, "prev");

    req.onerror = () => reject(req.error);

    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve({ data: results, total });

      const sale = cursor.value as DBSale;

      // 🔹 postponed filter
      if (filters.showPostponedOnly && !sale.isPostponed) {
        cursor.continue();
        return;
      }

      // 🔹 type filter
      if (
        filters.transactionType &&
        filters.transactionType !== "All" &&
        sale.transactionType !== filters.transactionType
      ) {
        cursor.continue();
        return;
      }

      // 🔹 return sub-filter (SAFE NARROWING)
      if (isReturnFilter) {
        const sub = filters.returnSubFilter ?? "All";

        if (
          sub === "Cus" &&
          !sale.invoiceNo?.startsWith("RET-C")
        ) {
          cursor.continue();
          return;
        }

        if (
          sub === "Sup" &&
          !sale.invoiceNo?.startsWith("RET-S")
        ) {
          cursor.continue();
          return;
        }
      }

      // 🔹 search filter
      if (q) {
        const match =
          sale.invoiceNo?.toLowerCase().includes(q) ||
          sale.customerName?.toLowerCase().includes(q) ||
          sale.supplierName?.toLowerCase().includes(q);

        if (!match) {
          cursor.continue();
          return;
        }
      }

      total++;

      // 🔹 pagination
      if (skipped < offset) {
        skipped++;
        cursor.continue();
        return;
      }

      if (results.length < pageSize) {
        results.push(sale);
      }

      cursor.continue();
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
   * 🔴 DELETE SALE + RESTORE STOCK (MIN UNITS)
   */
  async deleteSaleAndRestoreStock(saleId: number): Promise<void> {
  const conn = await db.open();

  return new Promise((resolve, reject) => {
    const tx = conn.transaction(
      ["sales", "sale_items", "items", "item_batches"],
      "readwrite"
    );

    const salesStore = tx.objectStore("sales");
    const saleItemsStore = tx.objectStore("sale_items");
    const itemsStore = tx.objectStore("items");
    const batchStore = tx.objectStore("item_batches");

    const saleItemsReq = saleItemsStore.getAll();

    saleItemsReq.onsuccess = () => {
      const saleItems = (saleItemsReq.result as DBSaleItem[]).filter(
        i => i.saleId === saleId
      );

      for (const si of saleItems) {

        /* ---------------- STOCK RESTORE ---------------- */
        const itemReq = itemsStore.get(si.originalItemId);
        itemReq.onsuccess = () => {
          const item = itemReq.result as Item;
          if (!item) return;

          item.availableStock += si.qty;
          itemsStore.put(item);
        };

        /* ---------------- BATCH REVERSE ---------------- */
        if (si.id) {
          const batchReq = batchStore.get(si.id);

          batchReq.onsuccess = () => {
            const batch = batchReq.result;
            if (!batch) return;

            batch.qtySold -= si.qty;
            batch.balance += si.qty;

            batch.qtySold = Math.max(0, batch.qtySold);

            batchStore.put(batch);
          };
        }
      }

      /* ---------------- DELETE ITEMS ---------------- */
      for (const si of saleItems) {
        if (si.id != null) saleItemsStore.delete(si.id);
      }

      /* ---------------- DELETE SALE ---------------- */
      salesStore.delete(saleId);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
},

  /**
   * 🔴 DELETE PURCHASE + RESTORE STOCK (MIN UNITS)
   */
async deletePurchaseAndReduceStock(purchaseId: number): Promise<void> {
  const conn = await db.open();

  return new Promise((resolve, reject) => {
    const tx = conn.transaction(
      ["sales", "sale_items", "items", "item_batches"],
      "readwrite"
    );

    const salesStore = tx.objectStore("sales");
    const saleItemsStore = tx.objectStore("sale_items");
    const itemsStore = tx.objectStore("items");
    const batchStore = tx.objectStore("item_batches");

    const saleReq = salesStore.get(purchaseId);

    saleReq.onsuccess = () => {
      const sale = saleReq.result as DBSale;
      if (!sale) return;

      const invoiceNo = sale.invoiceNo;

      const saleItemsReq = saleItemsStore.getAll();

      saleItemsReq.onsuccess = () => {
        const purchaseItems = (saleItemsReq.result as DBSaleItem[]).filter(
          i => i.saleId === purchaseId
        );

        for (const pi of purchaseItems) {

          /* ---------------- STOCK REDUCE ---------------- */
          const itemReq = itemsStore.get(pi.originalItemId);
          itemReq.onsuccess = () => {
            const item = itemReq.result as Item;
            if (!item) return;

            item.availableStock -= pi.qty;
            if (item.availableStock < 0) item.availableStock = 0;

            itemsStore.put(item);
          };
        }

        /* ---------------- DELETE BATCHES ---------------- */
        const batchIndex = batchStore.index("by-item");

        for (const pi of purchaseItems) {
          const batchReq = batchIndex.getAll(pi.originalItemId);

          batchReq.onsuccess = () => {
            const batches = batchReq.result;

            batches.forEach((b: any) => {
              if (b.invoiceNo === invoiceNo && b.id) {
                batchStore.delete(b.id);
              }
            });
          };
        }

        /* ---------------- DELETE ITEMS ---------------- */
        for (const pi of purchaseItems) {
          if (pi.id != null) saleItemsStore.delete(pi.id);
        }

        /* ---------------- DELETE SALE ---------------- */
        salesStore.delete(purchaseId);
      };
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
},

/**
 * 🔵 DELETE QUOTATION (NO STOCK / NO ACCOUNTS)
 */
async deleteQuotation(quotationId: number): Promise<void> {
  const conn = await db.open();

  return new Promise((resolve, reject) => {
    const tx = conn.transaction(
      ["sales", "sale_items"],
      "readwrite"
    );

    const salesStore = tx.objectStore("sales");
    const saleItemsStore = tx.objectStore("sale_items");

    const saleItemsReq = saleItemsStore.getAll();

    saleItemsReq.onsuccess = () => {
      const quotationItems = (saleItemsReq.result as DBSaleItem[]).filter(
        i => i.saleId === quotationId
      );

      // 1️⃣ Delete quotation items
      for (const qi of quotationItems) {
        if (qi.id != null) {
          saleItemsStore.delete(qi.id);
        }
      }

      // 2️⃣ Delete quotation invoice
      salesStore.delete(quotationId);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
},

async deleteCustomerReturnAndReduceStock(returnId: number): Promise<void> {
  const conn = await db.open();

  return new Promise((resolve, reject) => {
    const tx = conn.transaction(
      ["sales", "sale_items", "items", "item_batches"],
      "readwrite"
    );

    const salesStore = tx.objectStore("sales");
    const saleItemsStore = tx.objectStore("sale_items");
    const itemsStore = tx.objectStore("items");
    const batchStore = tx.objectStore("item_batches");

    const saleReq = salesStore.get(returnId);

    saleReq.onsuccess = () => {
      const sale = saleReq.result as DBSale;
      if (!sale) return;

      const invoiceNo = sale.invoiceNo;

      const saleItemsReq = saleItemsStore.getAll();

      saleItemsReq.onsuccess = () => {
        const returnItems = (saleItemsReq.result as DBSaleItem[]).filter(
          i => i.saleId === returnId
        );

        for (const ri of returnItems) {

          /* ---------------- STOCK REDUCE ---------------- */
          const itemReq = itemsStore.get(ri.originalItemId);
          itemReq.onsuccess = () => {
            const item = itemReq.result as Item;
            if (!item) return;

            item.availableStock -= ri.qty;
            if (item.availableStock < 0) item.availableStock = 0;

            itemsStore.put(item);
          };
        }

        /* ---------------- DELETE RETURN BATCH ---------------- */
        const batchIndex = batchStore.index("by-item");

        for (const ri of returnItems) {
          const batchReq = batchIndex.getAll(ri.originalItemId);

          batchReq.onsuccess = () => {
            const batches = batchReq.result;

            batches.forEach((b: any) => {
              if (b.invoiceNo === invoiceNo && b.id) {
                batchStore.delete(b.id);
              }
            });
          };
        }

        /* ---------------- DELETE ITEMS ---------------- */
        for (const ri of returnItems) {
          if (ri.id != null) saleItemsStore.delete(ri.id);
        }

        /* ---------------- DELETE SALE ---------------- */
        salesStore.delete(returnId);
      };
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
},

async deleteSupplierReturnAndRestoreStock(returnId: number): Promise<void> {
  const conn = await db.open();

  return new Promise((resolve, reject) => {
    const tx = conn.transaction(
      ["sales", "sale_items", "items", "item_batches"],
      "readwrite"
    );

    const salesStore = tx.objectStore("sales");
    const saleItemsStore = tx.objectStore("sale_items");
    const itemsStore = tx.objectStore("items");
    const batchStore = tx.objectStore("item_batches");

    const saleItemsReq = saleItemsStore.getAll();

    saleItemsReq.onsuccess = () => {
      const returnItems = (saleItemsReq.result as DBSaleItem[]).filter(
        i => i.saleId === returnId
      );

      for (const ri of returnItems) {

        /* ---------------- STOCK RESTORE ---------------- */
        const itemReq = itemsStore.get(ri.originalItemId);
        itemReq.onsuccess = () => {
          const item = itemReq.result as Item;
          if (!item) return;

          item.availableStock += ri.qty;
          itemsStore.put(item);
        };

        /* ---------------- BATCH REVERSE ---------------- */
        if (ri.id) {
          const batchReq = batchStore.get(ri.id);

          batchReq.onsuccess = () => {
            const batch = batchReq.result;
            if (!batch) return;

            batch.qtyPurchased += ri.qty;
            batch.balance += ri.qty;

            batchStore.put(batch);
          };
        }
      }

      /* ---------------- DELETE ITEMS ---------------- */
      for (const ri of returnItems) {
        if (ri.id != null) saleItemsStore.delete(ri.id);
      }

      /* ---------------- DELETE SALE ---------------- */
      salesStore.delete(returnId);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

};
