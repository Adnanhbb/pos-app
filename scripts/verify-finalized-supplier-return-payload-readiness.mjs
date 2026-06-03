#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const builderPath = resolve(root, "src/services/posTransactionPayloadBuilder.ts");
const queueServicePath = resolve(root, "src/services/transactionQueueService.ts");
const queueReportPath = resolve(root, "scripts/report-sync-queue.mjs");
const posPath = resolve(root, "src/POS.tsx");
const syncEnginePath = resolve(root, "src/services/syncEngine.ts");
const transactionApiPath = resolve(root, "src/api/transactionApi.ts");
const finalizationPath = resolve(root, "src/services/localPOSFinalizationService.ts");
const backendSupplierReturnReplayPath = resolve(root, "api/replay/supplier-return.php");
const backendSaleReplayPath = resolve(root, "api/replay/sale.php");
const backendPurchaseReplayPath = resolve(root, "api/replay/purchase.php");
const backendCustomerReturnReplayPath = resolve(root, "api/replay/customer-return.php");

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

function supplierReturnHeader(overrides = {}) {
  return {
    invoiceNo: "RET-S-REHEARSAL-PAYLOAD-READY",
    date: "2026-06-03T00:00:00.000Z",
    transactionType: "Return",
    customerId: null,
    supplierId: 9,
    customerName: "",
    supplierName: "Replay Fixture Supplier",
    subtotal: 150,
    discount: 0,
    tax: 0,
    dues: 500,
    grandTotal: 350,
    paid: -30,
    arrears: 380,
    profit: 0,
    isPostponed: false,
    ...overrides,
  };
}

function returnItem(overrides = {}) {
  return {
    originalItemId: 18,
    name: "Replay Fixture Supplier Return Item",
    qty: 3,
    price: 50,
    priceCategory: "Retail",
    discountType: "%",
    discountValue: 0,
    taxType: "%",
    taxValue: 0,
    costPrice: 50,
    batchId: 28,
    ...overrides,
  };
}

function contractInput(overrides = {}) {
  return {
    clientTransactionId: "txn_rehearsal_supplier_return_payload_ready",
    createdAt: 1770000000000,
    localSaleId: 92,
    invoiceNo: "RET-S-REHEARSAL-PAYLOAD-READY",
    supplier: {
      localId: 9,
      serverId: 9009,
      nameSnapshot: "Replay Fixture Supplier",
    },
    items: [
      {
        localItemId: 18,
        serverItemId: 8018,
        originalItemId: 18,
        nameSnapshot: "Replay Fixture Supplier Return Item",
        qty: 3,
        price: 50,
        costPrice: 50,
        quantityUnit: "min",
        selectedUnit: "min",
        conversion: {
          minUnit: "piece",
          maxUnit: "box",
          convQty: 1,
          quantityInMinUnit: 3,
        },
        sourceBatch: {
          localBatchId: 28,
          serverBatchId: 8028,
          returnedQty: 3,
          qtyPurchasedBefore: 10,
          qtyPurchasedAfter: 7,
          balanceBefore: 8,
          balanceAfter: 5,
        },
        requiresCylinderMutation: false,
      },
    ],
    payments: {
      paidAmount: -30,
      source: "pos-finalization",
      method: null,
    },
    cylinders: [],
    totals: {
      subtotal: 150,
      discount: 0,
      tax: 0,
      dues: 500,
      grandTotal: 350,
      paid: -30,
      arrears: 380,
    },
    ...overrides,
  };
}

function hasSensitiveKey(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    if (/password|token|secret|payload_json|response_json|cnic|mobile|address/i.test(key)) {
      return true;
    }
    return hasSensitiveKey(child);
  });
}

