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
const finalizationPath = resolve(root, "src/services/localPOSFinalizationService.ts");
const backendCustomerReturnReplayPath = resolve(root, "api/replay/customer-return.php");
const backendSaleReplayPath = resolve(root, "api/replay/sale.php");
const backendPurchaseReplayPath = resolve(root, "api/replay/purchase.php");

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

function customerReturnHeader(overrides = {}) {
  return {
    invoiceNo: "RET-C-REHEARSAL-PAYLOAD-READY",
    date: "2026-06-02T00:00:00.000Z",
    transactionType: "Return",
    customerId: 7,
    supplierId: null,
    customerName: "Replay Fixture Customer",
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
    ...overrides,
  };
}

function returnItem(overrides = {}) {
  return {
    originalItemId: 18,
    name: "Replay Fixture Return Item",
    qty: 2,
    price: 80,
    priceCategory: "Retail",
    discountType: "%",
    discountValue: 0,
    taxType: "%",
    taxValue: 0,
    ...overrides,
  };
}

function contractInput(overrides = {}) {
  return {
    clientTransactionId: "txn_rehearsal_customer_return_payload_ready",
    createdAt: 1770000000000,
    localSaleId: 92,
    invoiceNo: "RET-C-REHEARSAL-PAYLOAD-READY",
    customer: {
      localId: 7,
      serverId: 7007,
      nameSnapshot: "Replay Fixture Customer",
    },
    items: [
      {
        localItemId: 18,
        serverItemId: 8018,
        originalItemId: 18,
        nameSnapshot: "Replay Fixture Return Item",
        qty: 2,
        price: 80,
        costPrice: 50,
        quantityUnit: "min",
        selectedUnit: "min",
        conversion: {
          minUnit: "piece",
          maxUnit: "box",
          convQty: 1,
          quantityInMinUnit: 2,
        },
        returnBatchCreate: {
          localBatchId: 28,
          sourceSaleId: 92,
          purchaseDate: "2026-06-02T00:00:00.000Z",
          qtyReturned: 2,
          balance: 2,
          costPrice: 50,
          invoiceNo: "RET-C-REHEARSAL-PAYLOAD-READY",
        },
        requiresCylinderMutation: false,
      },
    ],
    payments: {
      paidAmount: -40,
      source: "pos-finalization",
      method: null,
    },
    cylinders: [],
    totals: {
      subtotal: 160,
      discount: 0,
      tax: 0,
      dues: 500,
      grandTotal: 340,
      paid: -40,
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
const finalizationSource = readFileSync(finalizationPath, "utf8");
const {
  buildFinalizedCustomerReturnReplayContract,
  buildReturnTransactionPayload,
} = await importTypescriptModule(builderPath);

const readyContract = buildFinalizedCustomerReturnReplayContract(contractInput());
assert(readyContract.payloadVersion === 1, "finalized Customer Return replay contract is versioned");
assert(readyContract.transactionType === "Return", "contract is constrained to Return transaction type");
assert(readyContract.returnMode === "customer", "contract is constrained to customer return mode");
assert(readyContract.replayReadiness.status === "ready", "mapped Customer Return is replay-ready");
assert(
  readyContract.customer.localId === 7 &&
    readyContract.customer.serverId === 7007 &&
    readyContract.customer.localId !== readyContract.customer.serverId,
  "local customer id remains correlation metadata and server customer id is explicit"
);
assert(
  readyContract.items[0].localItemId === 18 &&
    readyContract.items[0].serverItemId === 8018 &&
    readyContract.items[0].localItemId !== readyContract.items[0].serverItemId,
  "local item id remains correlation metadata and server item id is explicit"
);
assert(
  readyContract.items[0].returnBatchCreate.localBatchId === 28 &&
    readyContract.items[0].returnBatchCreate.sourceSaleId === 92,
  "return batch carries explicit local correlation metadata without backend mutation id"
);
assert(
  readyContract.payments.paidAmount === -40,
  "Customer Return payment metadata preserves negative local paid amount"
);

const readyCylinderContract = buildFinalizedCustomerReturnReplayContract(
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
        customerHolding: {
          localHoldingId: 48,
          serverHoldingId: 8048,
          customerNameSnapshot: "Replay Fixture Customer",
        },
        qtyReturned: 1,
        movement: "customerHoldingToEmpty",
      },
    ],
  })
);
assert(
  readyCylinderContract.replayReadiness.status === "ready" &&
    readyCylinderContract.cylinders[0].movement === "customerHoldingToEmpty",
  "mapped cylinder Customer Return can become replay-ready with holding reference"
);

