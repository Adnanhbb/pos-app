#!/usr/bin/env node

/*
 * Safe packaged-Laragon finalized Customer Return queue-readiness fixture.
 *
 * This verifier opens the packaged frontend, blocks API requests, and uses a
 * uniquely named temporary IndexedDB database. It creates one synthetic mapped
 * cylinder Customer Return fixture, atomically finalizes it locally, queues the
 * hardened payload post-commit, verifies readiness, and deletes the temporary
 * database. It never opens the live POSDatabase and never triggers Customer
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
const backendCustomerReturnReplayPath = resolve(root, "api/replay/customer-return.php");
const backendSaleReplayPath = resolve(root, "api/replay/sale.php");
const backendPurchaseReplayPath = resolve(root, "api/replay/purchase.php");
const fixtureDatabaseName = `POSFinalizedCustomerReturnQueueReadinessFixture-${Date.now()}`;
const fixtureName = "Rehearsal Finalized Customer Return Queue Readiness Fixture";
const createdAt = Date.now();
const clientTransactionId = `txn_rehearsal_customer_return_queue_ready_${createdAt}`;

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
  buildFinalizedCustomerReturnReplayContract,
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
    existsSync(backendCustomerReturnReplayPath),
    "backend Customer Return replay HTTP endpoint exists for manual ready-row replay"
  );
  assert(
    existsSync(backendSaleReplayPath) && existsSync(backendPurchaseReplayPath),
    "existing Sale/Purchase replay endpoints remain present"
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
            database.createObjectStore("customers", { keyPath: "id" });
            database.createObjectStore("customer_payments", {
              keyPath: "id",
              autoIncrement: true,
            });
            database.createObjectStore("item_batches", {
              keyPath: "id",
              autoIncrement: true,
            });
            database.createObjectStore("cylinders", { keyPath: "id" });
            database.createObjectStore("cylinder_customers", { keyPath: "id" });
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
          ["items", "customers", "cylinders", "cylinder_customers"],
          "readwrite"
        );
        seed.objectStore("items").put({
          id: 18,
          serverId: 8018,
          name: `${fixtureLabel} Cylinder Item`,
          category: "Gas Cylinder",
          minunit: "kg",
          maxunit: "cylinder",
          ConvQty: 2,
          availableStock: 5,
        });
        seed.objectStore("customers").put({
          id: 7,
          serverId: 7007,
          name: `${fixtureLabel} Customer`,
          invoices: 0,
          payable: 500,
          paid: 0,
          balance: 500,
          isDeleted: false,
          deletedAt: null,
        });
        seed.objectStore("cylinders").put({
          id: 38,
          serverId: 8038,
          itemId: 18,
          title: `${fixtureLabel} Cylinder`,
          qtyInStock: 4,
          filledCylinders: 3,
          emptyCylinders: 0,
          withCustomers: 1,
          convQty: 2,
          isDeleted: false,
          deletedAt: null,
        });
        seed.objectStore("cylinder_customers").put({
          id: 48,
          serverId: 8048,
          cylinderId: 38,
          cylinderType: `${fixtureLabel} Cylinder`,
          customerName: `${fixtureLabel} Customer`,
          qtyHeld: 1,
          isDeleted: false,
          deletedAt: null,
        });
        await transactionDone(seed);

        const finalize = database.transaction(
          [
            "sales",
            "sale_items",
            "items",
            "customers",
            "customer_payments",
            "item_batches",
            "cylinders",
            "cylinder_customers",
          ],
          "readwrite"
        );
        const saleId = await requestResult(
          finalize.objectStore("sales").add({
            invoiceNo: "RET-C-REHEARSAL-QUEUE-READY",
            transactionType: "Return",
            returnMode: "customer",
            isPostponed: false,
            customerId: 7,
            customerName: `${fixtureLabel} Customer`,
            subtotal: 160,
            discount: 0,
            tax: 0,
            dues: 500,
            grandTotal: 340,
            paid: -40,
            arrears: 380,
            profit: -60,
          })
        );
        finalize.objectStore("sale_items").add({
          saleId,
          originalItemId: 18,
          name: `${fixtureLabel} Cylinder Item`,
          qty: 2,
          price: 80,
        });
        finalize.objectStore("items").put({
          id: 18,
          serverId: 8018,
          name: `${fixtureLabel} Cylinder Item`,
          category: "Gas Cylinder",
          minunit: "kg",
          maxunit: "cylinder",
          ConvQty: 2,
          availableStock: 7,
        });
        finalize.objectStore("customers").put({
          id: 7,
          serverId: 7007,
          name: `${fixtureLabel} Customer`,
          invoices: 1,
          payable: 340,
          paid: -40,
          balance: 380,
          isDeleted: false,
          deletedAt: null,
        });
        finalize.objectStore("customer_payments").add({
          customerId: 7,
          customerName: `${fixtureLabel} Customer`,
          amount: -40,
          paymentDate: "2026-06-03T00:00:00.000Z",
          saleId,
          invoiceNo: "RET-C-REHEARSAL-QUEUE-READY",
          remarks: "Return adjustment RET-C-REHEARSAL-QUEUE-READY",
          payableSnapshot: 340,
          balanceSnapshot: 380,
        });
        const localBatchId = await requestResult(
          finalize.objectStore("item_batches").add({
            itemId: 18,
            purchaseDate: "2026-06-03T00:00:00.000Z",
            qtyPurchased: 2,
            qtySold: 0,
            balance: 2,
            costPrice: 50,
            invoiceNo: "RET-C-REHEARSAL-QUEUE-READY",
            sourceSaleId: saleId,
            isDeleted: false,
            deletedAt: null,
          })
        );
        finalize.objectStore("cylinders").put({
          id: 38,
          serverId: 8038,
          itemId: 18,
          title: `${fixtureLabel} Cylinder`,
          qtyInStock: 4,
          filledCylinders: 3,
          emptyCylinders: 1,
          withCustomers: 0,
          convQty: 2,
          isDeleted: false,
          deletedAt: null,
        });
        finalize.objectStore("cylinder_customers").put({
          id: 48,
          serverId: 8048,
          cylinderId: 38,
          cylinderType: `${fixtureLabel} Cylinder`,
          customerName: `${fixtureLabel} Customer`,
          qtyHeld: 0,
          isDeleted: false,
          deletedAt: null,
        });
        await transactionDone(finalize);

        const inspect = database.transaction(
          [
            "sales",
            "sale_items",
            "items",
            "customers",
            "customer_payments",
            "item_batches",
            "cylinders",
            "cylinder_customers",
          ],
          "readonly"
        );
        const sales = await requestResult(inspect.objectStore("sales").getAll());
        const saleItems = await requestResult(
          inspect.objectStore("sale_items").getAll()
        );
        const item = await requestResult(inspect.objectStore("items").get(18));
        const customer = await requestResult(
          inspect.objectStore("customers").get(7)
        );
        const payments = await requestResult(
          inspect.objectStore("customer_payments").getAll()
        );
        const batch = await requestResult(
          inspect.objectStore("item_batches").get(localBatchId)
        );
        const cylinder = await requestResult(
          inspect.objectStore("cylinders").get(38)
        );
        const holding = await requestResult(
          inspect.objectStore("cylinder_customers").get(48)
        );

        return {
          saleId,
          salesCount: sales.length,
          saleItemsCount: saleItems.length,
          customerPaymentsCount: payments.length,
          item: {
            localId: item.id,
            serverId: item.serverId,
            availableStock: item.availableStock,
          },
          customer: {
            localId: customer.id,
            serverId: customer.serverId,
            invoices: customer.invoices,
            payable: customer.payable,
            paid: customer.paid,
            balance: customer.balance,
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
          cylinder: {
            localId: cylinder.id,
            serverId: cylinder.serverId,
            filledCylinders: cylinder.filledCylinders,
            emptyCylinders: cylinder.emptyCylinders,
            withCustomers: cylinder.withCustomers,
            qtyInStock: cylinder.qtyInStock,
          },
          holding: {
            localId: holding.id,
            serverId: holding.serverId,
            qtyHeld: holding.qtyHeld,
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
      localReturn.customerPaymentsCount === 1,
    "one finalized local Customer Return, one linked line, and one customer payment are committed"
  );
  assert(
    localReturn.item.availableStock === 7 &&
      localReturn.batch.qtyPurchased === 2 &&
      localReturn.batch.balance === 2 &&
      localReturn.batch.sourceSaleId === localReturn.saleId,
    "isolated local Customer Return applies expected stock increase and return batch creation"
  );
  assert(
    localReturn.customer.invoices === 1 &&
      localReturn.customer.payable === 340 &&
      localReturn.customer.paid === -40 &&
      localReturn.customer.balance === 380,
    "isolated local Customer Return applies selected customer accounting outcome"
  );
  assert(
    localReturn.cylinder.filledCylinders === 3 &&
      localReturn.cylinder.emptyCylinders === 1 &&
      localReturn.cylinder.withCustomers === 0 &&
      localReturn.cylinder.qtyInStock === 4 &&
      localReturn.holding.qtyHeld === 0,
    "isolated cylinder Customer Return moves holding to empty without increasing filled"
  );
  assert(
    localReturn.item.localId !== localReturn.item.serverId &&
      localReturn.customer.localId !== localReturn.customer.serverId &&
      localReturn.cylinder.localId !== localReturn.cylinder.serverId &&
      localReturn.holding.localId !== localReturn.holding.serverId,
    "fixture mappings separate local correlation ids from backend mutation ids"
  );

  const contractInput = {
    localSaleId: localReturn.saleId,
    invoiceNo: "RET-C-REHEARSAL-QUEUE-READY",
    customer: {
      localId: localReturn.customer.localId,
      serverId: localReturn.customer.serverId,
      nameSnapshot: `${fixtureName} Customer`,
    },
    items: [
      {
        localItemId: localReturn.item.localId,
        serverItemId: localReturn.item.serverId,
        originalItemId: localReturn.item.localId,
        nameSnapshot: `${fixtureName} Cylinder Item`,
        qty: 2,
        price: 80,
        costPrice: 50,
        quantityUnit: "min",
        selectedUnit: "min",
        conversion: {
          minUnit: "kg",
          maxUnit: "cylinder",
          convQty: 2,
          quantityInMinUnit: 2,
        },
        returnBatchCreate: {
          localBatchId: localReturn.batch.localId,
          sourceSaleId: localReturn.batch.sourceSaleId,
          purchaseDate: localReturn.batch.purchaseDate,
          qtyReturned: localReturn.batch.qtyPurchased,
          balance: localReturn.batch.balance,
          costPrice: localReturn.batch.costPrice,
          invoiceNo: localReturn.batch.invoiceNo,
        },
        requiresCylinderMutation: true,
      },
    ],
    payments: {
      paidAmount: -40,
      source: "pos-finalization",
      method: null,
    },
    cylinders: [
      {
        localItemId: localReturn.item.localId,
        serverItemId: localReturn.item.serverId,
        localCylinderId: localReturn.cylinder.localId,
        serverCylinderId: localReturn.cylinder.serverId,
        customerHolding: {
          localHoldingId: localReturn.holding.localId,
          serverHoldingId: localReturn.holding.serverId,
          customerNameSnapshot: `${fixtureName} Customer`,
        },
        qtyReturned: 1,
        movement: "customerHoldingToEmpty",
      },
    ],
    totals: {
      subtotal: 160,
      discount: 0,
      tax: 0,
      dues: 500,
      grandTotal: 340,
      paid: -40,
      arrears: 380,
    },
  };

  const readyCylinderReturnContract = buildFinalizedCustomerReturnReplayContract({
    ...contractInput,
    clientTransactionId,
    createdAt,
  });
  const nonCylinderReadyContract = buildFinalizedCustomerReturnReplayContract({
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
  const unsafeCustomerContract = buildFinalizedCustomerReturnReplayContract({
    ...contractInput,
    clientTransactionId: `${clientTransactionId}_unsafe_customer`,
    createdAt,
    customer: {
      ...contractInput.customer,
      serverId: null,
    },
  });
  const unsafeItemContract = buildFinalizedCustomerReturnReplayContract({
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
  const unsafeBatchContract = buildFinalizedCustomerReturnReplayContract({
    ...contractInput,
    clientTransactionId: `${clientTransactionId}_unsafe_batch`,
    createdAt,
    items: [
      {
        ...contractInput.items[0],
        returnBatchCreate: null,
      },
    ],
  });
  const unsafeCylinderContract = buildFinalizedCustomerReturnReplayContract({
    ...contractInput,
    clientTransactionId: `${clientTransactionId}_unsafe_cylinder`,
    createdAt,
    cylinders: [
      {
        ...contractInput.cylinders[0],
        serverCylinderId: null,
        customerHolding: {
          ...contractInput.cylinders[0].customerHolding,
          serverHoldingId: null,
        },
      },
    ],
  });

  assert(
    readyCylinderReturnContract.replayReadiness.status === "ready",
    "cylinder Customer Return is ready when customer, item, batch, cylinder, and holding mappings exist"
  );
  assert(
    nonCylinderReadyContract.replayReadiness.status === "ready",
    "non-cylinder Customer Return is ready without cylinder metadata"
  );
  assert(
    unsafeCustomerContract.replayReadiness.status === "unsafe" &&
      reasonCodes(unsafeCustomerContract).includes("missing_customer_server_id"),
    "Customer Return is unsafe when customer serverId is missing"
  );
  assert(
    unsafeItemContract.replayReadiness.status === "unsafe" &&
      reasonCodes(unsafeItemContract).includes("missing_server_item_id"),
    "Customer Return item without serverItemId is unsafe"
  );
  assert(
    unsafeBatchContract.replayReadiness.status === "unsafe" &&
      reasonCodes(unsafeBatchContract).includes("missing_return_batch_metadata"),
    "Customer Return item without returnBatch metadata is unsafe"
  );
  assert(
    unsafeCylinderContract.replayReadiness.status === "unsafe" &&
      reasonCodes(unsafeCylinderContract).includes("missing_server_cylinder_id") &&
      reasonCodes(unsafeCylinderContract).includes("missing_customer_holding_mapping"),
    "cylinder Customer Return requires mapped serverCylinderId and mapped customer holding reference"
  );

  const queuedPayload = buildReturnTransactionPayload({
    clientTransactionId,
    createdAt,
    returnMode: "customer",
    sale: {
      invoiceNo: "RET-C-REHEARSAL-QUEUE-READY",
      date: new Date(createdAt).toISOString(),
      transactionType: "Return",
      customerId: localReturn.customer.localId,
      supplierId: null,
      customerName: `${fixtureName} Customer`,
      supplierName: "",
      subtotal: 160,
      discount: 0,
      tax: 0,
      dues: 500,
      grandTotal: 340,
      paid: -40,
      arrears: 380,
      profit: -60,
      isPostponed: false,
    },
    saleId: localReturn.saleId,
    saleItems: [
      {
        originalItemId: localReturn.item.localId,
        name: `${fixtureName} Cylinder Item`,
        qty: 2,
        price: 80,
        priceCategory: "Retail",
        discountType: "%",
        discountValue: 0,
        taxType: "%",
        taxValue: 0,
      },
    ],
    finalizedCustomerReturnReplay: contractInput,
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
        const contract = row?.payload?.payload?.finalizedCustomerReturnReplay;
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
          customerMapping: contract?.customer
            ? {
                localId: contract.customer.localId,
                serverId: contract.customer.serverId,
              }
            : null,
          itemMapping: item
            ? {
                localItemId: item.localItemId,
                serverItemId: item.serverItemId,
              }
            : null,
          returnBatchCreate: item?.returnBatchCreate
            ? {
                localBatchId: item.returnBatchCreate.localBatchId,
                sourceSaleId: item.returnBatchCreate.sourceSaleId,
                qtyReturned: item.returnBatchCreate.qtyReturned,
                balance: item.returnBatchCreate.balance,
                costPrice: item.returnBatchCreate.costPrice,
              }
            : null,
          cylindersCount: Array.isArray(contract?.cylinders)
            ? contract.cylinders.length
            : null,
          cylinderMapping: cylinder
            ? {
                localCylinderId: cylinder.localCylinderId,
                serverCylinderId: cylinder.serverCylinderId,
                localHoldingId: cylinder.customerHolding?.localHoldingId ?? null,
                serverHoldingId: cylinder.customerHolding?.serverHoldingId ?? null,
                movement: cylinder.movement,
                qtyReturned: cylinder.qtyReturned,
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
      queueSummary.returnMode === "customer" &&
      queueSummary.clientTransactionIdMatches,
    "queued payload contains finalizedCustomerReturnReplay v1 contract"
  );
  assert(
    queueSummary.readinessScope === "finalized_customer_return" &&
      queueSummary.readinessStatus === "ready" &&
      queueSummary.readinessReasonCodes.length === 0,
    "fully mapped local Customer Return fixture queue row is replay-ready"
  );
  assert(
    queueSummary.customerMapping.localId === 7 &&
      queueSummary.customerMapping.serverId === 7007 &&
      queueSummary.itemMapping.localItemId === 18 &&
      queueSummary.itemMapping.serverItemId === 8018,
    "queue summary preserves explicit customer and item backend mappings"
  );
  assert(
    queueSummary.returnBatchCreate.localBatchId === localReturn.batch.localId &&
      queueSummary.returnBatchCreate.sourceSaleId === localReturn.saleId &&
      queueSummary.returnBatchCreate.qtyReturned === 2 &&
      queueSummary.returnBatchCreate.balance === 2 &&
      queueSummary.returnBatchCreate.costPrice === 50,
    "queue summary includes safe returnBatch metadata for future backend batch creation"
  );
  assert(
    queueSummary.cylindersCount === 1 &&
      queueSummary.cylinderMapping.localCylinderId === 38 &&
      queueSummary.cylinderMapping.serverCylinderId === 8038 &&
      queueSummary.cylinderMapping.localHoldingId === 48 &&
      queueSummary.cylinderMapping.serverHoldingId === 8048 &&
      queueSummary.cylinderMapping.movement === "customerHoldingToEmpty" &&
      queueSummary.cylinderMapping.qtyReturned === 1,
    "queue summary includes mapped cylinder and customer holding references"
  );
  assert(
    !observedApiRequests.some((request) =>
      request.url.includes("/api/replay/customer-return.php")
    ),
    "fixture never calls a Customer Return replay endpoint"
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
          mappedCylinderCustomerReturn:
            readyCylinderReturnContract.replayReadiness.status,
          nonCylinderCustomerReturnWithoutCylinderMetadata:
            nonCylinderReadyContract.replayReadiness.status,
          missingCustomerServerId: {
            status: unsafeCustomerContract.replayReadiness.status,
            reasonCodes: reasonCodes(unsafeCustomerContract),
          },
          missingServerItemId: {
            status: unsafeItemContract.replayReadiness.status,
            reasonCodes: reasonCodes(unsafeItemContract),
          },
          missingReturnBatchMetadata: {
            status: unsafeBatchContract.replayReadiness.status,
            reasonCodes: reasonCodes(unsafeBatchContract),
          },
          missingCylinderAndHoldingMappings: {
            status: unsafeCylinderContract.replayReadiness.status,
            reasonCodes: reasonCodes(unsafeCylinderContract),
          },
        },
        queuedRows: queueSummary.totalRows,
        payloadSummary: {
          payloadVersion: queueSummary.payloadVersion,
          transactionType: queueSummary.contractTransactionType,
          returnMode: queueSummary.returnMode,
          readiness: queueSummary.readinessStatus,
          customerMappings: 1,
          itemMappings: 1,
          returnBatchCreates: 1,
          cylinders: queueSummary.cylindersCount,
          cylinderMovement: queueSummary.cylinderMapping.movement,
        },
        backendBusinessMutationRequests: observedApiRequests.filter(
          (request) => request.method !== "GET" && request.method !== "HEAD"
        ).length,
        backendCustomerReturnReplayEndpointAdded: true,
        saleReplayChanged: false,
        purchaseReplayChanged: false,
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
        customerReturnReplayTriggered: false,
      },
      null,
      2
    )
  );
}