const builderSource = readFileSync(builderPath, "utf8");
const queueServiceSource = readFileSync(queueServicePath, "utf8");
const queueReportSource = readFileSync(queueReportPath, "utf8");
const posSource = readFileSync(posPath, "utf8");
const syncEngineSource = readFileSync(syncEnginePath, "utf8");
const transactionApiSource = readFileSync(transactionApiPath, "utf8");
const finalizationSource = readFileSync(finalizationPath, "utf8");
const {
  buildFinalizedSupplierReturnReplayContract,
  buildReturnTransactionPayload,
} = await importTypescriptModule(builderPath);

const readyContract = buildFinalizedSupplierReturnReplayContract(contractInput());
assert(readyContract.payloadVersion === 1, "finalized Supplier Return replay contract is versioned");
assert(readyContract.transactionType === "Return", "contract is constrained to Return transaction type");
assert(readyContract.returnMode === "supplier", "contract is constrained to supplier return mode");
assert(readyContract.replayReadiness.status === "ready", "mapped Supplier Return is replay-ready");
assert(
  readyContract.supplier.localId === 9 &&
    readyContract.supplier.serverId === 9009 &&
    readyContract.supplier.localId !== readyContract.supplier.serverId,
  "local supplier id remains correlation metadata and server supplier id is explicit"
);
assert(
  readyContract.items[0].localItemId === 18 &&
    readyContract.items[0].serverItemId === 8018 &&
    readyContract.items[0].localItemId !== readyContract.items[0].serverItemId,
  "local item id remains correlation metadata and server item id is explicit"
);
assert(
  readyContract.items[0].sourceBatch.localBatchId === 28 &&
    readyContract.items[0].sourceBatch.serverBatchId === 8028 &&
    readyContract.items[0].sourceBatch.localBatchId !==
      readyContract.items[0].sourceBatch.serverBatchId,
  "local source batch id remains correlation metadata and server batch id is explicit"
);
assert(
  readyContract.items[0].sourceBatch.qtyPurchasedBefore === 10 &&
    readyContract.items[0].sourceBatch.qtyPurchasedAfter === 7 &&
    readyContract.items[0].sourceBatch.balanceBefore === 8 &&
    readyContract.items[0].sourceBatch.balanceAfter === 5,
  "source batch before/after metadata is explicit"
);
assert(
  readyContract.payments.paidAmount === -30,
  "Supplier Return payment metadata preserves negative local paid amount"
);

const readyCylinderContract = buildFinalizedSupplierReturnReplayContract(
  contractInput({
    items: [
      {
        ...contractInput().items[0],
        requiresCylinderMutation: true,
      },
    ],
    cylinders: [
      {
        localItemId: 18,
        serverItemId: 8018,
        localCylinderId: 38,
        serverCylinderId: 8038,
        qtyReturned: 1,
        movement: "filledDecrease",
        filledCylindersBefore: 4,
        filledCylindersAfter: 3,
        qtyInStockBefore: 7,
        qtyInStockAfter: 6,
      },
    ],
  })
);
assert(
  readyCylinderContract.replayReadiness.status === "ready" &&
    readyCylinderContract.cylinders[0].movement === "filledDecrease",
  "mapped cylinder Supplier Return can become replay-ready"
);

const unsafeContract = buildFinalizedSupplierReturnReplayContract(
  contractInput({
    localSaleId: undefined,
    supplier: {
      localId: 9,
      serverId: null,
      nameSnapshot: "Replay Fixture Supplier",
    },
    items: [
      {
        ...contractInput().items[0],
        serverItemId: null,
        sourceBatch: null,
        requiresCylinderMutation: true,
      },
    ],
  })
);
const unsafeCodes = new Set(unsafeContract.replayReadiness.reasons.map((reason) => reason.code));
assert(unsafeContract.replayReadiness.status === "unsafe", "missing Supplier Return mappings mark replay unsafe");
assert(unsafeCodes.has("missing_local_sale_id"), "missing local Supplier Return id is diagnosed");
assert(unsafeCodes.has("missing_supplier_server_id"), "missing supplier server id is diagnosed");
assert(unsafeCodes.has("missing_server_item_id"), "missing Supplier Return item server id is diagnosed");
assert(unsafeCodes.has("missing_source_batch_metadata"), "missing source batch metadata is diagnosed");
assert(unsafeCodes.has("missing_cylinder_mapping"), "missing required cylinder mapping is diagnosed");