const unsafeContract = buildFinalizedCustomerReturnReplayContract(
  contractInput({
    localSaleId: undefined,
    customer: {
      localId: 7,
      serverId: null,
      nameSnapshot: "Replay Fixture Customer",
    },
    items: [
      {
        ...contractInput().items[0],
        serverItemId: null,
        returnBatchCreate: null,
        requiresCylinderMutation: true,
      },
    ],
  })
);
const unsafeCodes = new Set(unsafeContract.replayReadiness.reasons.map((reason) => reason.code));
assert(unsafeContract.replayReadiness.status === "unsafe", "missing Customer Return mappings mark replay unsafe");
assert(unsafeCodes.has("missing_local_sale_id"), "missing local Customer Return id is diagnosed");
assert(unsafeCodes.has("missing_customer_server_id"), "missing customer server id is diagnosed");
assert(unsafeCodes.has("missing_server_item_id"), "missing Customer Return item server id is diagnosed");
assert(unsafeCodes.has("missing_return_batch_metadata"), "missing return batch metadata is diagnosed");
assert(unsafeCodes.has("missing_cylinder_mapping"), "missing required cylinder mapping is diagnosed");

const unsafeCylinderContract = buildFinalizedCustomerReturnReplayContract(
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
        customerHolding: {
          localHoldingId: 48,
          serverHoldingId: null,
          customerNameSnapshot: "Replay Fixture Customer",
        },
        qtyReturned: 1,
        movement: "customerHoldingToEmpty",
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
    (reason) => reason.code === "missing_customer_holding_mapping"
  ),
  "missing customer holding server mapping is diagnosed"
);

const builtPayload = buildReturnTransactionPayload({
  clientTransactionId: "txn_rehearsal_customer_return_payload_ready",
  createdAt: 1770000000000,
  returnMode: "customer",
  sale: customerReturnHeader(),
  saleId: 92,
  saleItems: [returnItem()],
  customer: {
    before: {
      id: 7,
      name: "Replay Fixture Customer",
      invoices: 0,
      payable: 500,
      paid: 0,
      balance: 500,
      isDeleted: false,
      deletedAt: null,
    },
  },
  stockMovements: [{ itemId: 18, qtyDelta: 2 }],
  finalizedCustomerReturnReplay: contractInput(),
});
assert(
  builtPayload.transactionType === "return" &&
    builtPayload.replayReadiness?.scope === "finalized_customer_return" &&
    builtPayload.replayReadiness?.status === "ready" &&
    builtPayload.payload.finalizedCustomerReturnReplay.payloadVersion === 1,
  "queued finalized Customer Return exposes top-level readiness and v1 contract"
);
assert(
  !("customer" in builtPayload.payload) &&
    !("stockMovements" in builtPayload.payload) &&
    !("batchMutations" in builtPayload.payload) &&
    !("cylinderMutations" in builtPayload.payload),
  "finalized Customer Return queue omits broad record snapshots from its storage envelope"
);
assert(!hasSensitiveKey(builtPayload), "queued finalized Customer Return contract contains no sensitive fields");

