#!/usr/bin/env node

/* Isolated backend verifier for authenticated manual finalized Purchase v1 replay. */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `finalized-purchase-v1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
require_once getcwd() . '/api/lib/finalizedPurchaseReplayV1.php';

$pdo = get_pdo();
$runId = getenv('FINALIZED_PURCHASE_V1_TEST_RUN_ID') ?: ('finalized-purchase-v1-' . time());
ensure_fixture_tables($pdo);
$supplierFixture = insert_fixture($pdo, $runId . '-supplier', true, true);
$directFixture = insert_fixture($pdo, $runId . '-direct', false, false);
$unsafeFixture = null;

try {
    $auth = [
        'authenticated' => true,
        'actorType' => 'replay_worker',
        'actorId' => $runId . '-worker',
        'actorRole' => 'replay',
        'sessionId' => $runId . '-session',
    ];

    $supplierPayload = make_payload($runId, 'supplier-ready', $supplierFixture, true, false, false, 2, 100, 50);
    $supplierSyncId = insert_sync_row($pdo, $supplierPayload);
    $supplierBefore = snapshot($pdo, $supplierFixture, $supplierSyncId);
    $supplierFirst = replayStoredFinalizedPurchaseV1Authorized($pdo, $supplierSyncId, $auth);
    $supplierAfterFirst = snapshot($pdo, $supplierFixture, $supplierSyncId);
    $supplierSecond = replayStoredFinalizedPurchaseV1Authorized($pdo, $supplierSyncId, $auth);
    $supplierAfterSecond = snapshot($pdo, $supplierFixture, $supplierSyncId);

    $directPayload = make_payload($runId, 'direct-ready', $directFixture, true, true, false, 3, 20, 20);
    $directSyncId = insert_sync_row($pdo, $directPayload);
    $directBefore = snapshot($pdo, $directFixture, $directSyncId);
    $directReplay = replayStoredFinalizedPurchaseV1Authorized($pdo, $directSyncId, $auth);
    $directAfter = snapshot($pdo, $directFixture, $directSyncId);

    $unsafeFixture = insert_fixture($pdo, $runId . '-unsafe', true, false);
    $unsafePayload = make_payload($runId, 'unsafe', $unsafeFixture, false, false, true, 2, 40, 10);
    $unsafeSyncId = insert_sync_row($pdo, $unsafePayload);
    $unsafeBefore = snapshot($pdo, $unsafeFixture, $unsafeSyncId);
    $unsafeReplay = replayStoredFinalizedPurchaseV1Authorized($pdo, $unsafeSyncId, $auth);
    $unsafeAfter = snapshot($pdo, $unsafeFixture, $unsafeSyncId);

    echo json_encode([
        'ok' => true,
        'supplierFixture' => $supplierFixture,
        'supplierSyncId' => $supplierSyncId,
        'supplierBefore' => $supplierBefore,
        'supplierFirst' => $supplierFirst,
        'supplierAfterFirst' => $supplierAfterFirst,
        'supplierSecond' => $supplierSecond,
        'supplierAfterSecond' => $supplierAfterSecond,
        'directFixture' => $directFixture,
        'directBefore' => $directBefore,
        'directReplay' => $directReplay,
        'directAfter' => $directAfter,
        'unsafeBefore' => $unsafeBefore,
        'unsafeReplay' => $unsafeReplay,
        'unsafeAfter' => $unsafeAfter,
        'auditRows' => audit_rows($pdo, $supplierSyncId),
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
} finally {
    cleanup_fixture($pdo, $supplierFixture ?? null);
    cleanup_fixture($pdo, $directFixture ?? null);
    cleanup_fixture($pdo, $unsafeFixture ?? null);
}

function make_payload(string $runId, string $name, array $fixture, bool $ready, bool $directPurchase, bool $missingItemServerId, float $qty, float $price, float $paid): array {
    $clientId = $runId . '-' . $name . '-client';
    $invoiceNo = strtoupper($runId . '-' . $name . '-invoice');
    $dues = $directPurchase ? 0.0 : (float) $fixture['supplierOpeningBalance'];
    $subtotal = $qty * $price;
    $grandTotal = $dues + $subtotal;
    $arrears = $grandTotal - $paid;
    $localSaleId = 92001;
    $readiness = [
        'scope' => 'finalized_purchase',
        'payloadVersion' => 1,
        'status' => $ready ? 'ready' : 'unsafe',
        'reasons' => $ready ? [] : [[
            'code' => $missingItemServerId ? 'missing_server_item_id' : 'missing_supplier_server_id',
            'message' => 'Purchase fixture intentionally lacks a required backend mapping.',
            'localItemId' => 92018,
        ]],
    ];

    $supplier = $directPurchase
        ? [
            'localId' => null,
            'serverId' => null,
            'nameSnapshot' => 'Direct Purchase',
            'directPurchase' => true,
        ]
        : [
            'localId' => 92008,
            'serverId' => $fixture['supplierId'],
            'nameSnapshot' => $fixture['supplierName'],
            'directPurchase' => false,
        ];

    $serverItemId = $missingItemServerId ? null : $fixture['itemId'];
    $cylinders = [];
    $requiresCylinder = $fixture['cylinderId'] !== null;
    if ($requiresCylinder) {
        $cylinders[] = [
            'localItemId' => 92018,
            'serverItemId' => $serverItemId,
            'localCylinderId' => 92038,
            'serverCylinderId' => $fixture['cylinderId'],
            'qtyFilledIncrease' => $qty,
            'qtyStockIncrease' => $qty,
        ];
    }

    $contract = [
        'payloadVersion' => 1,
        'transactionType' => 'Purchase',
        'localSaleId' => $localSaleId,
        'invoiceNo' => $invoiceNo,
        'clientTransactionId' => $clientId,
        'createdAt' => 1770000000000,
        'supplier' => $supplier,
        'items' => [[
            'localItemId' => 92018,
            'serverItemId' => $serverItemId,
            'originalItemId' => 92018,
            'nameSnapshot' => $fixture['itemName'],
            'qty' => $qty,
            'price' => $price,
            'costPrice' => $price,
            'quantityUnit' => 'min',
            'selectedUnit' => 'min',
            'conversion' => [
                'minUnit' => $requiresCylinder ? 'cylinder' : 'piece',
                'maxUnit' => $requiresCylinder ? 'cylinder' : 'piece',
                'convQty' => 1,
                'quantityInMinUnit' => $qty,
            ],
            'batchCreate' => [
                'localBatchId' => 92028,
                'sourceSaleId' => $localSaleId,
                'purchaseDate' => '2026-06-03',
                'qtyPurchased' => $qty,
                'balance' => $qty,
                'costPrice' => $price,
                'invoiceNo' => $invoiceNo,
            ],
            'requiresCylinderMutation' => $requiresCylinder,
        ]],
        'payments' => [
            'paidAmount' => $paid,
            'source' => 'pos-finalization',
            'method' => null,
        ],
        'cylinders' => $cylinders,
        'totals' => [
            'subtotal' => $subtotal,
            'discount' => 0,
            'tax' => 0,
            'dues' => $dues,
            'grandTotal' => $grandTotal,
            'paid' => $paid,
            'arrears' => $arrears,
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
                'date' => '2026-06-03',
                'transactionType' => 'Purchase',
                'customerId' => null,
                'supplierId' => $directPurchase ? null : 92008,
                'customerName' => '',
                'supplierName' => $directPurchase ? 'Direct Purchase' : $fixture['supplierName'],
                'subtotal' => $subtotal,
                'discount' => 0,
                'tax' => 0,
                'dues' => $dues,
                'grandTotal' => $grandTotal,
                'paid' => $paid,
                'arrears' => $arrears,
                'profit' => 0,
                'isPostponed' => false,
            ],
            'saleItems' => [[
                'originalItemId' => 92018,
                'name' => $fixture['itemName'],
                'qty' => $qty,
                'price' => $price,
            ]],
            'finalizedPurchaseReplay' => $contract,
        ],
    ];
}

function ensure_fixture_tables(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS supplier_payments (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, supplierId BIGINT UNSIGNED NOT NULL, supplierName VARCHAR(180) NULL, invoiceNo VARCHAR(120) NULL, amount DECIMAL(12,2) NOT NULL DEFAULT 0, paymentDate VARCHAR(50) NULL, remarks TEXT NULL, payableSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, balanceSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, sync_transaction_id BIGINT UNSIGNED NULL, client_transaction_id VARCHAR(150) NULL, sale_id BIGINT UNSIGNED NULL, source VARCHAR(80) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_supplier_payments_supplierId (supplierId)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    ensure_fixture_column($pdo, 'supplier_payments', 'sync_transaction_id', 'BIGINT UNSIGNED NULL');
    ensure_fixture_column($pdo, 'supplier_payments', 'client_transaction_id', 'VARCHAR(150) NULL');
    ensure_fixture_column($pdo, 'supplier_payments', 'sale_id', 'BIGINT UNSIGNED NULL');
    ensure_fixture_column($pdo, 'supplier_payments', 'source', 'VARCHAR(80) NULL');
}

function ensure_fixture_column(PDO $pdo, string $table, string $column, string $definition): void {
    $statement = $pdo->prepare('SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = :table AND column_name = :column');
    $statement->execute(['table' => $table, 'column' => $column]);
    if ((int) ($statement->fetch()['c'] ?? 0) === 0) {
        $pdo->exec("ALTER TABLE $table ADD COLUMN $column $definition");
    }
}

function insert_fixture(PDO $pdo, string $prefix, bool $withSupplier, bool $withCylinder): array {
    $itemName = $prefix . '-mapped-purchase-item';
    $supplierName = $prefix . '-mapped-supplier';
    $category = $withCylinder ? 'Gas Cylinder' : 'General';
    $statement = $pdo->prepare("INSERT INTO items (client_id, name, barcode, purchasePrice, retailPrice, discountPrice, wholesalePrice, availableStock, category, brand, minunit, maxunit, ConvQty, is_deleted) VALUES (:client, :name, :barcode, 10, 100, 0, 100, :stock, :category, 'Replay Fixture', :minunit, :maxunit, 1, 0)");
    $statement->execute([
        'client' => $prefix . '-item-client',
        'name' => $itemName,
        'barcode' => $prefix . '-barcode',
        'stock' => $withSupplier ? 10 : 5,
        'category' => $category,
        'minunit' => $withCylinder ? 'cylinder' : 'piece',
        'maxunit' => $withCylinder ? 'cylinder' : 'piece',
    ]);
    $itemId = (int) $pdo->lastInsertId();

    $supplierId = null;
    $openingBalance = 0.0;
    if ($withSupplier) {
        $openingBalance = 80.0;
        $statement = $pdo->prepare("INSERT INTO suppliers (client_id, name, mobile, cnic, address, invoices, payable, paid, balance, is_deleted) VALUES (:client, :name, '03111111111', 'purchase-test', 'purchase replay supplier', 1, 100, 20, 80, 0)");
        $statement->execute(['client' => $prefix . '-supplier-client', 'name' => $supplierName]);
        $supplierId = (int) $pdo->lastInsertId();
    }

    $cylinderId = null;
    if ($withCylinder) {
        $statement = $pdo->prepare("INSERT INTO cylinders (itemId, title, qtyInStock, filledCylinders, emptyCylinders, withCustomers, convQty, isDeleted) VALUES (:itemId, :title, 4, 4, 0, 0, 1, 0)");
        $statement->execute(['itemId' => $itemId, 'title' => $prefix . '-cylinder']);
        $cylinderId = (int) $pdo->lastInsertId();
    }

    return [
        'prefix' => $prefix,
        'itemId' => $itemId,
        'itemName' => $itemName,
        'supplierId' => $supplierId,
        'supplierName' => $withSupplier ? $supplierName : null,
        'supplierOpeningBalance' => $openingBalance,
        'cylinderId' => $cylinderId,
    ];
}

function insert_sync_row(PDO $pdo, array $payload): int {
    $statement = $pdo->prepare("INSERT INTO sync_transactions (client_transaction_id, transaction_type, payload_json, status, replay_status, replay_attempts) VALUES (:client, 'sale', :payload, 'stored', 'stored', 0)");
    $statement->execute(['client' => $payload['clientTransactionId'], 'payload' => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]);
    return (int) $pdo->lastInsertId();
}

function snapshot(PDO $pdo, array $fixture, int $syncId): array {
    $saleId = scalar($pdo, 'SELECT id FROM sales WHERE sync_transaction_id = :id LIMIT 1', ['id' => $syncId]);
    return [
        'itemStock' => scalar($pdo, 'SELECT availableStock FROM items WHERE id = :id', ['id' => $fixture['itemId']]),
        'supplier' => $fixture['supplierId'] !== null
            ? row($pdo, 'SELECT invoices, payable, paid, balance FROM suppliers WHERE id = :id', ['id' => $fixture['supplierId']])
            : [],
        'cylinder' => $fixture['cylinderId'] !== null
            ? row($pdo, 'SELECT filledCylinders, emptyCylinders, withCustomers, qtyInStock FROM cylinders WHERE id = :id', ['id' => $fixture['cylinderId']])
            : [],
        'saleCount' => (int) scalar($pdo, 'SELECT COUNT(*) FROM sales WHERE sync_transaction_id = :id', ['id' => $syncId]),
        'saleId' => $saleId !== false ? (int) $saleId : null,
        'saleItemCount' => (int) scalar($pdo, 'SELECT COUNT(*) FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE sync_transaction_id = :id)', ['id' => $syncId]),
        'supplierPaymentCount' => (int) scalar($pdo, 'SELECT COUNT(*) FROM supplier_payments WHERE sync_transaction_id = :id', ['id' => $syncId]),
        'paymentPayableSnapshot' => scalar($pdo, 'SELECT payableSnapshot FROM supplier_payments WHERE sync_transaction_id = :id LIMIT 1', ['id' => $syncId]),
        'paymentBalanceSnapshot' => scalar($pdo, 'SELECT balanceSnapshot FROM supplier_payments WHERE sync_transaction_id = :id LIMIT 1', ['id' => $syncId]),
        'createdBatchCount' => (int) scalar($pdo, 'SELECT COUNT(*) FROM item_batches WHERE sync_transaction_id = :id', ['id' => $syncId]),
        'createdBatch' => row($pdo, 'SELECT id, itemId, qtyPurchased, qtySold, balance, costPrice, sourceSaleId, client_transaction_id FROM item_batches WHERE sync_transaction_id = :id LIMIT 1', ['id' => $syncId]),
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
    $like = $fixture['prefix'] . '%';
    $pdo->prepare('DELETE FROM transaction_replay_audit WHERE client_transaction_id LIKE :pattern')->execute(['pattern' => $like]);
    $pdo->prepare('DELETE FROM supplier_payments WHERE supplierId = :id OR client_transaction_id LIKE :pattern')->execute(['id' => $fixture['supplierId'] ?? 0, 'pattern' => $like]);
    $pdo->prepare('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_transaction_id LIKE :pattern)')->execute(['pattern' => $like]);
    $pdo->prepare('DELETE FROM sales WHERE client_transaction_id LIKE :pattern')->execute(['pattern' => $like]);
    $pdo->prepare('DELETE FROM sync_transactions WHERE client_transaction_id LIKE :pattern')->execute(['pattern' => $like]);
    $pdo->prepare('DELETE FROM item_batches WHERE itemId = :item_id OR client_transaction_id LIKE :pattern')->execute(['item_id' => $fixture['itemId'], 'pattern' => $like]);
    if ($fixture['cylinderId'] !== null) {
        $pdo->prepare('DELETE FROM cylinder_customers WHERE cylinderId = :id')->execute(['id' => $fixture['cylinderId']]);
        $pdo->prepare('DELETE FROM cylinders WHERE id = :id')->execute(['id' => $fixture['cylinderId']]);
    }
    if ($fixture['supplierId'] !== null) {
        $pdo->prepare('DELETE FROM suppliers WHERE id = :id')->execute(['id' => $fixture['supplierId']]);
    }
    $pdo->prepare('DELETE FROM items WHERE id = :id')->execute(['id' => $fixture['itemId']]);
}
`;
}

