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

function saleHeader(overrides = {}) {
  return {
    invoiceNo: "SAL-REHEARSAL-PAYLOAD-READY",
    date: "2026-06-02T00:00:00.000Z",
    transactionType: "Sale",
    customerId: 7,
    supplierId: null,
    customerName: "Replay Fixture Customer",
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
    ...overrides,
  };
}

function saleItem(overrides = {}) {
  return {
    originalItemId: 17,
    name: "Replay Fixture LPG",
    qty: 2,
    price: 100,
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
    clientTransactionId: "txn_rehearsal_payload_ready",
    createdAt: 1770000000000,
    localSaleId: 91,
    invoiceNo: "SAL-REHEARSAL-PAYLOAD-READY",
    customer: {
      localId: 7,
      serverId: 7007,
      nameSnapshot: "Replay Fixture Customer",
    },
    items: [
      {
        localItemId: 17,
        serverItemId: 7017,
        originalItemId: 17,
        nameSnapshot: "Replay Fixture LPG",
        qty: 2,
        price: 100,
        quantityUnit: "min",
        selectedUnit: "max",
        conversion: {
          minUnit: "kg",
          maxUnit: "cylinder",
          convQty: 1,
          quantityInMinUnit: 2,
        },
        resolvedBatch: {
          localBatchId: 27,
          serverBatchId: 7027,
          consumedQty: 2,
        },
        requiresCylinderMutation: true,
      },
    ],
    payments: {
      paidAmount: 50,
      source: "pos-finalization",
      method: null,
    },
    cylinders: [
      {
        localItemId: 17,
        serverItemId: 7017,
        localCylinderId: 37,
        serverCylinderId: 7037,
        customerHolding: {
          localHoldingId: 47,
          serverHoldingId: null,
          customerNameSnapshot: "Replay Fixture Customer",
        },
        qtyMoved: 2,
      },
    ],
    totals: {
      subtotal: 200,
      discount: 0,
      tax: 0,
      dues: 0,
      grandTotal: 200,
      paid: 50,
      arrears: 150,
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
  buildFinalizedSaleReplayContract,
  buildSaleTransactionPayload,
} = await importTypescriptModule(builderPath);

const readyContract = buildFinalizedSaleReplayContract(contractInput());
assert(readyContract.payloadVersion === 1, "finalized Sale replay contract is versioned");
assert(readyContract.transactionType === "Sale", "contract is constrained to finalized Sale");
assert(readyContract.replayReadiness.status === "ready", "fully mapped fixture is replay-ready");
assert(
  readyContract.items[0].localItemId === 17 &&
    readyContract.items[0].serverItemId === 7017 &&
    readyContract.items[0].localItemId !== readyContract.items[0].serverItemId,
  "local item id remains correlation metadata and server item id is explicit"
);
assert(
  readyContract.items[0].resolvedBatch.localBatchId === 27 &&
    readyContract.items[0].resolvedBatch.serverBatchId === 7027,
  "exact resolved batch carries separate local and backend ids"
);
assert(
  readyContract.items[0].conversion.quantityInMinUnit === 2 &&
    readyContract.items[0].selectedUnit === "max",
  "quantity normalization and selected-unit conversion metadata are explicit"
);
assert(
  readyContract.cylinders[0].serverCylinderId === 7037 &&
    readyContract.cylinders[0].qtyMoved === 2,
  "cylinder Sale issue carries explicit backend mapping and moved quantity"
);

const unsafeContract = buildFinalizedSaleReplayContract(
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
        resolvedBatch: {
          localBatchId: 27,
          serverBatchId: null,
          consumedQty: 2,
        },
      },
    ],
    cylinders: [],
  })
);
const unsafeCodes = new Set(unsafeContract.replayReadiness.reasons.map((reason) => reason.code));
assert(unsafeContract.replayReadiness.status === "unsafe", "missing mappings mark replay unsafe");
assert(unsafeCodes.has("missing_local_sale_id"), "missing local finalized Sale id is diagnosed");
assert(unsafeCodes.has("missing_customer_server_id"), "missing customer server id is diagnosed");
assert(unsafeCodes.has("missing_server_item_id"), "missing item server id is diagnosed");
assert(unsafeCodes.has("missing_server_batch_id"), "missing resolved batch server id is diagnosed");
assert(unsafeCodes.has("missing_cylinder_mapping"), "missing required cylinder mapping is diagnosed");

