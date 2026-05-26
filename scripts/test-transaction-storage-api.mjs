#!/usr/bin/env node

/*
 * Storage-only transaction API validation tests.
 *
 * This script verifies transactions.php validation, idempotency, and storage
 * metadata only. It does not assert or perform stock/accounting/cylinder/batch
 * replay or mutation logic.
 *
 * Windows PowerShell:
 *   $env:API_BASE_URL="http://localhost/jawad-bro/api"
 *   npm run test:transactions:storage
 *
 * Optional PHP path override for DB verification:
 *   $env:PHP_BIN="C:\laragon\bin\php\php-8.3.16-Win32-vs16-x64\php.exe"
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `transaction-storage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let passed = 0;
let failed = 0;

function endpoint(file) {
  return `${API_BASE_URL}/${file}.php`;
}

async function request(file, options = {}) {
  const { method = "GET", body, rawBody, headers = {} } = options;
  const response = await fetch(endpoint(file), {
    method,
    headers: {
      ...(body !== undefined || rawBody !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

  const text = await response.text();
  let data = null;

  if (text.trim() !== "") {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return {
    status: response.status,
    ok: response.ok,
    body: data,
  };
}

function pass(name, details) {
  passed += 1;
  console.log(`PASS ${name}`);
  if (details !== undefined) {
    console.log(JSON.stringify(details, null, 2));
  }
}

function fail(name, details, message) {
  failed += 1;
  console.error(`FAIL ${name}${message ? `: ${message}` : ""}`);
  if (details !== undefined) {
    console.error(JSON.stringify(details, null, 2));
  }
}

function check(name, details, predicate, message) {
  if (predicate(details)) {
    pass(name, details);
    return true;
  }

  fail(name, details, message);
  return false;
}

function isSuccess(response) {
  return response.ok && response.body?.success === true;
}

function responseData(response) {
  return response.body?.data;
}

function findPhpBinary() {
  if (process.env.PHP_BIN) {
    return process.env.PHP_BIN;
  }

  const laragonPhpRoot = "C:\\laragon\\bin\\php";

  if (existsSync(laragonPhpRoot)) {
    const candidates = readdirSync(laragonPhpRoot)
      .map((entry) => resolve(laragonPhpRoot, entry, "php.exe"))
      .filter((candidate) => existsSync(candidate))
      .sort()
      .reverse();

    if (candidates.length > 0) {
      return candidates[0];
    }
  }

  return "php";
}

function phpString(value) {
  return JSON.stringify(String(value));
}

function queryStoredTransaction(clientTransactionId) {
  const phpCode = `
require_once getcwd() . '/api/config/database.php';
$pdo = get_pdo();
$id = ${phpString(clientTransactionId)};
$statement = $pdo->prepare("\n    SELECT\n        st.id AS sync_transaction_id,\n        st.client_transaction_id,\n        st.transaction_type,\n        st.status AS sync_status,\n        st.replay_status,\n        st.replay_attempts,\n        st.replay_started_at,\n        st.replay_finished_at,\n        CASE WHEN st.replay_error IS NULL OR st.replay_error = '' THEN 0 ELSE 1 END AS has_replay_error,\n        st.locked_at,\n        st.locked_by,\n        st.created_at AS sync_created_at,\n        st.updated_at AS sync_updated_at,\n        ti.id AS idempotency_id,\n        ti.status AS idempotency_status,\n        ti.request_hash,\n        ti.created_at AS idempotency_created_at,\n        ti.updated_at AS idempotency_updated_at,\n        CASE WHEN ti.response_json IS NULL OR ti.response_json = '' THEN 0 ELSE 1 END AS has_response,\n        CASE WHEN ti.error_message IS NULL OR ti.error_message = '' THEN 0 ELSE 1 END AS has_error\n    FROM sync_transactions st\n    LEFT JOIN transaction_idempotency ti\n        ON ti.client_transaction_id = st.client_transaction_id\n    WHERE st.client_transaction_id = :client_transaction_id\n    LIMIT 1\n");
$statement->execute(['client_transaction_id' => $id]);
$row = $statement->fetch();
echo json_encode(['ok' => true, 'row' => $row ?: null], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
`;

  const result = spawnSync(findPhpBinary(), ["-r", phpCode], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.error) {
    return {
      ok: false,
      error: result.error.message,
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      error: "PHP query failed.",
      status: result.status,
      stderr: result.stderr.trim(),
    };
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}
function basePayload(suffix, transactionType, payload) {
  return {
    clientTransactionId: `${runId}-${suffix}`,
    transactionType,
    createdAt: Date.now(),
    payload,
  };
}

function saleItems() {
  return [
    {
      itemId: 101,
      serverId: null,
      name: "Storage Test Item",
      qty: 2,
      price: 250,
      total: 500,
      unit: "pcs",
    },
  ];
}

function salePayload(suffix, saleOverrides = {}) {
  return basePayload(suffix, "sale", {
    sale: {
      invoiceNo: `${runId}-${suffix}-INV`,
      transactionType: "Sale",
      subtotal: 500,
      grandTotal: 500,
      paid: 500,
      ...saleOverrides,
    },
    saleItems: saleItems(),
    stockMovements: [],
    batchMutations: [],
    cylinderMutations: [],
  });
}

function purchasePayload() {
  return salePayload("purchase", {
    transactionType: "Purchase",
    supplierName: "Storage Test Supplier",
  });
}

function returnPayload(suffix, returnMode) {
  return basePayload(suffix, "return", {
    returnMode,
    sale: {
      invoiceNo: `${runId}-${suffix}-RET`,
      transactionType: returnMode === "customer" ? "Customer Return" : "Supplier Return",
      grandTotal: 100,
    },
    saleItems: [
      {
        itemId: 101,
        name: "Returned Storage Test Item",
        qty: 1,
        price: 100,
        total: 100,
      },
    ],
    stockMovements: [],
    batchMutations: [],
    cylinderMutations: [],
  });
}

function paymentPayload() {
  return basePayload("payment", "payment", {
    partyType: "customer",
    payment: {
      customerId: 123,
      amount: 75,
      date: "2026-05-20",
      description: "Storage validation payment",
    },
    customer: {
      before: { id: 123, balance: 75 },
      after: { id: 123, balance: 0 },
    },
  });
}

async function testValidStoragePayload(name, payload) {
  const response = await request("transactions", {
    method: "POST",
    body: payload,
  });

  const accepted = check(
    `${name}: API accepts storage-only transaction`,
    { status: response.status, body: response.body },
    (res) => res.status === 201 && res.body?.success === true && res.body?.data?.storedOnly === true,
    "expected HTTP 201 success with storedOnly true",
  );

  if (!accepted) return;

  const rowResult = queryStoredTransaction(payload.clientTransactionId);
  check(
    `${name}: sync_transactions and idempotency rows exist`,
    rowResult,
    (result) =>
      result.ok === true &&
      result.row?.client_transaction_id === payload.clientTransactionId &&
      result.row?.transaction_type === payload.transactionType &&
      result.row?.sync_status === "stored" &&
      result.row?.replay_status === "stored" &&
      Number(result.row?.replay_attempts) === 0 &&
      (result.row?.replay_started_at === null || result.row?.replay_started_at === undefined) &&
      (result.row?.replay_finished_at === null || result.row?.replay_finished_at === undefined) &&
      Number(result.row?.has_replay_error ?? 0) === 0 &&
      (result.row?.locked_at === null || result.row?.locked_at === undefined) &&
      (result.row?.locked_by === null || result.row?.locked_by === undefined) &&
      result.row?.idempotency_status === "completed" &&
      Boolean(result.row?.sync_transaction_id) &&
      Boolean(result.row?.idempotency_id),
    "expected stored sync transaction row, stored replay metadata, zero attempts, and completed idempotency row",
  );
}

async function testRejected(name, payload, expectedStatus = 422) {
  const response = await request("transactions", {
    method: "POST",
    body: payload,
  });

  check(
    name,
    { status: response.status, body: response.body },
    (res) => res.status === expectedStatus && res.body?.success === false,
    `expected HTTP ${expectedStatus} rejection`,
  );
}

async function testMalformedJson() {
  const response = await request("transactions", {
    method: "POST",
    rawBody: '{"broken":',
  });

  check(
    "malformed JSON returns 400",
    { status: response.status, body: response.body },
    (res) => res.status === 400 && res.body?.success === false,
    "expected HTTP 400 malformed JSON rejection",
  );
}

async function testIdempotency() {
  const payload = salePayload("idempotent");

  const first = await request("transactions", { method: "POST", body: payload });
  check(
    "idempotency: first request stored",
    { status: first.status, body: first.body },
    (res) => res.status === 201 && res.body?.success === true && res.body?.data?.storedOnly === true,
    "expected first request to store transaction",
  );

  const second = await request("transactions", { method: "POST", body: payload });
  check(
    "idempotency: same id and same payload returns saved response",
    { status: second.status, body: second.body },
    (res) => res.status === 200 && res.body?.success === true && res.body?.data?.clientTransactionId === payload.clientTransactionId,
    "expected idempotent saved response",
  );

  const changed = {
    ...payload,
    payload: {
      ...payload.payload,
      sale: {
        ...payload.payload.sale,
        grandTotal: 999,
      },
    },
  };
  const changedResponse = await request("transactions", { method: "POST", body: changed });
  check(
    "idempotency: same id and different payload returns 409",
    { status: changedResponse.status, body: changedResponse.body },
    (res) => res.status === 409 && res.body?.success === false,
    "expected HTTP 409 idempotency conflict",
  );
}

async function main() {
  console.log(`Testing transaction storage API: ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);
  console.log("Storage/validation only; no replay or stock/accounting mutation assertions are made.");

  const health = await request("health");
  check(
    "backend health",
    { status: health.status, body: health.body },
    (res) => res.status === 200 && res.body?.success === true,
    "expected backend health success",
  );

  await testMalformedJson();

  await testValidStoragePayload("sale", salePayload("sale"));
  await testValidStoragePayload("purchase-like sale", purchasePayload());
  await testValidStoragePayload("customer return", returnPayload("customer-return", "customer"));
  await testValidStoragePayload("supplier return", returnPayload("supplier-return", "supplier"));
  await testValidStoragePayload("payment", paymentPayload());

  await testRejected("missing clientTransactionId is rejected", {
    transactionType: "sale",
    createdAt: Date.now(),
    payload: salePayload("missing-id").payload,
  });
  await testRejected("missing transactionType is rejected", {
    clientTransactionId: `${runId}-missing-type`,
    createdAt: Date.now(),
    payload: salePayload("missing-type").payload,
  });
  await testRejected("invalid transactionType is rejected", {
    clientTransactionId: `${runId}-bad-type`,
    transactionType: "dangerous_replay",
    createdAt: Date.now(),
    payload: salePayload("bad-type").payload,
  });
  await testRejected("payload must be an object", {
    clientTransactionId: `${runId}-bad-payload`,
    transactionType: "sale",
    createdAt: Date.now(),
    payload: "not-object",
  });
  await testRejected("sale items must be a non-empty array", {
    clientTransactionId: `${runId}-bad-items`,
    transactionType: "sale",
    createdAt: Date.now(),
    payload: {
      sale: { invoiceNo: `${runId}-BAD-ITEMS` },
      saleItems: { itemId: 1, qty: 1 },
    },
  });
  await testRejected("invalid item qty is rejected", {
    clientTransactionId: `${runId}-bad-qty`,
    transactionType: "sale",
    createdAt: Date.now(),
    payload: {
      sale: { invoiceNo: `${runId}-BAD-QTY` },
      saleItems: [{ itemId: 1, qty: "not-numeric", price: 10 }],
    },
  });
  await testRejected("non-numeric createdAt is rejected", {
    clientTransactionId: `${runId}-bad-created-at`,
    transactionType: "sale",
    createdAt: "not-numeric",
    payload: salePayload("bad-created-at").payload,
  });

  await testIdempotency();

  console.log("");
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  failed += 1;
  console.error("FAIL test runner crashed");
  console.error(error);
  console.log("");
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  process.exitCode = 1;
});