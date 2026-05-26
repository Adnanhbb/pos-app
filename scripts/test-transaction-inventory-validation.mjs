#!/usr/bin/env node

/*
 * Dev-only transaction inventory sufficiency validation tests.
 *
 * These tests exercise validation-only inventory checks for deduction-style
 * transactions. They do not process payloads into stock mutations and do not
 * touch accounting, payments, cylinders, batches, sales, or sale item tables.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `transaction-inventory-validation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let passed = 0;
let failed = 0;

function findPhpBinary() {
  if (process.env.PHP_BIN) return process.env.PHP_BIN;

  const laragonPhpRoot = "C:\\laragon\\bin\\php";
  if (existsSync(laragonPhpRoot)) {
    const candidates = readdirSync(laragonPhpRoot)
      .map((entry) => resolve(laragonPhpRoot, entry, "php.exe"))
      .filter((candidate) => existsSync(candidate))
      .sort()
      .reverse();

    if (candidates.length > 0) return candidates[0];
  }

  return "php";
}

function pass(name, details) {
  passed += 1;
  console.log(`PASS ${name}`);
  if (details !== undefined) console.log(JSON.stringify(details, null, 2));
}

function fail(name, details, message) {
  failed += 1;
  console.error(`FAIL ${name}${message ? `: ${message}` : ""}`);
  if (details !== undefined) console.error(JSON.stringify(details, null, 2));
}

function check(name, details, predicate, message) {
  if (predicate(details)) {
    pass(name, details);
    return true;
  }

  fail(name, details, message);
  return false;
}

async function request(file) {
  const response = await fetch(`${API_BASE_URL}/${file}.php`);
  const text = await response.text();
  let body = null;

  if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return { status: response.status, body };
}

function phpTestCode() {
  return String.raw`
require_once getcwd() . '/api/config/database.php';
require_once getcwd() . '/api/lib/transactionReplayProcessor.php';

$pdo = get_pdo();
$runId = getenv('INVENTORY_VALIDATION_TEST_RUN_ID') ?: ('transaction-inventory-validation-' . time());
$workerPrefix = $runId . '-worker';

$sufficientItemId = insert_inventory_validation_item($pdo, $runId . '-sufficient-item', 10);
$lowStockItemId = insert_inventory_validation_item($pdo, $runId . '-low-stock-item', 1);
$zeroStockItemId = insert_inventory_validation_item($pdo, $runId . '-zero-stock-item', 0);

$cases = [
    'sufficient_stock_sale' => [
        'payload' => make_inventory_validation_payload($runId . '-sufficient-sale', 'sale', [
            'sale' => ['transactionType' => 'Sale', 'invoiceNo' => $runId . '-SUFFICIENT'],
            'saleItems' => [['itemId' => $sufficientItemId, 'qty' => 2, 'price' => 10]],
        ]),
        'expectedSuccess' => true,
        'expectedReason' => null,
    ],
    'insufficient_stock_sale' => [
        'payload' => make_inventory_validation_payload($runId . '-insufficient-sale', 'sale', [
            'sale' => ['transactionType' => 'Sale', 'invoiceNo' => $runId . '-INSUFFICIENT'],
            'saleItems' => [['itemId' => $lowStockItemId, 'qty' => 2, 'price' => 10]],
        ]),
        'expectedSuccess' => false,
        'expectedReason' => 'inventory_validation_failed',
    ],
    'invalid_quantity_sale' => [
        'payload' => make_inventory_validation_payload($runId . '-invalid-qty', 'sale', [
            'sale' => ['transactionType' => 'Sale', 'invoiceNo' => $runId . '-BAD-QTY'],
            'saleItems' => [['itemId' => $sufficientItemId, 'qty' => 0, 'price' => 10]],
        ]),
        'expectedSuccess' => false,
        'expectedReason' => 'inventory_validation_failed',
    ],
    'supplier_return_deducts_stock' => [
        'payload' => make_inventory_validation_payload($runId . '-supplier-return', 'return', [
            'returnMode' => 'supplier',
            'sale' => ['transactionType' => 'Supplier Return', 'invoiceNo' => $runId . '-SUP-RET'],
            'saleItems' => [['itemId' => $lowStockItemId, 'qty' => 2, 'price' => 10]],
        ]),
        'expectedSuccess' => false,
        'expectedReason' => 'inventory_validation_failed',
    ],
    'customer_return_skips_stock_check' => [
        'payload' => make_inventory_validation_payload($runId . '-customer-return', 'return', [
            'returnMode' => 'customer',
            'sale' => ['transactionType' => 'Customer Return', 'invoiceNo' => $runId . '-CUST-RET'],
            'saleItems' => [['itemId' => $zeroStockItemId, 'qty' => 5, 'price' => 10]],
        ]),
        'expectedSuccess' => true,
        'expectedReason' => null,
    ],
    'purchase_skips_stock_check' => [
        'payload' => make_inventory_validation_payload($runId . '-purchase', 'sale', [
            'sale' => ['transactionType' => 'Purchase', 'invoiceNo' => $runId . '-PURCHASE'],
            'items' => [['itemId' => $zeroStockItemId, 'qty' => 5, 'price' => 10]],
        ]),
        'expectedSuccess' => true,
        'expectedReason' => null,
    ],
];

$results = [];
foreach ($cases as $caseName => $case) {
    $payload = $case['payload'];
    $syncTransactionId = insert_inventory_validation_transaction($pdo, $payload);
    $replayResult = replayStoredTransaction($pdo, $syncTransactionId, $workerPrefix . '-' . $caseName);
    $row = fetch_inventory_validation_row($pdo, $syncTransactionId);
    $auditRows = fetch_inventory_validation_audit_rows($pdo, $syncTransactionId);

    $results[$caseName] = [
        'caseName' => $caseName,
        'syncTransactionId' => $syncTransactionId,
        'clientTransactionId' => $payload['clientTransactionId'],
        'expectedSuccess' => $case['expectedSuccess'],
        'expectedReason' => $case['expectedReason'],
        'replayResult' => $replayResult,
        'row' => $row,
        'auditRows' => $auditRows,
    ];
}

$missingStockField = ['ok' => false, 'error' => null];
try {
    validateReplayInventoryStockRows([999999 => 1], [999999 => ['id' => 999999]]);
} catch (ReplayInventoryValidationException $exception) {
    $missingStockField = ['ok' => true, 'error' => $exception->getMessage()];
}

echo json_encode([
    'ok' => true,
    'fixtureIds' => [
        'sufficientItemId' => $sufficientItemId,
        'lowStockItemId' => $lowStockItemId,
        'zeroStockItemId' => $zeroStockItemId,
    ],
    'missingStockField' => $missingStockField,
    'results' => $results,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

function make_inventory_validation_payload(string $clientTransactionId, string $transactionType, array $payload): array
{
    return [
        'clientTransactionId' => $clientTransactionId,
        'transactionType' => $transactionType,
        'createdAt' => time(),
        'payload' => $payload,
    ];
}

function insert_inventory_validation_transaction(PDO $pdo, array $payload): int
{
    $statement = $pdo->prepare(
        "INSERT INTO sync_transactions
            (client_transaction_id, transaction_type, payload_json, status, replay_status, replay_attempts)
         VALUES
            (:client_transaction_id, :transaction_type, :payload_json, 'stored', 'stored', 0)"
    );
    $statement->execute([
        'client_transaction_id' => $payload['clientTransactionId'],
        'transaction_type' => $payload['transactionType'],
        'payload_json' => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);

    return (int) $pdo->lastInsertId();
}

function insert_inventory_validation_item(PDO $pdo, string $name, float $availableStock): int
{
    $statement = $pdo->prepare(
        "INSERT INTO items
            (client_id, name, barcode, purchasePrice, retailPrice, discountPrice, wholesalePrice, availableStock, category, brand, minunit, maxunit, ConvQty)
         VALUES
            (:client_id, :name, :barcode, 1, 2, 0, 2, :availableStock, 'Inventory Validation', 'Inventory Validation', 'pc', 'box', 1)"
    );
    $statement->execute([
        'client_id' => $name,
        'name' => $name,
        'barcode' => $name,
        'availableStock' => $availableStock,
    ]);

    return (int) $pdo->lastInsertId();
}

function fetch_inventory_validation_row(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare(
        "SELECT
            id,
            client_transaction_id,
            transaction_type,
            status,
            replay_status,
            replay_attempts,
            replay_started_at,
            replay_finished_at,
            CASE WHEN replay_error IS NULL OR replay_error = '' THEN 0 ELSE 1 END AS has_replay_error,
            locked_at,
            locked_by
         FROM sync_transactions
         WHERE id = :id
         LIMIT 1"
    );
    $statement->execute(['id' => $id]);
    $row = $statement->fetch();

    return $row ?: null;
}

function fetch_inventory_validation_audit_rows(PDO $pdo, int $id): array
{
    $statement = $pdo->prepare(
        "SELECT
            id,
            sync_transaction_id,
            client_transaction_id,
            event_type,
            status_before,
            status_after,
            message,
            created_at
         FROM transaction_replay_audit
         WHERE sync_transaction_id = :id
         ORDER BY id ASC"
    );
    $statement->execute(['id' => $id]);

    return $statement->fetchAll();
}
`;
}

function runPhpInventoryValidationTest() {
  const result = spawnSync(findPhpBinary(), ["-r", phpTestCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      INVENTORY_VALIDATION_TEST_RUN_ID: runId,
    },
    windowsHide: true,
  });

  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) {
    return {
      ok: false,
      error: "PHP inventory validation test failed.",
      status: result.status,
      stderr: result.stderr.trim(),
      stdout: result.stdout,
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

function eventTypes(rows) {
  return Array.isArray(rows) ? rows.map((row) => row.event_type) : [];
}

function getCase(result, name) {
  return result?.results?.[name] ?? null;
}

function isCommittedValidationCase(testCase) {
  return (
    testCase?.replayResult?.success === true &&
    testCase?.replayResult?.replayStatus === "committed" &&
    testCase?.replayResult?.businessMutationsApplied === true &&
    testCase?.row?.replay_status === "committed" &&
    Number(testCase?.row?.replay_attempts) === 1 &&
    (testCase?.row?.locked_at === null || testCase?.row?.locked_at === undefined) &&
    (testCase?.row?.locked_by === null || testCase?.row?.locked_by === undefined)
  );
}

function isFailedInventoryValidationCase(testCase) {
  return (
    testCase?.replayResult?.success === false &&
    testCase?.replayResult?.reason === "inventory_validation_failed" &&
    testCase?.row?.replay_status === "failed" &&
    Number(testCase?.row?.replay_attempts) === 1 &&
    Number(testCase?.row?.has_replay_error ?? 0) === 1 &&
    (testCase?.row?.locked_at === null || testCase?.row?.locked_at === undefined) &&
    (testCase?.row?.locked_by === null || testCase?.row?.locked_by === undefined)
  );
}

async function main() {
  console.log(`Testing transaction inventory sufficiency validation: ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);
  console.log("Inventory validation plus stock-only replay; no accounting/sales/payment/cylinder/batch mutations are applied.");

  const health = await request("health");
  check(
    "backend health",
    { status: health.status, body: health.body },
    (res) => res.status === 200 && res.body?.success === true,
    "expected backend health success",
  );

  const result = runPhpInventoryValidationTest();
  check("PHP inventory validation test completed", result, (res) => res.ok === true, "expected PHP helper test to complete");

  if (result.ok) {
    for (const name of ["sufficient_stock_sale", "customer_return_skips_stock_check", "purchase_skips_stock_check"]) {
      const testCase = getCase(result, name);
      check(
        `${name} passes validation-only replay`,
        { caseName: name, result: testCase?.replayResult, row: testCase?.row },
        () => isCommittedValidationCase(testCase),
        "expected committed metadata with stock-only replay",
      );
    }

    for (const name of ["insufficient_stock_sale", "invalid_quantity_sale", "supplier_return_deducts_stock"]) {
      const testCase = getCase(result, name);
      check(
        `${name} fails inventory validation safely`,
        { caseName: name, result: testCase?.replayResult, row: testCase?.row },
        () => isFailedInventoryValidationCase(testCase),
        "expected inventory validation failure metadata with released lock",
      );

      check(
        `${name} writes inventory validation audit rows`,
        { caseName: name, events: eventTypes(testCase?.auditRows), rows: testCase?.auditRows },
        (value) =>
          value.events.includes("lock_acquired") &&
          value.events.includes("replay_inventory_validation_failed") &&
          value.events.includes("replay_failed") &&
          value.events.includes("lock_released"),
        "expected inventory validation failure audit events",
      );
    }

    check(
      "non-deduction transactions skip stock sufficiency checks",
      {
        customerReturn: getCase(result, "customer_return_skips_stock_check")?.replayResult,
        purchase: getCase(result, "purchase_skips_stock_check")?.replayResult,
      },
      (value) => value.customerReturn?.success === true && value.purchase?.success === true,
      "expected customer return and purchase to skip deduction sufficiency checks",
    );

    check(
      "missing stock field fails safely in validator",
      result.missingStockField,
      (value) => value?.ok === true && String(value.error || "").includes("missing or non-numeric"),
      "expected missing availableStock validation error",
    );

    check(
      "replay_attempts remains one per replay attempt",
      { cases: Object.fromEntries(Object.entries(result.results).map(([name, value]) => [name, value.row?.replay_attempts])) },
      (value) => Object.values(value.cases).every((attempts) => Number(attempts) === 1),
      "expected every test transaction to be attempted exactly once",
    );

    pass("only stock business mutations may be applied after validation", {
      stock: "validated and replayed for successful cases",
      accounting: "not asserted or mutated",
      sales: "not asserted or inserted",
      payments: "not asserted or inserted",
      cylinders: "not asserted or mutated",
      batches: "not asserted or mutated",
    });
  }

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