const unsafeBatchContract = buildFinalizedSupplierReturnReplayContract(
  contractInput({
    items: [
      {
        ...contractInput().items[0],
        sourceBatch: {
          ...contractInput().items[0].sourceBatch,
          serverBatchId: null,
        },
      },
    ],
  })
);
assert(
  unsafeBatchContract.replayReadiness.reasons.some(
    (reason) => reason.code === "missing_server_batch_id"
  ),
  "missing source batch server id is diagnosed"
);

const invalidBatchDeltaContract = buildFinalizedSupplierReturnReplayContract(
  contractInput({
    items: [
      {
        ...contractInput().items[0],
        sourceBatch: {
          ...contractInput().items[0].sourceBatch,
          qtyPurchasedBefore: 2,
          qtyPurchasedAfter: 2,
          balanceBefore: 2,
          balanceAfter: 2,
        },
      },
    ],
  })
);
assert(
  invalidBatchDeltaContract.replayReadiness.reasons.some(
    (reason) => reason.code === "invalid_supplier_return_batch_delta"
  ),
  "invalid Supplier Return source batch before/after delta is diagnosed"
);

const unsafeCylinderContract = buildFinalizedSupplierReturnReplayContract(
  contractInput({
    items: [
      {
        ...contractInput().items[0],
        requiresCylinderMutation: true,
      },
    ],
    cylinders: [
      {
        localItemId: 18,
        serverItemId: 8018,
        localCylinderId: 38,
        serverCylinderId: null,
        qtyReturned: 2,
        movement: "filledDecrease",
        filledCylindersBefore: 1,
        filledCylindersAfter: 0,
        qtyInStockBefore: 1,
        qtyInStockAfter: 0,
      },
    ],
  })
);
assert(
  unsafeCylinderContract.replayReadiness.reasons.some(
    (reason) => reason.code === "missing_server_cylinder_id"
  ),
  "missing cylinder server id is diagnosed"
);
assert(
  unsafeCylinderContract.replayReadiness.reasons.some(
    (reason) => reason.code === "unsafe_supplier_return_cylinder_clamping"
  ),
  "unsafe Supplier Return cylinder clamping is diagnosed"
);

const builtPayload = buildReturnTransactionPayload({
  clientTransactionId: "txn_rehearsal_supplier_return_payload_ready",
  createdAt: 1770000000000,
  returnMode: "supplier",
  sale: supplierReturnHeader(),
  saleId: 92,
  saleItems: [returnItem()],
  supplier: {
    before: {
      id: 9,
      name: "Replay Fixture Supplier",
      invoices: 0,
      payable: 500,
      paid: 0,
      balance: 500,
      isDeleted: false,
      deletedAt: null,
    },
  },
  stockMovements: [{ itemId: 18, qtyDelta: -3 }],
  finalizedSupplierReturnReplay: contractInput(),
});
assert(
  builtPayload.transactionType === "return" &&
    builtPayload.replayReadiness?.scope === "finalized_supplier_return" &&
    builtPayload.replayReadiness?.status === "ready" &&
    builtPayload.payload.finalizedSupplierReturnReplay.payloadVersion === 1,
  "queued finalized Supplier Return exposes top-level readiness and v1 contract"
);
assert(
  !("supplier" in builtPayload.payload) &&
    !("stockMovements" in builtPayload.payload) &&
    !("batchMutations" in builtPayload.payload) &&
    !("cylinderMutations" in builtPayload.payload),
  "finalized Supplier Return queue omits broad record snapshots from its storage envelope"
);
assert(!hasSensitiveKey(builtPayload), "queued finalized Supplier Return contract contains no sensitive fields");

