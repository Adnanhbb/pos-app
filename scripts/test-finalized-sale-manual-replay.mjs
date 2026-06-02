#!/usr/bin/env node

/* Isolated backend verifier for authenticated manual finalized Sale v1 replay. */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `finalized-sale-v1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let passed = 0;
let failed = 0;

function findPhpBinary() {
  if (process.env.PHP_BIN) return process.env.PHP_BIN;
  const laragonPhpRoot = "C:\\laragon\\bin\\php";
  if (existsSync(laragonPhpRoot)) {
    const candidates = readdirSync(laragonPhpRoot)
      .map((entry) => resolve(laragonPhpRoot, entry, "php.exe"))
      .filter(existsSync)
      .sort()
      .reverse();
    if (candidates.length > 0) return candidates[0];
  }
  return "php";
}

function check(name, details, predicate, message) {
  if (predicate(details)) {
    passed += 1;
    console.log(`PASS ${name}`);
    return true;
  }
  failed += 1;
  console.error(`FAIL ${name}: ${message}`);
  if (details !== undefined) console.error(JSON.stringify(details, null, 2));
  return false;
}

function nearlyEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.000001;
}

function phpTestCode() {
  return String.raw`
require_once getcwd() . '/api/config/database.php';
require_once getcwd() . '/api/lib/finalizedSaleReplayV1.php';

$pdo = get_pdo();
$runId = getenv('FINALIZED_SALE_V1_TEST_RUN_ID') ?: ('finalized-sale-v1-' . time());
ensure_fixture_tables($pdo);
$fixture = insert_fixture($pdo, $runId);
$unsafeFixture = null;
$zeroPaidFixture = null;

