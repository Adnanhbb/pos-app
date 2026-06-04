#!/usr/bin/env node

/* Isolated backend verifier for authenticated manual finalized Supplier Return v1 replay. */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `finalized-supplier-return-v1-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;
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
require_once getcwd() . '/api/lib/finalizedSupplierReturnReplayV1.php';

$pdo = get_pdo();
$runId = getenv('FINALIZED_SUPPLIER_RETURN_V1_TEST_RUN_ID') ?: ('finalized-supplier-return-v1-' . time());
ensure_fixture_tables($pdo);
$cylinderFixture = insert_fixture($pdo, $runId . '-cylinder', true);
$nonCylinderFixture = insert_fixture($pdo, $runId . '-non-cylinder', false);
$unsafeFixture = insert_fixture($pdo, $runId . '-unsafe', true);

try {
    $auth = [
        'authenticated' => true,
        'actorType' => 'replay_worker',
        'actorId' => $runId . '-worker',
        'actorRole' => 'replay',
        'sessionId' => $runId . '-session',
    ];

    $cylinderPayload = make_payload($runId, 'cylinder-ready', $cylinderFixture, true, true, 3, 50, -30);
    $cylinderSyncId = insert_sync_row($pdo, $cylinderPayload);
    $cylinderBefore = snapshot($pdo, $cylinderFixture, $cylinderSyncId);
    $cylinderFirst = replayStoredFinalizedSupplierReturnV1Authorized($pdo, $cylinderSyncId, $auth);
    $cylinderAfterFirst = snapshot($pdo, $cylinderFixture, $cylinderSyncId);
    $cylinderSecond = replayStoredFinalizedSupplierReturnV1Authorized($pdo, $cylinderSyncId, $auth);
    $cylinderAfterSecond = snapshot($pdo, $cylinderFixture, $cylinderSyncId);

    $nonCylinderPayload = make_payload($runId, 'non-cylinder-ready', $nonCylinderFixture, true, false, 2, 20, 0);
    $nonCylinderSyncId = insert_sync_row($pdo, $nonCylinderPayload);
    $nonCylinderBefore = snapshot($pdo, $nonCylinderFixture, $nonCylinderSyncId);
    $nonCylinderReplay = replayStoredFinalizedSupplierReturnV1Authorized($pdo, $nonCylinderSyncId, $auth);
    $nonCylinderAfter = snapshot($pdo, $nonCylinderFixture, $nonCylinderSyncId);

    $unsafePayload = make_payload($runId, 'unsafe', $unsafeFixture, false, true, 3, 50, -30);
    $unsafeSyncId = insert_sync_row($pdo, $unsafePayload);
    $unsafeBefore = snapshot($pdo, $unsafeFixture, $unsafeSyncId);
    $unsafeReplay = replayStoredFinalizedSupplierReturnV1Authorized($pdo, $unsafeSyncId, $auth);
    $unsafeAfter = snapshot($pdo, $unsafeFixture, $unsafeSyncId);

    echo json_encode([
        'ok' => true,
        'cylinderFixture' => $cylinderFixture,
        'cylinderSyncId' => $cylinderSyncId,
        'cylinderBefore' => $cylinderBefore,
        'cylinderFirst' => $cylinderFirst,
        'cylinderAfterFirst' => $cylinderAfterFirst,
        'cylinderSecond' => $cylinderSecond,
        'cylinderAfterSecond' => $cylinderAfterSecond,
        'nonCylinderFixture' => $nonCylinderFixture,
        'nonCylinderBefore' => $nonCylinderBefore,
        'nonCylinderReplay' => $nonCylinderReplay,
        'nonCylinderAfter' => $nonCylinderAfter,
        'unsafeBefore' => $unsafeBefore,
        'unsafeReplay' => $unsafeReplay,
        'unsafeAfter' => $unsafeAfter,
        'auditRows' => audit_rows($pdo, $cylinderSyncId),
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
} finally {
    cleanup_fixture($pdo, $cylinderFixture ?? null);
    cleanup_fixture($pdo, $nonCylinderFixture ?? null);
    cleanup_fixture($pdo, $unsafeFixture ?? null);
}

function make_payload(string $runId, string $name, array $fixture, bool $ready, bool $withCylinder, float $qty, float $price, float $paid): array {
    $clientId = $runId . '-' . $name . '-client';
    $invoiceNo = strtoupper($runId . '-' . $name . '-invoice');
    $localSaleId = 94001;
    $localItemId = 94018;
    $localSupplierId = 94009;
    $localBatchId = 94028;
    $subtotal = $qty * $price;
    $dues = (float) $fixture['supplierOpeningPayable'];
    $grandTotal = $dues - $subtotal;
    $arrears = $grandTotal - $paid;
    $sourceBeforePurchased = (float) $fixture['sourceBatchQtyPurchased'];
    $sourceBeforeBalance = (float) $fixture['sourceBatchBalance'];
    $readiness = [
        'scope' => 'finalized_supplier_return',
        'payloadVersion' => 1,
        'status' => $ready ? 'ready' : 'unsafe',
        'reasons' => $ready ? [] : [[
            'code' => 'missing_server_item_id',
            'message' => 'Supplier Return fixture intentionally lacks a required backend mapping.',
            'localItemId' => $localItemId,
        ]],
    ];

    $serverItemId = $ready ? $fixture['itemId'] : null;
    $item = [
        'localItemId' => $localItemId,
        'serverItemId' => $serverItemId,
        'originalItemId' => $localItemId,
        'nameSnapshot' => $fixture['itemName'],
        'qty' => $qty,
        'price' => $price,
        'costPrice' => $price,
        'quantityUnit' => 'min',
        'selectedUnit' => 'min',
        'conversion' => [
            'minUnit' => $withCylinder ? 'kg' : 'piece',
            'maxUnit' => $withCylinder ? 'cylinder' : 'piece',
            'convQty' => $withCylinder ? 3 : 1,
            'quantityInMinUnit' => $qty,
        ],
        'sourceBatch' => [
            'localBatchId' => $localBatchId,
            'serverBatchId' => $ready ? $fixture['sourceBatchId'] : null,
            'returnedQty' => $qty,
            'qtyPurchasedBefore' => $sourceBeforePurchased,
            'qtyPurchasedAfter' => $sourceBeforePurchased - $qty,
            'balanceBefore' => $sourceBeforeBalance,
            'balanceAfter' => $sourceBeforeBalance - $qty,
        ],
        'requiresCylinderMutation' => $withCylinder,
    ];

    $cylinders = [];
    if ($withCylinder) {
        $cylinders[] = [
            'localItemId' => $localItemId,
            'serverItemId' => $serverItemId,
            'localCylinderId' => 94038,
            'serverCylinderId' => $ready ? $fixture['cylinderId'] : null,
            'qtyReturned' => 1,
            'movement' => 'filledDecrease',
            'filledCylindersBefore' => 4,
            'filledCylindersAfter' => 3,
            'qtyInStockBefore' => 7,
            'qtyInStockAfter' => 6,
        ];
    }

    $contract = [
        'payloadVersion' => 1,
        'transactionType' => 'Return',
        'returnMode' => 'supplier',
        'localSaleId' => $localSaleId,
        'invoiceNo' => $invoiceNo,
        'clientTransactionId' => $clientId,
        'createdAt' => 1770000000000,
        'supplier' => [
            'localId' => $localSupplierId,
            'serverId' => $ready ? $fixture['supplierId'] : null,
            'nameSnapshot' => $fixture['supplierName'],
        ],
        'items' => [$item],
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
        'transactionType' => 'return',
        'createdAt' => 1770000000000,
        'replayReadiness' => $readiness,
        'payload' => [
            'returnMode' => 'supplier',
            'sale' => [
                'invoiceNo' => $invoiceNo,
                'date' => '2026-06-03',
                'transactionType' => 'Return',
                'customerId' => null,
                'supplierId' => $localSupplierId,
                'customerName' => '',
                'supplierName' => $fixture['supplierName'],
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
                'originalItemId' => $localItemId,
                'name' => $fixture['itemName'],
                'qty' => $qty,
                'price' => $price,
                'costPrice' => $price,
                'batchId' => $localBatchId,
            ]],
            'finalizedSupplierReturnReplay' => $contract,
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

function insert_fixture(PDO $pdo, string $prefix, bool $withCylinder): array {
    $itemName = $prefix . '-mapped-supplier-return-item';
    $supplierName = $prefix . '-mapped-supplier';
    $category = $withCylinder ? 'Gas Cylinder' : 'General';
    $statement = $pdo->prepare("INSERT INTO items (client_id, name, barcode, purchasePrice, retailPrice, discountPrice, wholesalePrice, availableStock, category, brand, minunit, maxunit, ConvQty, is_deleted) VALUES (:client, :name, :barcode, 10, 100, 0, 100, 10, :category, 'Replay Fixture', :minunit, :maxunit, :convQty, 0)");
    $statement->execute([
        'client' => $prefix . '-item-client',
        'name' => $itemName,
        'barcode' => $prefix . '-barcode',
        'category' => $category,
        'minunit' => $withCylinder ? 'kg' : 'piece',
        'maxunit' => $withCylinder ? 'cylinder' : 'piece',
        'convQty' => $withCylinder ? 3 : 1,
    ]);
    $itemId = (int) $pdo->lastInsertId();

    $openingPayable = 500.0;
    $statement = $pdo->prepare("INSERT INTO suppliers (client_id, name, mobile, cnic, address, invoices, payable, paid, balance, is_deleted) VALUES (:client, :name, '03111111111', 'supplier-return-test', 'supplier return replay supplier', 0, :payable, 0, :balance, 0)");
    $statement->execute([
        'client' => $prefix . '-supplier-client',
        'name' => $supplierName,
        'payable' => $openingPayable,
        'balance' => $openingPayable,
    ]);
    $supplierId = (int) $pdo->lastInsertId();

    $sourceBatchQtyPurchased = 10.0;
    $sourceBatchBalance = 8.0;
    $statement = $pdo->prepare("INSERT INTO item_batches (itemId, purchaseDate, qtyPurchased, qtySold, balance, costPrice, sourceSaleId, invoiceNo, isDeleted, deletedAt) VALUES (:itemId, '2026-06-03', :qtyPurchased, 0, :balance, 50, 77, :invoiceNo, 0, NULL)");
    $statement->execute([
        'itemId' => $itemId,
        'qtyPurchased' => $sourceBatchQtyPurchased,
        'balance' => $sourceBatchBalance,
        'invoiceNo' => $prefix . '-source-batch',
    ]);
    $sourceBatchId = (int) $pdo->lastInsertId();

    $cylinderId = null;
    if ($withCylinder) {
        $statement = $pdo->prepare("INSERT INTO cylinders (itemId, title, qtyInStock, filledCylinders, emptyCylinders, withCustomers, convQty, isDeleted) VALUES (:itemId, :title, 7, 4, 2, 1, 3, 0)");
        $statement->execute(['itemId' => $itemId, 'title' => $prefix . '-cylinder']);
        $cylinderId = (int) $pdo->lastInsertId();
    }

    return [
        'prefix' => $prefix,
        'itemId' => $itemId,
        'itemName' => $itemName,
        'supplierId' => $supplierId,
        'supplierName' => $supplierName,
        'supplierOpeningPayable' => $openingPayable,
        'sourceBatchId' => $sourceBatchId,
        'sourceBatchQtyPurchased' => $sourceBatchQtyPurchased,
        'sourceBatchBalance' => $sourceBatchBalance,
        'cylinderId' => $cylinderId,
    ];
}

function insert_sync_row(PDO $pdo, array $payload): int {
    $statement = $pdo->prepare("INSERT INTO sync_transactions (client_transaction_id, transaction_type, payload_json, status, replay_status, replay_attempts) VALUES (:client, 'return', :payload, 'stored', 'stored', 0)");
    $statement->execute(['client' => $payload['clientTransactionId'], 'payload' => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]);
    return (int) $pdo->lastInsertId();
}

function snapshot(PDO $pdo, array $fixture, int $syncId): array {
    $saleId = scalar($pdo, 'SELECT id FROM sales WHERE sync_transaction_id = :id LIMIT 1', ['id' => $syncId]);
    return [
        'itemStock' => scalar($pdo, 'SELECT availableStock FROM items WHERE id = :id', ['id' => $fixture['itemId']]),
        'supplier' => row($pdo, 'SELECT invoices, payable, paid, balance FROM suppliers WHERE id = :id', ['id' => $fixture['supplierId']]),
        'sourceBatch' => row($pdo, 'SELECT id, itemId, qtyPurchased, qtySold, balance, costPrice FROM item_batches WHERE id = :id', ['id' => $fixture['sourceBatchId']]),
        'cylinder' => $fixture['cylinderId'] !== null
            ? row($pdo, 'SELECT filledCylinders, emptyCylinders, withCustomers, qtyInStock FROM cylinders WHERE id = :id', ['id' => $fixture['cylinderId']])
            : [],
        'saleCount' => (int) scalar($pdo, 'SELECT COUNT(*) FROM sales WHERE sync_transaction_id = :id', ['id' => $syncId]),
        'saleId' => $saleId !== false ? (int) $saleId : null,
        'sale' => row($pdo, 'SELECT transactionType, supplierId, paid, grandTotal, arrears FROM sales WHERE sync_transaction_id = :id LIMIT 1', ['id' => $syncId]),
        'saleItemCount' => (int) scalar($pdo, 'SELECT COUNT(*) FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE sync_transaction_id = :id)', ['id' => $syncId]),
        'saleItemOriginalId' => scalar($pdo, 'SELECT originalItemId FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE sync_transaction_id = :id) LIMIT 1', ['id' => $syncId]),
        'supplierPaymentCount' => (int) scalar($pdo, 'SELECT COUNT(*) FROM supplier_payments WHERE sync_transaction_id = :id', ['id' => $syncId]),
        'payment' => row($pdo, 'SELECT amount, payableSnapshot, balanceSnapshot FROM supplier_payments WHERE sync_transaction_id = :id LIMIT 1', ['id' => $syncId]),
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
    $pattern = $fixture['prefix'] . '%';
    $pdo->prepare('DELETE FROM transaction_replay_audit WHERE client_transaction_id LIKE :pattern')->execute(['pattern' => $pattern]);
    $pdo->prepare('DELETE FROM supplier_payments WHERE supplierId = :id OR client_transaction_id LIKE :pattern')->execute(['id' => $fixture['supplierId'], 'pattern' => $pattern]);
    $pdo->prepare('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE supplierId = :id OR client_transaction_id LIKE :pattern)')->execute(['id' => $fixture['supplierId'], 'pattern' => $pattern]);
    $pdo->prepare('DELETE FROM sales WHERE supplierId = :id OR client_transaction_id LIKE :pattern')->execute(['id' => $fixture['supplierId'], 'pattern' => $pattern]);
    $pdo->prepare('DELETE FROM sync_transactions WHERE client_transaction_id LIKE :pattern')->execute(['pattern' => $pattern]);
    $pdo->prepare('DELETE FROM item_batches WHERE itemId = :item_id OR client_transaction_id LIKE :pattern')->execute(['item_id' => $fixture['itemId'], 'pattern' => $pattern]);
    if ($fixture['cylinderId'] !== null) {
        $pdo->prepare('DELETE FROM cylinder_customers WHERE cylinderId = :id')->execute(['id' => $fixture['cylinderId']]);
        $pdo->prepare('DELETE FROM cylinders WHERE id = :id')->execute(['id' => $fixture['cylinderId']]);
    }
    $pdo->prepare('DELETE FROM suppliers WHERE id = :id')->execute(['id' => $fixture['supplierId']]);
    $pdo->prepare('DELETE FROM items WHERE id = :id')->execute(['id' => $fixture['itemId']]);
}
`;
}