const missingContractPayload = buildReturnTransactionPayload({
  clientTransactionId: "txn_rehearsal_supplier_return_payload_missing",
  createdAt: 1770000000001,
  returnMode: "supplier",
  sale: supplierReturnHeader({ invoiceNo: "RET-S-REHEARSAL-PAYLOAD-MISSING" }),
  saleId: 93,
  saleItems: [returnItem()],
});
assert(
  missingContractPayload.replayReadiness?.status === "unsafe" &&
    missingContractPayload.replayReadiness.reasons.some(
      (reason) => reason.code === "missing_finalized_supplier_return_replay_contract"
    ),
  "finalized Supplier Return without mappings remains locally queueable but explicitly replay-unsafe"
);

assert(
  queueServiceSource.includes("replayReadiness: payload.replayReadiness"),
  "queue row stores safe replay-readiness diagnostics beside the payload"
);
assert(
  queueReportSource.includes("finalizedSupplierReturnReplayReadiness") &&
    queueReportSource.includes("row.payload?.payload?.finalizedSupplierReturnReplay"),
  "read-only queue report summarizes finalized Supplier Return readiness"
);
assert(
  posSource.includes("const finalizedSupplierReturnReplay = isSupplierReturn && !isPostponed") &&
    posSource.includes("sourceBatch: sourceBatch") &&
    posSource.includes("finalizedSupplierReturnReplay,"),
  "POS packages Supplier Return mappings after local finalization"
);
assert(
  finalizationSource.includes('const tx = db.transaction(') &&
    finalizationSource.includes('"readwrite"') &&
    finalizationSource.includes("await tx.done;"),
  "local IndexedDB finalization remains the existing atomic commit path"
);
assert(!existsSync(backendSupplierReturnReplayPath), "backend Supplier Return replay endpoint does not exist yet");
assert(
  !transactionApiSource.includes("replayFinalizedSupplierReturn") &&
    !transactionApiSource.includes("/replay/supplier-return.php"),
  "transaction API has no Supplier Return replay endpoint route"
);
assert(
  !syncEngineSource.includes("assertReadyFinalizedSupplierReturnReplay") &&
    !syncEngineSource.includes("replayFinalizedSupplierReturn"),
  "manual sync router has no Supplier Return replay branch yet"
);
assert(existsSync(backendSaleReplayPath), "existing narrow backend Sale replay endpoint remains present");
assert(existsSync(backendPurchaseReplayPath), "existing narrow backend Purchase replay endpoint remains present");
assert(existsSync(backendCustomerReturnReplayPath), "existing narrow backend Customer Return replay endpoint remains present");
assert(
  builderSource.includes("buildFinalizedSaleReplayContract") &&
    builderSource.includes("buildFinalizedPurchaseReplayContract") &&
    builderSource.includes("buildFinalizedCustomerReturnReplayContract"),
  "existing finalized Sale/Purchase/Customer Return replay builders remain available"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checks,
      scope: "finalized Supplier Return queue payload readiness only",
      readyFixtureStatus: readyContract.replayReadiness.status,
      readyCylinderFixtureStatus: readyCylinderContract.replayReadiness.status,
      unsafeFixtureStatus: unsafeContract.replayReadiness.status,
      unsafeReasonCodes: [
        ...new Set([
          ...unsafeCodes,
          ...unsafeBatchContract.replayReadiness.reasons.map((reason) => reason.code),
          ...invalidBatchDeltaContract.replayReadiness.reasons.map((reason) => reason.code),
          ...unsafeCylinderContract.replayReadiness.reasons.map((reason) => reason.code),
          ...missingContractPayload.replayReadiness.reasons.map((reason) => reason.code),
        ]),
      ].sort(),
      cylinderMovement: "filledDecrease",
      backendSupplierReturnReplayEndpointAdded: false,
      saleReplayChanged: false,
      purchaseReplayChanged: false,
      customerReturnReplayChanged: false,
      localPOSBehaviorChanged: false,
      autoSyncChanged: false,
      sourceModule: pathToFileURL(builderPath).href,
    },
    null,
    2
  )
);
