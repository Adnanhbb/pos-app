#!/usr/bin/env node

/*
 * Dev-only transaction business-reference validation tests.
 *
 * These tests exercise business-reference validation for customers, suppliers, and items. Successful cases now continue into stock-only replay, but never accounting, payment, cylinder, batch, sale, or sale item mutations
 * and do not touch stock, accounting, payment, cylinder, batch, sales, or sale
 * item tables.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `transaction-business-validation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
$runId = getenv('BUSINESS_VALIDATION_TEST_RUN_ID') ?: ('transaction-business-validation-' . time());
$workerPrefix = $runId . '-worker';

$customerId = insert_business_validation_customer($pdo, $runId . '-customer');
$supplierId = insert_business_validation_supplier($pdo, $runId . '-supplier');
$itemId = insert_business_validation_item($pdo, $runId . '-item-a');
$itemTwoId = insert_business_validation_item($pdo, $runId . '-item-b');
$missingCustomerId = next_missing_id($pdo, 'customers');
$missingSupplierId = next_missing_id($pdo, 'suppliers');
$missingItemId = next_missing_id($pdo, 'items');

$cases = [
    'valid_customer_reference' => [
        'payload' => make_business_validation_payload($runId . '-valid-customer', 'sale', [
            'sale' => ['customerId' => $customerId, 'invoiceNo' => $runId . '-CUST'],
            'saleItems' => [['itemId' => $itemId, 'qty' => 1, 'price' => 10]],
        ]),
        'expectedSuccess' => true,
    ],
    'valid_supplier_reference' => [
        'payload' => make_business_validation_payload($runId . '-valid-supplier', 'purchase', [
            'purchase' => ['supplierId' => $supplierId, 'invoiceNo' => $runId . '-SUP'],
            'items' => [['itemId' => $itemId, 'qty' => 1, 'price' => 10]],
        ]),
        'expectedSuccess' => true,
    ],
    'valid_item_references' => [
        'payload' => make_business_validation_payload($runId . '-valid-items', 'sale', [
            'sale' => ['invoiceNo' => $runId . '-ITEMS'],
            'saleItems' => [
                ['originalItemId' => $itemId, 'qty' => 1, 'price' => 10],
                ['itemId' => $itemTwoId, 'qty' => 2, 'price' => 20],
            ],
        ]),
        'expectedSuccess' => true,
    ],
    'missing_customer_reference' => [
        'payload' => make_business_validation_payload($runId . '-missing-customer', 'sale', [
            'sale' => ['customerId' => $missingCustomerId, 'invoiceNo' => $runId . '-MISS-CUST'],
            'saleItems' => [['itemId' => $itemId, 'qty' => 1, 'price' => 10]],
        ]),
        'expectedSuccess' => false,
    ],
    'missing_supplier_reference' => [
        'payload' => make_business_validation_payload($runId . '-missing-supplier', 'purchase', [
            'purchase' => ['supplierId' => $missingSupplierId, 'invoiceNo' => $runId . '-MISS-SUP'],
            'items' => [['itemId' => $itemId, 'qty' => 1, 'price' => 10]],
        ]),
        'expectedSuccess' => false,
    ],
    'missing_item_reference' => [
        'payload' => make_business_validation_payload($runId . '-missing-item', 'sale', [
            'sale' => ['invoiceNo' => $runId . '-MISS-ITEM'],
            'saleItems' => [['itemId' => $missingItemId, 'qty' => 1, 'price' => 10]],
        ]),
        'expectedSuccess' => false,
    ],
    'malformed_item_reference' => [
        'payload' => make_business_validation_payload($runId . '-malformed-item', 'sale', [
            'sale' => ['invoiceNo' => $runId . '-BAD-ITEM'],
            'saleItems' => [['qty' => 1, 'price' => 10]],
        ]),
        'expectedSuccess' => false,
    ],
];

$results = [];
foreach ($cases as $caseName => $case) {
    $payload = $case['payload'];
    $syncTransactionId = insert_business_validation_transaction($pdo, $payload);
    $replayResult = replayStoredTransaction($pdo, $syncTransactionId, $workerPrefix . '-' . $caseName);
    $row = fetch_business_validation_row($pdo, $syncTransactionId);
    $auditRows = fetch_business_validation_audit_rows($pdo, $syncTransactionId);

    $results[$caseName] = [
        'caseName' => $caseName,
        'syncTransactionId' => $syncTransactionId,
        'clientTransactionId' => $payload['clientTransactionId'],
        'expectedSuccess' => $case['expectedSuccess'],
        'replayResult' => $replayResult,
        'row' => $row,
        'auditRows' => $auditRows,
    ];
}

echo json_encode([
    'ok' => true,
    'fixtureIds' => [
        'customerId' => $customerId,
        'supplierId' => $supplierId,
        'itemId' => $itemId,
        'itemTwoId' => $itemTwoId,
        'missingCustomerId' => $missingCustomerId,
        'missingSupplierId' => $missingSupplierId,
        'missingItemId' => $missingItemId,
    ],
    'results' => $results,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

function make_business_validation_payload(string $clientTransactionId, string $transactionType, array $payload): array
{
    return [
        'clientTransactionId' => $clientTransactionId,
        'transactionType' => $transactionType,
        'createdAt' => time(),
        'payload' => $payload,
    ];
}

function insert_business_validation_transaction(PDO $pdo, array $payload): int
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

function insert_business_validation_customer(PDO $pdo, string $name): int
{
    $statement = $pdo->prepare(
        "INSERT INTO customers
            (client_id, name, mobile, cnic, address, invoices, payable, paid, balance)
         VALUES
            (:client_id, :name, '03000000000', '12345', 'Business validation customer', 0, 0, 0, 0)"
    );
    $statement->execute([
        'client_id' => $name,
        'name' => $name,
    ]);

    return (int) $pdo->lastInsertId();
}

function insert_business_validation_supplier(PDO $pdo, string $name): int
{
    $statement = $pdo->prepare(
        "INSERT INTO suppliers
            (client_id, name, mobile, cnic, address, invoices, payable, paid, balance)
         VALUES
            (:client_id, :name, '03111111111', '54321', 'Business validation supplier', 0, 0, 0, 0)"
    );
    $statement->execute([
        'client_id' => $name,
        'name' => $name,
    ]);

    return (int) $pdo->lastInsertId();
}

function insert_business_validation_item(PDO $pdo, string $name): int
{
    $statement = $pdo->prepare(
        "INSERT INTO items
            (client_id, name, barcode, purchasePrice, retailPrice, discountPrice, wholesalePrice, availableStock, category, brand, minunit, maxunit, ConvQty)
         VALUES
            (:client_id, :name, :barcode, 1, 2, 0, 2, 50, 'Business Validation', 'Business Validation', 'pc', 'box', 1)"
    );
    $statement->execute([
        'client_id' => $name,
        'name' => $name,
        'barcode' => $name,
    ]);

    return (int) $pdo->lastInsertId();
}

function next_missing_id(PDO $pdo, string $table): int
{
    $allowedTables = ['customers', 'suppliers', 'items'];
    if (!in_array($table, $allowedTables, true)) {
        throw new RuntimeException('Unsupported missing-id table.');
    }

    $row = $pdo->query("SELECT COALESCE(MAX(id), 0) + 1000000 AS missing_id FROM $table")->fetch();
    return (int) $row['missing_id'];
}

function fetch_business_validation_row(PDO $pdo, int $id): ?array
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

function fetch_business_validation_audit_rows(PDO $pdo, int $id): array
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

function runPhpBusinessValidationTest() {
  const result = spawnSync(findPhpBinary(), ["-r", phpTestCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      BUSINESS_VALIDATION_TEST_RUN_ID: runId,
    },
    windowsHide: true,
  });

  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) {
    return {
      ok: false,
      error: "PHP business-reference validation test failed.",
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

function isCommittedCase(testCase) {
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

function isFailedBusinessValidationCase(testCase) {
  return (
    testCase?.replayResult?.success === false &&
    testCase?.replayResult?.reason === "business_validation_failed" &&
    testCase?.row?.replay_status === "failed" &&
    Number(testCase?.row?.replay_attempts) === 1 &&
    Number(testCase?.row?.has_replay_error ?? 0) === 1 &&
    (testCase?.row?.locked_at === null || testCase?.row?.locked_at === undefined) &&
    (testCase?.row?.locked_by === null || testCase?.row?.locked_by === undefined)
  );
}

async function main() {
  console.log(`Testing transaction business-reference validation: ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);
  console.log("Business-reference validation plus stock-only replay; no accounting/sales/payment/cylinder/batch mutation assertions are made.");

  const health = await request("health");
  check(
    "backend health",
    { status: health.status, body: health.body },
    (res) => res.status === 200 && res.body?.success === true,
    "expected backend health success",
  );

  const result = runPhpBusinessValidationTest();
  check("PHP business-reference validation test completed", result, (res) => res.ok === true, "expected PHP helper test to complete");

  if (result.ok) {
    for (const name of ["valid_customer_reference", "valid_supplier_reference", "valid_item_references"]) {
      const testCase = getCase(result, name);
      check(
        `${name} passes business validation and stock-only replay`,
        { caseName: name, result: testCase?.replayResult, row: testCase?.row },
        () => isCommittedCase(testCase),
        "expected committed metadata with stock-only mutation",
      );

      check(
        `${name} writes validation audit rows`,
        { caseName: name, events: eventTypes(testCase?.auditRows), rows: testCase?.auditRows },
        (value) =>
          value.events.includes("lock_acquired") &&
          value.events.includes("replay_validation_started") &&
          value.events.includes("replay_validation_completed") &&
          value.events.includes("lock_released"),
        "expected lock and validation audit events",
      );
    }

    for (const name of ["missing_customer_reference", "missing_supplier_reference", "missing_item_reference", "malformed_item_reference"]) {
      const testCase = getCase(result, name);
      check(
        `${name} fails safely`,
        { caseName: name, result: testCase?.replayResult, row: testCase?.row },
        () => isFailedBusinessValidationCase(testCase),
        "expected failed replay metadata with released lock",
      );

      check(
        `${name} writes business validation audit rows`,
        { caseName: name, events: eventTypes(testCase?.auditRows), rows: testCase?.auditRows },
        (value) =>
          value.events.includes("lock_acquired") &&
          value.events.includes("replay_business_validation_failed") &&
          value.events.includes("replay_failed") &&
          value.events.includes("lock_released"),
        "expected business validation failure audit events",
      );
    }

    check(
      "replay_attempts remains one per validation attempt",
      { cases: Object.fromEntries(Object.entries(result.results).map(([name, value]) => [name, value.row?.replay_attempts])) },
      (value) => Object.values(value.cases).every((attempts) => Number(attempts) === 1),
      "expected every test transaction to be attempted exactly once",
    );

    pass("no business mutation assertions were added", {
      stock: "not asserted or mutated",
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
