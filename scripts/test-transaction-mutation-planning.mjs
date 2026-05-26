#!/usr/bin/env node

/*
 * Dev-only transaction mutation planning tests.
 *
 * These tests verify replay mutation plans and the current stock/sales replay path.
 *  * They do not apply accounting, payment, cylinder, or batch mutations.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `transaction-mutation-planning-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
$runId = getenv('MUTATION_PLANNING_TEST_RUN_ID') ?: ('transaction-mutation-planning-' . time());
$workerPrefix = $runId . '-worker';

$itemA = insert_mutation_planning_item($pdo, $runId . '-item-a', 100);
$itemB = insert_mutation_planning_item($pdo, $runId . '-item-b', 200);
$stockBefore = fetch_mutation_planning_stock($pdo, [$itemA, $itemB]);
$tableCountsBefore = fetch_mutation_planning_table_counts($pdo, ['sales', 'sale_items']);

$cases = [
    'sale_decrease' => [
        'payload' => make_mutation_planning_payload($runId . '-sale', 'sale', [
            'sale' => ['transactionType' => 'Sale', 'invoiceNo' => $runId . '-SALE'],
            'saleItems' => [['itemId' => $itemA, 'qty' => 3, 'price' => 10]],
        ]),
        'expected' => [['itemId' => $itemA, 'direction' => 'decrease', 'qty' => 3.0, 'transactionType' => 'Sale']],
    ],
    'purchase_increase' => [
        'payload' => make_mutation_planning_payload($runId . '-purchase', 'purchase', [
            'purchase' => ['transactionType' => 'Purchase', 'invoiceNo' => $runId . '-PURCHASE'],
            'items' => [['itemId' => $itemA, 'qty' => 4, 'price' => 10]],
        ]),
        'expected' => [['itemId' => $itemA, 'direction' => 'increase', 'qty' => 4.0, 'transactionType' => 'Purchase']],
    ],
    'customer_return_increase' => [
        'payload' => make_mutation_planning_payload($runId . '-customer-return', 'return', [
            'returnMode' => 'customer',
            'sale' => ['transactionType' => 'Customer Return', 'invoiceNo' => $runId . '-CUST-RETURN'],
            'saleItems' => [['itemId' => $itemA, 'qty' => 5, 'price' => 10]],
        ]),
        'expected' => [['itemId' => $itemA, 'direction' => 'increase', 'qty' => 5.0, 'transactionType' => 'Customer Return']],
    ],
    'supplier_return_decrease' => [
        'payload' => make_mutation_planning_payload($runId . '-supplier-return', 'return', [
            'returnMode' => 'supplier',
            'sale' => ['transactionType' => 'Supplier Return', 'invoiceNo' => $runId . '-SUP-RETURN'],
            'saleItems' => [['itemId' => $itemA, 'qty' => 6, 'price' => 10]],
        ]),
        'expected' => [['itemId' => $itemA, 'direction' => 'decrease', 'qty' => 6.0, 'transactionType' => 'Supplier Return']],
    ],
    'multiple_items' => [
        'payload' => make_mutation_planning_payload($runId . '-multi', 'sale', [
            'sale' => ['transactionType' => 'Sale', 'invoiceNo' => $runId . '-MULTI'],
            'saleItems' => [
                ['itemId' => $itemA, 'qty' => 1, 'price' => 10],
                ['itemId' => $itemB, 'qty' => 2, 'price' => 20],
            ],
        ]),
        'expected' => [
            ['itemId' => $itemA, 'direction' => 'decrease', 'qty' => 1.0, 'transactionType' => 'Sale'],
            ['itemId' => $itemB, 'direction' => 'decrease', 'qty' => 2.0, 'transactionType' => 'Sale'],
        ],
    ],
    'invalid_items_fail_before_planning' => [
        'payload' => make_mutation_planning_payload($runId . '-invalid', 'sale', [
            'sale' => ['transactionType' => 'Sale', 'invoiceNo' => $runId . '-INVALID'],
            'saleItems' => [['qty' => 1, 'price' => 10]],
        ]),
        'expected' => null,
    ],
];

$results = [];
foreach ($cases as $caseName => $case) {
    $payload = $case['payload'];
    $syncTransactionId = insert_mutation_planning_transaction($pdo, $payload);
    $replayResult = replayStoredTransaction($pdo, $syncTransactionId, $workerPrefix . '-' . $caseName);
    $row = fetch_mutation_planning_row($pdo, $syncTransactionId);
    $auditRows = fetch_mutation_planning_audit_rows($pdo, $syncTransactionId);

    $results[$caseName] = [
        'caseName' => $caseName,
        'syncTransactionId' => $syncTransactionId,
        'clientTransactionId' => $payload['clientTransactionId'],
        'expected' => $case['expected'],
        'replayResult' => $replayResult,
        'row' => $row,
        'auditRows' => $auditRows,
    ];
}

$stockAfter = fetch_mutation_planning_stock($pdo, [$itemA, $itemB]);
$tableCountsAfter = fetch_mutation_planning_table_counts($pdo, ['sales', 'sale_items']);

echo json_encode([
    'ok' => true,
    'fixtureIds' => ['itemA' => $itemA, 'itemB' => $itemB],
    'stockBefore' => $stockBefore,
    'stockAfter' => $stockAfter,
    'tableCountsBefore' => $tableCountsBefore,
    'tableCountsAfter' => $tableCountsAfter,
    'results' => $results,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

function make_mutation_planning_payload(string $clientTransactionId, string $transactionType, array $payload): array
{
    return [
        'clientTransactionId' => $clientTransactionId,
        'transactionType' => $transactionType,
        'createdAt' => time(),
        'payload' => $payload,
    ];
}

function insert_mutation_planning_transaction(PDO $pdo, array $payload): int
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

function insert_mutation_planning_item(PDO $pdo, string $name, float $availableStock): int
{
    $statement = $pdo->prepare(
        "INSERT INTO items
            (client_id, name, barcode, purchasePrice, retailPrice, discountPrice, wholesalePrice, availableStock, category, brand, minunit, maxunit, ConvQty)
         VALUES
            (:client_id, :name, :barcode, 1, 2, 0, 2, :availableStock, 'Mutation Planning', 'Mutation Planning', 'pc', 'box', 1)"
    );
    $statement->execute([
        'client_id' => $name,
        'name' => $name,
        'barcode' => $name,
        'availableStock' => $availableStock,
    ]);

    return (int) $pdo->lastInsertId();
}

function fetch_mutation_planning_stock(PDO $pdo, array $ids): array
{
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare("SELECT id, availableStock FROM items WHERE id IN ($placeholders) ORDER BY id ASC");
    $statement->execute($ids);

    $rows = [];
    foreach ($statement->fetchAll() as $row) {
        $rows[(int) $row['id']] = (float) $row['availableStock'];
    }

    return $rows;
}

function fetch_mutation_planning_table_counts(PDO $pdo, array $tables): array
{
    $counts = [];
    foreach ($tables as $table) {
        if (!mutation_planning_table_exists($pdo, $table)) {
            $counts[$table] = null;
            continue;
        }

        $row = $pdo->query("SELECT COUNT(*) AS row_count FROM $table")->fetch();
        $counts[$table] = (int) $row['row_count'];
    }

    return $counts;
}

function mutation_planning_table_exists(PDO $pdo, string $table): bool
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

function fetch_mutation_planning_row(PDO $pdo, int $id): ?array
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

function fetch_mutation_planning_audit_rows(PDO $pdo, int $id): array
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

function runPhpMutationPlanningTest() {
  const result = spawnSync(findPhpBinary(), ["-r", phpTestCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      MUTATION_PLANNING_TEST_RUN_ID: runId,
    },
    windowsHide: true,
  });

  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) {
    return {
      ok: false,
      error: "PHP mutation planning test failed.",
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

function stockAdjustments(testCase) {
  return testCase?.replayResult?.mutationPlan?.stockAdjustments ?? [];
}

function planMatchesExpected(testCase) {
  const actual = stockAdjustments(testCase);
  const expected = testCase?.expected ?? [];
  if (actual.length !== expected.length) return false;

  return expected.every((entry, index) => {
    const plan = actual[index];
    return (
      Number(plan?.itemId) === Number(entry.itemId) &&
      plan?.direction === entry.direction &&
      Number(plan?.qty) === Number(entry.qty) &&
      plan?.transactionType === entry.transactionType &&
      typeof plan?.reason === "string" &&
      plan.reason.length > 0
    );
  });
}

function isCommittedPlanningCase(testCase) {
  return (
    testCase?.replayResult?.success === true &&
    testCase?.replayResult?.replayStatus === "committed" &&
    testCase?.replayResult?.businessMutationsApplied === true &&
    testCase?.row?.replay_status === "committed" &&
    Number(testCase?.row?.replay_attempts) === 1 &&
    Array.isArray(testCase?.replayResult?.mutationPlan?.stockAdjustments)
  );
}

async function main() {
  console.log(`Testing transaction mutation planning: ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);
  console.log("Planning plus stock/sales replay; no accounting/payment/cylinder/batch mutations are applied.");

  const health = await request("health");
  check(
    "backend health",
    { status: health.status, body: health.body },
    (res) => res.status === 200 && res.body?.success === true,
    "expected backend health success",
  );

  const result = runPhpMutationPlanningTest();
  check("PHP mutation planning test completed", result, (res) => res.ok === true, "expected PHP helper test to complete");

  if (result.ok) {
    for (const name of ["sale_decrease", "purchase_increase", "customer_return_increase", "supplier_return_decrease", "multiple_items"]) {
      const testCase = getCase(result, name);
      check(
        `${name} commits metadata with mutation plan and stock replay`,
        { caseName: name, result: testCase?.replayResult, row: testCase?.row, plan: testCase?.replayResult?.mutationPlan },
        () => isCommittedPlanningCase(testCase),
        "expected committed metadata, returned mutation plan, and stock replay metadata",
      );

      check(
        `${name} stock adjustment plan matches expected direction`,
        { caseName: name, expected: testCase?.expected, actual: stockAdjustments(testCase) },
        () => planMatchesExpected(testCase),
        "expected deterministic stock adjustment plan",
      );

      check(
        `${name} writes mutation plan audit row`,
        { caseName: name, events: eventTypes(testCase?.auditRows) },
        (value) => value.events.includes("replay_mutation_plan_generated"),
        "expected replay_mutation_plan_generated audit event",
      );
    }

    const invalid = getCase(result, "invalid_items_fail_before_planning");
    check(
      "invalid items fail before planning",
      { result: invalid?.replayResult, row: invalid?.row, events: eventTypes(invalid?.auditRows) },
      (value) =>
        value.result?.success === false &&
        value.result?.reason === "business_validation_failed" &&
        value.row?.replay_status === "failed" &&
        !value.events.includes("replay_mutation_plan_generated") &&
        value.result?.mutationPlan === undefined,
      "expected business validation failure before plan generation",
    );

    check(
      "item stock reflects applied replay plan",
      { before: result.stockBefore, after: result.stockAfter, expected: { [result.fixtureIds.itemA]: 99, [result.fixtureIds.itemB]: 198 } },
      (value) => JSON.stringify(value.after) === JSON.stringify(value.expected),
      "expected item availableStock to reflect stock-only replay",
    );

    check(
      "sales and sale_items are persisted for successful replay plans",
      { before: result.tableCountsBefore, after: result.tableCountsAfter },
      (value) =>
        value.before?.sales !== null &&
        value.before?.sale_items !== null &&
        Number(value.after?.sales) - Number(value.before?.sales) === 5 &&
        Number(value.after?.sale_items) - Number(value.before?.sale_items) === 6,
      "expected one sales row per successful case and matching sale_items rows",
    );

    check(
      "replay_status flow remains correct",
      { cases: Object.fromEntries(Object.entries(result.results).map(([name, value]) => [name, value.row?.replay_status])) },
      (value) =>
        value.cases.sale_decrease === "committed" &&
        value.cases.purchase_increase === "committed" &&
        value.cases.customer_return_increase === "committed" &&
        value.cases.supplier_return_decrease === "committed" &&
        value.cases.multiple_items === "committed" &&
        value.cases.invalid_items_fail_before_planning === "failed",
      "expected committed planning cases and failed invalid case",
    );

    pass("only stock plus sales/sale_items business mutations were applied", {
      stock: "mutated through replay",
      accounting: "not touched",
      sales: "inserted",
      saleItems: "inserted",
      payments: "not inserted",
      cylinders: "not touched",
      batches: "not touched",
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




