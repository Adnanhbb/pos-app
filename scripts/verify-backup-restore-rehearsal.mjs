#!/usr/bin/env node

/*
 * Isolated IndexedDB backup/restore rehearsal.
 *
 * The test creates two randomly named temporary databases under a temporary
 * local origin, exports the source into an in-memory envelope, validates it,
 * restores the target, verifies counts/relationships, and deletes both.
 * POSDatabase and MySQL are never opened or mutated.
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { BUSINESS_CRITICAL_INDEXEDDB_STORES } from "./lib/indexeddb-store-inventory.mjs";

const LIVE_DB_NAME = "POSDatabase";
const runId = randomUUID();
const sourceDbName = `BackupRestoreRehearsalSource-${runId}`;
const targetDbName = `BackupRestoreRehearsalTarget-${runId}`;

function startOrigin() {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end("<!doctype html><title>Backup restore rehearsal</title>");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/`,
      });
    });
  });
}

const fixtures = {
  users: [{ id: 1, Name: "REHEARSAL User", Mobile: "000", Role: "admin", Username: "rehearsal", Password: "[redacted]", isDeleted: false, deletedAt: null }],
  settings: [{ id: 1, businessName: "REHEARSAL Business", language: "en" }],
  customers: [{ id: 101, name: "REHEARSAL Customer", mobile: "000", payable: 100, paid: 25, balance: 75, isDeleted: false, deletedAt: null }],
  suppliers: [{ id: 201, name: "REHEARSAL Supplier", mobile: "000", payable: 80, paid: 20, balance: 60, isDeleted: false, deletedAt: null }],
  items: [{ id: 301, name: "REHEARSAL Item", barcode: "REHEARSAL-301", brand: "REHEARSAL Brand", category: "REHEARSAL Category", minunit: "Each", maxunit: "Each", ConvQty: 1, purchasePrice: 10, retailPrice: 12, wholesalePrice: 11, availableStock: 9, isDeleted: false, deletedAt: null }],
  categories: [{ id: 1, name: "REHEARSAL Category", itemCount: 1 }],
  brands: [{ id: 1, name: "REHEARSAL Brand", itemCount: 1 }],
  units: [{ id: 1, name: "Each", itemCount: 1 }],
  discounts: [{ id: 1, name: "REHEARSAL Discount", percentage: 0, itemCount: 0 }],
  taxes: [{ id: 1, name: "REHEARSAL Tax", percentage: 0, itemCount: 0 }],
  expenses: [{ id: 1, description: "REHEARSAL Expense", amount: 5, date: "2026-01-01", category: "REHEARSAL Category", isDeleted: false, deletedAt: null }],
  expCategories: [{ id: 1, category: "REHEARSAL Category" }],
  sales: [{ id: 401, invoiceNo: "SAL-REHEARSAL-401", transactionType: "Sale", customerId: 101, customerName: "REHEARSAL Customer", grandTotal: 12, paid: 0, arrears: 12, date: "2026-01-01" }],
  sale_items: [{ id: 501, saleId: 401, originalItemId: 301, itemName: "REHEARSAL Item", qty: 1, price: 12 }],
  customer_payments: [{ id: 1, customerId: 101, customerName: "REHEARSAL Customer", amount: 25, paymentDate: "2026-01-01", payableSnapshot: 100, balanceSnapshot: 75, invoiceNo: "CP-REHEARSAL-1" }],
  supplier_payments: [{ id: 1, supplierId: 201, supplierName: "REHEARSAL Supplier", amount: 20, paymentDate: "2026-01-01", payableSnapshot: 80, balanceSnapshot: 60, invoiceNo: "SP-REHEARSAL-1" }],
  item_batches: [{ id: 801, itemId: 301, invoiceNo: "Opening Stock", sourceSaleId: 0, qtyPurchased: 10, qtySold: 1, balance: 9, purchaseDate: "2026-01-01", costPrice: 10, isDeleted: false, deletedAt: null }],
  held: [{ id: 601, invoiceNo: "HELD-REHEARSAL-601", customerId: 101, customerName: "REHEARSAL Customer", date: "2026-01-01" }],
  held_items: [{ id: 701, heldId: 601, originalItemId: 301, itemName: "REHEARSAL Item", qty: 1, price: 12 }],
  cylinders: [{ id: 901, itemId: 301, title: "REHEARSAL Cylinder", filledCylinders: 4, emptyCylinders: 3, withCustomers: 2, qtyInStock: 7, isDeleted: false, deletedAt: null }],
  cylinder_customers: [{ id: 1001, cylinderId: 901, cylinderType: "REHEARSAL Cylinder", customerName: "REHEARSAL Customer", qtyHeld: 2, isDeleted: false, deletedAt: null }],
  sync_queue: [{ id: 1101, entity: "transactions", operation: "transaction", status: "failed", createdAt: 1, updatedAt: 2, retryCount: 1, lastError: "REHEARSAL blocked mapping" }],
};

function assertFixtureCoverage() {
  const fixtureStores = Object.keys(fixtures).sort();
  const requiredStores = [...BUSINESS_CRITICAL_INDEXEDDB_STORES].sort();
  if (JSON.stringify(fixtureStores) !== JSON.stringify(requiredStores)) {
    throw new Error("Rehearsal fixtures do not cover the complete business-critical store inventory.");
  }
}

async function runBrowserRehearsal(page) {
  return await page.evaluate(
    async ({ sourceDbName, targetDbName, liveDbName, stores, fixtures }) => {
      const getDatabaseNames = async () => {
        if (typeof indexedDB.databases !== "function") return [];
        return (await indexedDB.databases()).map((entry) => entry.name).filter(Boolean);
      };

      const deleteDatabase = (name) => new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error(`Could not delete ${name}`));
        request.onblocked = () => reject(new Error(`Delete blocked for ${name}`));
      });

      const openDatabase = (name) => new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          for (const storeName of stores) {
            if (!db.objectStoreNames.contains(storeName)) {
              db.createObjectStore(storeName, { keyPath: "id", autoIncrement: true });
            }
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error(`Could not open ${name}`));
      });

      const transactionDone = (tx) => new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      });

      const requestResult = (request) => new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
      });

      const insertFixtures = async (db, rowsByStore) => {
        for (const storeName of stores) {
          const tx = db.transaction(storeName, "readwrite");
          const done = transactionDone(tx);
          const store = tx.objectStore(storeName);
          for (const row of rowsByStore[storeName]) store.put(structuredClone(row));
          await done;
        }
      };

      const exportDatabase = async (db) => {
        const exportedStores = {};
        const storeCounts = {};
        for (const storeName of stores) {
          const tx = db.transaction(storeName, "readonly");
          const done = transactionDone(tx);
          const rows = await requestResult(tx.objectStore(storeName).getAll());
          await done;
          exportedStores[storeName] = rows;
          storeCounts[storeName] = rows.length;
        }
        return {
          format: "jawad-bro-indexeddb-backup",
          formatVersion: 1,
          metadata: {
            exportedAt: new Date().toISOString(),
            dbName: db.name,
            dbVersion: db.version,
            rehearsalOnly: true,
            replayTriggered: false,
            backendMutated: false,
          },
          storeCounts,
          stores: exportedStores,
        };
      };

      const validateEnvelope = (backup) => {
        const missingStores = stores.filter((storeName) => !Array.isArray(backup.stores?.[storeName]));
        const countMismatches = stores.filter(
          (storeName) => backup.stores?.[storeName]?.length !== backup.storeCounts?.[storeName]
        );
        if (backup.format !== "jawad-bro-indexeddb-backup" || backup.formatVersion !== 1) {
          throw new Error("Unsupported backup contract.");
        }
        if (missingStores.length || countMismatches.length) {
          throw new Error(`Backup validation failed: missing=${missingStores.join(",")} mismatched=${countMismatches.join(",")}`);
        }
      };

      const restoreDatabase = async (db, backup) => {
        validateEnvelope(backup);
        for (const storeName of stores) {
          const tx = db.transaction(storeName, "readwrite");
          const done = transactionDone(tx);
          const store = tx.objectStore(storeName);
          for (const row of backup.stores[storeName]) store.put(structuredClone(row));
          await done;
        }
      };

      const readAll = async (db, storeName) => {
        const tx = db.transaction(storeName, "readonly");
        const done = transactionDone(tx);
        const rows = await requestResult(tx.objectStore(storeName).getAll());
        await done;
        return rows;
      };

      const beforeDatabases = await getDatabaseNames();
      if (beforeDatabases.includes(liveDbName)) {
        throw new Error("Temporary rehearsal origin unexpectedly contains the live POS database.");
      }

      let sourceDb;
      let targetDb;
      try {
        sourceDb = await openDatabase(sourceDbName);
        await insertFixtures(sourceDb, fixtures);
        const backup = await exportDatabase(sourceDb);

        const invalidBackup = structuredClone(backup);
        delete invalidBackup.stores.sale_items;
        let invalidBackupRejected = false;
        try {
          validateEnvelope(invalidBackup);
        } catch {
          invalidBackupRejected = true;
        }

        targetDb = await openDatabase(targetDbName);
        await restoreDatabase(targetDb, backup);

        const restored = {};
        const restoredCounts = {};
        for (const storeName of stores) {
          restored[storeName] = await readAll(targetDb, storeName);
          restoredCounts[storeName] = restored[storeName].length;
        }

        const countsMatch = stores.every(
          (storeName) => restoredCounts[storeName] === backup.storeCounts[storeName]
        );
        const sale = restored.sales.find((row) => row.id === 401);
        const saleItem = restored.sale_items.find((row) => row.id === 501);
        const held = restored.held.find((row) => row.id === 601);
        const heldItem = restored.held_items.find((row) => row.id === 701);
        const item = restored.items.find((row) => row.id === 301);
        const batch = restored.item_batches.find((row) => row.id === 801);
        const cylinder = restored.cylinders.find((row) => row.id === 901);
        const cylinderCustomer = restored.cylinder_customers.find((row) => row.id === 1001);
        const queueRow = restored.sync_queue.find((row) => row.id === 1101);

        return {
          beforeDatabases,
          backupStoreCounts: backup.storeCounts,
          restoredCounts,
          checks: {
            invalidBackupRejected,
            countsMatch,
            saleItemsRelationshipValid: saleItem?.saleId === sale?.id,
            heldItemsRelationshipValid: heldItem?.heldId === held?.id,
            itemBatchRelationshipValid: batch?.itemId === item?.id,
            cylinderItemRelationshipValid: cylinder?.itemId === item?.id,
            cylinderHoldingRelationshipValid: cylinderCustomer?.cylinderId === cylinder?.id,
            customerPaymentRelationshipValid: restored.customer_payments[0]?.customerId === restored.customers[0]?.id,
            supplierPaymentRelationshipValid: restored.supplier_payments[0]?.supplierId === restored.suppliers[0]?.id,
            queueFailureStatePreserved: queueRow?.status === "failed" && queueRow?.id === 1101,
            idsPreserved: sale?.id === 401 && item?.id === 301 && batch?.id === 801,
          },
        };
      } finally {
        sourceDb?.close();
        targetDb?.close();
        await deleteDatabase(sourceDbName);
        await deleteDatabase(targetDbName);
      }
    },
    {
      sourceDbName,
      targetDbName,
      liveDbName: LIVE_DB_NAME,
      stores: BUSINESS_CRITICAL_INDEXEDDB_STORES,
      fixtures,
    }
  );
}

assertFixtureCoverage();
const { server, url } = await startOrigin();
const browser = await chromium.launch({ headless: true });
let externalRequests = 0;

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("request", (request) => {
    if (!request.url().startsWith(url)) externalRequests += 1;
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const rehearsal = await runBrowserRehearsal(page);
  const remainingDatabases = await page.evaluate(async () =>
    typeof indexedDB.databases === "function"
      ? (await indexedDB.databases()).map((entry) => entry.name).filter(Boolean)
      : []
  );

  const checks = {
    ...rehearsal.checks,
    livePOSDatabaseUntouched:
      !rehearsal.beforeDatabases.includes(LIVE_DB_NAME) &&
      !remainingDatabases.includes(LIVE_DB_NAME),
    temporaryDatabasesRemoved:
      !remainingDatabases.includes(sourceDbName) &&
      !remainingDatabases.includes(targetDbName),
    mysqlUntouched: externalRequests === 0,
    replayNotTriggered: true,
  };
  const result = {
    ok: Object.values(checks).every(Boolean),
    rehearsalOnly: true,
    generatedAt: new Date().toISOString(),
    temporaryOrigin: new URL(url).origin,
    sourceDatabase: sourceDbName,
    targetDatabase: targetDbName,
    liveDatabaseName: LIVE_DB_NAME,
    storeCounts: rehearsal.restoredCounts,
    checks,
    livePOSDatabaseUntouched: checks.livePOSDatabaseUntouched,
    mysqlUntouched: checks.mysqlUntouched,
    replayTriggered: false,
    autoSyncEnabled: false,
    productionRestoreImplemented: false,
    warning: "This proves an isolated structural round-trip only. It does not restore the live POSDatabase and is not a production restore command.",
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
  await context.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
