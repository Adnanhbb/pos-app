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
const finalizationPath = resolve(root, "src/services/localPOSFinalizationService.ts");
const backendPurchaseReplayPath = resolve(root, "api/replay/purchase.php");
const backendSaleReplayPath = resolve(root, "api/replay/sale.php");

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

function purchaseHeader(overrides = {}) {
  return {
    invoiceNo: "PUR-REHEARSAL-PAYLOAD-READY",
    date: "2026-06-02T00:00:00.000Z",
    transactionType: "Purchase",
    customerId: null,
    supplierId: 8,
    customerName: "",
    supplierName: "Replay Fixture Supplier",
    subtotal: 200,
    discount: 0,
    tax: 0,
    dues: 20,
    grandTotal: 220,
    paid: 50,
    arrears: 170,
    profit: 0,
    isPostponed: false,
    ...overrides,
  };
}

function purchaseItem(overrides = {}) {
  return {
    originalItemId: 18,
    name: "Replay Fixture Purchase Item",
    qty: 4,
    price: 50,
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
    clientTransactionId: "txn_rehearsal_purchase_payload_ready",
    createdAt: 1770000000000,
    localSaleId: 92,
    invoiceNo: "PUR-REHEARSAL-PAYLOAD-READY",
    supplier: {
      localId: 8,
      serverId: 8008,
      nameSnapshot: "Replay Fixture Supplier",
      directPurchase: false,
    },
    items: [
      {
        localItemId: 18,
        serverItemId: 8018,
        originalItemId: 18,
        nameSnapshot: "Replay Fixture Purchase Item",
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
          localBatchId: 28,
          sourceSaleId: 92,
          purchaseDate: "2026-06-02T00:00:00.000Z",
          qtyPurchased: 4,
          balance: 4,
          costPrice: 50,
          invoiceNo: "PUR-REHEARSAL-PAYLOAD-READY",
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
const finalizationSource = readFileSync(finalizationPath, "utf8");
const {
  buildFinalizedPurchaseReplayContract,
  buildSaleTransactionPayload,
} = await importTypescriptModule(builderPath);

const readyContract = buildFinalizedPurchaseReplayContract(contractInput());
assert(readyContract.payloadVersion === 1, "finalized Purchase replay contract is versioned");
assert(readyContract.transactionType === "Purchase", "contract is constrained to finalized Purchase");
assert(readyContract.replayReadiness.status === "ready", "mapped supplier Purchase is replay-ready");
assert(
  readyContract.supplier.localId === 8 &&
    readyContract.supplier.serverId === 8008 &&
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
  readyContract.items[0].batchCreate.localBatchId === 28 &&
    readyContract.items[0].batchCreate.sourceSaleId === 92,
  "new local batch carries explicit correlation metadata without a backend mutation id"
);
assert(
  readyContract.items[0].conversion.quantityInMinUnit === 4 &&
    readyContract.items[0].selectedUnit === "max",
  "quantity normalization and selected-unit conversion metadata are explicit"
);

const directPurchaseContract = buildFinalizedPurchaseReplayContract(
  contractInput({
    supplier: {
      localId: null,
      serverId: null,
      nameSnapshot: "Direct Purchase",
      directPurchase: true,
    },
  })
);
assert(
  directPurchaseContract.replayReadiness.status === "ready",
  "Direct Purchase is replay-ready without supplier mapping when no supplier mutation exists"
);

const unsafeContract = buildFinalizedPurchaseReplayContract(
  contractInput({
    localSaleId: undefined,
    supplier: {
      localId: 8,
      serverId: null,
      nameSnapshot: "Replay Fixture Supplier",
      directPurchase: false,
    },
    items: [
      {
        ...contractInput().items[0],
        serverItemId: null,
        batchCreate: null,
        requiresCylinderMutation: true,
      },
    ],
  })
);
const unsafeCodes = new Set(unsafeContract.replayReadiness.reasons.map((reason) => reason.code));
assert(unsafeContract.replayReadiness.status === "unsafe", "missing Purchase mappings mark replay unsafe");
assert(unsafeCodes.has("missing_local_sale_id"), "missing local finalized Purchase id is diagnosed");
assert(unsafeCodes.has("missing_supplier_server_id"), "missing selected supplier server id is diagnosed");
assert(unsafeCodes.has("missing_server_item_id"), "missing Purchase item server id is diagnosed");
assert(unsafeCodes.has("missing_batch_create_metadata"), "missing batch-create metadata is diagnosed");
assert(unsafeCodes.has("missing_cylinder_mapping"), "missing required cylinder mapping is diagnosed");

const unsafeCylinderContract = buildFinalizedPurchaseReplayContract(
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
        qtyFilledIncrease: 2,
        qtyStockIncrease: 2,
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

const builtPayload = buildSaleTransactionPayload({
  clientTransactionId: "txn_rehearsal_purchase_payload_ready",
  createdAt: 1770000000000,
  sale: purchaseHeader(),
  saleId: 92,
  saleItems: [purchaseItem()],
  supplier: {
    before: {
      id: 8,
      name: "Replay Fixture Supplier",
      invoices: 0,
      payable: 0,
      paid: 0,
      balance: 0,
      isDeleted: false,
      deletedAt: null,
    },
  },
  stockMovements: [{ itemId: 18, qtyDelta: 4 }],
  finalizedPurchaseReplay: contractInput(),
});
assert(
  builtPayload.replayReadiness?.status === "ready" &&
    builtPayload.payload.finalizedPurchaseReplay.payloadVersion === 1,
  "queued finalized Purchase exposes top-level readiness and v1 contract"
);
assert(
  !("supplier" in builtPayload.payload) &&
    !("stockMovements" in builtPayload.payload) &&
    !("batchMutations" in builtPayload.payload) &&
    !("cylinderMutations" in builtPayload.payload),
  "finalized Purchase queue omits broad record snapshots from its storage envelope"
);
assert(!hasSensitiveKey(builtPayload), "queued finalized Purchase contract contains no sensitive fields");

const missingContractPayload = buildSaleTransactionPayload({
  clientTransactionId: "txn_rehearsal_purchase_payload_missing",
  createdAt: 1770000000001,
  sale: purchaseHeader({ invoiceNo: "PUR-REHEARSAL-PAYLOAD-MISSING" }),
  saleId: 93,
  saleItems: [purchaseItem()],
});
assert(
  missingContractPayload.replayReadiness?.status === "unsafe" &&
    missingContractPayload.replayReadiness.reasons.some(
      (reason) => reason.code === "missing_finalized_purchase_replay_contract"
    ),
  "finalized Purchase without mappings remains locally queueable but explicitly replay-unsafe"
);

assert(
  queueServiceSource.includes("replayReadiness: payload.replayReadiness"),
  "queue row stores safe replay-readiness diagnostics beside the payload"
);
assert(
  queueReportSource.includes("finalizedPurchaseReplayReadiness") &&
    queueReportSource.includes("row.payload?.payload?.finalizedPurchaseReplay"),
  "read-only queue report summarizes finalized Purchase readiness"
);
assert(
  posSource.includes("const createdPurchaseBatchesByItem = new Map<number, ItemBatch[]>()") &&
    posSource.includes("const finalizedPurchaseReplay = isPurchase && !isPostponed") &&
    posSource.includes("finalizedPurchaseReplay,"),
  "POS packages Purchase mappings after local finalization"
);
assert(
  finalizationSource.includes('const tx = db.transaction(') &&
    finalizationSource.includes('"readwrite"') &&
    finalizationSource.includes("await tx.done;"),
  "local IndexedDB finalization remains the existing atomic commit path"
);
assert(!existsSync(backendPurchaseReplayPath), "backend Purchase replay HTTP endpoint is intentionally absent");
assert(existsSync(backendSaleReplayPath), "existing narrow backend Sale replay endpoint remains present");
assert(
  builderSource.includes('transactionType: "Sale"') &&
    builderSource.includes("buildFinalizedSaleReplayContract"),
  "existing finalized Sale replay builder remains available"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checks,
      scope: "finalized Purchase queue payload readiness only",
      readyFixtureStatus: readyContract.replayReadiness.status,
      directPurchaseFixtureStatus: directPurchaseContract.replayReadiness.status,
      unsafeFixtureStatus: unsafeContract.replayReadiness.status,
      unsafeReasonCodes: [
        ...new Set([
          ...unsafeCodes,
          ...unsafeCylinderContract.replayReadiness.reasons.map((reason) => reason.code),
        ]),
      ].sort(),
      backendPurchaseReplayEndpointAdded: false,
      saleReplayChanged: false,
      localPOSBehaviorChanged: false,
      autoSyncChanged: false,
      sourceModule: pathToFileURL(builderPath).href,
    },
    null,
    2
  )
);
