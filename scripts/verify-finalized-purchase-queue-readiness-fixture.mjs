#!/usr/bin/env node

/*
 * Safe packaged-Laragon finalized Purchase queue-readiness fixture.
 *
 * This verifier opens the packaged frontend, blocks API requests, and uses a
 * uniquely named temporary IndexedDB database. It creates one synthetic mapped
 * supplier Purchase fixture, atomically finalizes one local Purchase, queues
 * the hardened payload post-commit, verifies readiness, and deletes the
 * temporary database. It never opens the live POSDatabase and never triggers
 * Purchase replay.
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
const backendPurchaseReplayPath = resolve(root, "api/replay/purchase.php");
const backendSaleReplayPath = resolve(root, "api/replay/sale.php");
const fixtureDatabaseName = `POSFinalizedPurchaseQueueReadinessFixture-${Date.now()}`;
const fixtureName = "Rehearsal Finalized Purchase Queue Readiness Fixture";
const createdAt = Date.now();
const clientTransactionId = `txn_rehearsal_purchase_queue_ready_${createdAt}`;

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

function reasonCodes(contractOrPayload) {
  return (contractOrPayload.replayReadiness?.reasons ?? []).map(
    (reason) => reason.code
  );
}

async function deleteFixtureDatabase(page) {
  return await page.evaluate(async (databaseName) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve(undefined);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("Temporary IndexedDB cleanup was blocked."));
    });
    return true;
  }, fixtureDatabaseName);
}

const {
  buildFinalizedPurchaseReplayContract,
  buildSaleTransactionPayload,
} = await importTypescriptModule(builderPath);
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
    !existsSync(backendPurchaseReplayPath),
    "backend Purchase replay HTTP endpoint is intentionally absent"
  );
  assert(
    existsSync(backendSaleReplayPath),
    "existing backend Sale replay endpoint remains present"
  );

  const localPurchase = await page.evaluate(
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
            database.createObjectStore("suppliers", { keyPath: "id" });
            database.createObjectStore("supplier_payments", {
              keyPath: "id",
              autoIncrement: true,
            });
            database.createObjectStore("item_batches", {
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

      const database = await openDatabase();
      try {
        const seed = database.transaction(["items", "suppliers"], "readwrite");
        seed.objectStore("items").put({
          id: 18,
          serverId: 8018,
          name: `${fixtureLabel} Item`,
          minunit: "piece",
          maxunit: "box",
          ConvQty: 2,
          availableStock: 0,
        });
        seed.objectStore("suppliers").put({
          id: 8,
          serverId: 8008,
          name: `${fixtureLabel} Supplier`,
          invoices: 0,
          payable: 0,
          paid: 0,
          balance: 20,
          isDeleted: false,
          deletedAt: null,
        });
        await transactionDone(seed);

        const finalize = database.transaction(
          [
            "sales",
            "sale_items",
            "items",
            "suppliers",
            "supplier_payments",
            "item_batches",
          ],
          "readwrite"
        );
        const saleId = await requestResult(
          finalize.objectStore("sales").add({
            invoiceNo: "PUR-REHEARSAL-QUEUE-READY",
            transactionType: "Purchase",
            isPostponed: false,
            supplierId: 8,
            supplierName: `${fixtureLabel} Supplier`,
            subtotal: 200,
            discount: 0,
            tax: 0,
            dues: 20,
            grandTotal: 220,
            paid: 50,
            arrears: 170,
          })
        );
        finalize.objectStore("sale_items").add({
          saleId,
          originalItemId: 18,
          name: `${fixtureLabel} Item`,
          qty: 4,
          price: 50,
        });
        finalize.objectStore("items").put({
          id: 18,
          serverId: 8018,
          name: `${fixtureLabel} Item`,
          minunit: "piece",
          maxunit: "box",
          ConvQty: 2,
          availableStock: 4,
        });
        finalize.objectStore("suppliers").put({
          id: 8,
          serverId: 8008,
          name: `${fixtureLabel} Supplier`,
          invoices: 1,
          payable: 200,
          paid: 50,
          balance: 170,
          isDeleted: false,
          deletedAt: null,
        });
        finalize.objectStore("supplier_payments").add({
          supplierId: 8,
          supplierName: `${fixtureLabel} Supplier`,
          amount: 50,
          date: "2026-06-03T00:00:00.000Z",
          saleId,
          invoiceNo: "PUR-REHEARSAL-QUEUE-READY",
          payableSnapshot: 220,
          balanceSnapshot: 170,
          source: "invoice",
        });
        const localBatchId = await requestResult(
          finalize.objectStore("item_batches").add({
            itemId: 18,
            purchaseDate: "2026-06-03T00:00:00.000Z",
            qtyPurchased: 4,
            qtySold: 0,
            balance: 4,
            costPrice: 50,
            invoiceNo: "PUR-REHEARSAL-QUEUE-READY",
            sourceSaleId: saleId,
            isDeleted: false,
            deletedAt: null,
          })
        );
        await transactionDone(finalize);

        const inspect = database.transaction(
          [
            "sales",
            "sale_items",
            "items",
            "suppliers",
            "supplier_payments",
            "item_batches",
          ],
          "readonly"
        );
        const sales = await requestResult(inspect.objectStore("sales").getAll());
        const saleItems = await requestResult(
          inspect.objectStore("sale_items").getAll()
        );
        const item = await requestResult(inspect.objectStore("items").get(18));
        const supplier = await requestResult(
          inspect.objectStore("suppliers").get(8)
        );
        const payments = await requestResult(
          inspect.objectStore("supplier_payments").getAll()
        );
        const batch = await requestResult(
          inspect.objectStore("item_batches").get(localBatchId)
        );

        return {
          saleId,
          salesCount: sales.length,
          saleItemsCount: saleItems.length,
          supplierPaymentsCount: payments.length,
          item: {
            localId: item.id,
            serverId: item.serverId,
            availableStock: item.availableStock,
          },
          supplier: {
            localId: supplier.id,
            serverId: supplier.serverId,
            invoices: supplier.invoices,
            payable: supplier.payable,
            paid: supplier.paid,
            balance: supplier.balance,
          },
          batch: {
            localId: batch.id,
            sourceSaleId: batch.sourceSaleId,
            qtyPurchased: batch.qtyPurchased,
            balance: batch.balance,
            costPrice: batch.costPrice,
            purchaseDate: batch.purchaseDate,
            invoiceNo: batch.invoiceNo,
          },
        };
      } finally {
        database.close();
      }
    },
    { databaseName: fixtureDatabaseName, fixtureLabel: fixtureName }
  );

  assert(
    localPurchase.salesCount === 1 &&
      localPurchase.saleItemsCount === 1 &&
      localPurchase.supplierPaymentsCount === 1,
    "one finalized local Purchase, one linked line, and one supplier payment are committed"
  );
  assert(
    localPurchase.item.availableStock === 4 &&
      localPurchase.batch.qtyPurchased === 4 &&
      localPurchase.batch.balance === 4 &&
      localPurchase.batch.sourceSaleId === localPurchase.saleId,
    "isolated local Purchase applies expected stock increase and linked batch creation"
  );
  assert(
    localPurchase.supplier.invoices === 1 &&
      localPurchase.supplier.payable === 200 &&
      localPurchase.supplier.paid === 50 &&
      localPurchase.supplier.balance === 170,
    "isolated local Purchase applies selected supplier accounting outcome"
  );
  assert(
    localPurchase.item.localId !== localPurchase.item.serverId &&
      localPurchase.supplier.localId !== localPurchase.supplier.serverId,
    "fixture mappings separate local correlation ids from backend mutation ids"
  );

  const contractInput = {
    localSaleId: localPurchase.saleId,
    invoiceNo: "PUR-REHEARSAL-QUEUE-READY",
    supplier: {
      localId: localPurchase.supplier.localId,
      serverId: localPurchase.supplier.serverId,
      nameSnapshot: `${fixtureName} Supplier`,
      directPurchase: false,
    },
    items: [
      {
        localItemId: localPurchase.item.localId,
        serverItemId: localPurchase.item.serverId,
        originalItemId: localPurchase.item.localId,
        nameSnapshot: `${fixtureName} Item`,
        qty: 4,
        price: 50,
        costPrice: 50,
        quantityUnit: "min",
        selectedUnit: "max",
        conversion: {
          minUnit: "piece",
          maxUnit: "box",
          convQty: 2,
          quantityInMinUnit: 4,
        },
        batchCreate: {
          localBatchId: localPurchase.batch.localId,
          sourceSaleId: localPurchase.batch.sourceSaleId,
          purchaseDate: localPurchase.batch.purchaseDate,
          qtyPurchased: localPurchase.batch.qtyPurchased,
          balance: localPurchase.batch.balance,
          costPrice: localPurchase.batch.costPrice,
          invoiceNo: localPurchase.batch.invoiceNo,
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
      dues: 20,
      grandTotal: 220,
      paid: 50,
      arrears: 170,
    },
  };

  const supplierReadyContract = buildFinalizedPurchaseReplayContract({
    ...contractInput,
    clientTransactionId,
    createdAt,
  });
  const directPurchaseContract = buildFinalizedPurchaseReplayContract({
    ...contractInput,
    clientTransactionId: `${clientTransactionId}_direct`,
    createdAt,
    supplier: {
      localId: null,
      serverId: null,
      nameSnapshot: "Direct Purchase",
      directPurchase: true,
    },
  });
  const unsafeSupplierContract = buildFinalizedPurchaseReplayContract({
    ...contractInput,
    clientTransactionId: `${clientTransactionId}_unsafe_supplier`,
    createdAt,
    supplier: {
      ...contractInput.supplier,
      serverId: null,
      directPurchase: false,
    },
  });
  const unsafeItemContract = buildFinalizedPurchaseReplayContract({
    ...contractInput,
    clientTransactionId: `${clientTransactionId}_unsafe_item`,
    createdAt,
    items: [
      {
        ...contractInput.items[0],
        serverItemId: null,
      },
    ],
  });

  assert(
    supplierReadyContract.replayReadiness.status === "ready",
    "supplier Purchase is ready when supplier and item server mappings exist"
  );
  assert(
    directPurchaseContract.replayReadiness.status === "ready",
    "Direct Purchase is ready without supplier serverId"
  );
  assert(
    unsafeSupplierContract.replayReadiness.status === "unsafe" &&
      reasonCodes(unsafeSupplierContract).includes("missing_supplier_server_id"),
    "supplier Purchase is unsafe when selected supplier serverId is missing"
  );
  assert(
    unsafeItemContract.replayReadiness.status === "unsafe" &&
      reasonCodes(unsafeItemContract).includes("missing_server_item_id"),
    "Purchase item without serverItemId is unsafe"
  );

  const queuedPayload = buildSaleTransactionPayload({
    clientTransactionId,
    createdAt,
    sale: {
      invoiceNo: "PUR-REHEARSAL-QUEUE-READY",
      date: new Date(createdAt).toISOString(),
      transactionType: "Purchase",
      customerId: null,
      supplierId: localPurchase.supplier.localId,
      customerName: "",
      supplierName: `${fixtureName} Supplier`,
      subtotal: 200,
      discount: 0,
      tax: 0,
      dues: 20,
      grandTotal: 220,
      paid: 50,
      arrears: 170,
      profit: 0,
      isPostponed: false,
    },
    saleId: localPurchase.saleId,
    saleItems: [
      {
        originalItemId: localPurchase.item.localId,
        name: `${fixtureName} Item`,
        qty: 4,
        price: 50,
        priceCategory: "Retail",
        discountType: "%",
        discountValue: 0,
        taxType: "%",
        taxValue: 0,
      },
    ],
    finalizedPurchaseReplay: contractInput,
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
        const contract = row?.payload?.payload?.finalizedPurchaseReplay;
        const item = contract?.items?.[0];

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
          supplierMapping: contract?.supplier
            ? {
                localId: contract.supplier.localId,
                serverId: contract.supplier.serverId,
                directPurchase: contract.supplier.directPurchase,
              }
            : null,
          itemMapping: item
            ? {
                localItemId: item.localItemId,
                serverItemId: item.serverItemId,
              }
            : null,
          batchCreate: item?.batchCreate
            ? {
                localBatchId: item.batchCreate.localBatchId,
                sourceSaleId: item.batchCreate.sourceSaleId,
                qtyPurchased: item.batchCreate.qtyPurchased,
                balance: item.batchCreate.balance,
                costPrice: item.batchCreate.costPrice,
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
      queueSummary.contractTransactionType === "Purchase" &&
      queueSummary.clientTransactionIdMatches,
    "queued payload contains finalizedPurchaseReplay v1 contract"
  );
  assert(
    queueSummary.readinessStatus === "ready" &&
      queueSummary.readinessReasonCodes.length === 0,
    "fully mapped local Purchase fixture queue row is replay-ready"
  );
  assert(
    queueSummary.supplierMapping.localId === 8 &&
      queueSummary.supplierMapping.serverId === 8008 &&
      queueSummary.supplierMapping.directPurchase === false &&
      queueSummary.itemMapping.localItemId === 18 &&
      queueSummary.itemMapping.serverItemId === 8018,
    "queue summary preserves explicit supplier and item backend mappings"
  );
  assert(
    queueSummary.batchCreate.localBatchId === localPurchase.batch.localId &&
      queueSummary.batchCreate.sourceSaleId === localPurchase.saleId &&
      queueSummary.batchCreate.qtyPurchased === 4 &&
      queueSummary.batchCreate.balance === 4 &&
      queueSummary.batchCreate.costPrice === 50,
    "queue summary includes safe batchCreate metadata for future backend batch creation"
  );
  assert(
    queueSummary.cylindersCount === 0,
    "non-cylinder rehearsal fixture does not add cylinder mutations"
  );
  assert(
    !observedApiRequests.some((request) =>
      request.url.includes("/api/replay/purchase.php")
    ),
    "fixture never calls a Purchase replay endpoint"
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
        scenarios: {
          supplierPurchaseWithMappings: supplierReadyContract.replayReadiness.status,
          directPurchaseWithoutSupplierServerId:
            directPurchaseContract.replayReadiness.status,
          supplierPurchaseMissingSupplierServerId: {
            status: unsafeSupplierContract.replayReadiness.status,
            reasonCodes: reasonCodes(unsafeSupplierContract),
          },
          purchaseMissingServerItemId: {
            status: unsafeItemContract.replayReadiness.status,
            reasonCodes: reasonCodes(unsafeItemContract),
          },
        },
        queuedRows: queueSummary.totalRows,
        payloadSummary: {
          payloadVersion: queueSummary.payloadVersion,
          transactionType: queueSummary.contractTransactionType,
          readiness: queueSummary.readinessStatus,
          supplierMappings: 1,
          itemMappings: 1,
          batchCreates: 1,
          cylinders: queueSummary.cylindersCount,
        },
        backendBusinessMutationRequests: observedApiRequests.filter(
          (request) => request.method !== "GET" && request.method !== "HEAD"
        ).length,
        backendPurchaseReplayEndpointAdded: false,
        saleReplayChanged: false,
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
        purchaseReplayTriggered: false,
      },
      null,
      2
    )
  );
}
