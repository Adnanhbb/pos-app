#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const builderPath = resolve(root, "src/services/posTransactionPayloadBuilder.ts");
const queueServicePath = resolve(root, "src/services/transactionQueueService.ts");
const custPaymentsPath = resolve(root, "src/CustPayments.tsx");
const supPaymentsPath = resolve(root, "src/SupPayments.tsx");
const syncEnginePath = resolve(root, "src/services/syncEngine.ts");
const transactionApiPath = resolve(root, "src/api/transactionApi.ts");

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

function hasReason(contractOrPayload, code) {
  const reasons =
    contractOrPayload?.replayReadiness?.reasons ??
    contractOrPayload?.payload?.standaloneCustomerPaymentReplay?.replayReadiness?.reasons ??
    contractOrPayload?.payload?.standaloneSupplierPaymentReplay?.replayReadiness?.reasons ??
    [];
  return reasons.some((reason) => reason.code === code);
}

function hasSensitiveKey(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    if (/password|token|secret|payload_json|response_json|hash/i.test(key)) {
      return true;
    }
    return hasSensitiveKey(child);
  });
}

const builderSource = readFileSync(builderPath, "utf8");
const queueServiceSource = readFileSync(queueServicePath, "utf8");
const custPaymentsSource = readFileSync(custPaymentsPath, "utf8");
const supPaymentsSource = readFileSync(supPaymentsPath, "utf8");
const syncEngineSource = readFileSync(syncEnginePath, "utf8");
const transactionApiSource = readFileSync(transactionApiPath, "utf8");

const {
  buildStandaloneCustomerPaymentReplayContract,
  buildStandaloneSupplierPaymentReplayContract,
  buildPaymentTransactionPayload,
} = await importTypescriptModule(builderPath);

const createdAt = 1770000000000;

const readyCustomerContract = buildStandaloneCustomerPaymentReplayContract({
  operation: "create",
  localPaymentId: 12,
  clientTransactionId: "txn_customer_payment_ready",
  createdAt,
  customer: {
    localId: 3,
    serverId: 3003,
    nameSnapshot: "Replay Fixture Customer",
  },
  payment: {
    amount: 125,
    paymentDate: "2026-06-04",
    remarks: "Standalone customer payment fixture",
    invoiceNo: "",
    payableSnapshot: 500,
    balanceSnapshot: 375,
  },
});

assert(readyCustomerContract.payloadVersion === 1, "customer payment contract is versioned");
assert(readyCustomerContract.partyType === "customer", "customer payment contract is party-scoped");
assert(readyCustomerContract.operation === "create", "customer payment contract is create-only");
assert(readyCustomerContract.replayReadiness.status === "ready", "mapped customer payment is replay-ready");
assert(
  readyCustomerContract.localPaymentId === 12 &&
    readyCustomerContract.customer.localId === 3 &&
    readyCustomerContract.customer.serverId === 3003 &&
    readyCustomerContract.customer.localId !== readyCustomerContract.customer.serverId,
  "customer payment local ids remain correlation metadata and server id is explicit"
);
assert(
  readyCustomerContract.clientPaymentId === "customer-payment-local-12",
  "customer payment has stable generated clientPaymentId"
);

const readySupplierContract = buildStandaloneSupplierPaymentReplayContract({
  operation: "create",
  localPaymentId: 22,
  clientTransactionId: "txn_supplier_payment_ready",
  createdAt,
  supplier: {
    localId: 4,
    serverId: 4004,
    nameSnapshot: "Replay Fixture Supplier",
  },
  payment: {
    amount: 225,
    paymentDate: "2026-06-04",
    remarks: "Standalone supplier payment fixture",
    invoiceNo: "",
    payableSnapshot: 800,
    balanceSnapshot: 575,
  },
});

assert(readySupplierContract.payloadVersion === 1, "supplier payment contract is versioned");
assert(readySupplierContract.partyType === "supplier", "supplier payment contract is party-scoped");
assert(readySupplierContract.operation === "create", "supplier payment contract is create-only");
assert(readySupplierContract.replayReadiness.status === "ready", "mapped supplier payment is replay-ready");
assert(
  readySupplierContract.localPaymentId === 22 &&
    readySupplierContract.supplier.localId === 4 &&
    readySupplierContract.supplier.serverId === 4004 &&
    readySupplierContract.supplier.localId !== readySupplierContract.supplier.serverId,
  "supplier payment local ids remain correlation metadata and server id is explicit"
);

const missingCustomerServer = buildStandaloneCustomerPaymentReplayContract({
  ...readyCustomerContract,
  customer: {
    ...readyCustomerContract.customer,
    serverId: null,
  },
});
assert(
  missingCustomerServer.replayReadiness.status === "unsafe" &&
    hasReason(missingCustomerServer, "missing_party_server_id"),
  "missing customer server id is unsafe"
);