function runPhpHarness() {
  const result = spawnSync(findPhpBinary(), ["-r", phpTestCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, FINALIZED_PURCHASE_V1_TEST_RUN_ID: runId },
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
const endpointSource = readFileSync(resolve(projectRoot, "api/replay/purchase.php"), "utf8");
const saleEndpointSource = readFileSync(resolve(projectRoot, "api/replay/sale.php"), "utf8");
const result = runPhpHarness();

check("PHP finalized Purchase replay harness completed", result, (value) => value.ok === true, "Harness failed.");
if (result.ok === true) {
  check("ready supplier Purchase commits exactly once", result, (value) =>
    value.supplierFirst?.success === true &&
    value.supplierFirst?.replayStatus === "committed" &&
    Number(value.supplierAfterFirst?.saleCount) === 1 &&
    Number(value.supplierAfterFirst?.saleItemCount) === 1,
  "Ready supplier Purchase did not commit one Purchase and one item.");
  check("server item id drives Purchase stock increase", result, (value) =>
    nearlyEqual(value.supplierBefore?.itemStock, 10) && nearlyEqual(value.supplierAfterFirst?.itemStock, 12),
  "Mapped backend stock was not increased.");
  check("backend batch is created from safe batchCreate metadata", result, (value) =>
    Number(value.supplierAfterFirst?.createdBatchCount) === 1 &&
    Number(value.supplierAfterFirst?.createdBatch?.id) !== 92028 &&
    Number(value.supplierAfterFirst?.createdBatch?.itemId) === Number(value.supplierFixture?.itemId) &&
    Number(value.supplierAfterFirst?.createdBatch?.sourceSaleId) === Number(value.supplierAfterFirst?.saleId) &&
    nearlyEqual(value.supplierAfterFirst?.createdBatch?.qtyPurchased, 2) &&
    nearlyEqual(value.supplierAfterFirst?.createdBatch?.balance, 2),
  "Purchase batch creation mismatch.");
  check("supplier accounting and payment ledger mirror local Purchase outcome", result, (value) =>
    Number(value.supplierAfterFirst?.supplier?.invoices) === 2 &&
    nearlyEqual(value.supplierAfterFirst?.supplier?.payable, 300) &&
    nearlyEqual(value.supplierAfterFirst?.supplier?.paid, 70) &&
    nearlyEqual(value.supplierAfterFirst?.supplier?.balance, 230) &&
    Number(value.supplierAfterFirst?.supplierPaymentCount) === 1 &&
    nearlyEqual(value.supplierAfterFirst?.paymentPayableSnapshot, 280) &&
    nearlyEqual(value.supplierAfterFirst?.paymentBalanceSnapshot, 230),
  "Supplier accounting or payment ledger mismatch.");
  check("cylinder Purchase uses mapped backend cylinder", result, (value) =>
    nearlyEqual(value.supplierAfterFirst?.cylinder?.filledCylinders, 6) &&
    nearlyEqual(value.supplierAfterFirst?.cylinder?.qtyInStock, 6) &&
    nearlyEqual(value.supplierAfterFirst?.cylinder?.withCustomers, 0),
  "Cylinder Purchase increase mismatch.");
  check("second Purchase replay is idempotent", result, (value) =>
    value.supplierSecond?.success === true &&
    value.supplierSecond?.terminalStateSkipped === true &&
    value.supplierSecond?.alreadyCommitted === true &&
    JSON.stringify(value.supplierAfterFirst) === JSON.stringify(value.supplierAfterSecond),
  "Second Purchase replay changed business state.");
  check("unsafe Purchase is rejected without mutation", result, (value) =>
    value.unsafeReplay?.success === false &&
    value.unsafeReplay?.reason === "invalid_finalized_purchase_contract" &&
    JSON.stringify(value.unsafeBefore) === JSON.stringify(value.unsafeAfter),
  "Unsafe Purchase replay changed state or was accepted.");
  check("Direct Purchase commits without supplier mutation or supplier payment", result, (value) =>
    value.directReplay?.success === true &&
    Number(value.directAfter?.saleCount) === 1 &&
    Number(value.directAfter?.saleItemCount) === 1 &&
    Number(value.directAfter?.supplierPaymentCount) === 0 &&
    nearlyEqual(value.directBefore?.itemStock, 5) &&
    nearlyEqual(value.directAfter?.itemStock, 8) &&
    Number(value.directAfter?.createdBatchCount) === 1,
  "Direct Purchase replay did not commit safely without supplier effects.");
  check("local ids are not backend mutation targets", result, (value) =>
    Number(value.supplierFixture?.itemId) !== 92018 &&
    Number(value.supplierFixture?.supplierId) !== 92008 &&
    Number(value.supplierFixture?.cylinderId) !== 92038 &&
    Number(value.supplierAfterFirst?.createdBatch?.id) !== 92028 &&
    nearlyEqual(value.supplierAfterFirst?.itemStock, 12),
  "Fixture did not prove local/server id separation.");
  check("actor attribution is recorded safely", result.auditRows, (rows) =>
    Array.isArray(rows) &&
    rows.some((row) => row.event_type === "finalized_purchase_v1_replay_completed") &&
    rows.some((row) => row.actor_type === "replay_worker" && row.actor_role === "replay"),
  "Audit attribution missing.");
}

check("manual sync router stores then explicitly replays ready finalized Purchase", syncEngineSource, (source) =>
  source.includes('sale?.transactionType === "Purchase"') &&
  source.includes("assertReadyFinalizedPurchaseReplay(item.payload)") &&
  source.includes("transactionApi.replayFinalizedPurchase(item.payload.clientTransactionId)"),
"Frontend manual router does not call narrow Purchase replay endpoint.");
check("transaction API targets narrow Purchase replay endpoint", transactionApiSource, (source) =>
  source.includes('apiClient.post("/replay/purchase.php", { clientTransactionId })'),
"Narrow Purchase endpoint is not wired.");
check("endpoint requires replay auth before execution", endpointSource, (source) =>
  source.includes("require_replay_request_auth($pdo)") &&
  source.includes("replayStoredFinalizedPurchaseV1Authorized"),
"Purchase endpoint auth guard is missing.");
check("Sale replay endpoint remains wired to Sale adapter", saleEndpointSource, (source) =>
  source.includes("replayStoredFinalizedSaleV1Authorized") &&
  !source.includes("replayStoredFinalizedPurchaseV1Authorized"),
"Sale endpoint was altered unexpectedly.");

console.log(`Summary: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
