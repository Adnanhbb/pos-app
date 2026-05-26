#!/usr/bin/env node

/*
 * Dev-only transaction stock mutation replay tests.
 *
 * These tests verify the stock mutation path while finalized sales/sale_items
 * are now persisted by replay, customer/supplier accounting summaries are updated, and payment ledger rows may be persisted when paid amounts are non-zero. They still do not mutate cylinders/batches.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `transaction-stock-mutation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
$runId = getenv('STOCK_MUTATION_TEST_RUN_ID') ?: ('transaction-stock-mutation-' . time());
$workerPrefix = $runId . '-worker';

$customerId = insert_stock_mutation_customer($pdo, $runId . '-customer', 100);
$supplierId = insert_stock_mutation_supplier($pdo, $runId . '-supplier', 200);
$balancesBefore = fetch_stock_mutation_balances($pdo, $customerId, $supplierId);
$tableCountsBefore = fetch_stock_mutation_table_counts($pdo, ['sales', 'sale_items', 'cylinders', 'batches']);

$items = [
    'sale' => insert_stock_mutation_item($pdo, $runId . '-sale-item', 100),
    'purchase' => insert_stock_mutation_item($pdo, $runId . '-purchase-item', 50),
    'customer_return' => insert_stock_mutation_item($pdo, $runId . '-customer-return-item', 1),
    'supplier_return' => insert_stock_mutation_item($pdo, $runId . '-supplier-return-item', 10),
    'multi_a' => insert_stock_mutation_item($pdo, $runId . '-multi-a', 30),
    'multi_b' => insert_stock_mutation_item($pdo, $runId . '-multi-b', 40),
    'insufficient' => insert_stock_mutation_item($pdo, $runId . '-insufficient-item', 1),
    'retry' => insert_stock_mutation_item($pdo, $runId . '-retry-item', 1),
];

$stockBefore = fetch_stock_mutation_stock($pdo, array_values($items));

$cases = [
    'sale_decreases_stock' => [
        'payload' => make_stock_mutation_payload($runId . '-sale', 'sale', [
            'sale' => ['transactionType' => 'Sale', 'invoiceNo' => $runId . '-SALE', 'customerId' => $customerId],
            'customerId' => $customerId,
            'saleItems' => [['itemId' => $items['sale'], 'qty' => 3, 'price' => 10]],
        ]),
        'expectedStocks' => [$items['sale'] => 97.0],
    ],
    'purchase_increases_stock' => [
        'payload' => make_stock_mutation_payload($runId . '-purchase', 'purchase', [
            'purchase' => ['transactionType' => 'Purchase', 'invoiceNo' => $runId . '-PURCHASE', 'supplierId' => $supplierId],
            'supplierId' => $supplierId,
            'items' => [['itemId' => $items['purchase'], 'qty' => 4, 'price' => 10]],
        ]),
        'expectedStocks' => [$items['purchase'] => 54.0],
    ],
    'customer_return_increases_stock' => [
        'payload' => make_stock_mutation_payload($runId . '-customer-return', 'return', [
            'returnMode' => 'customer',
            'sale' => ['transactionType' => 'Customer Return', 'invoiceNo' => $runId . '-CUST-RETURN', 'customerId' => $customerId],
            'customerId' => $customerId,
            'saleItems' => [['itemId' => $items['customer_return'], 'qty' => 5, 'price' => 10]],
        ]),
        'expectedStocks' => [$items['customer_return'] => 6.0],
    ],
    'supplier_return_decreases_stock' => [
        'payload' => make_stock_mutation_payload($runId . '-supplier-return', 'return', [
            'returnMode' => 'supplier',
            'sale' => ['transactionType' => 'Supplier Return', 'invoiceNo' => $runId . '-SUP-RETURN', 'supplierId' => $supplierId],
            'supplierId' => $supplierId,
            'saleItems' => [['itemId' => $items['supplier_return'], 'qty' => 6, 'price' => 10]],
        ]),
        'expectedStocks' => [$items['supplier_return'] => 4.0],
    ],
    'multiple_items_mutate_correctly' => [
        'payload' => make_stock_mutation_payload($runId . '-multi', 'sale', [
            'sale' => ['transactionType' => 'Sale', 'invoiceNo' => $runId . '-MULTI'],
            'saleItems' => [
                ['itemId' => $items['multi_a'], 'qty' => 1, 'price' => 10],
                ['itemId' => $items['multi_b'], 'qty' => 2, 'price' => 20],
            ],
        ]),
        'expectedStocks' => [$items['multi_a'] => 29.0, $items['multi_b'] => 38.0],
    ],
    'insufficient_stock_fails_without_change' => [
        'payload' => make_stock_mutation_payload($runId . '-insufficient', 'sale', [
            'sale' => ['transactionType' => 'Sale', 'invoiceNo' => $runId . '-INSUFFICIENT'],
            'saleItems' => [['itemId' => $items['insufficient'], 'qty' => 2, 'price' => 10]],
        ]),
        'expectedStocks' => [$items['insufficient'] => 1.0],
        'expectFailure' => true,
    ],
];

$results = [];
foreach ($cases as $caseName => $case) {
    $payload = $case['payload'];
    $syncTransactionId = insert_stock_mutation_transaction($pdo, $payload);
    $firstResult = replayStoredTransaction($pdo, $syncTransactionId, $workerPrefix . '-' . $caseName);
    $rowAfterFirst = fetch_stock_mutation_row($pdo, $syncTransactionId);
    $auditAfterFirst = fetch_stock_mutation_audit_rows($pdo, $syncTransactionId);
    $stockAfterFirst = fetch_stock_mutation_stock($pdo, array_keys($case['expectedStocks']));

    $secondResult = null;
    $stockAfterSecond = null;
    if (empty($case['expectFailure'])) {
        $secondResult = replayStoredTransaction($pdo, $syncTransactionId, $workerPrefix . '-' . $caseName . '-again');
        $stockAfterSecond = fetch_stock_mutation_stock($pdo, array_keys($case['expectedStocks']));
    }

    $results[$caseName] = [
        'syncTransactionId' => $syncTransactionId,
        'expectedStocks' => $case['expectedStocks'],
        'firstResult' => $firstResult,
        'rowAfterFirst' => $rowAfterFirst,
        'auditAfterFirst' => $auditAfterFirst,
        'stockAfterFirst' => $stockAfterFirst,
        'secondResult' => $secondResult,
        'stockAfterSecond' => $stockAfterSecond,
    ];
}

$retryPayload = make_stock_mutation_payload($runId . '-retry', 'sale', [
    'sale' => ['transactionType' => 'Sale', 'invoiceNo' => $runId . '-RETRY'],
    'saleItems' => [['itemId' => $items['retry'], 'qty' => 3, 'price' => 10]],
]);
$retryId = insert_stock_mutation_transaction($pdo, $retryPayload);
$retryFirst = replayStoredTransaction($pdo, $retryId, $workerPrefix . '-retry-first');
$retryStockAfterFirst = fetch_stock_mutation_stock($pdo, [$items['retry']]);
set_stock_mutation_stock($pdo, $items['retry'], 5);
$retrySecond = replayStoredTransaction($pdo, $retryId, $workerPrefix . '-retry-second');
$retryStockAfterSecond = fetch_stock_mutation_stock($pdo, [$items['retry']]);
$retryRow = fetch_stock_mutation_row($pdo, $retryId);
$retryAuditRows = fetch_stock_mutation_audit_rows($pdo, $retryId);

$balancesAfter = fetch_stock_mutation_balances($pdo, $customerId, $supplierId);
$tableCountsAfter = fetch_stock_mutation_table_counts($pdo, ['sales', 'sale_items', 'cylinders', 'batches']);
$stockAfter = fetch_stock_mutation_stock($pdo, array_values($items));

echo json_encode([
    'ok' => true,
    'fixtureIds' => ['customerId' => $customerId, 'supplierId' => $supplierId, 'items' => $items],
    'stockBefore' => $stockBefore,
    'stockAfter' => $stockAfter,
    'balancesBefore' => $balancesBefore,
    'balancesAfter' => $balancesAfter,
    'tableCountsBefore' => $tableCountsBefore,
    'tableCountsAfter' => $tableCountsAfter,
    'results' => $results,
    'retry' => [
        'syncTransactionId' => $retryId,
        'firstResult' => $retryFirst,
        'stockAfterFirst' => $retryStockAfterFirst,
        'secondResult' => $retrySecond,
        'stockAfterSecond' => $retryStockAfterSecond,
        'row' => $retryRow,
        'auditRows' => $retryAuditRows,
    ],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

function make_stock_mutation_payload(string $clientTransactionId, string $transactionType, array $payload): array
{
    return [
        'clientTransactionId' => $clientTransactionId,
        'transactionType' => $transactionType,
        'createdAt' => time(),
        'payload' => $payload,
    ];
}

function insert_stock_mutation_transaction(PDO $pdo, array $payload): int
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

function insert_stock_mutation_item(PDO $pdo, string $name, float $availableStock): int
{
    $statement = $pdo->prepare(
        "INSERT INTO items
            (client_id, name, barcode, purchasePrice, retailPrice, discountPrice, wholesalePrice, availableStock, category, brand, minunit, maxunit, ConvQty)
         VALUES
            (:client_id, :name, :barcode, 1, 2, 0, 2, :availableStock, 'Stock Mutation', 'Stock Mutation', 'pc', 'box', 1)"
    );
    $statement->execute([
        'client_id' => $name,
        'name' => $name,
        'barcode' => $name,
        'availableStock' => $availableStock,
    ]);

    return (int) $pdo->lastInsertId();
}

function insert_stock_mutation_customer(PDO $pdo, string $name, float $balance): int
{
    $statement = $pdo->prepare(
        "INSERT INTO customers (client_id, name, mobile, cnic, address, invoices, payable, paid, balance)
         VALUES (:client_id, :name, '03000000000', 'stock-test', 'stock mutation customer', 0, :payable, 0, :balance)"
    );
    $statement->execute(['client_id' => $name, 'name' => $name, 'payable' => $balance, 'balance' => $balance]);

    return (int) $pdo->lastInsertId();
}

function insert_stock_mutation_supplier(PDO $pdo, string $name, float $balance): int
{
    $statement = $pdo->prepare(
        "INSERT INTO suppliers (client_id, name, mobile, cnic, address, invoices, payable, paid, balance)
         VALUES (:client_id, :name, '03111111111', 'stock-test', 'stock mutation supplier', 0, :payable, 0, :balance)"
    );
    $statement->execute(['client_id' => $name, 'name' => $name, 'payable' => $balance, 'balance' => $balance]);

    return (int) $pdo->lastInsertId();
}

function fetch_stock_mutation_stock(PDO $pdo, array $ids): array
{
    if ($ids === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare("SELECT id, availableStock FROM items WHERE id IN ($placeholders) ORDER BY id ASC");
    $statement->execute(array_values($ids));

    $rows = [];
    foreach ($statement->fetchAll() as $row) {
        $rows[(int) $row['id']] = (float) $row['availableStock'];
    }

    return $rows;
}

function set_stock_mutation_stock(PDO $pdo, int $id, float $availableStock): void
{
    $statement = $pdo->prepare('UPDATE items SET availableStock = :availableStock WHERE id = :id');
    $statement->execute(['availableStock' => $availableStock, 'id' => $id]);
}

function fetch_stock_mutation_balances(PDO $pdo, int $customerId, int $supplierId): array
{
    $customer = $pdo->prepare('SELECT invoices, payable, paid, balance FROM customers WHERE id = :id');
    $customer->execute(['id' => $customerId]);
    $supplier = $pdo->prepare('SELECT invoices, payable, paid, balance FROM suppliers WHERE id = :id');
    $supplier->execute(['id' => $supplierId]);

    return [
        'customer' => normalize_stock_mutation_balance_row($customer->fetch() ?: []),
        'supplier' => normalize_stock_mutation_balance_row($supplier->fetch() ?: []),
    ];
}

function normalize_stock_mutation_balance_row(array $row): array
{
    return [
        'invoices' => (int) ($row['invoices'] ?? 0),
        'payable' => (float) ($row['payable'] ?? 0),
        'paid' => (float) ($row['paid'] ?? 0),
        'balance' => (float) ($row['balance'] ?? 0),
    ];
}

function fetch_stock_mutation_table_counts(PDO $pdo, array $tables): array
{
    $counts = [];
    foreach ($tables as $table) {
        if (!stock_mutation_table_exists($pdo, $table)) {
            $counts[$table] = null;
            continue;
        }

        $row = $pdo->query("SELECT COUNT(*) AS row_count FROM $table")->fetch();
        $counts[$table] = (int) $row['row_count'];
    }

    return $counts;
}

function stock_mutation_table_exists(PDO $pdo, string $table): bool
{
    $statement = $pdo->prepare(
        "SELECT COUNT(*) AS table_count
         FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = :table_name"
    );
    $statement->execute(['table_name' => $table]);
    $row = $statement->fetch();

    return (int) ($row['table_count'] ?? 0) > 0;
}

function fetch_stock_mutation_row(PDO $pdo, int $id): ?array
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

function fetch_stock_mutation_audit_rows(PDO $pdo, int $id): array
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

function runPhpStockMutationTest() {
  const result = spawnSync(findPhpBinary(), ["-r", phpTestCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      STOCK_MUTATION_TEST_RUN_ID: runId,
    },
    windowsHide: true,
  });

  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) {
    return {
      ok: false,
      error: "PHP stock mutation test failed.",
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

function numbersMatch(actual, expected) {
  return Math.abs(Number(actual) - Number(expected)) < 0.000001;
}

function stocksMatch(actual, expected) {
  return Object.entries(expected).every(([id, value]) => numbersMatch(actual?.[id], value));
}

function withoutSalesPersistenceCounts(counts) {
  const clone = { ...(counts ?? {}) };
  delete clone.sales;
  delete clone.sale_items;
  return clone;
}

function committedStockCase(testCase) {
  return (
    testCase?.firstResult?.success === true &&
    testCase?.firstResult?.replayStatus === "committed" &&
    testCase?.firstResult?.businessMutationsApplied === true &&
    testCase?.firstResult?.stockMutationsApplied === true &&
    testCase?.rowAfterFirst?.replay_status === "committed" &&
    Number(testCase?.rowAfterFirst?.replay_attempts) === 1 &&
    Number(testCase?.firstResult?.stockMutationResult?.appliedCount ?? 0) > 0
  );
}

function failedInventoryCase(testCase) {
  return (
    testCase?.firstResult?.success === false &&
    testCase?.firstResult?.reason === "inventory_validation_failed" &&
    testCase?.rowAfterFirst?.replay_status === "failed" &&
    Number(testCase?.rowAfterFirst?.replay_attempts) === 1 &&
    Number(testCase?.rowAfterFirst?.has_replay_error ?? 0) === 1
  );
}

async function main() {
  console.log(`Testing transaction stock mutation replay: ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);
  console.log("Stock mutation plus finalized sales/sale_items/accounting; payment ledger rows may be persisted when paid amounts are non-zero; cylinders/batches/frontend/auto-sync are untouched.");

  const health = await request("health");
  check(
    "backend health",
    { status: health.status, body: health.body },
    (res) => res.status === 200 && res.body?.success === true,
    "expected backend health success",
  );

  const result = runPhpStockMutationTest();
  check("PHP stock mutation test completed", result, (res) => res.ok === true, "expected PHP stock mutation helper test to complete");

  if (result.ok) {
    for (const name of [
      "sale_decreases_stock",
      "purchase_increases_stock",
      "customer_return_increases_stock",
      "supplier_return_decreases_stock",
      "multiple_items_mutate_correctly",
    ]) {
      const testCase = result.results?.[name];
      check(
        `${name}: replay commits and applies stock`,
        { result: testCase?.firstResult, row: testCase?.rowAfterFirst, stock: testCase?.stockAfterFirst },
        () => committedStockCase(testCase),
        "expected committed replay with stock mutation metadata",
      );

      check(
        `${name}: final stock matches expected`,
        { expected: testCase?.expectedStocks, actual: testCase?.stockAfterFirst },
        () => stocksMatch(testCase?.stockAfterFirst, testCase?.expectedStocks),
        "expected item availableStock to match planned mutation",
      );

      check(
        `${name}: stock mutation audit rows exist`,
        { events: eventTypes(testCase?.auditAfterFirst) },
        (value) =>
          value.events.includes("replay_stock_mutation_started") &&
          value.events.includes("replay_stock_mutation_completed") &&
          !value.events.includes("replay_stock_mutation_failed"),
        "expected stock mutation start/completed audit events",
      );

      check(
        `${name}: duplicate replay does not mutate again`,
        { secondResult: testCase?.secondResult, afterFirst: testCase?.stockAfterFirst, afterSecond: testCase?.stockAfterSecond },
        () =>
          testCase?.secondResult?.terminalStateSkipped === true &&
          testCase?.secondResult?.alreadyCommitted === true &&
          stocksMatch(testCase?.stockAfterSecond, testCase?.stockAfterFirst),
        "expected terminal-state skip with unchanged stock",
      );
    }

    const insufficient = result.results?.insufficient_stock_fails_without_change;
    check(
      "insufficient stock fails safely without stock change",
      { result: insufficient?.firstResult, row: insufficient?.rowAfterFirst, expected: insufficient?.expectedStocks, actual: insufficient?.stockAfterFirst },
      () => failedInventoryCase(insufficient) && stocksMatch(insufficient?.stockAfterFirst, insufficient?.expectedStocks),
      "expected inventory failure and unchanged stock",
    );

    const retry = result.retry;
    check(
      "failed replay can retry after fixing stock",
      { first: retry?.firstResult, second: retry?.secondResult, stockAfterFirst: retry?.stockAfterFirst, stockAfterSecond: retry?.stockAfterSecond, row: retry?.row },
      () =>
        retry?.firstResult?.success === false &&
        retry?.firstResult?.reason === "inventory_validation_failed" &&
        retry?.secondResult?.success === true &&
        retry?.secondResult?.stockMutationsApplied === true &&
        retry?.row?.replay_status === "committed" &&
        numbersMatch(Object.values(retry?.stockAfterFirst ?? {})[0], 1) &&
        numbersMatch(Object.values(retry?.stockAfterSecond ?? {})[0], 2),
      "expected failed row to retry after stock is fixed and then deduct stock",
    );

    check(
      "customer/supplier balances updated by replay accounting",
      { before: result.balancesBefore, after: result.balancesAfter },
      (value) =>
        value.before?.customer?.invoices === 0 &&
        value.before?.supplier?.invoices === 0 &&
        value.after?.customer?.invoices === 2 &&
        numbersMatch(value.after?.customer?.payable, 80) &&
        numbersMatch(value.after?.customer?.paid, 0) &&
        numbersMatch(value.after?.customer?.balance, 80) &&
        value.after?.supplier?.invoices === 2 &&
        numbersMatch(value.after?.supplier?.payable, 180) &&
        numbersMatch(value.after?.supplier?.paid, 0) &&
        numbersMatch(value.after?.supplier?.balance, 180),
      "expected authoritative accounting summary mutation for customer/supplier replay cases",
    );

    check(
      "cylinder/batch table counts unchanged when present",
      { before: withoutSalesPersistenceCounts(result.tableCountsBefore), after: withoutSalesPersistenceCounts(result.tableCountsAfter) },
      (value) => JSON.stringify(value.before) === JSON.stringify(value.after),
      "expected no cylinder or batch mutation",
    );

    check(
      "sales and sale_items are persisted for successful replays",
      { before: result.tableCountsBefore, after: result.tableCountsAfter },
      (value) =>
        value.before?.sales !== null &&
        value.before?.sale_items !== null &&
        Number(value.after?.sales) > Number(value.before?.sales) &&
        Number(value.after?.sale_items) > Number(value.before?.sale_items),
      "expected finalized sales and sale_items to be inserted by successful replays",
    );

    pass("items.availableStock, sales/sale_items, and accounting summaries were intentionally mutated", {
      stock: "mutated through replay",
      accounting: "customer/supplier summaries updated",
      sales: "inserted",
      saleItems: "inserted",
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





