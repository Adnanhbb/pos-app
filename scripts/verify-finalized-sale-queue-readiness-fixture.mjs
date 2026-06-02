#!/usr/bin/env node

/*
 * Safe packaged-Laragon finalized Sale queue-readiness fixture.
 *
 * This verifier opens the packaged frontend, blocks API requests, and uses a
 * uniquely named temporary IndexedDB database. It creates one synthetic mapped
 * item/customer/batch fixture, atomically finalizes one local Sale, queues the
 * hardened payload post-commit, verifies readiness, and deletes the temporary
 * database. It never opens the live POSDatabase and never triggers replay.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const APP_URL =
  process.env.APP_URL || "http://localhost/jawad-bro-rehearsal/";
const builderPath = resolve(root, "src/services/posTransactionPayloadBuilder.ts");
const backendSaleReplayPath = resolve(root, "api/replay/sale.php");
const fixtureDatabaseName = `POSFinalizedSaleQueueReadinessFixture-${Date.now()}`;
const fixtureName = "Rehearsal Finalized Sale Queue Readiness Fixture";
const createdAt = Date.now();
const clientTransactionId = `txn_rehearsal_sale_queue_ready_${createdAt}`;

let checks = 0;

function assert(condition, name) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  checks += 1;
  console.log(`PASS: ${name}`);
}

async function importTypescriptModule(path) {
  const source = readFileSync(path, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    fileName: path,
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
  return await import(moduleUrl);
}

async function deleteFixtureDatabase(page) {
  return await page.evaluate(async (databaseName) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve(undefined);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Temporary IndexedDB cleanup was blocked."));
    });
    return true;
  }, fixtureDatabaseName);
}

const { buildSaleTransactionPayload } = await importTypescriptModule(builderPath);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const observedApiRequests = [];
let cleanupConfirmed = false;

page.on("request", (request) => {
  if (request.url().includes("/api/")) {
    observedApiRequests.push({ method: request.method(), url: request.url() });
  }
});
await page.route("**/api/**", async (route) => {
  await route.abort();
});

try {
  const response = await page.goto(APP_URL, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });
  assert(response?.ok(), "packaged Laragon frontend opens for isolated fixture");
  assert(
    fixtureDatabaseName !== "POSDatabase",
    "fixture uses a uniquely named IndexedDB database instead of live POSDatabase"
  );
  assert(
    !existsSync(backendSaleReplayPath),
    "backend Sale replay HTTP endpoint remains unimplemented"
  );

  const localSale = await page.evaluate(
    async ({ databaseName, fixtureLabel }) => {
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
            database.createObjectStore("item_batches", { keyPath: "id" });
            database.createObjectStore("sync_queue", {
              keyPath: "id",
              autoIncrement: true,
            });
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      const database = await openDatabase();
      try {
        const seed = database.transaction(
          ["items", "customers", "item_batches"],
          "readwrite"
        );
        seed.objectStore("items").put({
          id: 17,
          serverId: 7017,
          name: `${fixtureLabel} Item`,
          availableStock: 10,
        });
        seed.objectStore("customers").put({
          id: 7,
          serverId: 7007,
          name: `${fixtureLabel} Customer`,
          invoices: 0,
          payable: 0,
          paid: 0,
          balance: 0,
        });
        seed.objectStore("item_batches").put({
          id: 27,
          serverId: 7027,
          itemId: 17,
          qtyPurchased: 10,
          qtySold: 0,
          balance: 10,
        });
        await transactionDone(seed);

        const finalize = database.transaction(
          ["sales", "sale_items", "items", "customers", "item_batches"],
          "readwrite"
        );
        const saleId = await requestResult(
          finalize.objectStore("sales").add({
            invoiceNo: "SAL-REHEARSAL-QUEUE-READY",
            transactionType: "Sale",
            isPostponed: false,
            grandTotal: 200,
            paid: 50,
            arrears: 150,
          })
        );
        finalize.objectStore("sale_items").add({
          saleId,
          originalItemId: 17,
          name: `${fixtureLabel} Item`,
          qty: 2,
          price: 100,
        });
        finalize.objectStore("items").put({
          id: 17,
          serverId: 7017,
          name: `${fixtureLabel} Item`,
          availableStock: 8,
        });
        finalize.objectStore("customers").put({
          id: 7,
          serverId: 7007,
          name: `${fixtureLabel} Customer`,
          invoices: 1,
          payable: 200,
          paid: 50,
          balance: 150,
        });
        finalize.objectStore("item_batches").put({
          id: 27,
          serverId: 7027,
          itemId: 17,
          qtyPurchased: 10,
          qtySold: 2,
          balance: 8,
        });
        await transactionDone(finalize);

        const inspect = database.transaction(
          ["sales", "sale_items", "items", "customers", "item_batches"],
          "readonly"
        );
        const sales = await requestResult(inspect.objectStore("sales").getAll());
        const saleItems = await requestResult(
          inspect.objectStore("sale_items").getAll()
        );
        const item = await requestResult(inspect.objectStore("items").get(17));
        const customer = await requestResult(
          inspect.objectStore("customers").get(7)
        );
        const batch = await requestResult(
          inspect.objectStore("item_batches").get(27)
        );

        return {
          saleId,
          salesCount: sales.length,
          saleItemsCount: saleItems.length,
          item: {
            localId: item.id,
            serverId: item.serverId,
            availableStock: item.availableStock,
          },
          customer: {
            localId: customer.id,
            serverId: customer.serverId,
            invoices: customer.invoices,
            balance: customer.balance,
          },
          batch: {
            localId: batch.id,
            serverId: batch.serverId,
            qtySold: batch.qtySold,
            balance: batch.balance,
          },
        };
      } finally {
        database.close();
      }
    },
    { databaseName: fixtureDatabaseName, fixtureLabel: fixtureName }
  );

  assert(
    localSale.salesCount === 1 && localSale.saleItemsCount === 1,
    "one minimal finalized local Sale and one linked sale item are committed"
  );
  assert(
    localSale.item.availableStock === 8 &&
      localSale.batch.qtySold === 2 &&
      localSale.batch.balance === 8 &&
      localSale.customer.invoices === 1 &&
      localSale.customer.balance === 150,
    "isolated local Sale applies expected stock, exact batch, and customer summary outcomes"
  );
  assert(
    localSale.item.localId !== localSale.item.serverId &&
      localSale.customer.localId !== localSale.customer.serverId &&
      localSale.batch.localId !== localSale.batch.serverId,
    "fixture mappings separate local correlation ids from backend mutation ids"
  );

  const queuedPayload = buildSaleTransactionPayload({
    clientTransactionId,
    createdAt,
    sale: {
      invoiceNo: "SAL-REHEARSAL-QUEUE-READY",
      date: new Date(createdAt).toISOString(),
      transactionType: "Sale",
      customerId: localSale.customer.localId,
      supplierId: null,
      customerName: `${fixtureName} Customer`,
      supplierName: "",
      subtotal: 200,
      discount: 0,
      tax: 0,
      dues: 0,
      grandTotal: 200,
      paid: 50,
      arrears: 150,
      profit: 80,
      isPostponed: false,
    },
    saleId: localSale.saleId,
    saleItems: [
      {
        originalItemId: localSale.item.localId,
        name: `${fixtureName} Item`,
        qty: 2,
        price: 100,
        priceCategory: "Retail",
        discountType: "%",
        discountValue: 0,
        taxType: "%",
        taxValue: 0,
      },
    ],
    finalizedSaleReplay: {
      localSaleId: localSale.saleId,
      invoiceNo: "SAL-REHEARSAL-QUEUE-READY",
      customer: {
        localId: localSale.customer.localId,
        serverId: localSale.customer.serverId,
        nameSnapshot: `${fixtureName} Customer`,
      },
      items: [
        {
          localItemId: localSale.item.localId,
          serverItemId: localSale.item.serverId,
          originalItemId: localSale.item.localId,
          nameSnapshot: `${fixtureName} Item`,
          qty: 2,
          price: 100,
          quantityUnit: "min",
          selectedUnit: "min",
          conversion: {
            minUnit: "piece",
            maxUnit: "box",
            convQty: 1,
            quantityInMinUnit: 2,
          },
          resolvedBatch: {
            localBatchId: localSale.batch.localId,
            serverBatchId: localSale.batch.serverId,
            consumedQty: 2,
          },
          requiresCylinderMutation: false,
        },
      ],
      payments: {
        paidAmount: 50,
        source: "pos-finalization",
        method: null,
      },
      cylinders: [],
      totals: {
        subtotal: 200,
        discount: 0,
        tax: 0,
        dues: 0,
        grandTotal: 200,
        paid: 50,
        arrears: 150,
      },
    },
  });

  const queueSummary = await page.evaluate(
    async ({ databaseName, payload, queuedAt }) => {
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

      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      try {
        const write = database.transaction("sync_queue", "readwrite");
        await requestResult(
          write.objectStore("sync_queue").add({
            entity: "transactions",
            operation: "transaction",
            localId: payload.clientTransactionId,
            payload,
            replayReadiness: payload.replayReadiness,
            createdAt: queuedAt,
            updatedAt: queuedAt,
            retryCount: 0,
            status: "pending",
          })
        );
        await transactionDone(write);

        const read = database.transaction("sync_queue", "readonly");
        const rows = await requestResult(read.objectStore("sync_queue").getAll());
        const row = rows[0];
        const contract = row?.payload?.payload?.finalizedSaleReplay;

        return {
          totalRows: rows.length,
          entity: row?.entity ?? null,
          operation: row?.operation ?? null,
          queueStatus: row?.status ?? null,
          readinessStatus: row?.replayReadiness?.status ?? null,
          readinessReasonCodes: (row?.replayReadiness?.reasons ?? []).map(
            (reason) => reason.code
          ),
          payloadVersion: contract?.payloadVersion ?? null,
          contractTransactionType: contract?.transactionType ?? null,
          clientTransactionIdMatches:
            contract?.clientTransactionId === payload.clientTransactionId,
          itemMapping: contract?.items?.[0]
            ? {
                localItemId: contract.items[0].localItemId,
                serverItemId: contract.items[0].serverItemId,
              }
            : null,
          batchMapping: contract?.items?.[0]?.resolvedBatch
            ? {
                localBatchId: contract.items[0].resolvedBatch.localBatchId,
                serverBatchId: contract.items[0].resolvedBatch.serverBatchId,
              }
            : null,
          customerMapping: contract?.customer
            ? {
                localId: contract.customer.localId,
                serverId: contract.customer.serverId,
              }
            : null,
          cylindersCount: Array.isArray(contract?.cylinders)
            ? contract.cylinders.length
            : null,
        };
      } finally {
        database.close();
      }
    },
    {
      databaseName: fixtureDatabaseName,
      payload: queuedPayload,
      queuedAt: Date.now(),
    }
  );

  assert(queueSummary.totalRows === 1, "exactly one isolated sync_queue row is created");
  assert(
    queueSummary.entity === "transactions" &&
      queueSummary.operation === "transaction" &&
      queueSummary.queueStatus === "pending",
    "queued row is a pending transaction and has not been replayed"
  );
  assert(
    queueSummary.payloadVersion === 1 &&
      queueSummary.contractTransactionType === "Sale" &&
      queueSummary.clientTransactionIdMatches,
    "queued payload contains finalizedSaleReplay v1 contract"
  );
  assert(
    queueSummary.readinessStatus === "ready" &&
      queueSummary.readinessReasonCodes.length === 0,
    "fully mapped local fixture queue row is replay-ready"
  );
  assert(
    queueSummary.itemMapping.localItemId === 17 &&
      queueSummary.itemMapping.serverItemId === 7017 &&
      queueSummary.batchMapping.localBatchId === 27 &&
      queueSummary.batchMapping.serverBatchId === 7027 &&
      queueSummary.customerMapping.localId === 7 &&
      queueSummary.customerMapping.serverId === 7007,
    "queue summary preserves explicit item, exact batch, and customer backend mappings"
  );
  assert(
    queueSummary.cylindersCount === 0,
    "non-cylinder rehearsal fixture does not add cylinder mutations"
  );
  assert(
    observedApiRequests.every((request) =>
      request.method === "GET" || request.method === "HEAD"
    ),
    "fixture performs no backend business mutation requests"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        checks,
        fixturePath:
          "packaged Laragon frontend origin plus isolated temporary IndexedDB",
        appUrl: APP_URL,
        fixtureDatabaseName,
        liveDatabaseTouched: false,
        mappingMode:
          "synthetic isolated serverId fixture because item creation remains local-only",
        queuedRows: queueSummary.totalRows,
        replayReadiness: queueSummary.readinessStatus,
        unsafeReasonCodes: queueSummary.readinessReasonCodes,
        payloadSummary: {
          payloadVersion: queueSummary.payloadVersion,
          transactionType: queueSummary.contractTransactionType,
          itemMappings: 1,
          exactBatchMappings: 1,
          customerMappings: 1,
          cylinders: queueSummary.cylindersCount,
        },
        backendBusinessMutationRequests: observedApiRequests.filter(
          (request) => request.method !== "GET" && request.method !== "HEAD"
        ).length,
        backendSaleReplayEndpointAdded: false,
        replayTriggered: false,
        autoSyncChanged: false,
      },
      null,
      2
    )
  );
} finally {
  try {
    cleanupConfirmed = await deleteFixtureDatabase(page);
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(
    JSON.stringify(
      {
        cleanupConfirmed,
        temporaryIndexedDbDeleted: cleanupConfirmed,
        livePOSDatabaseTouched: false,
        mysqlBusinessDataMutated: false,
        replayTriggered: false,
      },
      null,
      2
    )
  );
}