function runPhpHarness() {
  const result = spawnSync(findPhpBinary(), ["-r", phpTestCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      FINALIZED_SUPPLIER_RETURN_V1_TEST_RUN_ID: runId,
    },
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    return {
      ok: false,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    return {
      ok: false,
      parseError: String(error),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}

const syncEngineSource = readFileSync(
  resolve(projectRoot, "src/services/syncEngine.ts"),
  "utf8"
);
const transactionApiSource = readFileSync(
  resolve(projectRoot, "src/api/transactionApi.ts"),
  "utf8"
);
const endpointSource = readFileSync(
  resolve(projectRoot, "api/replay/supplier-return.php"),
  "utf8"
);
const saleEndpointSource = readFileSync(
  resolve(projectRoot, "api/replay/sale.php"),
  "utf8"
);
const purchaseEndpointSource = readFileSync(
  resolve(projectRoot, "api/replay/purchase.php"),
  "utf8"
);
const customerReturnEndpointSource = readFileSync(
  resolve(projectRoot, "api/replay/customer-return.php"),
  "utf8"
);
const result = runPhpHarness();

check("PHP finalized Supplier Return replay harness completed", result, (value) => value.ok === true, "Harness failed.");
if (result.ok === true) {
  check(
    "ready Supplier Return commits exactly once",
    result,
    (value) =>
      value.cylinderFirst?.success === true &&
      value.cylinderFirst?.replayStatus === "committed" &&
      Number(value.cylinderAfterFirst?.saleCount) === 1 &&
      Number(value.cylinderAfterFirst?.saleItemCount) === 1 &&
      value.cylinderAfterFirst?.sale?.transactionType === "Supplier Return",
    "Ready Supplier Return did not commit one Supplier Return and one item."
  );
  check(
    "server item id drives Supplier Return stock decrease",
    result,
    (value) =>
      nearlyEqual(value.cylinderBefore?.itemStock, 10) &&
      nearlyEqual(value.cylinderAfterFirst?.itemStock, 7),
    "Mapped backend stock was not decreased."
  );
  check(
    "source batch decreases exactly",
    result,
    (value) =>
      Number(value.cylinderAfterFirst?.sourceBatch?.id) ===
        Number(value.cylinderFixture?.sourceBatchId) &&
      Number(value.cylinderAfterFirst?.sourceBatch?.itemId) ===
        Number(value.cylinderFixture?.itemId) &&
      nearlyEqual(value.cylinderBefore?.sourceBatch?.qtyPurchased, 10) &&
      nearlyEqual(value.cylinderBefore?.sourceBatch?.balance, 8) &&
      nearlyEqual(value.cylinderAfterFirst?.sourceBatch?.qtyPurchased, 7) &&
      nearlyEqual(value.cylinderAfterFirst?.sourceBatch?.qtySold, 0) &&
      nearlyEqual(value.cylinderAfterFirst?.sourceBatch?.balance, 5),
    "Supplier Return source batch reduction mismatch."
  );
  check(
    "supplier accounting and negative payment ledger mirror local Supplier Return outcome",
    result,
    (value) =>
      Number(value.cylinderAfterFirst?.supplier?.invoices) === 1 &&
      nearlyEqual(value.cylinderAfterFirst?.supplier?.payable, 350) &&
      nearlyEqual(value.cylinderAfterFirst?.supplier?.paid, -30) &&
      nearlyEqual(value.cylinderAfterFirst?.supplier?.balance, 380) &&
      Number(value.cylinderAfterFirst?.supplierPaymentCount) === 1 &&
      nearlyEqual(value.cylinderAfterFirst?.payment?.amount, -30) &&
      nearlyEqual(value.cylinderAfterFirst?.payment?.payableSnapshot, 350) &&
      nearlyEqual(value.cylinderAfterFirst?.payment?.balanceSnapshot, 380),
    "Supplier accounting or negative payment ledger mismatch."
  );
  check(
    "cylinder Supplier Return applies filledDecrease exactly",
    result,
    (value) =>
      nearlyEqual(value.cylinderAfterFirst?.cylinder?.filledCylinders, 3) &&
      nearlyEqual(value.cylinderAfterFirst?.cylinder?.emptyCylinders, 2) &&
      nearlyEqual(value.cylinderAfterFirst?.cylinder?.withCustomers, 1) &&
      nearlyEqual(value.cylinderAfterFirst?.cylinder?.qtyInStock, 6),
    "Cylinder Supplier Return did not decrease filled cylinders exactly."
  );
  check(
    "second Supplier Return replay is idempotent",
    result,
    (value) =>
      value.cylinderSecond?.success === true &&
      value.cylinderSecond?.terminalStateSkipped === true &&
      value.cylinderSecond?.alreadyCommitted === true &&
      JSON.stringify(value.cylinderAfterFirst) ===
        JSON.stringify(value.cylinderAfterSecond),
    "Second Supplier Return replay changed business state."
  );
  check(
    "unsafe Supplier Return is rejected without mutation",
    result,
    (value) =>
      value.unsafeReplay?.success === false &&
      value.unsafeReplay?.reason ===
        "invalid_finalized_supplier_return_contract" &&
      JSON.stringify(value.unsafeBefore) === JSON.stringify(value.unsafeAfter),
    "Unsafe Supplier Return replay changed state or was accepted."
  );
  check(
    "non-cylinder Supplier Return works without cylinder metadata",
    result,
    (value) =>
      value.nonCylinderReplay?.success === true &&
      Number(value.nonCylinderAfter?.saleCount) === 1 &&
      Number(value.nonCylinderAfter?.saleItemCount) === 1 &&
      Number(value.nonCylinderAfter?.supplierPaymentCount) === 0 &&
      nearlyEqual(value.nonCylinderBefore?.itemStock, 10) &&
      nearlyEqual(value.nonCylinderAfter?.itemStock, 8) &&
      nearlyEqual(value.nonCylinderBefore?.sourceBatch?.qtyPurchased, 10) &&
      nearlyEqual(value.nonCylinderAfter?.sourceBatch?.qtyPurchased, 8) &&
      Array.isArray(value.nonCylinderAfter?.cylinder) &&
      value.nonCylinderAfter.cylinder.length === 0,
    "Non-cylinder Supplier Return replay did not commit safely."
  );
  check(
    "local ids are not backend mutation targets",
    result,
    (value) =>
      Number(value.cylinderFixture?.itemId) !== 94018 &&
      Number(value.cylinderFixture?.supplierId) !== 94009 &&
      Number(value.cylinderFixture?.sourceBatchId) !== 94028 &&
      Number(value.cylinderFixture?.cylinderId) !== 94038 &&
      Number(value.cylinderAfterFirst?.saleItemOriginalId) ===
        Number(value.cylinderFixture?.itemId) &&
      Number(value.cylinderAfterFirst?.sale?.supplierId) ===
        Number(value.cylinderFixture?.supplierId) &&
      Number(value.cylinderAfterFirst?.sourceBatch?.id) ===
        Number(value.cylinderFixture?.sourceBatchId),
    "Fixture did not prove local/server id separation."
  );
  check(
    "actor attribution is recorded safely",
    result.auditRows,
    (rows) =>
      Array.isArray(rows) &&
      rows.some(
        (row) =>
          row.event_type === "finalized_supplier_return_v1_replay_completed"
      ) &&
      rows.some(
        (row) => row.actor_type === "replay_worker" && row.actor_role === "replay"
      ),
    "Audit attribution missing."
  );
}

check(
  "manual sync router stores then explicitly replays ready finalized Supplier Return",
  syncEngineSource,
  (source) =>
    source.includes('payload.payload?.returnMode === "supplier"') &&
    source.includes("assertReadyFinalizedSupplierReturnReplay(item.payload)") &&
    source.includes(
      "transactionApi.replayFinalizedSupplierReturn(item.payload.clientTransactionId)"
    ),
  "Frontend manual router does not call narrow Supplier Return replay endpoint."
);
check(
  "transaction API targets narrow Supplier Return replay endpoint",
  transactionApiSource,
  (source) =>
    source.includes(
      'apiClient.post("/replay/supplier-return.php", { clientTransactionId })'
    ),
  "Narrow Supplier Return endpoint is not wired."
);
check(
  "Supplier Return endpoint requires replay auth before execution",
  endpointSource,
  (source) =>
    source.includes("require_replay_request_auth($pdo)") &&
    source.includes("replayStoredFinalizedSupplierReturnV1Authorized"),
  "Supplier Return endpoint auth guard is missing."
);
check(
  "Sale replay endpoint remains wired to Sale adapter",
  saleEndpointSource,
  (source) =>
    source.includes("replayStoredFinalizedSaleV1Authorized") &&
    !source.includes("replayStoredFinalizedSupplierReturnV1Authorized"),
  "Sale endpoint was altered unexpectedly."
);
check(
  "Purchase replay endpoint remains wired to Purchase adapter",
  purchaseEndpointSource,
  (source) =>
    source.includes("replayStoredFinalizedPurchaseV1Authorized") &&
    !source.includes("replayStoredFinalizedSupplierReturnV1Authorized"),
  "Purchase endpoint was altered unexpectedly."
);
check(
  "Customer Return replay endpoint remains wired to Customer Return adapter",
  customerReturnEndpointSource,
  (source) =>
    source.includes("replayStoredFinalizedCustomerReturnV1Authorized") &&
    !source.includes("replayStoredFinalizedSupplierReturnV1Authorized"),
  "Customer Return endpoint was altered unexpectedly."
);

console.log(`Summary: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
