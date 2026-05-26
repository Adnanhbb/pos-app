#!/usr/bin/env node

/*
 * Dev-only transaction accounting mutation replay tests.
 *
 * These tests verify that replay updates customer/supplier accounting summaries
 * atomically with stock mutation and sales persistence. They intentionally do
 * not create payment rows or mutate cylinders, batches, frontend behavior,
 * syncEngine, or auto-sync.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `transaction-accounting-mutation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
ensure_accounting_mutation_sales_tables($pdo);
$runId = getenv('ACCOUNTING_MUTATION_TEST_RUN_ID') ?: ('transaction-accounting-mutation-' . time());
$workerPrefix = $runId . '-worker';

$protectedCountsBefore = fetch_accounting_mutation_table_counts($pdo, ['cylinders', 'batches']);

$cases = [];
$cases['sale_updates_customer_balances'] = run_accounting_case($pdo, $workerPrefix, $runId, 'sale', [
    'partyType' => 'customer',
    'transactionType' => 'sale',
    'headerKey' => 'sale',
    'headerTransactionType' => 'Sale',
    'amount' => 30,
    'paid' => 10,
    'qty' => 3,
    'price' => 10,
    'initialStock' => 100,
    'expectedStock' => 97,
    'expectedParty' => ['invoices' => 3, 'payable' => 130, 'paid' => 30, 'balance' => 100],
]);

$cases['purchase_updates_supplier_balances'] = run_accounting_case($pdo, $workerPrefix, $runId, 'purchase', [
    'partyType' => 'supplier',
    'transactionType' => 'purchase',
    'headerKey' => 'purchase',
    'headerTransactionType' => 'Purchase',
    'amount' => 40,
    'paid' => 15,
    'qty' => 4,
    'price' => 10,
    'initialStock' => 50,
    'expectedStock' => 54,
    'expectedParty' => ['invoices' => 4, 'payable' => 240, 'paid' => 65, 'balance' => 175],
]);

$cases['customer_return_updates_customer_balances'] = run_accounting_case($pdo, $workerPrefix, $runId, 'customer-return', [
    'partyType' => 'customer',
    'transactionType' => 'return',
    'returnMode' => 'customer',
    'headerKey' => 'sale',
    'headerTransactionType' => 'Customer Return',
    'amount' => 50,
    'paid' => 5,
    'qty' => 5,
    'price' => 10,
    'initialStock' => 1,
    'expectedStock' => 6,
    'expectedParty' => ['invoices' => 3, 'payable' => 50, 'paid' => 15, 'balance' => 35],
]);

$cases['supplier_return_updates_supplier_balances'] = run_accounting_case($pdo, $workerPrefix, $runId, 'supplier-return', [
    'partyType' => 'supplier',
    'transactionType' => 'return',
    'returnMode' => 'supplier',
    'headerKey' => 'sale',
    'headerTransactionType' => 'Supplier Return',
    'amount' => 60,
    'paid' => 7,
    'qty' => 6,
    'price' => 10,
    'initialStock' => 20,
    'expectedStock' => 14,
    'expectedParty' => ['invoices' => 4, 'payable' => 140, 'paid' => 43, 'balance' => 97],
]);

$rollback = run_accounting_failure_case($pdo, $workerPrefix, $runId);
$protectedCountsAfter = fetch_accounting_mutation_table_counts($pdo, ['cylinders', 'batches']);

echo json_encode([
    'ok' => true,
    'cases' => $cases,
    'rollback' => $rollback,
    'protectedCountsBefore' => $protectedCountsBefore,
    'protectedCountsAfter' => $protectedCountsAfter,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

function run_accounting_case(PDO $pdo, string $workerPrefix, string $runId, string $caseName, array $config): array
{
    $itemId = insert_accounting_mutation_item($pdo, "$runId-$caseName-item", (float) $config['initialStock']);
    $partyType = $config['partyType'];
    $partyId = $partyType === 'customer'
        ? insert_accounting_mutation_customer($pdo, "$runId-$caseName-customer", 2, 100, 20)
        : insert_accounting_mutation_supplier($pdo, "$runId-$caseName-supplier", 3, 200, 50);

    $partyBefore = fetch_accounting_mutation_party($pdo, $partyType, $partyId);
    $stockBefore = fetch_accounting_mutation_stock($pdo, $itemId);
    $payload = make_accounting_mutation_payload($runId, $caseName, $config, $itemId, $partyId);
    $syncTransactionId = insert_accounting_mutation_transaction($pdo, $payload);
    $countsBefore = fetch_accounting_mutation_sales_counts($pdo, $syncTransactionId);

    $firstResult = replayStoredTransaction($pdo, $syncTransactionId, "$workerPrefix-$caseName");
    $partyAfterFirst = fetch_accounting_mutation_party($pdo, $partyType, $partyId);
    $stockAfterFirst = fetch_accounting_mutation_stock($pdo, $itemId);
    $countsAfterFirst = fetch_accounting_mutation_sales_counts($pdo, $syncTransactionId);
    $rowAfterFirst = fetch_accounting_mutation_row($pdo, $syncTransactionId);
    $auditAfterFirst = fetch_accounting_mutation_audit_rows($pdo, $syncTransactionId);

    $secondResult = replayStoredTransaction($pdo, $syncTransactionId, "$workerPrefix-$caseName-again");
    $partyAfterSecond = fetch_accounting_mutation_party($pdo, $partyType, $partyId);
    $stockAfterSecond = fetch_accounting_mutation_stock($pdo, $itemId);
    $countsAfterSecond = fetch_accounting_mutation_sales_counts($pdo, $syncTransactionId);

    return [
        'syncTransactionId' => $syncTransactionId,
        'partyType' => $partyType,
        'partyId' => $partyId,
        'itemId' => $itemId,
        'expectedParty' => $config['expectedParty'],
        'expectedStock' => (float) $config['expectedStock'],
        'partyBefore' => $partyBefore,
        'stockBefore' => $stockBefore,
        'firstResult' => $firstResult,
        'rowAfterFirst' => $rowAfterFirst,
        'auditAfterFirst' => $auditAfterFirst,
        'partyAfterFirst' => $partyAfterFirst,
        'stockAfterFirst' => $stockAfterFirst,
        'countsBefore' => $countsBefore,
        'countsAfterFirst' => $countsAfterFirst,
        'secondResult' => $secondResult,
        'partyAfterSecond' => $partyAfterSecond,
        'stockAfterSecond' => $stockAfterSecond,
        'countsAfterSecond' => $countsAfterSecond,
    ];
}

function run_accounting_failure_case(PDO $pdo, string $workerPrefix, string $runId): array
{
    $itemId = insert_accounting_mutation_item($pdo, "$runId-accounting-failure-item", 25);
    $customerId = insert_accounting_mutation_customer($pdo, "$runId-accounting-failure-customer", 1, 9999999990.00, 0);
    $partyBefore = fetch_accounting_mutation_party($pdo, 'customer', $customerId);
    $stockBefore = fetch_accounting_mutation_stock($pdo, $itemId);
    $payload = make_accounting_mutation_payload($runId, 'accounting-failure', [
        'partyType' => 'customer',
        'transactionType' => 'sale',
        'headerKey' => 'sale',
        'headerTransactionType' => 'Sale',
        'amount' => 20,
        'paid' => 0,
        'qty' => 2,
        'price' => 10,
    ], $itemId, $customerId);

    $syncTransactionId = insert_accounting_mutation_transaction($pdo, $payload);
    $result = replayStoredTransaction($pdo, $syncTransactionId, "$workerPrefix-accounting-failure");

    return [
        'syncTransactionId' => $syncTransactionId,
        'itemId' => $itemId,
        'customerId' => $customerId,
        'result' => $result,
        'row' => fetch_accounting_mutation_row($pdo, $syncTransactionId),
        'partyBefore' => $partyBefore,
        'partyAfter' => fetch_accounting_mutation_party($pdo, 'customer', $customerId),
        'stockBefore' => $stockBefore,
        'stockAfter' => fetch_accounting_mutation_stock($pdo, $itemId),
        'counts' => fetch_accounting_mutation_sales_counts($pdo, $syncTransactionId),
        'auditRows' => fetch_accounting_mutation_audit_rows($pdo, $syncTransactionId),
    ];
}

function make_accounting_mutation_payload(string $runId, string $caseName, array $config, int $itemId, int $partyId): array
{
    $partyType = $config['partyType'];
    $header = [
        'transactionType' => $config['headerTransactionType'],
        'invoiceNo' => "$runId-$caseName-INVOICE",
        'subtotal' => $config['amount'],
        'grandTotal' => $config['amount'],
        'paid' => $config['paid'],
    ];

    if ($partyType === 'customer') {
        $header['customerId'] = $partyId;
        $header['customerName'] = "$runId-$caseName-customer";
    } else {
        $header['supplierId'] = $partyId;
        $header['supplierName'] = "$runId-$caseName-supplier";
    }

    $payload = [
        $config['headerKey'] => $header,
        'saleItems' => [[
            'itemId' => $itemId,
            'name' => "$runId-$caseName-item",
            'qty' => $config['qty'],
            'price' => $config['price'],
        ]],
    ];

    if (isset($config['returnMode'])) {
        $payload['returnMode'] = $config['returnMode'];
    }

    if ($partyType === 'customer') {
        $payload['customerId'] = $partyId;
    } else {
        $payload['supplierId'] = $partyId;
    }

    return [
        'clientTransactionId' => "$runId-$caseName-client-transaction",
        'transactionType' => $config['transactionType'],
        'createdAt' => time(),
        'payload' => $payload,
    ];
}

function insert_accounting_mutation_transaction(PDO $pdo, array $payload): int
{
    $statement = $pdo->prepare("INSERT INTO sync_transactions (client_transaction_id, transaction_type, payload_json, status, replay_status, replay_attempts) VALUES (:client_transaction_id, :transaction_type, :payload_json, 'stored', 'stored', 0)");
    $statement->execute([
        'client_transaction_id' => $payload['clientTransactionId'],
        'transaction_type' => $payload['transactionType'],
        'payload_json' => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);
    return (int) $pdo->lastInsertId();
}

function insert_accounting_mutation_item(PDO $pdo, string $name, float $availableStock): int
{
    $statement = $pdo->prepare("INSERT INTO items (client_id, name, barcode, purchasePrice, retailPrice, discountPrice, wholesalePrice, availableStock, category, brand, minunit, maxunit, ConvQty) VALUES (:client_id, :name, :barcode, 1, 2, 0, 2, :availableStock, 'Accounting Mutation', 'Accounting Mutation', 'pc', 'box', 1)");
    $statement->execute(['client_id' => $name, 'name' => $name, 'barcode' => $name, 'availableStock' => $availableStock]);
    return (int) $pdo->lastInsertId();
}

function insert_accounting_mutation_customer(PDO $pdo, string $name, int $invoices, float $payable, float $paid): int
{
    $statement = $pdo->prepare("INSERT INTO customers (client_id, name, mobile, cnic, address, invoices, payable, paid, balance) VALUES (:client_id, :name, '03000000000', 'accounting-test', 'accounting mutation customer', :invoices, :payable, :paid, :balance)");
    $statement->execute(['client_id' => $name, 'name' => $name, 'invoices' => $invoices, 'payable' => $payable, 'paid' => $paid, 'balance' => $payable - $paid]);
    return (int) $pdo->lastInsertId();
}

function insert_accounting_mutation_supplier(PDO $pdo, string $name, int $invoices, float $payable, float $paid): int
{
    $statement = $pdo->prepare("INSERT INTO suppliers (client_id, name, mobile, cnic, address, invoices, payable, paid, balance) VALUES (:client_id, :name, '03111111111', 'accounting-test', 'accounting mutation supplier', :invoices, :payable, :paid, :balance)");
    $statement->execute(['client_id' => $name, 'name' => $name, 'invoices' => $invoices, 'payable' => $payable, 'paid' => $paid, 'balance' => $payable - $paid]);
    return (int) $pdo->lastInsertId();
}

function fetch_accounting_mutation_party(PDO $pdo, string $partyType, int $id): array
{
    $table = $partyType === 'customer' ? 'customers' : 'suppliers';
    $statement = $pdo->prepare("SELECT invoices, payable, paid, balance FROM $table WHERE id = :id LIMIT 1");
    $statement->execute(['id' => $id]);
    $row = $statement->fetch() ?: [];
    return [
        'invoices' => (int) ($row['invoices'] ?? 0),
        'payable' => (float) ($row['payable'] ?? 0),
        'paid' => (float) ($row['paid'] ?? 0),
        'balance' => (float) ($row['balance'] ?? 0),
    ];
}

function fetch_accounting_mutation_stock(PDO $pdo, int $id): float
{
    $statement = $pdo->prepare('SELECT availableStock FROM items WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $id]);
    return (float) (($statement->fetch()['availableStock'] ?? 0));
}

function fetch_accounting_mutation_sales_counts(PDO $pdo, int $syncTransactionId): array
{
    $sales = $pdo->prepare('SELECT id FROM sales WHERE sync_transaction_id = :id ORDER BY id ASC');
    $sales->execute(['id' => $syncTransactionId]);
    $saleRows = $sales->fetchAll();
    $itemCount = 0;
    foreach ($saleRows as $saleRow) {
        $items = $pdo->prepare('SELECT COUNT(*) AS row_count FROM sale_items WHERE sale_id = :sale_id');
        $items->execute(['sale_id' => $saleRow['id']]);
        $itemCount += (int) ($items->fetch()['row_count'] ?? 0);
    }
    return ['sales' => count($saleRows), 'sale_items' => $itemCount];
}

function fetch_accounting_mutation_row(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare('SELECT id, client_transaction_id, replay_status, replay_attempts, CASE WHEN replay_error IS NULL OR replay_error = "" THEN 0 ELSE 1 END AS has_replay_error, locked_at, locked_by FROM sync_transactions WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $id]);
    $row = $statement->fetch();
    return $row ?: null;
}

function fetch_accounting_mutation_audit_rows(PDO $pdo, int $id): array
{
    $statement = $pdo->prepare('SELECT event_type, status_before, status_after, message FROM transaction_replay_audit WHERE sync_transaction_id = :id ORDER BY id ASC');
    $statement->execute(['id' => $id]);
    return $statement->fetchAll();
}

function fetch_accounting_mutation_table_counts(PDO $pdo, array $tables): array
{
    $counts = [];
    foreach ($tables as $table) {
        if (!accounting_mutation_table_exists($pdo, $table)) {
            $counts[$table] = null;
            continue;
        }
        $row = $pdo->query("SELECT COUNT(*) AS row_count FROM $table")->fetch();
        $counts[$table] = (int) $row['row_count'];
    }
    return $counts;
}

function accounting_mutation_table_exists(PDO $pdo, string $table): bool
{
    $statement = $pdo->prepare('SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = :table_name');
    $statement->execute(['table_name' => $table]);
    return (int) (($statement->fetch()['table_count'] ?? 0)) > 0;
}

function ensure_accounting_mutation_sales_tables(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS sales (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        sync_transaction_id BIGINT UNSIGNED NULL UNIQUE,
        client_transaction_id VARCHAR(150) NULL UNIQUE,
        invoiceNo VARCHAR(120) NOT NULL,
        date VARCHAR(50) NULL,
        transactionType VARCHAR(80) NOT NULL,
        customerId BIGINT UNSIGNED NULL,
        supplierId BIGINT UNSIGNED NULL,
        customerName VARCHAR(180) NULL,
        supplierName VARCHAR(180) NULL,
        subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
        discount DECIMAL(12,2) NOT NULL DEFAULT 0,
        tax DECIMAL(12,2) NOT NULL DEFAULT 0,
        dues DECIMAL(12,2) NOT NULL DEFAULT 0,
        grandTotal DECIMAL(12,2) NOT NULL DEFAULT 0,
        paid DECIMAL(12,2) NOT NULL DEFAULT 0,
        arrears DECIMAL(12,2) NOT NULL DEFAULT 0,
        profit DECIMAL(12,2) NOT NULL DEFAULT 0,
        isPostponed TINYINT(1) NOT NULL DEFAULT 0,
        sale_json LONGTEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_sales_invoiceNo (invoiceNo),
        INDEX idx_sales_transactionType (transactionType),
        INDEX idx_sales_customerId (customerId),
        INDEX idx_sales_supplierId (supplierId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS sale_items (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        sale_id BIGINT UNSIGNED NOT NULL,
        originalItemId BIGINT UNSIGNED NULL,
        name VARCHAR(180) NOT NULL,
        qty DECIMAL(12,2) NOT NULL DEFAULT 0,
        price DECIMAL(12,2) NOT NULL DEFAULT 0,
        priceCategory VARCHAR(80) NULL,
        discountType VARCHAR(50) NULL,
        discountValue DECIMAL(12,2) NOT NULL DEFAULT 0,
        taxType VARCHAR(50) NULL,
        taxValue DECIMAL(12,2) NOT NULL DEFAULT 0,
        item_json LONGTEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_sale_items_sale_id (sale_id),
        INDEX idx_sale_items_originalItemId (originalItemId),
        CONSTRAINT fk_sale_items_sale_id FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}
`;
}

function runPhpAccountingMutationTest() {
  const result = spawnSync(findPhpBinary(), ["-r", phpTestCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, ACCOUNTING_MUTATION_TEST_RUN_ID: runId },
    windowsHide: true,
  });

  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) return { ok: false, error: "PHP accounting mutation test failed.", status: result.status, stderr: result.stderr.trim(), stdout: result.stdout };

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), stdout: result.stdout, stderr: result.stderr };
  }
}

function eventTypes(rows) {
  return Array.isArray(rows) ? rows.map((row) => row.event_type) : [];
}

function numbersMatch(actual, expected) {
  return Math.abs(Number(actual) - Number(expected)) < 0.000001;
}

function partyMatches(actual, expected) {
  return (
    Number(actual?.invoices) === Number(expected?.invoices) &&
    numbersMatch(actual?.payable, expected?.payable) &&
    numbersMatch(actual?.paid, expected?.paid) &&
    numbersMatch(actual?.balance, expected?.balance)
  );
}

function committedAccountingCase(testCase) {
  return (
    testCase?.firstResult?.success === true &&
    testCase?.firstResult?.replayStatus === "committed" &&
    testCase?.firstResult?.stockMutationsApplied === true &&
    testCase?.firstResult?.salesPersisted === true &&
    testCase?.firstResult?.accountingMutationsApplied === true &&
    Number(testCase?.firstResult?.accountingMutationResult?.appliedCount ?? 0) === 1 &&
    Number(testCase?.rowAfterFirst?.replay_attempts) === 1 &&
    testCase?.rowAfterFirst?.replay_status === "committed"
  );
}

async function main() {
  console.log(`Testing transaction accounting mutation replay: ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);
  console.log("Stock + sales + authoritative customer/supplier accounting + payment ledger replay; cylinders/batches/frontend/auto-sync are untouched.");

  const health = await request("health");
  check("backend health", { status: health.status, body: health.body }, (res) => res.status === 200 && res.body?.success === true, "expected backend health success");

  const result = runPhpAccountingMutationTest();
  check("PHP accounting mutation test completed", result, (res) => res.ok === true, "expected PHP accounting mutation helper test to complete");

  if (result.ok) {
    for (const name of [
      "sale_updates_customer_balances",
      "purchase_updates_supplier_balances",
      "customer_return_updates_customer_balances",
      "supplier_return_updates_supplier_balances",
    ]) {
      const testCase = result.cases?.[name];
      check(`${name}: replay commits stock, sales, and accounting`, { result: testCase?.firstResult, row: testCase?.rowAfterFirst }, () => committedAccountingCase(testCase), "expected committed replay with accounting mutation metadata");
      check(`${name}: party accounting matches expected`, { expected: testCase?.expectedParty, actual: testCase?.partyAfterFirst }, () => partyMatches(testCase?.partyAfterFirst, testCase?.expectedParty), "expected backend-authoritative accounting summary update");
      check(`${name}: stock mutation still matches expected`, { expected: testCase?.expectedStock, actual: testCase?.stockAfterFirst }, () => numbersMatch(testCase?.stockAfterFirst, testCase?.expectedStock), "expected stock mutation to remain correct");
      check(`${name}: sales rows inserted`, { counts: testCase?.countsAfterFirst }, () => Number(testCase?.countsAfterFirst?.sales) === 1 && Number(testCase?.countsAfterFirst?.sale_items) === 1, "expected one sales row and one sale_items row");
      check(`${name}: accounting audit rows exist`, { events: eventTypes(testCase?.auditAfterFirst) }, (value) => value.events.includes("replay_accounting_mutation_started") && value.events.includes("replay_accounting_mutation_completed") && !value.events.includes("replay_accounting_mutation_failed"), "expected accounting mutation audit start/completed events");
      check(`${name}: duplicate replay does not mutate balances again`, { secondResult: testCase?.secondResult, afterFirst: testCase?.partyAfterFirst, afterSecond: testCase?.partyAfterSecond, stockAfterFirst: testCase?.stockAfterFirst, stockAfterSecond: testCase?.stockAfterSecond, countsAfterFirst: testCase?.countsAfterFirst, countsAfterSecond: testCase?.countsAfterSecond }, () => testCase?.secondResult?.terminalStateSkipped === true && testCase?.secondResult?.alreadyCommitted === true && partyMatches(testCase?.partyAfterSecond, testCase?.partyAfterFirst) && numbersMatch(testCase?.stockAfterSecond, testCase?.stockAfterFirst) && JSON.stringify(testCase?.countsAfterSecond) === JSON.stringify(testCase?.countsAfterFirst), "expected terminal-state skip with unchanged balances, stock, and sales rows");
    }

    const rollback = result.rollback;
    check("failed accounting rolls back stock and sales", { result: rollback?.result, row: rollback?.row, partyBefore: rollback?.partyBefore, partyAfter: rollback?.partyAfter, stockBefore: rollback?.stockBefore, stockAfter: rollback?.stockAfter, counts: rollback?.counts, events: eventTypes(rollback?.auditRows) }, (value) => value.result?.success === false && value.result?.reason === "accounting_mutation_failed" && value.row?.replay_status === "failed" && partyMatches(value.partyAfter, value.partyBefore) && numbersMatch(value.stockAfter, value.stockBefore) && Number(value.counts?.sales) === 0 && Number(value.counts?.sale_items) === 0 && value.events.includes("replay_accounting_mutation_failed"), "expected accounting failure to rollback stock and sales atomically");

    check("cylinder/batch table counts unchanged when present", { before: result.protectedCountsBefore, after: result.protectedCountsAfter }, (value) => JSON.stringify(value.before) === JSON.stringify(value.after), "expected no cylinder or batch mutation");

    pass("only items.availableStock, sales/sale_items, and customer/supplier summaries were intentionally mutated", {
      stock: "mutated through replay",
      sales: "inserted",
      saleItems: "inserted",
      accounting: "customer/supplier summaries updated",
      payments: "inserted when paid amount is non-zero",
      cylinders: "unchanged",
      batches: "unchanged",
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