const unsafeCylinderContract = buildFinalizedSaleReplayContract(
  contractInput({
    cylinders: [
      {
        ...contractInput().cylinders[0],
        serverCylinderId: null,
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
  clientTransactionId: "txn_rehearsal_payload_ready",
  createdAt: 1770000000000,
  sale: saleHeader(),
  saleId: 91,
  saleItems: [saleItem()],
  customer: {
    before: {
      id: 7,
      name: "Replay Fixture Customer",
      mobile: "redacted-fixture",
      cnic: "redacted-fixture",
      address: "redacted-fixture",
      isDeleted: false,
      deletedAt: null,
    },
  },
  stockMovements: [{ itemId: 17, qtyDelta: -2 }],
  finalizedSaleReplay: contractInput(),
});
assert(
  builtPayload.replayReadiness?.status === "ready" &&
    builtPayload.payload.finalizedSaleReplay.payloadVersion === 1,
  "queued finalized Sale exposes top-level readiness and v1 contract"
);
assert(
  !("customer" in builtPayload.payload) &&
    !("stockMovements" in builtPayload.payload) &&
    !("batchMutations" in builtPayload.payload) &&
    !("cylinderMutations" in builtPayload.payload),
  "finalized Sale queue omits broad record snapshots from its storage envelope"
);
assert(!hasSensitiveKey(builtPayload), "queued finalized Sale contract contains no sensitive fields");

const missingContractPayload = buildSaleTransactionPayload({
  clientTransactionId: "txn_rehearsal_payload_missing",
  createdAt: 1770000000001,
  sale: saleHeader({ invoiceNo: "SAL-REHEARSAL-PAYLOAD-MISSING" }),
  saleId: 92,
  saleItems: [saleItem()],
});
assert(
  missingContractPayload.replayReadiness?.status === "unsafe" &&
    missingContractPayload.replayReadiness.reasons.some(
      (reason) => reason.code === "missing_finalized_sale_replay_contract"
    ),
  "finalized Sale without mappings remains locally queueable but explicitly replay-unsafe"
);

assert(
  queueServiceSource.includes("replayReadiness: payload.replayReadiness"),
  "queue row stores safe replay-readiness diagnostics beside the payload"
);
assert(
  queueReportSource.includes("unsafeReasons") &&
    queueReportSource.includes("row.replayReadiness?.reasons ?? []"),
  "read-only queue report summarizes replay-unsafe reason codes"
);
assert(
  posSource.includes("const finalizedSaleReplay = isSale && !isPostponed") &&
    posSource.includes("serverBatchId: getServerId(resolvedBatch)") &&
    posSource.includes("finalizedSaleReplay,"),
  "POS packages resolved Sale mappings after local finalization"
);
assert(
  finalizationSource.includes('const tx = db.transaction(') &&
    finalizationSource.includes('"readwrite"') &&
    finalizationSource.includes("await tx.done;"),
  "local IndexedDB finalization remains the existing atomic commit path"
);
assert(existsSync(backendSaleReplayPath), "narrow backend Sale replay HTTP endpoint exists");

console.log(
  JSON.stringify(
    {
      ok: true,
      checks,
      scope: "finalized Sale queue payload readiness only",
      readyFixtureStatus: readyContract.replayReadiness.status,
      unsafeFixtureStatus: unsafeContract.replayReadiness.status,
      unsafeReasonCodes: [
        ...new Set([
          ...unsafeCodes,
          ...unsafeCylinderContract.replayReadiness.reasons.map((reason) => reason.code),
        ]),
      ].sort(),
      backendSaleReplayEndpointAdded: true,
      localPOSBehaviorChanged: false,
      autoSyncChanged: false,
      sourceModule: pathToFileURL(builderPath).href,
    },
    null,
    2
  )
);
