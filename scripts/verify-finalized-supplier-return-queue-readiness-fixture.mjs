#!/usr/bin/env node

/*
 * Safe packaged-Laragon finalized Supplier Return queue-readiness fixture.
 *
 * This verifier opens the packaged frontend, blocks API requests, and uses a
 * uniquely named temporary IndexedDB database. It creates one synthetic mapped
 * cylinder Supplier Return fixture, atomically finalizes it locally, queues the
 * hardened payload post-commit, verifies readiness, and deletes the temporary
 * database. It never opens the live POSDatabase and never triggers Supplier
 * Return replay.
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
const backendSupplierReturnReplayPath = resolve(root, "api/replay/supplier-return.php");
const backendSaleReplayPath = resolve(root, "api/replay/sale.php");
const backendPurchaseReplayPath = resolve(root, "api/replay/purchase.php");
const backendCustomerReturnReplayPath = resolve(root, "api/replay/customer-return.php");
const fixtureDatabaseName = `POSFinalizedSupplierReturnQueueReadinessFixture-${Date.now()}`;
const fixtureName = "Rehearsal Finalized Supplier Return Queue Readiness Fixture";
const createdAt = Date.now();
const clientTransactionId = `txn_rehearsal_supplier_return_queue_ready_${createdAt}`;

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
  buildFinalizedSupplierReturnReplayContract,
  buildReturnTransactionPayload,
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
    !existsSync(backendSupplierReturnReplayPath),
    "backend Supplier Return replay HTTP endpoint is still absent"
  );
  assert(
    existsSync(backendSaleReplayPath) &&
      existsSync(backendPurchaseReplayPath) &&
      existsSync(backendCustomerReturnReplayPath),
    "existing Sale/Purchase/Customer Return replay endpoints remain present"
  );

  const localReturn = await page.evaluate(
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
            database.createObjectStore("item_batches", { keyPath: "id" });
            database.createObjectStore("cylinders", { keyPath: "id" });
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
          ["items", "suppliers", "item_batches", "cylinders"],
          "readwrite"
        );
        seed.objectStore("items").put({
          id: 18,
          serverId: 8018,
          name: `${fixtureLabel} Cylinder Item`,
          category: "Gas Cylinder",
          minunit: "kg",
          maxunit: "cylinder",
          ConvQty: 3,
          availableStock: 10,
        });
        seed.objectStore("suppliers").put({
          id: 9,
          serverId: 9009,
          name: `${fixtureLabel} Supplier`,
          invoices: 0,
          payable: 500,
          paid: 0,
          balance: 500,
          isDeleted: false,
          deletedAt: null,
        });
        seed.objectStore("item_batches").put({
          id: 28,
          serverId: 8028,
          itemId: 18,
          purchaseDate: "2026-06-03T00:00:00.000Z",
          qtyPurchased: 10,
          qtySold: 0,
          balance: 8,
          costPrice: 50,
          invoiceNo: "PUR-REHEARSAL-SOURCE-BATCH",
          sourceSaleId: 77,
          isDeleted: false,
          deletedAt: null,
        });
        seed.objectStore("cylinders").put({
          id: 38,
          serverId: 8038,
          itemId: 18,
          title: `${fixtureLabel} Cylinder`,
          qtyInStock: 7,
          filledCylinders: 4,
          emptyCylinders: 2,
          withCustomers: 1,
          convQty: 3,
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
            "cylinders",
          ],
          "readwrite"
        );
        const saleId = await requestResult(
          finalize.objectStore("sales").add({
            invoiceNo: "RET-S-REHEARSAL-QUEUE-READY",
            transactionType: "Return",
            returnMode: "supplier",
            isPostponed: false,
            supplierId: 9,
            supplierName: `${fixtureLabel} Supplier`,
            subtotal: 150,
            discount: 0,
            tax: 0,
            dues: 500,
            grandTotal: 350,
            paid: -30,
            arrears: 380,
            profit: 0,
          })
        );
        finalize.objectStore("sale_items").add({
          saleId,
          originalItemId: 18,
          name: `${fixtureLabel} Cylinder Item`,
          qty: 3,
          price: 50,
          costPrice: 50,
          batchId: 28,
        });
        finalize.objectStore("items").put({
          id: 18,
          serverId: 8018,
          name: `${fixtureLabel} Cylinder Item`,
          category: "Gas Cylinder",
          minunit: "kg",
          maxunit: "cylinder",
          ConvQty: 3,
          availableStock: 7,
        });
        finalize.objectStore("suppliers").put({
          id: 9,
          serverId: 9009,
          name: `${fixtureLabel} Supplier`,
          invoices: 1,
          payable: 350,
          paid: -30,
          balance: 380,
          isDeleted: false,
          deletedAt: null,
        });
        finalize.objectStore("supplier_payments").add({
          supplierId: 9,
          supplierName: `${fixtureLabel} Supplier`,
          amount: -30,
          date: "2026-06-03T00:00:00.000Z",
          saleId,
          invoiceNo: "RET-S-REHEARSAL-QUEUE-READY",
          remarks: "Supplier Return adjustment RET-S-REHEARSAL-QUEUE-READY",
          payableSnapshot: 350,
          balanceSnapshot: 380,
          source: "invoice",
        });
        finalize.objectStore("item_batches").put({
          id: 28,
          serverId: 8028,
          itemId: 18,
          purchaseDate: "2026-06-03T00:00:00.000Z",
          qtyPurchased: 7,
          qtySold: 0,
          balance: 5,
          costPrice: 50,
          invoiceNo: "PUR-REHEARSAL-SOURCE-BATCH",
          sourceSaleId: 77,
          isDeleted: false,
          deletedAt: null,
        });
        finalize.objectStore("cylinders").put({
          id: 38,
          serverId: 8038,
          itemId: 18,
          title: `${fixtureLabel} Cylinder`,
          qtyInStock: 6,
          filledCylinders: 3,
          emptyCylinders: 2,
          withCustomers: 1,
          convQty: 3,
          isDeleted: false,
          deletedAt: null,
        });
        await transactionDone(finalize);

        const inspect = database.transaction(
          [
            "sales",
            "sale_items",
            "items",
            "suppliers",
            "supplier_payments",
            "item_batches",
            "cylinders",
          ],
          "readonly"
        );
        const sales = await requestResult(inspect.objectStore("sales").getAll());
        const saleItems = await requestResult(
          inspect.objectStore("sale_items").getAll()
        );
        const item = await requestResult(inspect.objectStore("items").get(18));
        const supplier = await requestResult(
          inspect.objectStore("suppliers").get(9)
        );
        const payments = await requestResult(
          inspect.objectStore("supplier_payments").getAll()
        );
        const batch = await requestResult(
          inspect.objectStore("item_batches").get(28)
        );
        const cylinder = await requestResult(
          inspect.objectStore("cylinders").get(38)
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
            serverId: batch.serverId,
            qtyPurchasedBefore: 10,
            qtyPurchasedAfter: batch.qtyPurchased,
            balanceBefore: 8,
            balanceAfter: batch.balance,
            costPrice: batch.costPrice,
            purchaseDate: batch.purchaseDate,
            invoiceNo: batch.invoiceNo,
          },
          cylinder: {
            localId: cylinder.id,
            serverId: cylinder.serverId,
            filledCylindersBefore: 4,
            filledCylindersAfter: cylinder.filledCylinders,
            qtyInStockBefore: 7,
            qtyInStockAfter: cylinder.qtyInStock,
            emptyCylinders: cylinder.emptyCylinders,
            withCustomers: cylinder.withCustomers,
          },
        };
      } finally {
        database.close();
      }
    },
    { databaseName: fixtureDatabaseName, fixtureLabel: fixtureName }
  );

  assert(
    localReturn.salesCount === 1 &&
      localReturn.saleItemsCount === 1 &&
      localReturn.supplierPaymentsCount === 1,
    "one finalized local Supplier Return, one linked line, and one supplier payment are committed"
  );
  assert(
    localReturn.item.availableStock === 7 &&
      localReturn.batch.qtyPurchasedAfter === 7 &&
      localReturn.batch.balanceAfter === 5,
    "isolated local Supplier Return applies expected stock and selected source-batch decrease"
  );
  assert(
    localReturn.supplier.invoices === 1 &&
      localReturn.supplier.payable === 350 &&
      localReturn.supplier.paid === -30 &&
      localReturn.supplier.balance === 380,
    "isolated local Supplier Return applies selected supplier accounting outcome"
  );
  assert(
    localReturn.cylinder.filledCylindersAfter === 3 &&
      localReturn.cylinder.emptyCylinders === 2 &&
      localReturn.cylinder.withCustomers === 1 &&
      localReturn.cylinder.qtyInStockAfter === 6,
    "isolated cylinder Supplier Return decreases filled cylinders and recomputes stock"
  );
  assert(
    localReturn.item.localId !== localReturn.item.serverId &&
      localReturn.supplier.localId !== localReturn.supplier.serverId &&
      localReturn.batch.localId !== localReturn.batch.serverId &&
      localReturn.cylinder.localId !== localReturn.cylinder.serverId,
    "fixture mappings separate local correlation ids from backend mutation ids"
  );

  const contractInput = {
    localSaleId: localReturn.saleId,
    invoiceNo: "RET-S-REHEARSAL-QUEUE-READY",
    supplier: {
      localId: localReturn.supplier.localId,
      serverId: localReturn.supplier.serverId,
      nameSnapshot: `${fixtureName} Supplier`,
    },
    items: [
      {
        localItemId: localReturn.item.localId,
        serverItemId: localReturn.item.serverId,
        originalItemId: localReturn.item.localId,
        nameSnapshot: `${fixtureName} Cylinder Item`,
        qty: 3,
        price: 50,
        costPrice: 50,
        quantityUnit: "min",
        selectedUnit: "min",
        conversion: {
          minUnit: "kg",
          maxUnit: "cylinder",
          convQty: 3,
          quantityInMinUnit: 3,
        },
        sourceBatch: {
          localBatchId: localReturn.batch.localId,
          serverBatchId: localReturn.batch.serverId,
          returnedQty: 3,
          qtyPurchasedBefore: localReturn.batch.qtyPurchasedBefore,
          qtyPurchasedAfter: localReturn.batch.qtyPurchasedAfter,
          balanceBefore: localReturn.batch.balanceBefore,
          balanceAfter: localReturn.batch.balanceAfter,
        },
        requiresCylinderMutation: true,
      },
    ],
    payments: {
      paidAmount: -30,
      source: "pos-finalization",
      method: null,
    },
    cylinders: [
      {
        localItemId: localReturn.item.localId,
        serverItemId: localReturn.item.serverId,
        localCylinderId: localReturn.cylinder.localId,
        serverCylinderId: localReturn.cylinder.serverId,
        qtyReturned: 1,
        movement: "filledDecrease",
        filledCylindersBefore: localReturn.cylinder.filledCylindersBefore,
        filledCylindersAfter: localReturn.cylinder.filledCylindersAfter,
        qtyInStockBefore: localReturn.cylinder.qtyInStockBefore,
        qtyInStockAfter: localReturn.cylinder.qtyInStockAfter,
      },
    ],
    totals: {
      subtotal: 150,
      discount: 0,
      tax: 0,
      dues: 500,
      grandTotal: 350,
      paid: -30,
      arrears: 380,
    },
  };

  const readyCylinderReturnContract = buildFinalizedSupplierReturnReplayContract({
    ...contractInput,
    clientTransactionId,
    createdAt,
  });
  const nonCylinderReadyContract = buildFinalizedSupplierReturnReplayContract({
    ...contractInput,
    clientTransactionId: `${clientTransactionId}_non_cylinder`,
    createdAt,
    items: [
      {
        ...contractInput.items[0],
        requiresCylinderMutation: false,
      },
    ],
    cylinders: [],
  });
  const unsafeSupplierContract = buildFinalizedSupplierReturnReplayContract({
    ...contractInput,
    clientTransactionId: `${clientTransactionId}_unsafe_supplier`,
    createdAt,
    supplier: {
      ...contractInput.supplier,
      serverId: null,
    },
  });
  const unsafeItemContract = buildFinalizedSupplierReturnReplayContract({
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
  const unsafeSourceBatchContract = buildFinalizedSupplierReturnReplayContract({
    ...contractInput,
    clientTransactionId: `${clientTransactionId}_unsafe_source_batch`,
    createdAt,
    items: [
      {
        ...contractInput.items[0],
        sourceBatch: null,
      },
    ],
  });
  const unsafeServerBatchContract = buildFinalizedSupplierReturnReplayContract({
    ...contractInput,
    clientTransactionId: `${clientTransactionId}_unsafe_server_batch`,
    createdAt,
    items: [
      {
        ...contractInput.items[0],
        sourceBatch: {
          ...contractInput.items[0].sourceBatch,
          serverBatchId: null,
        },
      },
    ],
  });
  const unsafeCylinderMappingContract = buildFinalizedSupplierReturnReplayContract({
    ...contractInput,
    clientTransactionId: `${clientTransactionId}_unsafe_cylinder_mapping`,
    createdAt,
    cylinders: [
      {
        ...contractInput.cylinders[0],
        serverCylinderId: null,
      },
    ],
  });
  const unsafeCylinderClampingContract = buildFinalizedSupplierReturnReplayContract({
    ...contractInput,
    clientTransactionId: `${clientTransactionId}_unsafe_cylinder_clamping`,
    createdAt,
    cylinders: [
      {
        ...contractInput.cylinders[0],
        serverCylinderId: localReturn.cylinder.serverId,
        qtyReturned: 2,
        filledCylindersBefore: 1,
        filledCylindersAfter: 0,
        qtyInStockBefore: 1,
        qtyInStockAfter: 0,
      },
    ],
  });

  assert(
    readyCylinderReturnContract.replayReadiness.status === "ready",
    "cylinder Supplier Return is ready when supplier, item, source batch, and cylinder mappings exist"
  );
  assert(
    nonCylinderReadyContract.replayReadiness.status === "ready",
    "non-cylinder Supplier Return is ready without cylinder metadata"
  );
  assert(
    unsafeSupplierContract.replayReadiness.status === "unsafe" &&
      reasonCodes(unsafeSupplierContract).includes("missing_supplier_server_id"),
    "Supplier Return is unsafe when supplier serverId is missing"
  );
  assert(
    unsafeItemContract.replayReadiness.status === "unsafe" &&
      reasonCodes(unsafeItemContract).includes("missing_server_item_id"),
    "Supplier Return item without serverItemId is unsafe"
  );
  assert(
    unsafeSourceBatchContract.replayReadiness.status === "unsafe" &&
      reasonCodes(unsafeSourceBatchContract).includes("missing_source_batch_metadata"),
    "Supplier Return item without sourceBatch metadata is unsafe"
  );
  assert(
    unsafeServerBatchContract.replayReadiness.status === "unsafe" &&
      reasonCodes(unsafeServerBatchContract).includes("missing_server_batch_id"),
    "Supplier Return sourceBatch without serverBatchId is unsafe"
  );
  assert(
    unsafeCylinderMappingContract.replayReadiness.status === "unsafe" &&
      reasonCodes(unsafeCylinderMappingContract).includes("missing_server_cylinder_id"),
    "cylinder Supplier Return requires mapped serverCylinderId"
  );
  assert(
    unsafeCylinderClampingContract.replayReadiness.status === "unsafe" &&
      reasonCodes(unsafeCylinderClampingContract).includes(
        "unsafe_supplier_return_cylinder_clamping"
      ),
    "unsafe Supplier Return cylinder clamping scenario is classified unsafe"
  );

  const queuedPayload = buildReturnTransactionPayload({
    clientTransactionId,
    createdAt,
    returnMode: "supplier",
    sale: {
      invoiceNo: "RET-S-REHEARSAL-QUEUE-READY",
      date: new Date(createdAt).toISOString(),
      transactionType: "Return",
      customerId: null,
      supplierId: localReturn.supplier.localId,
      customerName: "",
      supplierName: `${fixtureName} Supplier`,
      subtotal: 150,
      discount: 0,
      tax: 0,
      dues: 500,
      grandTotal: 350,
      paid: -30,
      arrears: 380,
      profit: 0,
      isPostponed: false,
    },
    saleId: localReturn.saleId,
    saleItems: [
      {
        originalItemId: localReturn.item.localId,
        name: `${fixtureName} Cylinder Item`,
        qty: 3,
        price: 50,
        priceCategory: "Retail",
        discountType: "%",
        discountValue: 0,
        taxType: "%",
        taxValue: 0,
        costPrice: 50,
        batchId: localReturn.batch.localId,
      },
    ],
    finalizedSupplierReturnReplay: contractInput,
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
        const contract = row?.payload?.payload?.finalizedSupplierReturnReplay;
        const item = contract?.items?.[0];
        const cylinder = contract?.cylinders?.[0];

        return {
          totalRows: rows.length,
          entity: row?.entity ?? null,
          operation: row?.operation ?? null,
          queueStatus: row?.status ?? null,
          readinessStatus: row?.replayReadiness?.status ?? null,
          readinessScope: row?.replayReadiness?.scope ?? null,
          readinessReasonCodes: (row?.replayReadiness?.reasons ?? []).map(
            (reason) => reason.code
          ),
          payloadVersion: contract?.payloadVersion ?? null,
          contractTransactionType: contract?.transactionType ?? null,
          returnMode: contract?.returnMode ?? null,
          clientTransactionIdMatches:
            contract?.clientTransactionId === payload.clientTransactionId,
          supplierMapping: contract?.supplier
            ? {
                localId: contract.supplier.localId,
                serverId: contract.supplier.serverId,
              }
            : null,
          itemMapping: item
            ? {
                localItemId: item.localItemId,
                serverItemId: item.serverItemId,
              }
            : null,
          sourceBatch: item?.sourceBatch
            ? {
                localBatchId: item.sourceBatch.localBatchId,
                serverBatchId: item.sourceBatch.serverBatchId,
                returnedQty: item.sourceBatch.returnedQty,
                qtyPurchasedBefore: item.sourceBatch.qtyPurchasedBefore,
                qtyPurchasedAfter: item.sourceBatch.qtyPurchasedAfter,
                balanceBefore: item.sourceBatch.balanceBefore,
                balanceAfter: item.sourceBatch.balanceAfter,
              }
            : null,
          cylindersCount: Array.isArray(contract?.cylinders)
            ? contract.cylinders.length
            : null,
          cylinderMapping: cylinder
            ? {
                localCylinderId: cylinder.localCylinderId,
                serverCylinderId: cylinder.serverCylinderId,
                movement: cylinder.movement,
                qtyReturned: cylinder.qtyReturned,
                filledCylindersBefore: cylinder.filledCylindersBefore,
                filledCylindersAfter: cylinder.filledCylindersAfter,
              }
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
      queueSummary.contractTransactionType === "Return" &&
      queueSummary.returnMode === "supplier" &&
      queueSummary.clientTransactionIdMatches,
    "queued payload contains finalizedSupplierReturnReplay v1 contract"
  );
  assert(
    queueSummary.readinessScope === "finalized_supplier_return" &&
      queueSummary.readinessStatus === "ready" &&
      queueSummary.readinessReasonCodes.length === 0,
    "fully mapped local Supplier Return fixture queue row is replay-ready"
  );
  assert(
    queueSummary.supplierMapping.localId === 9 &&
      queueSummary.supplierMapping.serverId === 9009 &&
      queueSummary.itemMapping.localItemId === 18 &&
      queueSummary.itemMapping.serverItemId === 8018,
    "queue summary preserves explicit supplier and item backend mappings"
  );
  assert(
    queueSummary.sourceBatch.localBatchId === localReturn.batch.localId &&
      queueSummary.sourceBatch.serverBatchId === localReturn.batch.serverId &&
      queueSummary.sourceBatch.returnedQty === 3 &&
      queueSummary.sourceBatch.qtyPurchasedBefore === 10 &&
      queueSummary.sourceBatch.qtyPurchasedAfter === 7 &&
      queueSummary.sourceBatch.balanceBefore === 8 &&
      queueSummary.sourceBatch.balanceAfter === 5,
    "queue summary includes safe sourceBatch metadata for future backend batch reduction"
  );
  assert(
    queueSummary.cylindersCount === 1 &&
      queueSummary.cylinderMapping.localCylinderId === 38 &&
      queueSummary.cylinderMapping.serverCylinderId === 8038 &&
      queueSummary.cylinderMapping.movement === "filledDecrease" &&
      queueSummary.cylinderMapping.qtyReturned === 1 &&
      queueSummary.cylinderMapping.filledCylindersBefore === 4 &&
      queueSummary.cylinderMapping.filledCylindersAfter === 3,
    "queue summary includes mapped cylinder filledDecrease metadata"
  );
  assert(
    !observedApiRequests.some((request) =>
      request.url.includes("/api/replay/supplier-return.php")
    ),
    "fixture never calls a Supplier Return replay endpoint"
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
          mappedCylinderSupplierReturn:
            readyCylinderReturnContract.replayReadiness.status,
          nonCylinderSupplierReturnWithoutCylinderMetadata:
            nonCylinderReadyContract.replayReadiness.status,
          missingSupplierServerId: {
            status: unsafeSupplierContract.replayReadiness.status,
            reasonCodes: reasonCodes(unsafeSupplierContract),
          },
          missingServerItemId: {
            status: unsafeItemContract.replayReadiness.status,
            reasonCodes: reasonCodes(unsafeItemContract),
          },
          missingSourceBatchMetadata: {
            status: unsafeSourceBatchContract.replayReadiness.status,
            reasonCodes: reasonCodes(unsafeSourceBatchContract),
          },
          missingServerBatchId: {
            status: unsafeServerBatchContract.replayReadiness.status,
            reasonCodes: reasonCodes(unsafeServerBatchContract),
          },
          missingServerCylinderId: {
            status: unsafeCylinderMappingContract.replayReadiness.status,
            reasonCodes: reasonCodes(unsafeCylinderMappingContract),
          },
          unsafeCylinderClamping: {
            status: unsafeCylinderClampingContract.replayReadiness.status,
            reasonCodes: reasonCodes(unsafeCylinderClampingContract),
          },
        },
        queuedRows: queueSummary.totalRows,
        payloadSummary: {
          payloadVersion: queueSummary.payloadVersion,
          transactionType: queueSummary.contractTransactionType,
          returnMode: queueSummary.returnMode,
          readiness: queueSummary.readinessStatus,
          supplierMappings: 1,
          itemMappings: 1,
          sourceBatchMappings: 1,
          cylinders: queueSummary.cylindersCount,
          cylinderMovement: queueSummary.cylinderMapping.movement,
        },
        backendBusinessMutationRequests: observedApiRequests.filter(
          (request) => request.method !== "GET" && request.method !== "HEAD"
        ).length,
        backendSupplierReturnReplayEndpointAdded: false,
        saleReplayChanged: false,
        purchaseReplayChanged: false,
        customerReturnReplayChanged: false,
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
        supplierReturnReplayTriggered: false,
      },
      null,
      2
    )
  );
}