const missingSupplierServer = buildStandaloneSupplierPaymentReplayContract({
  ...readySupplierContract,
  supplier: {
    ...readySupplierContract.supplier,
    serverId: null,
  },
});
assert(
  missingSupplierServer.replayReadiness.status === "unsafe" &&
    hasReason(missingSupplierServer, "missing_party_server_id"),
  "missing supplier server id is unsafe"
);

const invalidCustomerAmount = buildStandaloneCustomerPaymentReplayContract({
  ...readyCustomerContract,
  payment: {
    ...readyCustomerContract.payment,
    amount: 0,
  },
});
assert(
  invalidCustomerAmount.replayReadiness.status === "unsafe" &&
    hasReason(invalidCustomerAmount, "invalid_payment_amount"),
  "invalid customer payment amount is unsafe"
);

const invalidSupplierAmount = buildStandaloneSupplierPaymentReplayContract({
  ...readySupplierContract,
  payment: {
    ...readySupplierContract.payment,
    amount: -1,
  },
});
assert(
  invalidSupplierAmount.replayReadiness.status === "unsafe" &&
    hasReason(invalidSupplierAmount, "invalid_payment_amount"),
  "invalid supplier payment amount is unsafe"
);

const missingPaymentDate = buildStandaloneCustomerPaymentReplayContract({
  ...readyCustomerContract,
  payment: {
    ...readyCustomerContract.payment,
    paymentDate: "",
  },
});
assert(
  missingPaymentDate.replayReadiness.status === "unsafe" &&
    hasReason(missingPaymentDate, "missing_payment_date"),
  "missing payment date is unsafe"
);

const missingLocalPaymentId = buildStandaloneSupplierPaymentReplayContract({
  ...readySupplierContract,
  localPaymentId: null,
});
assert(
  missingLocalPaymentId.replayReadiness.status === "unsafe" &&
    hasReason(missingLocalPaymentId, "missing_local_payment_id"),
  "missing local payment id is unsafe"
);

const customerPayload = buildPaymentTransactionPayload({
  clientTransactionId: "txn_customer_payment_ready",
  createdAt,
  partyType: "customer",
  payment: {
    id: 12,
    customerId: 3,
    amount: 125,
    paymentDate: "2026-06-04",
    remarks: "Standalone customer payment fixture",
    payableSnapshot: 500,
    balanceSnapshot: 375,
  },
  customer: {
    before: {
      id: 3,
      name: "Replay Fixture Customer",
      invoices: 0,
      payable: 500,
      paid: 0,
      balance: 500,
    },
    after: {
      id: 3,
      name: "Replay Fixture Customer",
      invoices: 0,
      payable: 500,
      paid: 125,
      balance: 375,
    },
  },
  standaloneCustomerPaymentReplay: readyCustomerContract,
});

assert(
  customerPayload.transactionType === "payment" &&
    customerPayload.replayReadiness?.scope === "standalone_customer_payment" &&
    customerPayload.replayReadiness?.status === "ready" &&
    customerPayload.payload.standaloneCustomerPaymentReplay.payloadVersion === 1,
  "queued customer payment exposes top-level readiness and v1 contract"
);
assert(!hasSensitiveKey(customerPayload), "queued customer payment payload contains no sensitive fields");

const supplierPayload = buildPaymentTransactionPayload({
  clientTransactionId: "txn_supplier_payment_ready",
  createdAt,
  partyType: "supplier",
  payment: {
    id: 22,
    supplierId: 4,
    amount: 225,
    paymentDate: "2026-06-04",
    remarks: "Standalone supplier payment fixture",
    payableSnapshot: 800,
    balanceSnapshot: 575,
  },
  supplier: {
    before: {
      id: 4,
      name: "Replay Fixture Supplier",
      invoices: 0,
      payable: 800,
      paid: 0,
      balance: 800,
    },
    after: {
      id: 4,
      name: "Replay Fixture Supplier",
      invoices: 0,
      payable: 800,
      paid: 225,
      balance: 575,
    },
  },
  standaloneSupplierPaymentReplay: readySupplierContract,
});

assert(
  supplierPayload.transactionType === "payment" &&
    supplierPayload.replayReadiness?.scope === "standalone_supplier_payment" &&
    supplierPayload.replayReadiness?.status === "ready" &&
    supplierPayload.payload.standaloneSupplierPaymentReplay.payloadVersion === 1,
  "queued supplier payment exposes top-level readiness and v1 contract"
);
assert(!hasSensitiveKey(supplierPayload), "queued supplier payment payload contains no sensitive fields");

const missingCustomerContractPayload = buildPaymentTransactionPayload({
  partyType: "customer",
  clientTransactionId: "txn_customer_payment_missing_contract",
  createdAt,
  payment: {
    id: 13,
    customerId: 3,
    amount: 125,
    paymentDate: "2026-06-04",
    remarks: "",
    payableSnapshot: 500,
    balanceSnapshot: 375,
  },
});
assert(
  missingCustomerContractPayload.replayReadiness?.status === "unsafe" &&
    hasReason(missingCustomerContractPayload, "missing_standalone_customer_payment_replay_contract"),
  "customer payment without explicit contract remains locally queueable but replay-unsafe"
);

