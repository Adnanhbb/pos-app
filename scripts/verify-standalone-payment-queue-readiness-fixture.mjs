#!/usr/bin/env node

/*
 * Safe packaged-Laragon standalone Payment queue-readiness fixture.
 *
 * This verifier opens the packaged frontend origin, blocks API requests, and
 * uses a uniquely named temporary IndexedDB database. It creates isolated local
 * Customer/Supplier payment rows, queues the hardened standalone payment v1
 * payloads, verifies ready/unsafe classifications, and deletes the temporary
 * database. It never opens the live POSDatabase and never triggers payment
 * replay.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const APP_URL = process.env.APP_URL || "http://localhost/jawad-bro-rehearsal/";
const builderPath = resolve(root, "src/services/posTransactionPayloadBuilder.ts");
const syncEnginePath = resolve(root, "src/services/syncEngine.ts");
const transactionApiPath = resolve(root, "src/api/transactionApi.ts");
const fixtureDatabaseName = `POSStandalonePaymentQueueReadinessFixture-${Date.now()}`;
const fixtureName = "Rehearsal Standalone Payment Queue Readiness Fixture";
const createdAt = Date.now();

const paymentReplayEndpoints = [
  resolve(root, "api/replay/customer-payment.php"),
  resolve(root, "api/replay/supplier-payment.php"),
];
const forbiddenGenericPaymentReplayEndpoints = [
  resolve(root, "api/replay/payment.php"),
  resolve(root, "api/replay/standalone-payment.php"),
];

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

const syncEngineSource = readFileSync(syncEnginePath, "utf8");
const transactionApiSource = readFileSync(transactionApiPath, "utf8");
const {
  buildStandaloneCustomerPaymentReplayContract,
  buildStandaloneSupplierPaymentReplayContract,
  buildPaymentTransactionPayload,
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
    paymentReplayEndpoints.every((endpointPath) => existsSync(endpointPath)) &&
      forbiddenGenericPaymentReplayEndpoints.every((endpointPath) => !existsSync(endpointPath)),
    "backend standalone payment replay endpoints are narrow and generic payment replay is absent"
  );
  assert(
    transactionApiSource.includes('apiClient.post("/replay/customer-payment.php", { clientTransactionId })') &&
      transactionApiSource.includes('apiClient.post("/replay/supplier-payment.php", { clientTransactionId })') &&
      !transactionApiSource.includes("/replay/payment.php") &&
      !transactionApiSource.includes("/replay/standalone-payment.php"),
    "transaction API uses only narrow standalone payment replay endpoints"
  );
  assert(
    syncEngineSource.includes("assertReadyStandaloneCustomerPaymentReplay") &&
      syncEngineSource.includes("assertReadyStandaloneSupplierPaymentReplay") &&
      syncEngineSource.includes("transactionApi.replayStandaloneCustomerPayment(item.payload.clientTransactionId)") &&
      syncEngineSource.includes("transactionApi.replayStandaloneSupplierPayment(item.payload.clientTransactionId)"),
    "manual replay routes only ready standalone Customer/Supplier Payment payloads"
  );

  const localFixture = await page.evaluate(
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
          ["customers", "suppliers"],
          "readwrite"
        );
        seed.objectStore("customers").put({
          id: 3,
          serverId: 3003,
          name: `${fixtureLabel} Ready Customer`,
          invoices: 0,
          payable: 500,
          paid: 0,
          balance: 500,
          isDeleted: false,
          deletedAt: null,
        });
        seed.objectStore("customers").put({
          id: 4,
          serverId: null,
          name: `${fixtureLabel} Unmapped Customer`,
          invoices: 0,
          payable: 500,
          paid: 0,
          balance: 500,
          isDeleted: false,
          deletedAt: null,
        });
        seed.objectStore("customers").put({
          id: 5,
          serverId: 3005,
          name: `${fixtureLabel} Invalid Amount Customer`,
          invoices: 0,
          payable: 500,
          paid: 0,
          balance: 500,
          isDeleted: false,
          deletedAt: null,
        });
        seed.objectStore("suppliers").put({
          id: 8,
          serverId: 8008,
          name: `${fixtureLabel} Ready Supplier`,
          invoices: 0,
          payable: 800,
          paid: 0,
          balance: 800,
          isDeleted: false,
          deletedAt: null,
        });
        seed.objectStore("suppliers").put({
          id: 9,
          serverId: null,
          name: `${fixtureLabel} Unmapped Supplier`,
          invoices: 0,
          payable: 800,
          paid: 0,
          balance: 800,
          isDeleted: false,
          deletedAt: null,
        });
        seed.objectStore("suppliers").put({
          id: 10,
          serverId: 8010,
          name: `${fixtureLabel} Invalid Amount Supplier`,
          invoices: 0,
          payable: 800,
          paid: 0,
          balance: 800,
          isDeleted: false,
          deletedAt: null,
        });
        await transactionDone(seed);

        const write = database.transaction(
          ["customer_payments", "supplier_payments"],
          "readwrite"
        );
        const customerReadyPaymentId = await requestResult(
          write.objectStore("customer_payments").add({
            customerId: 3,
            amount: 125,
            paymentDate: "2026-06-04",
            remarks: `${fixtureLabel} customer ready payment`,
            payableSnapshot: 500,
            balanceSnapshot: 375,
          })
        );
        const customerMissingServerPaymentId = await requestResult(
          write.objectStore("customer_payments").add({
            customerId: 4,
            amount: 125,
            paymentDate: "2026-06-04",
            remarks: `${fixtureLabel} customer unmapped payment`,
            payableSnapshot: 500,
            balanceSnapshot: 375,
          })
        );
        const customerInvalidAmountPaymentId = await requestResult(
          write.objectStore("customer_payments").add({
            customerId: 5,
            amount: 0,
            paymentDate: "2026-06-04",
            remarks: `${fixtureLabel} customer invalid amount payment`,
            payableSnapshot: 500,
            balanceSnapshot: 500,
          })
        );
        const supplierReadyPaymentId = await requestResult(
          write.objectStore("supplier_payments").add({
            supplierId: 8,
            amount: 225,
            paymentDate: "2026-06-04",
            remarks: `${fixtureLabel} supplier ready payment`,
            payableSnapshot: 800,
            balanceSnapshot: 575,
          })
        );
        const supplierMissingServerPaymentId = await requestResult(
          write.objectStore("supplier_payments").add({
            supplierId: 9,
            amount: 225,
            paymentDate: "2026-06-04",
            remarks: `${fixtureLabel} supplier unmapped payment`,
            payableSnapshot: 800,
            balanceSnapshot: 575,
          })
        );
        const supplierInvalidAmountPaymentId = await requestResult(
          write.objectStore("supplier_payments").add({
            supplierId: 10,
            amount: -1,
            paymentDate: "2026-06-04",
            remarks: `${fixtureLabel} supplier invalid amount payment`,
            payableSnapshot: 800,
            balanceSnapshot: 801,
          })
        );
        await transactionDone(write);

        const read = database.transaction(
          ["customers", "suppliers", "customer_payments", "supplier_payments"],
          "readonly"
        );
        const customerReady = await requestResult(
          read.objectStore("customers").get(3)
        );
        const customerMissingServer = await requestResult(
          read.objectStore("customers").get(4)
        );
        const customerInvalidAmount = await requestResult(
          read.objectStore("customers").get(5)
        );
        const supplierReady = await requestResult(
          read.objectStore("suppliers").get(8)
        );
        const supplierMissingServer = await requestResult(
          read.objectStore("suppliers").get(9)
        );
        const supplierInvalidAmount = await requestResult(
          read.objectStore("suppliers").get(10)
        );
        const customerReadyPayment = await requestResult(
          read.objectStore("customer_payments").get(customerReadyPaymentId)
        );
        const customerMissingServerPayment = await requestResult(
          read
            .objectStore("customer_payments")
            .get(customerMissingServerPaymentId)
        );
        const customerInvalidAmountPayment = await requestResult(
          read
            .objectStore("customer_payments")
            .get(customerInvalidAmountPaymentId)
        );
        const supplierReadyPayment = await requestResult(
          read.objectStore("supplier_payments").get(supplierReadyPaymentId)
        );
        const supplierMissingServerPayment = await requestResult(
          read
            .objectStore("supplier_payments")
            .get(supplierMissingServerPaymentId)
        );
        const supplierInvalidAmountPayment = await requestResult(
          read
            .objectStore("supplier_payments")
            .get(supplierInvalidAmountPaymentId)
        );

        return {
          customers: {
            ready: customerReady,
            missingServer: customerMissingServer,
            invalidAmount: customerInvalidAmount,
          },
          suppliers: {
            ready: supplierReady,
            missingServer: supplierMissingServer,
            invalidAmount: supplierInvalidAmount,
          },
          customerPayments: {
            ready: customerReadyPayment,
            missingServer: customerMissingServerPayment,
            invalidAmount: customerInvalidAmountPayment,
          },
          supplierPayments: {
            ready: supplierReadyPayment,
            missingServer: supplierMissingServerPayment,
            invalidAmount: supplierInvalidAmountPayment,
          },
        };
      } finally {
        database.close();
      }
    },
    { databaseName: fixtureDatabaseName, fixtureLabel: fixtureName }
  );

  assert(
    Boolean(localFixture.customerPayments.ready?.id) &&
      Boolean(localFixture.supplierPayments.ready?.id),
    "local customer and supplier payment fixture rows are created"
  );
  assert(
    localFixture.customers.ready.id !== localFixture.customers.ready.serverId &&
      localFixture.suppliers.ready.id !== localFixture.suppliers.ready.serverId,
    "fixture separates local party ids from backend server ids"
  );

  function customerPayloadFor(scenario, payment, customer) {
    const clientTransactionId = `txn_rehearsal_customer_payment_${scenario}_${createdAt}`;
    const contract = buildStandaloneCustomerPaymentReplayContract({
      operation: "create",
      localPaymentId: payment.id,
      clientTransactionId,
      createdAt,
      customer: {
        localId: customer.id,
        serverId: customer.serverId ?? null,
        nameSnapshot: customer.name,
      },
      payment: {
        amount: payment.amount,
        paymentDate: payment.paymentDate,
        remarks: payment.remarks ?? "",
        invoiceNo: payment.invoiceNo ?? "",
        payableSnapshot: payment.payableSnapshot,
        balanceSnapshot: payment.balanceSnapshot,
      },
    });

    const payload = buildPaymentTransactionPayload({
      clientTransactionId,
      createdAt,
      partyType: "customer",
      payment,
      customer: {
        before: customer,
        after: {
          ...customer,
          paid: (customer.paid ?? 0) + payment.amount,
          balance: (customer.balance ?? 0) - payment.amount,
        },
      },
      standaloneCustomerPaymentReplay: contract,
    });

    return { scenario, payload, contract };
  }

  function supplierPayloadFor(scenario, payment, supplier) {
    const clientTransactionId = `txn_rehearsal_supplier_payment_${scenario}_${createdAt}`;
    const contract = buildStandaloneSupplierPaymentReplayContract({
      operation: "create",
      localPaymentId: payment.id,
      clientTransactionId,
      createdAt,
      supplier: {
        localId: supplier.id,
        serverId: supplier.serverId ?? null,
        nameSnapshot: supplier.name,
      },
      payment: {
        amount: payment.amount,
        paymentDate: payment.paymentDate,
        remarks: payment.remarks ?? "",
        invoiceNo: payment.invoiceNo ?? "",
        payableSnapshot: payment.payableSnapshot,
        balanceSnapshot: payment.balanceSnapshot,
      },
    });

    const payload = buildPaymentTransactionPayload({
      clientTransactionId,
      createdAt,
      partyType: "supplier",
      payment,
      supplier: {
        before: supplier,
        after: {
          ...supplier,
          paid: (supplier.paid ?? 0) + payment.amount,
          balance: (supplier.payable ?? 0) - ((supplier.paid ?? 0) + payment.amount),
        },
      },
      standaloneSupplierPaymentReplay: contract,
    });

    return { scenario, payload, contract };
  }

  const customerScenarios = [
    customerPayloadFor(
      "ready",
      localFixture.customerPayments.ready,
      localFixture.customers.ready
    ),
    customerPayloadFor(
      "missing_server",
      localFixture.customerPayments.missingServer,
      localFixture.customers.missingServer
    ),
    customerPayloadFor(
      "invalid_amount",
      localFixture.customerPayments.invalidAmount,
      localFixture.customers.invalidAmount
    ),
  ];
  const supplierScenarios = [
    supplierPayloadFor(
      "ready",
      localFixture.supplierPayments.ready,
      localFixture.suppliers.ready
    ),
    supplierPayloadFor(
      "missing_server",
      localFixture.supplierPayments.missingServer,
      localFixture.suppliers.missingServer
    ),
    supplierPayloadFor(
      "invalid_amount",
      localFixture.supplierPayments.invalidAmount,
      localFixture.suppliers.invalidAmount
    ),
  ];

  assert(
    customerScenarios[0].contract.replayReadiness.status === "ready",
    "Customer Payment is ready when customer serverId exists"
  );
  assert(
    customerScenarios[1].contract.replayReadiness.status === "unsafe" &&
      reasonCodes(customerScenarios[1].contract).includes("missing_party_server_id"),
    "Customer Payment is unsafe when customer serverId is missing"
  );
  assert(
    customerScenarios[2].contract.replayReadiness.status === "unsafe" &&
      reasonCodes(customerScenarios[2].contract).includes("invalid_payment_amount"),
    "Customer Payment is unsafe when amount is invalid"
  );
  assert(
    supplierScenarios[0].contract.replayReadiness.status === "ready",
    "Supplier Payment is ready when supplier serverId exists"
  );
  assert(
    supplierScenarios[1].contract.replayReadiness.status === "unsafe" &&
      reasonCodes(supplierScenarios[1].contract).includes("missing_party_server_id"),
    "Supplier Payment is unsafe when supplier serverId is missing"
  );
  assert(
    supplierScenarios[2].contract.replayReadiness.status === "unsafe" &&
      reasonCodes(supplierScenarios[2].contract).includes("invalid_payment_amount"),
    "Supplier Payment is unsafe when amount is invalid"
  );

  const queueSummary = await page.evaluate(
    async ({ databaseName, queuedRows, queuedAt }) => {
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
        for (const row of queuedRows) {
          await requestResult(
            write.objectStore("sync_queue").add({
              entity: "transactions",
              operation: "transaction",
              localId: row.payload.clientTransactionId,
              payload: row.payload,
              replayReadiness: row.payload.replayReadiness,
              createdAt: queuedAt,
              updatedAt: queuedAt,
              retryCount: 0,
              status: "pending",
            })
          );
        }
        await transactionDone(write);

        const read = database.transaction("sync_queue", "readonly");
        const rows = await requestResult(read.objectStore("sync_queue").getAll());
        return rows.map((row) => {
          const customerContract =
            row.payload?.payload?.standaloneCustomerPaymentReplay ?? null;
          const supplierContract =
            row.payload?.payload?.standaloneSupplierPaymentReplay ?? null;
          const contract = customerContract ?? supplierContract;
          const party = customerContract ? "customer" : "supplier";
          const partyReference = customerContract
            ? customerContract.customer
            : supplierContract?.supplier;

          return {
            queueStatus: row.status,
            entity: row.entity,
            operation: row.operation,
            party,
            payloadVersion: contract?.payloadVersion ?? null,
            operationName: contract?.operation ?? null,
            localPaymentId: contract?.localPaymentId ?? null,
            clientPaymentId: contract?.clientPaymentId ?? null,
            partyLocalId: partyReference?.localId ?? null,
            partyServerId: partyReference?.serverId ?? null,
            amount: contract?.payment?.amount ?? null,
            paymentDatePresent:
              typeof contract?.payment?.paymentDate === "string" &&
              contract.payment.paymentDate.length > 0,
            readinessScope: row.replayReadiness?.scope ?? null,
            readinessStatus: row.replayReadiness?.status ?? null,
            readinessReasonCodes: (row.replayReadiness?.reasons ?? []).map(
              (reason) => reason.code
            ),
            hasPayloadBody: Boolean(row.payload),
          };
        });
      } finally {
        database.close();
      }
    },
    {
      databaseName: fixtureDatabaseName,
      queuedRows: [...customerScenarios, ...supplierScenarios].map(
        ({ payload }) => ({ payload })
      ),
      queuedAt: Date.now(),
    }
  );

  assert(queueSummary.length === 6, "six isolated standalone payment queue rows are created");
  assert(
    queueSummary.every(
      (row) =>
        row.entity === "transactions" &&
        row.operation === "transaction" &&
        row.queueStatus === "pending" &&
        row.payloadVersion === 1 &&
        row.operationName === "create"
    ),
    "all queued standalone payment rows are pending create transaction rows"
  );

  const customerReadySummary = queueSummary.find(
    (row) => row.party === "customer" && row.readinessStatus === "ready"
  );
  const supplierReadySummary = queueSummary.find(
    (row) => row.party === "supplier" && row.readinessStatus === "ready"
  );
  const customerUnsafeSummaries = queueSummary.filter(
    (row) => row.party === "customer" && row.readinessStatus === "unsafe"
  );
  const supplierUnsafeSummaries = queueSummary.filter(
    (row) => row.party === "supplier" && row.readinessStatus === "unsafe"
  );

  assert(
    customerReadySummary?.readinessScope === "standalone_customer_payment" &&
      customerReadySummary.partyServerId === 3003,
    "queued Customer Payment ready row carries mapped customer serverId"
  );
  assert(
    supplierReadySummary?.readinessScope === "standalone_supplier_payment" &&
      supplierReadySummary.partyServerId === 8008,
    "queued Supplier Payment ready row carries mapped supplier serverId"
  );
  assert(
    customerUnsafeSummaries.some((row) =>
      row.readinessReasonCodes.includes("missing_party_server_id")
    ) &&
      customerUnsafeSummaries.some((row) =>
        row.readinessReasonCodes.includes("invalid_payment_amount")
      ),
    "queued Customer Payment unsafe rows include missing serverId and invalid amount"
  );
  assert(
    supplierUnsafeSummaries.some((row) =>
      row.readinessReasonCodes.includes("missing_party_server_id")
    ) &&
      supplierUnsafeSummaries.some((row) =>
        row.readinessReasonCodes.includes("invalid_payment_amount")
      ),
    "queued Supplier Payment unsafe rows include missing serverId and invalid amount"
  );
  assert(
    queueSummary.every(
      (row) =>
        typeof row.localPaymentId === "number" &&
        row.clientPaymentId.includes(`payment-local-${row.localPaymentId}`)
    ),
    "queued standalone payment rows include stable local payment correlation ids"
  );
  assert(
    !observedApiRequests.some((request) => request.url.includes("/api/replay/")),
    "fixture never calls any backend replay endpoint"
  );
  assert(
    observedApiRequests.every((request) =>
      request.method === "GET" || request.method === "HEAD"
    ),
    "fixture performs no backend business mutation requests"
  );

  const unsafeReasonCodes = [
    ...new Set(
      queueSummary.flatMap((row) => row.readinessReasonCodes)
    ),
  ].sort();

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
        queuedRows: queueSummary.length,
        scenarios: {
          customerPaymentReady:
            customerScenarios[0].contract.replayReadiness.status,
          customerPaymentMissingServerId: {
            status: customerScenarios[1].contract.replayReadiness.status,
            reasonCodes: reasonCodes(customerScenarios[1].contract),
          },
          customerPaymentInvalidAmount: {
            status: customerScenarios[2].contract.replayReadiness.status,
            reasonCodes: reasonCodes(customerScenarios[2].contract),
          },
          supplierPaymentReady:
            supplierScenarios[0].contract.replayReadiness.status,
          supplierPaymentMissingServerId: {
            status: supplierScenarios[1].contract.replayReadiness.status,
            reasonCodes: reasonCodes(supplierScenarios[1].contract),
          },
          supplierPaymentInvalidAmount: {
            status: supplierScenarios[2].contract.replayReadiness.status,
            reasonCodes: reasonCodes(supplierScenarios[2].contract),
          },
        },
        payloadSummary: {
          contracts: [
            "standaloneCustomerPaymentReplay v1",
            "standaloneSupplierPaymentReplay v1",
          ],
          customerRows: queueSummary.filter((row) => row.party === "customer")
            .length,
          supplierRows: queueSummary.filter((row) => row.party === "supplier")
            .length,
          readyRows: queueSummary.filter((row) => row.readinessStatus === "ready")
            .length,
          unsafeRows: queueSummary.filter(
            (row) => row.readinessStatus === "unsafe"
          ).length,
          unsafeReasonCodes,
        },
        manualReplayStatus:
          "Standalone Payment replay endpoints exist, but this fixture does not invoke manual replay.",
        backendPaymentReplayEndpointAdded: true,
        paymentReplayTriggered: false,
        finalizedTransactionReplayChanged: false,
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
        paymentReplayTriggered: false,
      },
      null,
      2
    )
  );
}