const missingContractPayload = buildReturnTransactionPayload({
  clientTransactionId: "txn_rehearsal_customer_return_payload_missing",
  createdAt: 1770000000001,
  returnMode: "customer",
  sale: customerReturnHeader({ invoiceNo: "RET-C-REHEARSAL-PAYLOAD-MISSING" }),
  saleId: 93,
  saleItems: [returnItem()],
});
assert(
  missingContractPayload.replayReadiness?.status === "unsafe" &&
    missingContractPayload.replayReadiness.reasons.some(
      (reason) => reason.code === "missing_finalized_customer_return_replay_contract"
    ),
  "finalized Customer Return without mappings remains locally queueable but explicitly replay-unsafe"
);

const supplierReturnPayload = buildReturnTransactionPayload({
  clientTransactionId: "txn_rehearsal_supplier_return_generic",
  createdAt: 1770000000002,
  returnMode: "supplier",
  sale: customerReturnHeader({
    invoiceNo: "RET-S-REHEARSAL-GENERIC",
    customerId: null,
    supplierId: 17,
    customerName: "",
    supplierName: "Replay Fixture Supplier",
  }),
  saleId: 94,
  saleItems: [returnItem()],
});
assert(
  !supplierReturnPayload.replayReadiness &&
    !supplierReturnPayload.payload.finalizedCustomerReturnReplay,
  "Supplier Return queue payload remains generic and is not migrated by Customer Return hardening"
);

assert(
  queueServiceSource.includes("replayReadiness: payload.replayReadiness"),
  "queue row stores safe replay-readiness diagnostics beside the payload"
);
assert(
  queueReportSource.includes("finalizedCustomerReturnReplayReadiness") &&
    queueReportSource.includes("row.payload?.payload?.finalizedCustomerReturnReplay"),
  "read-only queue report summarizes finalized Customer Return readiness"
);
assert(
  posSource.includes("const createdCustomerReturnBatchesByItem = new Map<number, ItemBatch[]>()") &&
    posSource.includes("const finalizedCustomerReturnReplay = isCustomerReturn && !isPostponed") &&
    posSource.includes("finalizedCustomerReturnReplay,"),
  "POS packages Customer Return mappings after local finalization"
);
assert(
  syncEngineSource.includes("replayFinalizedSale") &&
    syncEngineSource.includes("replayFinalizedPurchase") &&
    !syncEngineSource.includes("replayFinalizedCustomerReturn") &&
    !syncEngineSource.includes("customer-return.php"),
  "manual sync router still has no Customer Return replay execution path"
);
assert(
  finalizationSource.includes('const tx = db.transaction(') &&
    finalizationSource.includes('"readwrite"') &&
    finalizationSource.includes("await tx.done;"),
  "local IndexedDB finalization remains the existing atomic commit path"
);
assert(!existsSync(backendCustomerReturnReplayPath), "backend Customer Return replay endpoint is not implemented yet");
assert(existsSync(backendSaleReplayPath), "existing narrow backend Sale replay endpoint remains present");
assert(existsSync(backendPurchaseReplayPath), "existing narrow backend Purchase replay endpoint remains present");
assert(
  builderSource.includes("buildFinalizedSaleReplayContract") &&
    builderSource.includes("buildFinalizedPurchaseReplayContract"),
  "existing finalized Sale/Purchase replay builders remain available"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checks,
      scope: "finalized Customer Return queue payload readiness only",
      readyFixtureStatus: readyContract.replayReadiness.status,
      readyCylinderFixtureStatus: readyCylinderContract.replayReadiness.status,
      unsafeFixtureStatus: unsafeContract.replayReadiness.status,
      unsafeReasonCodes: [
        ...new Set([
          ...unsafeCodes,
          ...unsafeCylinderContract.replayReadiness.reasons.map((reason) => reason.code),
          ...missingContractPayload.replayReadiness.reasons.map((reason) => reason.code),
        ]),
      ].sort(),
      cylinderMovement: "customerHoldingToEmpty",
      backendCustomerReturnReplayEndpointAdded: false,
      saleReplayChanged: false,
      purchaseReplayChanged: false,
      localPOSBehaviorChanged: false,
      autoSyncChanged: false,
      sourceModule: pathToFileURL(builderPath).href,
    },
    null,
    2
  )
);
