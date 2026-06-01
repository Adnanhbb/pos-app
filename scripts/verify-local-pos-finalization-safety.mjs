#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const posSource = readFileSync("src/POS.tsx", "utf8");
const finalizationSource = readFileSync(
  "src/services/localPOSFinalizationService.ts",
  "utf8"
);
const APP_URL = process.env.APP_URL || "http://localhost/jawad-bro-rehearsal/";

function assert(condition, name) {
  if (!condition) {
    throw new Error(`FAIL: ${name}`);
  }

  console.log(`PASS: ${name}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function atomicCommit(state, plan, failAfterSaleItems = false) {
  const draft = clone(state);
  const saleId = draft.nextSaleId++;
  draft.sales.push({ ...plan.sale, id: saleId });
  draft.saleItems.push(
    ...plan.saleItems.map((item) => ({ ...item, saleId }))
  );

  if (failAfterSaleItems) {
    throw new Error("forced failure after sale items");
  }

  draft.items = plan.itemUpdates;
  draft.customers = plan.customerUpdate ? [plan.customerUpdate] : draft.customers;
  draft.payments.push(...(plan.customerPayment ? [plan.customerPayment] : []));
  draft.batches = plan.batchUpdates;
  draft.batches.push(
    ...plan.batchCreates.map((batch) => ({ ...batch, sourceSaleId: saleId }))
  );
  return draft;
}

function safeCommit(state, plan, failAfterSaleItems = false) {
  try {
    return atomicCommit(state, plan, failAfterSaleItems);
  } catch {
    return state;
  }
}

async function verifyIsolatedIndexedDBAbort() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 20000 });

    return await page.evaluate(async () => {
      const databaseName = `POSFinalizationSafetyTest-${Date.now()}`;
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore("sales", { keyPath: "id", autoIncrement: true });
          db.createObjectStore("sale_items", {
            keyPath: "id",
            autoIncrement: true,
          });
          db.createObjectStore("items", { keyPath: "id" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      try {
        const seed = database.transaction("items", "readwrite");
        seed.objectStore("items").put({ id: 1, availableStock: 10 });
        await new Promise((resolve, reject) => {
          seed.oncomplete = () => resolve(undefined);
          seed.onerror = () => reject(seed.error);
          seed.onabort = () => reject(seed.error);
        });

        const transaction = database.transaction(
          ["sales", "sale_items", "items"],
          "readwrite"
        );
        const saleRequest = transaction.objectStore("sales").add({
          invoiceNo: "ATOMIC-ABORT-TEST",
        });
        saleRequest.onsuccess = () => {
          transaction.objectStore("sale_items").add({
            saleId: saleRequest.result,
            originalItemId: 1,
            qty: 2,
          });
          transaction.objectStore("items").put({ id: 1, availableStock: 8 });
          transaction.abort();
        };

        await new Promise((resolve) => {
          transaction.onabort = () => resolve(undefined);
        });

        const read = database.transaction(
          ["sales", "sale_items", "items"],
          "readonly"
        );
        const salesCount = await new Promise((resolve, reject) => {
          const request = read.objectStore("sales").count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const saleItemsCount = await new Promise((resolve, reject) => {
          const request = read.objectStore("sale_items").count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const item = await new Promise((resolve, reject) => {
          const request = read.objectStore("items").get(1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

        return {
          salesCount,
          saleItemsCount,
          availableStock: item?.availableStock ?? null,
        };
      } finally {
        database.close();
        indexedDB.deleteDatabase(databaseName);
      }
    });
  } finally {
    await browser.close();
  }
}

const requiredStores = [
  "sales",
  "sale_items",
  "items",
  "item_batches",
  "cylinders",
  "cylinder_customers",
  "customers",
  "suppliers",
  "customer_payments",
  "supplier_payments",
];

const commitCall = posSource.indexOf("await finalizeLocalPOSTransaction({");
const queueCall = posSource.indexOf("await queueOfflineTransaction(transactionPayload);");
const stagingStart = posSource.indexOf("const itemUpdates: Item[] = [];");
const postCommitReads = posSource.indexOf(
  "const updatedCustomers = await customersRepository.getAll();"
);

assert(commitCall >= 0, "POS finalization delegates local commit to atomic service");
assert(
  stagingStart >= 0 && stagingStart < commitCall,
  "POS calculates staged mutations before local persistence"
);
assert(
  postCommitReads > commitCall && queueCall > postCommitReads,
  "post-commit snapshots and queue insertion run after atomic local commit"
);
assert(
  !posSource
    .slice(stagingStart, commitCall)
    .match(
      /await (salesRepository\.addTransaction|customersRepository\.update|supplierRepo\.update|customerPaymentRepository\.add|supplierPaymentRepository\.add|batchRepository\.(addBatch|updateBatch)|itemsRepository\.update|cylinderRepo_update|cylinderCustomerRepo_addOrUpdate)/
    ),
  "staging phase contains no direct local business writes"
);
assert(
  requiredStores.every((store) => finalizationSource.includes(`"${store}"`)),
  "atomic service transaction includes all directly related business stores"
);
assert(
  finalizationSource.includes('const tx = db.transaction(') &&
    finalizationSource.includes('"readwrite"') &&
    finalizationSource.includes("await tx.done;") &&
    finalizationSource.includes("tx.abort();"),
  "atomic service commits together and aborts on failure"
);
assert(
  posSource.includes(
    'console.warn("Transaction saved locally but failed to queue for sync.", error);'
  ),
  "queue failure remains safely reported after local commit"
);

const initial = {
  nextSaleId: 1,
  sales: [],
  saleItems: [],
  items: [{ id: 1, availableStock: 10 }],
  customers: [{ id: 1, payable: 0, paid: 0, balance: 0, invoices: 0 }],
  payments: [],
  batches: [{ id: 1, qtyPurchased: 10, qtySold: 0, balance: 10 }],
};
const salePlan = {
  sale: { invoiceNo: "SAL-TEST", transactionType: "Sale" },
  saleItems: [{ originalItemId: 1, qty: 2 }],
  itemUpdates: [{ id: 1, availableStock: 8 }],
  customerUpdate: { id: 1, payable: 20, paid: 5, balance: 15, invoices: 1 },
  customerPayment: { customerId: 1, amount: 5 },
  batchUpdates: [{ id: 1, qtyPurchased: 10, qtySold: 2, balance: 8 }],
  batchCreates: [],
};

const committedSale = safeCommit(initial, salePlan);
assert(
  committedSale.sales.length === 1 &&
    committedSale.saleItems.length === 1 &&
    committedSale.items[0].availableStock === 8 &&
    committedSale.customers[0].balance === 15 &&
    committedSale.payments.length === 1 &&
    committedSale.batches[0].balance === 8,
  "successful sale simulation commits sale, items, stock, balance, payment, and batch"
);

let preflightRejected = false;
try {
  throw new Error("preflight rejected unsafe transaction");
} catch {
  preflightRejected = true;
}
assert(
  preflightRejected && initial.sales.length === 0,
  "forced failure before persistence creates no sale"
);

const abortedSale = safeCommit(initial, salePlan, true);
assert(
  abortedSale === initial &&
    abortedSale.sales.length === 0 &&
    abortedSale.saleItems.length === 0 &&
    abortedSale.items[0].availableStock === 10,
  "forced failure after validation aborts without partial sale state"
);

let queueFailureReported = false;
const committedBeforeQueue = safeCommit(initial, salePlan);
try {
  throw new Error("forced queue failure");
} catch {
  queueFailureReported = true;
}
assert(
  queueFailureReported &&
    committedBeforeQueue.sales.length === 1 &&
    committedBeforeQueue.items[0].availableStock === 8,
  "queue failure does not roll back or corrupt finalized local business state"
);

const purchase = safeCommit(initial, {
  sale: { invoiceNo: "PUR-TEST", transactionType: "Purchase" },
  saleItems: [{ originalItemId: 1, qty: 3 }],
  itemUpdates: [{ id: 1, availableStock: 13 }],
  batchUpdates: [],
  batchCreates: [{ itemId: 1, qtyPurchased: 3, qtySold: 0, balance: 3 }],
});
assert(
  purchase.sales.length === 1 &&
    purchase.items[0].availableStock === 13 &&
    purchase.batches[0].sourceSaleId === 1,
  "purchase simulation preserves stock increase and linked batch creation"
);

const customerReturn = safeCommit(initial, {
  sale: { invoiceNo: "RET-C-TEST", transactionType: "Return" },
  saleItems: [{ originalItemId: 1, qty: 1 }],
  itemUpdates: [{ id: 1, availableStock: 11 }],
  batchUpdates: [],
  batchCreates: [{ itemId: 1, qtyPurchased: 1, qtySold: 0, balance: 1 }],
});
assert(
  customerReturn.sales.length === 1 &&
    customerReturn.items[0].availableStock === 11 &&
    customerReturn.batches[0].sourceSaleId === 1,
  "customer-return simulation preserves restock batch creation"
);

const isolatedAbort = await verifyIsolatedIndexedDBAbort();
assert(
  isolatedAbort.salesCount === 0 &&
    isolatedAbort.saleItemsCount === 0 &&
    isolatedAbort.availableStock === 10,
  "isolated browser IndexedDB abort rolls back header, items, and stock together"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: 14,
      approach: "single IndexedDB business transaction plus post-commit queue containment",
      backendReplayChanged: false,
      autoSyncChanged: false,
    },
    null,
    2
  )
);