try {
    $readyPayload = make_payload($runId, 'ready', $fixture, true);
    $readySyncId = insert_sync_row($pdo, $readyPayload);
    $before = snapshot($pdo, $fixture, $readySyncId);
    $auth = [
        'authenticated' => true,
        'actorType' => 'replay_worker',
        'actorId' => $runId . '-worker',
        'actorRole' => 'replay',
        'sessionId' => $runId . '-session',
    ];

    $first = replayStoredFinalizedSaleV1Authorized($pdo, $readySyncId, $auth);
    $afterFirst = snapshot($pdo, $fixture, $readySyncId);
    $second = replayStoredFinalizedSaleV1Authorized($pdo, $readySyncId, $auth);
    $afterSecond = snapshot($pdo, $fixture, $readySyncId);

    $unsafeFixture = insert_fixture($pdo, $runId . '-unsafe');
    $unsafePayload = make_payload($runId, 'unsafe', $unsafeFixture, false);
    $unsafeSyncId = insert_sync_row($pdo, $unsafePayload);
    $unsafeBefore = snapshot($pdo, $unsafeFixture, $unsafeSyncId);
    $unsafe = replayStoredFinalizedSaleV1Authorized($pdo, $unsafeSyncId, $auth);
    $unsafeAfter = snapshot($pdo, $unsafeFixture, $unsafeSyncId);

    $zeroPaidFixture = insert_fixture($pdo, $runId . '-zero-paid');
    $zeroPaidPayload = make_payload($runId, 'zero-paid', $zeroPaidFixture, true, 0);
    $zeroPaidSyncId = insert_sync_row($pdo, $zeroPaidPayload);
    $zeroPaid = replayStoredFinalizedSaleV1Authorized($pdo, $zeroPaidSyncId, $auth);
    $zeroPaidAfter = snapshot($pdo, $zeroPaidFixture, $zeroPaidSyncId);

    echo json_encode([
        'ok' => true,
        'fixture' => $fixture,
        'readySyncId' => $readySyncId,
        'before' => $before,
        'first' => $first,
        'afterFirst' => $afterFirst,
        'second' => $second,
        'afterSecond' => $afterSecond,
        'unsafeSyncId' => $unsafeSyncId,
        'unsafeBefore' => $unsafeBefore,
        'unsafe' => $unsafe,
        'unsafeAfter' => $unsafeAfter,
        'zeroPaid' => $zeroPaid,
        'zeroPaidAfter' => $zeroPaidAfter,
        'auditRows' => audit_rows($pdo, $readySyncId),
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
} finally {
    cleanup_fixture($pdo, $fixture ?? null);
    cleanup_fixture($pdo, $unsafeFixture ?? null);
    cleanup_fixture($pdo, $zeroPaidFixture ?? null);
}

function make_payload(string $runId, string $name, array $fixture, bool $ready, float $paid = 50): array {
    $clientId = $runId . '-' . $name . '-client';
    $invoiceNo = strtoupper($runId . '-' . $name . '-invoice');
    $readiness = [
        'scope' => 'finalized_sale',
        'payloadVersion' => 1,
        'status' => $ready ? 'ready' : 'unsafe',
        'reasons' => $ready ? [] : [[
            'code' => 'missing_server_item_id',
            'message' => 'Sale item is not mapped to a backend row.',
            'localItemId' => 91017,
        ]],
    ];
    $contract = [
        'payloadVersion' => 1,
        'transactionType' => 'Sale',
        'localSaleId' => 91001,
        'invoiceNo' => $invoiceNo,
        'clientTransactionId' => $clientId,
        'createdAt' => 1770000000000,
        'customer' => [
            'localId' => 91007,
            'serverId' => $fixture['customerId'],
            'nameSnapshot' => $fixture['customerName'],
        ],
        'items' => [[
            'localItemId' => 91017,
            'serverItemId' => $fixture['itemId'],
            'originalItemId' => 91017,
            'nameSnapshot' => $fixture['itemName'],
            'qty' => 2,
            'price' => 100,
            'quantityUnit' => 'min',
            'selectedUnit' => 'min',
            'conversion' => [
                'minUnit' => 'cylinder',
                'maxUnit' => 'cylinder',
                'convQty' => 1,
                'quantityInMinUnit' => 2,
            ],
            'resolvedBatch' => [
                'localBatchId' => 91027,
                'serverBatchId' => $fixture['batchId'],
                'consumedQty' => 2,
            ],
            'requiresCylinderMutation' => true,
        ]],
        'payments' => [
            'paidAmount' => $paid,
            'source' => 'pos-finalization',
            'method' => null,
        ],
        'cylinders' => [[
            'localItemId' => 91017,
            'serverItemId' => $fixture['itemId'],
            'localCylinderId' => 91037,
            'serverCylinderId' => $fixture['cylinderId'],
            'customerHolding' => [
                'localHoldingId' => null,
                'serverHoldingId' => null,
                'customerNameSnapshot' => $fixture['customerName'],
            ],
            'qtyMoved' => 2,
        ]],
        'totals' => [
            'subtotal' => 200,
            'discount' => 0,
            'tax' => 0,
            'dues' => 80,
            'grandTotal' => 280,
            'paid' => $paid,
            'arrears' => 280 - $paid,
        ],
        'replayReadiness' => $readiness,
    ];

    return [
        'clientTransactionId' => $clientId,
        'transactionType' => 'sale',
        'createdAt' => 1770000000000,
        'replayReadiness' => $readiness,
        'payload' => [
            'sale' => [
                'invoiceNo' => $invoiceNo,
                'date' => '2026-06-02',
                'transactionType' => 'Sale',
                'customerId' => 91007,
                'customerName' => $fixture['customerName'],
                'subtotal' => 200,
                'discount' => 0,
                'tax' => 0,
                'dues' => 80,
                'grandTotal' => 280,
                'paid' => $paid,
                'arrears' => 280 - $paid,
                'profit' => 75,
                'isPostponed' => false,
            ],
            'saleItems' => [[
                'originalItemId' => 91017,
                'name' => $fixture['itemName'],
                'qty' => 2,
                'price' => 100,
            ]],
            'finalizedSaleReplay' => $contract,
        ],
    ];
}

function ensure_fixture_tables(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS customer_payments (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, customerId BIGINT UNSIGNED NOT NULL, customerName VARCHAR(180) NULL, invoiceNo VARCHAR(120) NULL, amount DECIMAL(12,2) NOT NULL DEFAULT 0, paymentDate VARCHAR(50) NULL, remarks TEXT NULL, payableSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, balanceSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, sync_transaction_id BIGINT UNSIGNED NULL, client_transaction_id VARCHAR(150) NULL, sale_id BIGINT UNSIGNED NULL, source VARCHAR(80) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_customer_payments_customerId (customerId)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    ensure_fixture_column($pdo, 'customer_payments', 'sync_transaction_id', 'BIGINT UNSIGNED NULL');
    ensure_fixture_column($pdo, 'customer_payments', 'client_transaction_id', 'VARCHAR(150) NULL');
    ensure_fixture_column($pdo, 'customer_payments', 'sale_id', 'BIGINT UNSIGNED NULL');
    ensure_fixture_column($pdo, 'customer_payments', 'source', 'VARCHAR(80) NULL');
}

function ensure_fixture_column(PDO $pdo, string $table, string $column, string $definition): void {
    $statement = $pdo->prepare('SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = :table AND column_name = :column');
    $statement->execute(['table' => $table, 'column' => $column]);
    if ((int) ($statement->fetch()['c'] ?? 0) === 0) {
        $pdo->exec("ALTER TABLE $table ADD COLUMN $column $definition");
    }
}

function insert_fixture(PDO $pdo, string $prefix): array {
    $itemName = $prefix . '-mapped-gas-item';
    $customerName = $prefix . '-mapped-customer';
    $statement = $pdo->prepare("INSERT INTO items (client_id, name, barcode, purchasePrice, retailPrice, discountPrice, wholesalePrice, availableStock, category, brand, minunit, maxunit, ConvQty, is_deleted) VALUES (:client, :name, :barcode, 10, 100, 0, 100, 10, 'Gas Cylinder', 'Replay Fixture', 'cylinder', 'cylinder', 1, 0)");
    $statement->execute(['client' => $prefix . '-item-client', 'name' => $itemName, 'barcode' => $prefix . '-barcode']);
    $itemId = (int) $pdo->lastInsertId();
    $statement = $pdo->prepare("INSERT INTO customers (client_id, name, mobile, cnic, address, invoices, payable, paid, balance, is_deleted) VALUES (:client, :name, '03000000000', 'fixture', 'fixture', 1, 100, 20, 80, 0)");
    $statement->execute(['client' => $prefix . '-customer-client', 'name' => $customerName]);
    $customerId = (int) $pdo->lastInsertId();
    $statement = $pdo->prepare("INSERT INTO item_batches (itemId, purchaseDate, qtyPurchased, qtySold, balance, costPrice, invoiceNo, isDeleted) VALUES (:itemId, '2026-06-02', 10, 0, 10, 10, :invoiceNo, 0)");
    $statement->execute(['itemId' => $itemId, 'invoiceNo' => $prefix . '-opening-batch']);
    $batchId = (int) $pdo->lastInsertId();
    $statement = $pdo->prepare("INSERT INTO cylinders (itemId, title, qtyInStock, filledCylinders, emptyCylinders, withCustomers, convQty, isDeleted) VALUES (:itemId, :title, 4, 4, 0, 0, 1, 0)");
    $statement->execute(['itemId' => $itemId, 'title' => $prefix . '-cylinder']);
    return ['itemId' => $itemId, 'itemName' => $itemName, 'customerId' => $customerId, 'customerName' => $customerName, 'batchId' => $batchId, 'cylinderId' => (int) $pdo->lastInsertId()];
}

function insert_sync_row(PDO $pdo, array $payload): int {
    $statement = $pdo->prepare("INSERT INTO sync_transactions (client_transaction_id, transaction_type, payload_json, status, replay_status, replay_attempts) VALUES (:client, 'sale', :payload, 'stored', 'stored', 0)");
    $statement->execute(['client' => $payload['clientTransactionId'], 'payload' => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]);
    return (int) $pdo->lastInsertId();
}

function snapshot(PDO $pdo, array $fixture, int $syncId): array {
    return [
        'itemStock' => scalar($pdo, 'SELECT availableStock FROM items WHERE id = :id', ['id' => $fixture['itemId']]),
        'batch' => row($pdo, 'SELECT qtySold, balance FROM item_batches WHERE id = :id', ['id' => $fixture['batchId']]),
        'customer' => row($pdo, 'SELECT invoices, payable, paid, balance FROM customers WHERE id = :id', ['id' => $fixture['customerId']]),
        'cylinder' => row($pdo, 'SELECT filledCylinders, emptyCylinders, withCustomers, qtyInStock FROM cylinders WHERE id = :id', ['id' => $fixture['cylinderId']]),
        'holdingCount' => (int) scalar($pdo, 'SELECT COUNT(*) FROM cylinder_customers WHERE cylinderId = :id', ['id' => $fixture['cylinderId']]),
        'saleCount' => (int) scalar($pdo, 'SELECT COUNT(*) FROM sales WHERE sync_transaction_id = :id', ['id' => $syncId]),
        'saleItemCount' => (int) scalar($pdo, 'SELECT COUNT(*) FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE sync_transaction_id = :id)', ['id' => $syncId]),
        'paymentCount' => (int) scalar($pdo, 'SELECT COUNT(*) FROM customer_payments WHERE sync_transaction_id = :id', ['id' => $syncId]),
        'paymentPayableSnapshot' => scalar($pdo, 'SELECT payableSnapshot FROM customer_payments WHERE sync_transaction_id = :id LIMIT 1', ['id' => $syncId]),
        'sync' => row($pdo, 'SELECT replay_status, replay_attempts FROM sync_transactions WHERE id = :id', ['id' => $syncId]),
    ];
}

function audit_rows(PDO $pdo, int $syncId): array {
    $statement = $pdo->prepare('SELECT event_type, actor_type, actor_id, actor_role, session_id FROM transaction_replay_audit WHERE sync_transaction_id = :id ORDER BY id');
    $statement->execute(['id' => $syncId]);
    return $statement->fetchAll();
}

function scalar(PDO $pdo, string $sql, array $args) {
    $statement = $pdo->prepare($sql);
    $statement->execute($args);
    return $statement->fetchColumn();
}

function row(PDO $pdo, string $sql, array $args): array {
    $statement = $pdo->prepare($sql);
    $statement->execute($args);
    return $statement->fetch() ?: [];
}

function cleanup_fixture(PDO $pdo, ?array $fixture): void {
    if (!$fixture) return;
    $pdo->prepare('DELETE FROM transaction_replay_audit WHERE sync_transaction_id IN (SELECT id FROM sync_transactions WHERE client_transaction_id LIKE :prefix)')->execute(['prefix' => '%' . strstr($fixture['itemName'], '-mapped-gas-item', true) . '%']);
    $pdo->prepare('DELETE FROM customer_payments WHERE customerId = :id')->execute(['id' => $fixture['customerId']]);
    $pdo->prepare('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE customerId = :id)')->execute(['id' => $fixture['customerId']]);
    $pdo->prepare('DELETE FROM sales WHERE customerId = :id')->execute(['id' => $fixture['customerId']]);
    $pdo->prepare('DELETE FROM sync_transactions WHERE client_transaction_id LIKE :prefix')->execute(['prefix' => '%' . strstr($fixture['itemName'], '-mapped-gas-item', true) . '%']);
    $pdo->prepare('DELETE FROM cylinder_customers WHERE cylinderId = :id')->execute(['id' => $fixture['cylinderId']]);
    $pdo->prepare('DELETE FROM cylinders WHERE id = :id')->execute(['id' => $fixture['cylinderId']]);
    $pdo->prepare('DELETE FROM item_batches WHERE id = :id')->execute(['id' => $fixture['batchId']]);
    $pdo->prepare('DELETE FROM customers WHERE id = :id')->execute(['id' => $fixture['customerId']]);
    $pdo->prepare('DELETE FROM items WHERE id = :id')->execute(['id' => $fixture['itemId']]);
}
`;
}

function runPhpHarness() {
  const result = spawnSync(findPhpBinary(), ["-r", phpTestCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, FINALIZED_SALE_V1_TEST_RUN_ID: runId },
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    return { ok: false, status: result.status, stdout: result.stdout, stderr: result.stderr };
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    return { ok: false, parseError: String(error), stdout: result.stdout, stderr: result.stderr };
  }
}

const syncEngineSource = readFileSync(resolve(projectRoot, "src/services/syncEngine.ts"), "utf8");
const transactionApiSource = readFileSync(resolve(projectRoot, "src/api/transactionApi.ts"), "utf8");
const endpointSource = readFileSync(resolve(projectRoot, "api/replay/sale.php"), "utf8");
const result = runPhpHarness();

check("PHP finalized Sale replay harness completed", result, (value) => value.ok === true, "Harness failed.");
if (result.ok === true) {
  check("ready Sale commits exactly once", result, (value) =>
    value.first?.success === true &&
    value.first?.replayStatus === "committed" &&
    Number(value.afterFirst?.saleCount) === 1 &&
    Number(value.afterFirst?.saleItemCount) === 1,
  "Ready replay did not commit one Sale and one item.");
  check("server item id drives stock mutation", result, (value) =>
    nearlyEqual(value.before?.itemStock, 10) && nearlyEqual(value.afterFirst?.itemStock, 8),
  "Mapped backend stock was not decreased.");
  check("exact server batch id drives consumption", result, (value) =>
    nearlyEqual(value.afterFirst?.batch?.qtySold, 2) && nearlyEqual(value.afterFirst?.batch?.balance, 8),
  "Mapped backend batch was not consumed.");
  check("customer accounting and payment ledger mirror local Sale outcome", result, (value) =>
    Number(value.afterFirst?.customer?.invoices) === 2 &&
    nearlyEqual(value.afterFirst?.customer?.payable, 300) &&
    nearlyEqual(value.afterFirst?.customer?.paid, 70) &&
    nearlyEqual(value.afterFirst?.customer?.balance, 230) &&
    Number(value.afterFirst?.paymentCount) === 1 &&
    nearlyEqual(value.afterFirst?.paymentPayableSnapshot, 280),
  "Customer accounting or payment ledger mismatch.");
  check("cylinder issue uses mapped backend cylinder", result, (value) =>
    nearlyEqual(value.afterFirst?.cylinder?.filledCylinders, 2) &&
    nearlyEqual(value.afterFirst?.cylinder?.withCustomers, 2) &&
    nearlyEqual(value.afterFirst?.cylinder?.qtyInStock, 4) &&
    Number(value.afterFirst?.holdingCount) === 1,
  "Cylinder Sale issue mismatch.");
  check("second replay is idempotent", result, (value) =>
    value.second?.success === true &&
    value.second?.terminalStateSkipped === true &&
    value.second?.alreadyCommitted === true &&
    JSON.stringify(value.afterFirst) === JSON.stringify(value.afterSecond),
  "Second replay changed business state.");
  check("unsafe replay is rejected without mutation", result, (value) =>
    value.unsafe?.success === false &&
    value.unsafe?.reason === "invalid_finalized_sale_contract" &&
    JSON.stringify(value.unsafeBefore) === JSON.stringify(value.unsafeAfter),
  "Unsafe replay changed state or was accepted.");
  check("zero-paid Sale commits without payment ledger row", result, (value) =>
    value.zeroPaid?.success === true &&
    Number(value.zeroPaidAfter?.saleCount) === 1 &&
    Number(value.zeroPaidAfter?.paymentCount) === 0,
  "Zero-paid Sale was rejected or created a payment row.");
  check("local ids are not backend mutation targets", result, (value) =>
    Number(value.fixture?.itemId) !== 91017 &&
    Number(value.fixture?.batchId) !== 91027 &&
    Number(value.fixture?.customerId) !== 91007 &&
    Number(value.fixture?.cylinderId) !== 91037 &&
    nearlyEqual(value.afterFirst?.itemStock, 8),
  "Fixture did not prove local/server id separation.");
  check("actor attribution is recorded safely", result.auditRows, (rows) =>
    Array.isArray(rows) &&
    rows.some((row) => row.event_type === "finalized_sale_v1_replay_completed") &&
    rows.some((row) => row.actor_type === "replay_worker" && row.actor_role === "replay"),
  "Audit attribution missing.");
}

check("manual sync router stores then explicitly replays ready finalized Sale", syncEngineSource, (source) =>
  source.includes('sale?.transactionType === "Sale"') &&
  source.includes("assertReadyFinalizedSaleReplay(item.payload)") &&
  source.includes("transactionApi.replayFinalizedSale(item.payload.clientTransactionId)"),
"Frontend manual router does not call narrow replay endpoint.");
check("transaction API targets narrow Sale replay endpoint", transactionApiSource, (source) =>
  source.includes('apiClient.post("/replay/sale.php", { clientTransactionId })'),
"Narrow endpoint is not wired.");
check("endpoint requires replay auth before execution", endpointSource, (source) =>
  source.includes("require_replay_request_auth($pdo)") &&
  source.includes("replayStoredFinalizedSaleV1Authorized"),
"Endpoint auth guard is missing.");

console.log(`Summary: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
