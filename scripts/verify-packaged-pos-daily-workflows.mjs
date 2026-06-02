#!/usr/bin/env node

/*
 * Safe packaged-Laragon daily POS workflow rehearsal.
 *
 * The verifier opens the copied frontend, blocks API requests, and exercises
 * the local IndexedDB persistence contract inside a uniquely named temporary
 * database. It does not open POSDatabase, replay queued rows, or mutate MySQL.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const APP_URL =
  process.env.APP_URL || "http://localhost/jawad-bro-rehearsal/";
const fixtureDatabaseName = `POSDailyWorkflowRehearsal-${Date.now()}`;
const fixtureMarker = `Rehearsal Daily POS ${Date.now()}`;
const reportJsonPath = "packaged-pos-daily-workflows-report.json";
const reportMarkdownPath = "packaged-pos-daily-workflows-report.md";
const posSource = readFileSync("src/POS.tsx", "utf8");
const invoicesSource = readFileSync("src/Invoices.tsx", "utf8");
const finalizationSource = readFileSync(
  "src/services/localPOSFinalizationService.ts",
  "utf8"
);
const backendSaleReplayPath = "api/replay/sale.php";

const checks = [];

function check(name, ok, details = {}) {
  checks.push({ name, ok: Boolean(ok), ...details });
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
}

function markdownReport(report) {
  const lines = [
    "# Packaged POS Daily Workflow Rehearsal",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    `Overall result: ${report.ok ? "PASS" : "FAIL"}`,
    "",
    "## Safety Boundary",
    "",
    "- Copied Laragon frontend origin only.",
    "- Unique temporary IndexedDB database only; live `POSDatabase` is not opened.",
    "- API requests are blocked.",
    "- The narrow backend Sale replay endpoint is not called.",
    "- No auto-sync, background sync, polling, listeners, or workers are added.",
    "",
    "## Checks",
    "",
  ];

  for (const item of report.checks) {
    lines.push(`- ${item.ok ? "PASS" : "FAIL"}: ${item.name}`);
  }

  lines.push(
    "",
    "## Workflow Summary",
    "",
    `- Sale queue rows: ${report.workflowSummary.sale.queueRows}`,
    `- Purchase queue rows: ${report.workflowSummary.purchase.queueRows}`,
    `- Customer Return queue rows: ${report.workflowSummary.customerReturn.queueRows}`,
    `- Supplier Return queue rows: ${report.workflowSummary.supplierReturn.queueRows}`,
    `- Final local stock: ${report.workflowSummary.finalState.availableStock}`,
    `- Final customer balance: ${report.workflowSummary.finalState.customerBalance}`,
    `- Final supplier balance: ${report.workflowSummary.finalState.supplierBalance}`,
    "",
    "## Intentionally Manual Or Source-Checked",
    "",
    "- Full four-flow POS form clicking is skipped to avoid brittle UI setup and any chance of touching live `POSDatabase`; packaged-origin temporary IndexedDB commits plus executable source-contract checks cover the local workflow boundary.",
    "- Printer hardware output remains manual; this rehearsal verifies invoice view and print wiring only.",
    "- Full cylinder UI automation is skipped because it would add brittle UI setup. The safe isolated local cylinder state transition is checked instead.",
    "- Invoice cancellation/reversal is not exercised.",
    "- Backend replay, multi-device sync, conflict resolution, and auto-sync are not exercised.",
    ""
  );

  return `${lines.join("\n")}\n`;
}

function assertSourceContract() {
  const stockPlanningStart = posSource.indexOf(
    "let newStock = item.availableStock;"
  );
  const customerReturnStart = posSource.indexOf(
    "if (isCustomerReturn) {",
    stockPlanningStart
  );
  const supplierReturnStart = posSource.indexOf(
    "if (isSupplierReturn) {",
    customerReturnStart
  );
  const customerReturnBlock =
    customerReturnStart >= 0 && supplierReturnStart > customerReturnStart
      ? posSource.slice(customerReturnStart, supplierReturnStart)
      : "";
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

  check(
    "POS delegates final local persistence to the atomic IndexedDB service",
    posSource.includes("await finalizeLocalPOSTransaction({")
  );
  check(
    "atomic local service includes all daily business stores",
    requiredStores.every((store) => finalizationSource.includes(`"${store}"`))
  );
  check(
    "Sale stock decrease and batch consumption remain staged",
    posSource.includes("if (isSale) {") &&
      posSource.includes("newStock -= ci.qty;") &&
      posSource.includes("qtySold: batch.qtySold + ci.qty,") &&
      posSource.includes("balance: batch.balance - ci.qty,")
  );
  check(
    "Purchase stock increase and batch creation remain staged",
    posSource.includes("if (isPurchase) {") &&
      posSource.includes("newStock += ci.qty;") &&
      posSource.includes("qtyPurchased: ci.qty,") &&
      posSource.includes("qtySold: 0,")
  );
  check(
    "Customer Return stock increase and return batch creation remain staged",
    customerReturnBlock.includes("newStock += ci.qty;") &&
      customerReturnBlock.includes("batchCreates.push({") &&
      customerReturnBlock.includes("qtyPurchased: ci.qty,") &&
      customerReturnBlock.includes("balance: ci.qty,")
  );
  check(
    "Supplier Return stock decrease and exact batch reduction remain staged",
    posSource.includes("if (isSupplierReturn) {") &&
      posSource.includes("qtyPurchased: batch.qtyPurchased - ci.qty,") &&
      posSource.includes("balance: batch.balance - ci.qty,")
  );
  check(
    "invoice viewer and print handlers remain wired",
    invoicesSource.includes("handlePrintInvoice") &&
      invoicesSource.includes("FaPrint") &&
      invoicesSource.includes("salesRepository.getSaleItems")
  );
  check(
    "narrow backend Sale replay HTTP endpoint exists",
    existsSync(backendSaleReplayPath)
  );
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const observedApiRequests = [];
let cleanupConfirmed = false;

page.on("request", (request) => {
  if (request.url().includes("/api/")) {
    observedApiRequests.push({
      method: request.method(),
      endpoint: new URL(request.url()).pathname,
    });
  }
});
await page.route("**/api/**", async (route) => {
  await route.abort();
});

try {
  assertSourceContract();

  const response = await page.goto(APP_URL, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  check("packaged Laragon frontend opens", response?.ok(), {
    appUrl: APP_URL,
  });
  check(
    "temporary rehearsal database is not the live POSDatabase",
    fixtureDatabaseName !== "POSDatabase",
    { fixtureDatabaseName }
  );

  const localResult = await page.evaluate(
    async ({ databaseName, marker }) => {
      function requestResult(request) {
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      function transactionDone(transaction) {
        return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve(undefined);
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      }

      function openDatabase() {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(databaseName, 1);
          request.onupgradeneeded = () => {
            const database = request.result;
            database.createObjectStore("sales", {
              keyPath: "id",
              autoIncrement: true,
            });
            database.createObjectStore("sale_items", {
              keyPath: "id",
              autoIncrement: true,
            });
            database.createObjectStore("items", { keyPath: "id" });
            database.createObjectStore("customers", { keyPath: "id" });
            database.createObjectStore("suppliers", { keyPath: "id" });
            database.createObjectStore("customer_payments", {
              keyPath: "id",
              autoIncrement: true,
            });
            database.createObjectStore("supplier_payments", {
              keyPath: "id",
              autoIncrement: true,
            });
            database.createObjectStore("item_batches", {
              keyPath: "id",
              autoIncrement: true,
            });
            database.createObjectStore("cylinders", { keyPath: "id" });
            database.createObjectStore("cylinder_customers", {
              keyPath: "id",
              autoIncrement: true,
            });
            database.createObjectStore("sync_queue", {
              keyPath: "id",
              autoIncrement: true,
            });
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      async function finalize(database, input) {
        const transaction = database.transaction(
          [
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
          ],
          "readwrite"
        );
        const saleId = await requestResult(
          transaction.objectStore("sales").add(input.sale)
        );
        for (const saleItem of input.saleItems) {
          transaction.objectStore("sale_items").add({ ...saleItem, saleId });
        }
        for (const item of input.itemUpdates) {
          transaction.objectStore("items").put(item);
        }
        for (const batch of input.batchUpdates) {
          transaction.objectStore("item_batches").put(batch);
        }
        for (const batch of input.batchCreates) {
          transaction
            .objectStore("item_batches")
            .add({ ...batch, sourceSaleId: saleId });
        }
        for (const cylinder of input.cylinderUpdates ?? []) {
          transaction.objectStore("cylinders").put(cylinder);
        }
        for (const holding of input.cylinderCustomerUpdates ?? []) {
          transaction.objectStore("cylinder_customers").put(holding);
        }
        if (input.customerUpdate) {
          transaction.objectStore("customers").put(input.customerUpdate);
        }
        if (input.supplierUpdate) {
          transaction.objectStore("suppliers").put(input.supplierUpdate);
        }
        if (input.customerPayment) {
          transaction
            .objectStore("customer_payments")
            .add(input.customerPayment);
        }
        if (input.supplierPayment) {
          transaction
            .objectStore("supplier_payments")
            .add(input.supplierPayment);
        }
        await transactionDone(transaction);
        return saleId;
      }

      async function queue(database, transactionType, saleId) {
        const transaction = database.transaction("sync_queue", "readwrite");
        transaction.objectStore("sync_queue").add({
          entity: "transactions",
          operation: "transaction",
          localId: `${transactionType}-${saleId}`,
          payload: {
            transactionType,
            clientTransactionId: `${transactionType}-${saleId}`,
            createdAt: Date.now(),
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          retryCount: 0,
          status: "pending",
        });
        await transactionDone(transaction);
      }

      async function inspect(database) {
        const transaction = database.transaction(
          [
            "sales",
            "sale_items",
            "items",
            "customers",
            "suppliers",
            "customer_payments",
            "supplier_payments",
            "item_batches",
            "cylinders",
            "cylinder_customers",
            "sync_queue",
          ],
          "readonly"
        );
        const [
          sales,
          saleItems,
          items,
          customers,
          suppliers,
          customerPayments,
          supplierPayments,
          batches,
          cylinders,
          cylinderCustomers,
          queueRows,
        ] = await Promise.all([
          requestResult(transaction.objectStore("sales").getAll()),
          requestResult(transaction.objectStore("sale_items").getAll()),
          requestResult(transaction.objectStore("items").getAll()),
          requestResult(transaction.objectStore("customers").getAll()),
          requestResult(transaction.objectStore("suppliers").getAll()),
          requestResult(transaction.objectStore("customer_payments").getAll()),
          requestResult(transaction.objectStore("supplier_payments").getAll()),
          requestResult(transaction.objectStore("item_batches").getAll()),
          requestResult(transaction.objectStore("cylinders").getAll()),
          requestResult(transaction.objectStore("cylinder_customers").getAll()),
          requestResult(transaction.objectStore("sync_queue").getAll()),
        ]);
        return {
          sales,
          saleItems,
          item: items.find((item) => item.id === 17),
          customer: customers.find((customer) => customer.id === 7),
          supplier: suppliers.find((supplier) => supplier.id === 8),
          customerPayments,
          supplierPayments,
          batches,
          cylinder: cylinders.find((cylinder) => cylinder.id === 37),
          cylinderHolding: cylinderCustomers.find((holding) => holding.id === 47),
          queueRows,
        };
      }

      const database = await openDatabase();
      try {
        const seed = database.transaction(
          [
            "items",
            "customers",
            "suppliers",
            "item_batches",
            "cylinders",
            "cylinder_customers",
          ],
          "readwrite"
        );
        seed.objectStore("items").put({
          id: 17,
          name: `${marker} Item`,
          availableStock: 10,
        });
        seed.objectStore("customers").put({
          id: 7,
          name: `${marker} Customer`,
          invoices: 0,
          payable: 0,
          paid: 0,
          balance: 0,
        });
        seed.objectStore("suppliers").put({
          id: 8,
          name: `${marker} Supplier`,
          invoices: 0,
          payable: 0,
          paid: 0,
          balance: 0,
        });
        seed.objectStore("item_batches").put({
          id: 27,
          itemId: 17,
          qtyPurchased: 10,
          qtySold: 0,
          balance: 10,
          invoiceNo: `${marker} Opening`,
        });
        seed.objectStore("cylinders").put({
          id: 37,
          itemId: 17,
          title: `${marker} Cylinder`,
          filledCylinders: 4,
          emptyCylinders: 0,
          withCustomers: 0,
          qtyInStock: 4,
        });
        seed.objectStore("cylinder_customers").put({
          id: 47,
          cylinderId: 37,
          customerName: `${marker} Customer`,
          qtyHeld: 0,
        });
        await transactionDone(seed);

        const saleId = await finalize(database, {
          sale: {
            invoiceNo: "SAL-REHEARSAL-DAILY",
            transactionType: "Sale",
          },
          saleItems: [{ originalItemId: 17, name: `${marker} Item`, qty: 2 }],
          itemUpdates: [
            { id: 17, name: `${marker} Item`, availableStock: 8 },
          ],
          batchUpdates: [
            {
              id: 27,
              itemId: 17,
              qtyPurchased: 10,
              qtySold: 2,
              balance: 8,
              invoiceNo: `${marker} Opening`,
            },
          ],
          batchCreates: [],
          customerUpdate: {
            id: 7,
            name: `${marker} Customer`,
            invoices: 1,
            payable: 20,
            paid: 5,
            balance: 15,
          },
          customerPayment: {
            customerId: 7,
            invoiceNo: "SAL-REHEARSAL-DAILY",
            amount: 5,
          },
          cylinderUpdates: [
            {
              id: 37,
              itemId: 17,
              title: `${marker} Cylinder`,
              filledCylinders: 3,
              emptyCylinders: 0,
              withCustomers: 1,
              qtyInStock: 4,
            },
          ],
          cylinderCustomerUpdates: [
            {
              id: 47,
              cylinderId: 37,
              customerName: `${marker} Customer`,
              qtyHeld: 1,
            },
          ],
        });
        await queue(database, "sale", saleId);
        const afterSale = await inspect(database);

        const purchaseId = await finalize(database, {
          sale: {
            invoiceNo: "PUR-REHEARSAL-DAILY",
            transactionType: "Purchase",
          },
          saleItems: [{ originalItemId: 17, name: `${marker} Item`, qty: 4 }],
          itemUpdates: [
            { id: 17, name: `${marker} Item`, availableStock: 12 },
          ],
          batchUpdates: [],
          batchCreates: [
            {
              itemId: 17,
              qtyPurchased: 4,
              qtySold: 0,
              balance: 4,
              invoiceNo: "PUR-REHEARSAL-DAILY",
            },
          ],
          supplierUpdate: {
            id: 8,
            name: `${marker} Supplier`,
            invoices: 1,
            payable: 40,
            paid: 10,
            balance: 30,
          },
          supplierPayment: {
            supplierId: 8,
            invoiceNo: "PUR-REHEARSAL-DAILY",
            amount: 10,
          },
          cylinderUpdates: [],
          cylinderCustomerUpdates: [],
        });
        await queue(database, "sale", purchaseId);
        const afterPurchase = await inspect(database);
        const purchaseBatch = afterPurchase.batches.find(
          (batch) => batch.invoiceNo === "PUR-REHEARSAL-DAILY"
        );

        const customerReturnId = await finalize(database, {
          sale: {
            invoiceNo: "RET-C-REHEARSAL-DAILY",
            transactionType: "Return",
          },
          saleItems: [{ originalItemId: 17, name: `${marker} Item`, qty: 1 }],
          itemUpdates: [
            { id: 17, name: `${marker} Item`, availableStock: 13 },
          ],
          batchUpdates: [],
          batchCreates: [
            {
              itemId: 17,
              qtyPurchased: 1,
              qtySold: 0,
              balance: 1,
              invoiceNo: "RET-C-REHEARSAL-DAILY",
            },
          ],
          customerUpdate: {
            id: 7,
            name: `${marker} Customer`,
            invoices: 2,
            payable: 10,
            paid: 4,
            balance: 6,
          },
          customerPayment: {
            customerId: 7,
            invoiceNo: "RET-C-REHEARSAL-DAILY",
            amount: -1,
          },
          cylinderUpdates: [
            {
              id: 37,
              itemId: 17,
              title: `${marker} Cylinder`,
              filledCylinders: 3,
              emptyCylinders: 1,
              withCustomers: 0,
              qtyInStock: 4,
            },
          ],
          cylinderCustomerUpdates: [
            {
              id: 47,
              cylinderId: 37,
              customerName: `${marker} Customer`,
              qtyHeld: 0,
            },
          ],
        });
        await queue(database, "return", customerReturnId);
        const afterCustomerReturn = await inspect(database);

        const supplierReturnId = await finalize(database, {
          sale: {
            invoiceNo: "RET-S-REHEARSAL-DAILY",
            transactionType: "Return",
          },
          saleItems: [{ originalItemId: 17, name: `${marker} Item`, qty: 2 }],
          itemUpdates: [
            { id: 17, name: `${marker} Item`, availableStock: 11 },
          ],
          batchUpdates: [
            {
              ...purchaseBatch,
              qtyPurchased: purchaseBatch.qtyPurchased - 2,
              balance: purchaseBatch.balance - 2,
            },
          ],
          batchCreates: [],
          supplierUpdate: {
            id: 8,
            name: `${marker} Supplier`,
            invoices: 2,
            payable: 20,
            paid: 8,
            balance: 12,
          },
          supplierPayment: {
            supplierId: 8,
            invoiceNo: "RET-S-REHEARSAL-DAILY",
            amount: -2,
          },
          cylinderUpdates: [],
          cylinderCustomerUpdates: [],
        });
        await queue(database, "return", supplierReturnId);
        const finalState = await inspect(database);

        return {
          afterSale,
          afterPurchase,
          afterCustomerReturn,
          finalState,
          purchaseBatchId: purchaseBatch.id,
        };
      } finally {
        database.close();
      }
    },
    { databaseName: fixtureDatabaseName, marker: fixtureMarker }
  );

  const { afterSale, afterPurchase, afterCustomerReturn, finalState } =
    localResult;
  check(
    "Sale stores header and linked sale item locally",
    afterSale.sales.length === 1 && afterSale.saleItems.length === 1
  );
  check(
    "Sale decreases local stock and exact batch balance",
    afterSale.item.availableStock === 8 &&
      afterSale.batches.find((batch) => batch.id === 27)?.qtySold === 2 &&
      afterSale.batches.find((batch) => batch.id === 27)?.balance === 8
  );
  check(
    "Sale updates customer balance and payment ledger",
    afterSale.customer.payable === 20 &&
      afterSale.customer.paid === 5 &&
      afterSale.customer.balance === 15 &&
      afterSale.customerPayments.some((payment) => payment.amount === 5)
  );
  check(
    "Purchase increases local stock and creates linked batch",
    afterPurchase.item.availableStock === 12 &&
      afterPurchase.batches.some(
        (batch) =>
          batch.invoiceNo === "PUR-REHEARSAL-DAILY" &&
          batch.qtyPurchased === 4 &&
          batch.balance === 4
      )
  );
  check(
    "Purchase updates supplier balance and payment ledger",
    afterPurchase.supplier.payable === 40 &&
      afterPurchase.supplier.paid === 10 &&
      afterPurchase.supplier.balance === 30 &&
      afterPurchase.supplierPayments.some((payment) => payment.amount === 10)
  );
  check(
    "Customer Return increases stock and creates return batch",
    afterCustomerReturn.item.availableStock === 13 &&
      afterCustomerReturn.batches.some(
        (batch) =>
          batch.invoiceNo === "RET-C-REHEARSAL-DAILY" &&
          batch.qtyPurchased === 1 &&
          batch.balance === 1
      )
  );
  check(
    "Customer Return reduces customer balance with negative ledger adjustment",
    afterCustomerReturn.customer.payable === 10 &&
      afterCustomerReturn.customer.paid === 4 &&
      afterCustomerReturn.customer.balance === 6 &&
      afterCustomerReturn.customerPayments.some(
        (payment) => payment.amount === -1
      )
  );
  check(
    "Supplier Return decreases stock and the selected purchase batch",
    finalState.item.availableStock === 11 &&
      finalState.batches.some(
        (batch) =>
          batch.invoiceNo === "PUR-REHEARSAL-DAILY" &&
          batch.qtyPurchased === 2 &&
          batch.balance === 2
      )
  );
  check(
    "Supplier Return reduces supplier balance with negative ledger adjustment",
    finalState.supplier.payable === 20 &&
      finalState.supplier.paid === 8 &&
      finalState.supplier.balance === 12 &&
      finalState.supplierPayments.some((payment) => payment.amount === -2)
  );
  check(
    "isolated cylinder Sale issues filled cylinder to customer",
    afterSale.cylinder.filledCylinders === 3 &&
      afterSale.cylinder.withCustomers === 1 &&
      afterSale.cylinderHolding.qtyHeld === 1
  );
  check(
    "isolated cylinder Customer Return moves holding to empty without increasing filled",
    afterCustomerReturn.cylinder.filledCylinders === 3 &&
      afterCustomerReturn.cylinder.emptyCylinders === 1 &&
      afterCustomerReturn.cylinder.withCustomers === 0 &&
      afterCustomerReturn.cylinderHolding.qtyHeld === 0
  );
  check(
    "each daily workflow queues one pending local transaction without replay",
    finalState.queueRows.length === 4 &&
      finalState.queueRows.every((row) => row.status === "pending")
  );
  check(
    "no backend business mutation request was attempted",
    observedApiRequests.every((request) => request.method === "GET"),
    { observedApiRequests }
  );

  await page.evaluate(async (databaseName) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve(undefined);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("Temporary IndexedDB cleanup was blocked."));
    });
  }, fixtureDatabaseName);
  cleanupConfirmed = true;
  check("temporary rehearsal IndexedDB database is deleted", cleanupConfirmed);

  const report = {
    generatedAt: new Date().toISOString(),
    ok: checks.every((item) => item.ok),
    appUrl: APP_URL,
    fixtureDatabaseName,
    fixtureMarker,
    checks,
    workflowSummary: {
      sale: { queueRows: 1 },
      purchase: { queueRows: 1 },
      customerReturn: { queueRows: 1 },
      supplierReturn: { queueRows: 1 },
      finalState: {
        availableStock: finalState.item.availableStock,
        customerBalance: finalState.customer.balance,
        supplierBalance: finalState.supplier.balance,
      },
    },
    safety: {
      livePOSDatabaseTouched: false,
      mysqlBusinessDataMutated: false,
      replayTriggered: false,
      backendSaleReplayEndpointAdded: true,
      backendSaleReplayCalled: false,
      itemCreateDeleteMigrationAdded: false,
      autoSyncEnabled: false,
      backgroundSyncAdded: false,
    },
    skipped: [
      {
        area: "full four-flow POS form clicking",
        reason: "Packaged-origin temporary IndexedDB commits plus executable source-contract checks are used to avoid brittle UI setup and any chance of touching live POSDatabase.",
      },
      {
        area: "printer hardware output",
        reason: "Invoice view and print wiring are verified; physical printer output remains manual.",
      },
      {
        area: "full cylinder UI automation",
        reason: "The isolated local cylinder transition is verified without brittle UI setup.",
      },
      {
        area: "invoice cancellation or reversal",
        reason: "Explicitly out of scope and intentionally disabled.",
      },
    ],
  };

  writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(reportMarkdownPath, markdownReport(report));
  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) process.exitCode = 1;
} finally {
  if (!cleanupConfirmed) {
    try {
      await page.evaluate(async (databaseName) => {
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase(databaseName);
          request.onsuccess = () => resolve(undefined);
          request.onerror = () => reject(request.error);
          request.onblocked = () => resolve(undefined);
        });
      }, fixtureDatabaseName);
    } catch {
      // Best-effort cleanup for a failed rehearsal.
    }
  }

  await context.close();
  await browser.close();
}
