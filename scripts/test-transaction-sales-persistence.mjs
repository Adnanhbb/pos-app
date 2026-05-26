#!/usr/bin/env node

/*
 * Dev-only transaction sales persistence replay tests.
 *
 * These tests verify that replay persists finalized sales and sale_items
 * atomically with stock mutation. Accounting summaries are now mutated by replay too, and payment ledger rows may be persisted when paid amounts are non-zero. Cylinders, batches, frontend behavior, syncEngine, and auto-sync stay untouched.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `transaction-sales-persistence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
ensure_sales_persistence_tables($pdo);
$runId = getenv('SALES_PERSISTENCE_TEST_RUN_ID') ?: ('transaction-sales-persistence-' . time());
$workerPrefix = $runId . '-worker';

$customerId = insert_sales_persistence_customer($pdo, $runId . '-customer', 100);
$supplierId = insert_sales_persistence_supplier($pdo, $runId . '-supplier', 200);
$balancesBefore = fetch_sales_persistence_balances($pdo, $customerId, $supplierId);
$protectedCountsBefore = fetch_sales_persistence_table_counts($pdo, ['cylinders', 'batches']);

$items = [
    'sale' => insert_sales_persistence_item($pdo, $runId . '-sale-item', 100),
    'purchase' => insert_sales_persistence_item($pdo, $runId . '-purchase-item', 50),
    'customer_return' => insert_sales_persistence_item($pdo, $runId . '-customer-return-item', 1),
    'supplier_return' => insert_sales_persistence_item($pdo, $runId . '-supplier-return-item', 10),
    'multi_a' => insert_sales_persistence_item($pdo, $runId . '-multi-a', 30),
    'multi_b' => insert_sales_persistence_item($pdo, $runId . '-multi-b', 40),
    'rollback' => insert_sales_persistence_item($pdo, $runId . '-rollback-item', 25),
];

$cases = [
    'sale_inserts_sales_and_items' => [
        'payload' => make_sales_persistence_payload($runId . '-sale', 'sale', [
            'sale' => ['transactionType' => 'Sale', 'invoiceNo' => $runId . '-SALE', 'customerId' => $customerId, 'customerName' => $runId . '-customer', 'subtotal' => 30, 'grandTotal' => 30, 'paid' => 10, 'arrears' => 20],
            'customerId' => $customerId,
            'saleItems' => [['itemId' => $items['sale'], 'name' => $runId . '-sale-item', 'qty' => 3, 'price' => 10]],
        ]),
        'expectedStocks' => [$items['sale'] => 97.0],
        'expectedItems' => 1,
    ],
    'purchase_inserts_sales_and_items' => [
        'payload' => make_sales_persistence_payload($runId . '-purchase', 'purchase', [
            'purchase' => ['transactionType' => 'Purchase', 'invoiceNo' => $runId . '-PURCHASE', 'supplierId' => $supplierId, 'supplierName' => $runId . '-supplier', 'subtotal' => 40, 'grandTotal' => 40],
            'supplierId' => $supplierId,
            'items' => [['itemId' => $items['purchase'], 'name' => $runId . '-purchase-item', 'qty' => 4, 'price' => 10]],
        ]),
        'expectedStocks' => [$items['purchase'] => 54.0],
        'expectedItems' => 1,
    ],
    'customer_return_inserts_sales_and_items' => [
        'payload' => make_sales_persistence_payload($runId . '-customer-return', 'return', [
            'returnMode' => 'customer',
            'sale' => ['transactionType' => 'Customer Return', 'invoiceNo' => $runId . '-CUST-RETURN', 'customerId' => $customerId],
            'customerId' => $customerId,
            'saleItems' => [['itemId' => $items['customer_return'], 'name' => $runId . '-customer-return-item', 'qty' => 5, 'price' => 10]],
        ]),
        'expectedStocks' => [$items['customer_return'] => 6.0],
        'expectedItems' => 1,
    ],
    'supplier_return_inserts_sales_and_items' => [
        'payload' => make_sales_persistence_payload($runId . '-supplier-return', 'return', [
            'returnMode' => 'supplier',
            'sale' => ['transactionType' => 'Supplier Return', 'invoiceNo' => $runId . '-SUP-RETURN', 'supplierId' => $supplierId],
            'supplierId' => $supplierId,
            'saleItems' => [['itemId' => $items['supplier_return'], 'name' => $runId . '-supplier-return-item', 'qty' => 6, 'price' => 10]],
        ]),
        'expectedStocks' => [$items['supplier_return'] => 4.0],
        'expectedItems' => 1,
    ],
    'multiple_items_insert_matching_sale_items' => [
        'payload' => make_sales_persistence_payload($runId . '-multi', 'sale', [
            'sale' => ['transactionType' => 'Sale', 'invoiceNo' => $runId . '-MULTI'],
            'saleItems' => [
                ['itemId' => $items['multi_a'], 'name' => $runId . '-multi-a', 'qty' => 1, 'price' => 10],
                ['itemId' => $items['multi_b'], 'name' => $runId . '-multi-b', 'qty' => 2, 'price' => 20],
            ],
        ]),
        'expectedStocks' => [$items['multi_a'] => 29.0, $items['multi_b'] => 38.0],
        'expectedItems' => 2,
    ],
];

$results = [];
foreach ($cases as $caseName => $case) {
    $syncTransactionId = insert_sales_persistence_transaction($pdo, $case['payload']);
    $beforeCounts = fetch_sales_rows_for_transaction($pdo, $syncTransactionId);
    $firstResult = replayStoredTransaction($pdo, $syncTransactionId, $workerPrefix . '-' . $caseName);
    $rowAfterFirst = fetch_sales_persistence_row($pdo, $syncTransactionId);
    $auditAfterFirst = fetch_sales_persistence_audit_rows($pdo, $syncTransactionId);
    $stockAfterFirst = fetch_sales_persistence_stock($pdo, array_keys($case['expectedStocks']));
    $afterCounts = fetch_sales_rows_for_transaction($pdo, $syncTransactionId);

    $secondResult = replayStoredTransaction($pdo, $syncTransactionId, $workerPrefix . '-' . $caseName . '-again');
    $afterDuplicateCounts = fetch_sales_rows_for_transaction($pdo, $syncTransactionId);
    $stockAfterSecond = fetch_sales_persistence_stock($pdo, array_keys($case['expectedStocks']));

    $results[$caseName] = [
        'syncTransactionId' => $syncTransactionId,
        'expectedStocks' => $case['expectedStocks'],
        'expectedItems' => $case['expectedItems'],
        'beforeCounts' => $beforeCounts,
        'firstResult' => $firstResult,
        'rowAfterFirst' => $rowAfterFirst,
        'auditAfterFirst' => $auditAfterFirst,
        'stockAfterFirst' => $stockAfterFirst,
        'afterCounts' => $afterCounts,
        'secondResult' => $secondResult,
        'afterDuplicateCounts' => $afterDuplicateCounts,
        'stockAfterSecond' => $stockAfterSecond,
    ];
}

$rollbackPayload = make_sales_persistence_payload($runId . '-rollback', 'sale', [
    'sale' => ['transactionType' => 'Sale', 'invoiceNo' => $runId . '-ROLLBACK'],
    'saleItems' => [['itemId' => $items['rollback'], 'name' => $runId . '-rollback-item', 'qty' => 2, 'price' => 10]],
]);
$rollbackId = insert_sales_persistence_transaction($pdo, $rollbackPayload);
$rollbackStockBefore = fetch_sales_persistence_stock($pdo, [$items['rollback']]);
insert_sales_persistence_conflicting_sale($pdo, $rollbackId, $runId . '-rollback-conflict');
$rollbackResult = replayStoredTransaction($pdo, $rollbackId, $workerPrefix . '-rollback');
$rollbackRow = fetch_sales_persistence_row($pdo, $rollbackId);
$rollbackStockAfter = fetch_sales_persistence_stock($pdo, [$items['rollback']]);
$rollbackCounts = fetch_sales_rows_for_transaction($pdo, $rollbackId);
$rollbackAuditRows = fetch_sales_persistence_audit_rows($pdo, $rollbackId);

$balancesAfter = fetch_sales_persistence_balances($pdo, $customerId, $supplierId);
$protectedCountsAfter = fetch_sales_persistence_table_counts($pdo, ['cylinders', 'batches']);

echo json_encode([
    'ok' => true,
    'fixtureIds' => ['customerId' => $customerId, 'supplierId' => $supplierId, 'items' => $items],
    'results' => $results,
    'rollback' => [
        'syncTransactionId' => $rollbackId,
        'result' => $rollbackResult,
        'row' => $rollbackRow,
        'stockBefore' => $rollbackStockBefore,
        'stockAfter' => $rollbackStockAfter,
        'counts' => $rollbackCounts,
        'auditRows' => $rollbackAuditRows,
    ],
    'balancesBefore' => $balancesBefore,
    'balancesAfter' => $balancesAfter,
    'protectedCountsBefore' => $protectedCountsBefore,
    'protectedCountsAfter' => $protectedCountsAfter,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

function ensure_sales_persistence_tables(PDO $pdo): void
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

function make_sales_persistence_payload(string $clientTransactionId, string $transactionType, array $payload): array
{
    return ['clientTransactionId' => $clientTransactionId, 'transactionType' => $transactionType, 'createdAt' => time(), 'payload' => $payload];
}

function insert_sales_persistence_transaction(PDO $pdo, array $payload): int
{
    $statement = $pdo->prepare("INSERT INTO sync_transactions (client_transaction_id, transaction_type, payload_json, status, replay_status, replay_attempts) VALUES (:client_transaction_id, :transaction_type, :payload_json, 'stored', 'stored', 0)");
    $statement->execute([
        'client_transaction_id' => $payload['clientTransactionId'],
        'transaction_type' => $payload['transactionType'],
        'payload_json' => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);
    return (int) $pdo->lastInsertId();
}

function insert_sales_persistence_item(PDO $pdo, string $name, float $availableStock): int
{
    $statement = $pdo->prepare("INSERT INTO items (client_id, name, barcode, purchasePrice, retailPrice, discountPrice, wholesalePrice, availableStock, category, brand, minunit, maxunit, ConvQty) VALUES (:client_id, :name, :barcode, 1, 2, 0, 2, :availableStock, 'Sales Persistence', 'Sales Persistence', 'pc', 'box', 1)");
    $statement->execute(['client_id' => $name, 'name' => $name, 'barcode' => $name, 'availableStock' => $availableStock]);
    return (int) $pdo->lastInsertId();
}

function insert_sales_persistence_customer(PDO $pdo, string $name, float $balance): int
{
    $statement = $pdo->prepare("INSERT INTO customers (client_id, name, mobile, cnic, address, invoices, payable, paid, balance) VALUES (:client_id, :name, '03000000000', 'sales-test', 'sales persistence customer', 0, :payable, 0, :balance)");
    $statement->execute(['client_id' => $name, 'name' => $name, 'payable' => $balance, 'balance' => $balance]);
    return (int) $pdo->lastInsertId();
}

function insert_sales_persistence_supplier(PDO $pdo, string $name, float $balance): int
{
    $statement = $pdo->prepare("INSERT INTO suppliers (client_id, name, mobile, cnic, address, invoices, payable, paid, balance) VALUES (:client_id, :name, '03111111111', 'sales-test', 'sales persistence supplier', 0, :payable, 0, :balance)");
    $statement->execute(['client_id' => $name, 'name' => $name, 'payable' => $balance, 'balance' => $balance]);
    return (int) $pdo->lastInsertId();
}

function insert_sales_persistence_conflicting_sale(PDO $pdo, int $syncTransactionId, string $invoiceNo): void
{
    $statement = $pdo->prepare("INSERT INTO sales (sync_transaction_id, client_transaction_id, invoiceNo, date, transactionType) VALUES (:sync_transaction_id, :client_transaction_id, :invoiceNo, :date, 'Sale')");
    $statement->execute([
        'sync_transaction_id' => $syncTransactionId,
        'client_transaction_id' => $invoiceNo,
        'invoiceNo' => $invoiceNo,
        'date' => date('Y-m-d'),
    ]);
}

function fetch_sales_rows_for_transaction(PDO $pdo, int $syncTransactionId): array
{
    $sales = $pdo->prepare('SELECT id, invoiceNo, transactionType, customerId, supplierId, subtotal, grandTotal, paid, arrears FROM sales WHERE sync_transaction_id = :id ORDER BY id ASC');
    $sales->execute(['id' => $syncTransactionId]);
    $saleRows = $sales->fetchAll();
    $itemCount = 0;
    foreach ($saleRows as $saleRow) {
        $items = $pdo->prepare('SELECT COUNT(*) AS row_count FROM sale_items WHERE sale_id = :sale_id');
        $items->execute(['sale_id' => $saleRow['id']]);
        $itemCount += (int) ($items->fetch()['row_count'] ?? 0);
    }
    return ['sales' => count($saleRows), 'sale_items' => $itemCount, 'rows' => $saleRows];
}

function fetch_sales_persistence_stock(PDO $pdo, array $ids): array
{
    if ($ids === []) return [];
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare("SELECT id, availableStock FROM items WHERE id IN ($placeholders) ORDER BY id ASC");
    $statement->execute(array_values($ids));
    $rows = [];
    foreach ($statement->fetchAll() as $row) $rows[(int) $row['id']] = (float) $row['availableStock'];
    return $rows;
}

function fetch_sales_persistence_balances(PDO $pdo, int $customerId, int $supplierId): array
{
    $customer = $pdo->prepare('SELECT invoices, payable, paid, balance FROM customers WHERE id = :id');
    $customer->execute(['id' => $customerId]);
    $supplier = $pdo->prepare('SELECT invoices, payable, paid, balance FROM suppliers WHERE id = :id');
    $supplier->execute(['id' => $supplierId]);
    return ['customer' => normalize_sales_persistence_balance_row($customer->fetch() ?: []), 'supplier' => normalize_sales_persistence_balance_row($supplier->fetch() ?: [])];
}

function normalize_sales_persistence_balance_row(array $row): array
{
    return ['invoices' => (int) ($row['invoices'] ?? 0), 'payable' => (float) ($row['payable'] ?? 0), 'paid' => (float) ($row['paid'] ?? 0), 'balance' => (float) ($row['balance'] ?? 0)];
}

function fetch_sales_persistence_table_counts(PDO $pdo, array $tables): array
{
    $counts = [];
    foreach ($tables as $table) {
        if (!sales_persistence_table_exists($pdo, $table)) { $counts[$table] = null; continue; }
        $row = $pdo->query("SELECT COUNT(*) AS row_count FROM $table")->fetch();
        $counts[$table] = (int) $row['row_count'];
    }
    return $counts;
}

function sales_persistence_table_exists(PDO $pdo, string $table): bool
{
    $statement = $pdo->prepare('SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = :table_name');
    $statement->execute(['table_name' => $table]);
    return (int) (($statement->fetch()['table_count'] ?? 0)) > 0;
}

function fetch_sales_persistence_row(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare('SELECT id, client_transaction_id, transaction_type, status, replay_status, replay_attempts, CASE WHEN replay_error IS NULL OR replay_error = "" THEN 0 ELSE 1 END AS has_replay_error, locked_at, locked_by FROM sync_transactions WHERE id = :id LIMIT 1');
    $statement->execute(['id' => $id]);
    $row = $statement->fetch();
    return $row ?: null;
}

function fetch_sales_persistence_audit_rows(PDO $pdo, int $id): array
{
    $statement = $pdo->prepare('SELECT id, sync_transaction_id, client_transaction_id, event_type, status_before, status_after, message, created_at FROM transaction_replay_audit WHERE sync_transaction_id = :id ORDER BY id ASC');
    $statement->execute(['id' => $id]);
    return $statement->fetchAll();
}
`;
}

function runPhpSalesPersistenceTest() {
  const result = spawnSync(findPhpBinary(), ["-r", phpTestCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, SALES_PERSISTENCE_TEST_RUN_ID: runId },
    windowsHide: true,
  });

  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) return { ok: false, error: "PHP sales persistence test failed.", status: result.status, stderr: result.stderr.trim(), stdout: result.stdout };

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

function stocksMatch(actual, expected) {
  return Object.entries(expected).every(([id, value]) => numbersMatch(actual?.[id], value));
}

function committedSalesCase(testCase) {
  return (
    testCase?.firstResult?.success === true &&
    testCase?.firstResult?.replayStatus === "committed" &&
    testCase?.firstResult?.stockMutationsApplied === true &&
    testCase?.firstResult?.salesPersisted === true &&
    testCase?.rowAfterFirst?.replay_status === "committed" &&
    Number(testCase?.rowAfterFirst?.replay_attempts) === 1 &&
    Number(testCase?.afterCounts?.sales) === 1 &&
    Number(testCase?.afterCounts?.sale_items) === Number(testCase?.expectedItems)
  );
}

async function main() {
  console.log(`Testing transaction sales persistence replay: ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);
  console.log("Stock + finalized sales/sale_items + accounting replay; payment ledger rows may be persisted when paid amounts are non-zero; cylinders/batches/frontend/auto-sync are untouched.");

  const health = await request("health");
  check("backend health", { status: health.status, body: health.body }, (res) => res.status === 200 && res.body?.success === true, "expected backend health success");

  const result = runPhpSalesPersistenceTest();
  check("PHP sales persistence test completed", result, (res) => res.ok === true, "expected PHP sales persistence helper test to complete");

  if (result.ok) {
    for (const name of [
      "sale_inserts_sales_and_items",
      "purchase_inserts_sales_and_items",
      "customer_return_inserts_sales_and_items",
      "supplier_return_inserts_sales_and_items",
      "multiple_items_insert_matching_sale_items",
    ]) {
      const testCase = result.results?.[name];
      check(`${name}: replay commits stock and sales`, { result: testCase?.firstResult, row: testCase?.rowAfterFirst, counts: testCase?.afterCounts }, () => committedSalesCase(testCase), "expected committed replay with one sales row and matching sale_items");
      check(`${name}: final stock matches expected`, { expected: testCase?.expectedStocks, actual: testCase?.stockAfterFirst }, () => stocksMatch(testCase?.stockAfterFirst, testCase?.expectedStocks), "expected item stock to match replay mutation");
      check(`${name}: sales persistence audit rows exist`, { events: eventTypes(testCase?.auditAfterFirst) }, (value) => value.events.includes("replay_sales_persistence_started") && value.events.includes("replay_sales_persistence_completed") && !value.events.includes("replay_sales_persistence_failed"), "expected sales persistence start/completed audit events");
      check(`${name}: duplicate replay does not duplicate sales rows`, { secondResult: testCase?.secondResult, afterFirst: testCase?.afterCounts, afterDuplicate: testCase?.afterDuplicateCounts, stockAfterFirst: testCase?.stockAfterFirst, stockAfterSecond: testCase?.stockAfterSecond }, () => testCase?.secondResult?.terminalStateSkipped === true && testCase?.secondResult?.alreadyCommitted === true && JSON.stringify(testCase?.afterCounts) === JSON.stringify(testCase?.afterDuplicateCounts) && stocksMatch(testCase?.stockAfterSecond, testCase?.stockAfterFirst), "expected terminal-state skip with unchanged sales rows and stock");
    }

    const rollback = result.rollback;
    check("failed sales insertion rolls back stock", { result: rollback?.result, row: rollback?.row, stockBefore: rollback?.stockBefore, stockAfter: rollback?.stockAfter, counts: rollback?.counts, events: eventTypes(rollback?.auditRows) }, (value) => value.result?.success === false && value.result?.reason === "sales_persistence_failed" && value.row?.replay_status === "failed" && JSON.stringify(value.stockBefore) === JSON.stringify(value.stockAfter) && value.counts?.sale_items === 0 && value.events.includes("replay_sales_persistence_failed"), "expected duplicate sales persistence failure to rollback stock and mark replay failed");

    check("customer/supplier balances updated by replay accounting", { before: result.balancesBefore, after: result.balancesAfter }, (value) =>
      value.before?.customer?.invoices === 0 &&
      value.before?.supplier?.invoices === 0 &&
      value.after?.customer?.invoices === 2 &&
      numbersMatch(value.after?.customer?.payable, 80) &&
      numbersMatch(value.after?.customer?.paid, 10) &&
      numbersMatch(value.after?.customer?.balance, 70) &&
      value.after?.supplier?.invoices === 2 &&
      numbersMatch(value.after?.supplier?.payable, 180) &&
      numbersMatch(value.after?.supplier?.paid, 0) &&
      numbersMatch(value.after?.supplier?.balance, 180),
      "expected authoritative accounting summary mutation for customer/supplier replay cases");

    check("cylinder/batch table counts unchanged when present", { before: result.protectedCountsBefore, after: result.protectedCountsAfter }, (value) => JSON.stringify(value.before) === JSON.stringify(value.after), "expected no cylinder or batch mutation");

    pass("items.availableStock, sales/sale_items, and accounting summaries were intentionally mutated", { stock: "mutated", sales: "inserted", saleItems: "inserted", accounting: "customer/supplier summaries updated", payments: "inserted when paid amount is non-zero", cylinders: "unchanged", batches: "unchanged" });
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