const missingSupplierContractPayload = buildPaymentTransactionPayload({
  partyType: "supplier",
  clientTransactionId: "txn_supplier_payment_missing_contract",
  createdAt,
  payment: {
    id: 23,
    supplierId: 4,
    amount: 225,
    paymentDate: "2026-06-04",
    remarks: "",
    payableSnapshot: 800,
    balanceSnapshot: 575,
  },
});
assert(
  missingSupplierContractPayload.replayReadiness?.status === "unsafe" &&
    hasReason(missingSupplierContractPayload, "missing_standalone_supplier_payment_replay_contract"),
  "supplier payment without explicit contract remains locally queueable but replay-unsafe"
);

assert(
  queueServiceSource.includes("replayReadiness: payload.replayReadiness"),
  "queue row stores standalone payment readiness diagnostics beside the payload"
);
assert(
  custPaymentsSource.includes("buildPaymentTransactionPayload") &&
    custPaymentsSource.includes("queueOfflineTransaction") &&
    custPaymentsSource.includes("standaloneCustomerPaymentReplay") &&
    custPaymentsSource.includes("const localPaymentId = await customerPaymentsRepo.add(newPayment)"),
  "Customer Payments UI-facing create path queues standalone customer payment contract"
);
assert(
  supPaymentsSource.includes("buildPaymentTransactionPayload") &&
    supPaymentsSource.includes("queueOfflineTransaction") &&
    supPaymentsSource.includes("standaloneSupplierPaymentReplay") &&
    supPaymentsSource.includes("const localPaymentId = await supplierPayRepo.add(newPayment)"),
  "Supplier Payments UI-facing create path queues standalone supplier payment contract"
);
assert(
  builderSource.includes('export type StandalonePaymentOperation = "create"'),
  "standalone payment replay contract is create-only"
);
assert(
  syncEngineSource.includes("assertReadyStandaloneCustomerPaymentReplay") &&
    syncEngineSource.includes("assertReadyStandaloneSupplierPaymentReplay") &&
    syncEngineSource.includes("transactionApi.replayStandaloneCustomerPayment(item.payload.clientTransactionId)") &&
    syncEngineSource.includes("transactionApi.replayStandaloneSupplierPayment(item.payload.clientTransactionId)"),
  "manual sync router routes only ready standalone Customer/Supplier Payment payloads"
);
assert(
  transactionApiSource.includes('apiClient.post("/replay/customer-payment.php", { clientTransactionId })') &&
    transactionApiSource.includes('apiClient.post("/replay/supplier-payment.php", { clientTransactionId })') &&
    !transactionApiSource.includes("/replay/payment.php") &&
    !transactionApiSource.includes("/replay/standalone-payment.php"),
  "transaction API uses only narrow standalone payment replay endpoints"
);
assert(
  paymentReplayEndpoints.every((endpointPath) => existsSync(endpointPath)) &&
    forbiddenGenericPaymentReplayEndpoints.every((endpointPath) => !existsSync(endpointPath)),
  "backend standalone payment replay endpoints are narrow and generic payment replay is absent"
);
assert(
  transactionApiSource.includes("replayFinalizedSale") &&
    transactionApiSource.includes("replayFinalizedPurchase") &&
    transactionApiSource.includes("replayFinalizedCustomerReturn") &&
    transactionApiSource.includes("replayFinalizedSupplierReturn"),
  "finalized transaction replay routes remain available"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checks,
      scope: "standalone Customer/Supplier Payment payload readiness only",
      customerReadyStatus: readyCustomerContract.replayReadiness.status,
      supplierReadyStatus: readySupplierContract.replayReadiness.status,
      unsafeReasonCodes: [
        ...new Set([
          ...missingCustomerServer.replayReadiness.reasons.map((reason) => reason.code),
          ...missingSupplierServer.replayReadiness.reasons.map((reason) => reason.code),
          ...invalidCustomerAmount.replayReadiness.reasons.map((reason) => reason.code),
          ...invalidSupplierAmount.replayReadiness.reasons.map((reason) => reason.code),
          ...missingPaymentDate.replayReadiness.reasons.map((reason) => reason.code),
          ...missingLocalPaymentId.replayReadiness.reasons.map((reason) => reason.code),
          ...missingCustomerContractPayload.replayReadiness.reasons.map((reason) => reason.code),
          ...missingSupplierContractPayload.replayReadiness.reasons.map((reason) => reason.code),
        ]),
      ].sort(),
      queueRowsCreatedForStandalonePayments: true,
      backendPaymentReplayEndpointAdded: true,
      finalizedTransactionReplayChanged: false,
      autoSyncChanged: false,
      sourceModule: pathToFileURL(builderPath).href,
    },
    null,
    2
  )
);
