#!/usr/bin/env node

/* Dev-only transaction cylinder mutation replay tests. */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `transaction-cylinder-mutation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let passed = 0;
let failed = 0;

function findPhpBinary() {
  if (process.env.PHP_BIN) return process.env.PHP_BIN;
  const laragonPhpRoot = "C:\\laragon\\bin\\php";
  if (existsSync(laragonPhpRoot)) {
    const candidates = readdirSync(laragonPhpRoot).map((entry) => resolve(laragonPhpRoot, entry, "php.exe")).filter(existsSync).sort().reverse();
    if (candidates.length > 0) return candidates[0];
  }
  return "php";
}

function pass(name) { passed += 1; console.log(`PASS ${name}`); }
function fail(name, details, message) { failed += 1; console.error(`FAIL ${name}${message ? `: ${message}` : ""}`); if (details !== undefined) console.error(JSON.stringify(details, null, 2)); }
function check(name, details, predicate, message) { if (predicate(details)) { pass(name); return true; } fail(name, details, message); return false; }
function nearlyEqual(a, b) { return Math.abs(Number(a) - Number(b)) < 0.000001; }
function auditHas(rows, eventType) { return Array.isArray(rows) && rows.some((row) => row.event_type === eventType); }
async function request(file) { const r = await fetch(`${API_BASE_URL}/${file}.php`); const t = await r.text(); let body = null; try { body = t.trim() ? JSON.parse(t) : null; } catch { body = t; } return { status: r.status, body }; }

function phpTestCode() {
  return String.raw`
require_once getcwd() . '/api/config/database.php';
require_once getcwd() . '/api/lib/transactionReplayProcessor.php';
$pdo = get_pdo();
$runId = getenv('CYLINDER_MUTATION_TEST_RUN_ID') ?: ('transaction-cylinder-mutation-' . time());
$workerPrefix = $runId . '-worker';
ensure_cylinder_test_tables($pdo);
$cases = [];
$cases['non_cylinder_skips'] = run_cylinder_case($pdo, $workerPrefix, $runId, 'non-cylinder', ['type' => 'sale', 'headerType' => 'Sale', 'category' => 'General Goods', 'qty' => 20, 'convQty' => 10, 'stock' => 100, 'customer' => true, 'cylinder' => null]);
$cases['sale_assigns_to_customer'] = run_cylinder_case($pdo, $workerPrefix, $runId, 'sale', ['type' => 'sale', 'headerType' => 'Sale', 'category' => 'Gas Cylinder', 'qty' => 20, 'convQty' => 10, 'stock' => 100, 'customer' => true, 'cylinder' => ['filled' => 5, 'empty' => 1, 'with' => 0]]);
$cases['customer_return_reduces_holding'] = run_cylinder_case($pdo, $workerPrefix, $runId, 'customer-return', ['type' => 'return', 'returnMode' => 'customer', 'headerType' => 'Customer Return', 'category' => 'Gas Cylinder', 'qty' => 20, 'convQty' => 10, 'stock' => 100, 'customer' => true, 'cylinder' => ['filled' => 3, 'empty' => 1, 'with' => 2], 'holding' => 2]);
$cases['purchase_increases_filled_stock'] = run_cylinder_case($pdo, $workerPrefix, $runId, 'purchase', ['type' => 'purchase', 'headerType' => 'Purchase', 'category' => 'Gas Cylinder', 'qty' => 20, 'convQty' => 10, 'stock' => 100, 'supplier' => true, 'cylinder' => ['filled' => 1, 'empty' => 1, 'with' => 0]]);
$cases['supplier_return_decreases_filled_stock'] = run_cylinder_case($pdo, $workerPrefix, $runId, 'supplier-return', ['type' => 'return', 'returnMode' => 'supplier', 'headerType' => 'Supplier Return', 'category' => 'Gas Cylinder', 'qty' => 20, 'convQty' => 10, 'stock' => 100, 'supplier' => true, 'cylinder' => ['filled' => 3, 'empty' => 1, 'with' => 0]]);
$failures = [];
$failures['insufficient_holding'] = run_cylinder_failure_case($pdo, $workerPrefix, $runId, 'insufficient-holding', ['type' => 'return', 'returnMode' => 'customer', 'headerType' => 'Customer Return', 'qty' => 20, 'convQty' => 10, 'stock' => 100, 'customer' => true, 'cylinder' => ['filled' => 3, 'empty' => 1, 'with' => 2], 'holding' => 1]);
$failures['negative_filled'] = run_cylinder_failure_case($pdo, $workerPrefix, $runId, 'negative-filled', ['type' => 'sale', 'headerType' => 'Sale', 'qty' => 20, 'convQty' => 10, 'stock' => 100, 'customer' => true, 'cylinder' => ['filled' => 1, 'empty' => 1, 'with' => 0]]);
$duplicate = run_cylinder_duplicate_case($pdo, $workerPrefix, $runId);
echo json_encode(['ok' => true, 'cases' => $cases, 'failures' => $failures, 'duplicate' => $duplicate], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

function run_cylinder_case(PDO $pdo, string $workerPrefix, string $runId, string $name, array $c): array {
    $itemId = insert_item($pdo, "$runId-$name-item", (float) $c['stock'], $c['category'] ?? 'Gas Cylinder', (float) $c['convQty']);
    $customerId = !empty($c['customer']) ? insert_customer($pdo, "$runId-$name-customer") : null;
    $supplierId = !empty($c['supplier']) ? insert_supplier($pdo, "$runId-$name-supplier") : null;
    $cylinder = is_array($c['cylinder'] ?? null) ? insert_cylinder($pdo, $itemId, "$runId-$name-cylinder", $c['cylinder'], (float) $c['convQty']) : null;
    if ($cylinder && isset($c['holding'])) { insert_holding($pdo, $cylinder['id'], $cylinder['title'], "$runId-$name-customer", (float) $c['holding']); }
    $payload = make_payload($runId, $name, $c, $itemId, $customerId, $supplierId);
    $syncId = insert_txn($pdo, $payload);
    $before = snapshot($pdo, $itemId, $syncId, $customerId, $supplierId, $cylinder['id'] ?? null);
    $first = replayStoredTransaction($pdo, $syncId, "$workerPrefix-$name");
    $after = snapshot($pdo, $itemId, $syncId, $customerId, $supplierId, $cylinder['id'] ?? null);
    $second = replayStoredTransaction($pdo, $syncId, "$workerPrefix-$name-again");
    $afterSecond = snapshot($pdo, $itemId, $syncId, $customerId, $supplierId, $cylinder['id'] ?? null);
    return ['syncTransactionId' => $syncId, 'cylinderId' => $cylinder['id'] ?? null, 'firstResult' => $first, 'secondResult' => $second, 'row' => sync_row($pdo, $syncId), 'audit' => audit_rows($pdo, $syncId), 'before' => $before, 'after' => $after, 'afterSecond' => $afterSecond];
}
function run_cylinder_failure_case(PDO $pdo, string $workerPrefix, string $runId, string $name, array $c): array {
    $itemId = insert_item($pdo, "$runId-$name-item", (float) $c['stock'], 'Gas Cylinder', (float) $c['convQty']);
    $customerId = !empty($c['customer']) ? insert_customer($pdo, "$runId-$name-customer") : null;
    $supplierId = !empty($c['supplier']) ? insert_supplier($pdo, "$runId-$name-supplier") : null;
    $cylinder = insert_cylinder($pdo, $itemId, "$runId-$name-cylinder", $c['cylinder'], (float) $c['convQty']);
    if (isset($c['holding'])) { insert_holding($pdo, $cylinder['id'], $cylinder['title'], "$runId-$name-customer", (float) $c['holding']); }
    $payload = make_payload($runId, $name, $c, $itemId, $customerId, $supplierId);
    $syncId = insert_txn($pdo, $payload);
    $before = snapshot($pdo, $itemId, $syncId, $customerId, $supplierId, $cylinder['id']);
    $result = replayStoredTransaction($pdo, $syncId, "$workerPrefix-$name");
    $after = snapshot($pdo, $itemId, $syncId, $customerId, $supplierId, $cylinder['id']);
    return ['syncTransactionId' => $syncId, 'result' => $result, 'row' => sync_row($pdo, $syncId), 'audit' => audit_rows($pdo, $syncId), 'before' => $before, 'after' => $after];
}
function run_cylinder_duplicate_case(PDO $pdo, string $workerPrefix, string $runId): array {
    $case = run_cylinder_case($pdo, $workerPrefix, $runId, 'duplicate', ['type' => 'sale', 'headerType' => 'Sale', 'category' => 'Gas Cylinder', 'qty' => 20, 'convQty' => 10, 'stock' => 100, 'customer' => true, 'cylinder' => ['filled' => 5, 'empty' => 1, 'with' => 0]]);
    return $case;
}
function make_payload(string $runId, string $name, array $c, int $itemId, ?int $customerId, ?int $supplierId): array {
    $header = ['transactionType' => $c['headerType'], 'invoiceNo' => "$runId-$name-INVOICE", 'date' => '2026-05-22', 'subtotal' => 100, 'grandTotal' => 100, 'paid' => 25, 'arrears' => 75];
    if ($customerId !== null) { $header['customerId'] = $customerId; $header['customerName'] = "$runId-$name-customer"; }
    if ($supplierId !== null) { $header['supplierId'] = $supplierId; $header['supplierName'] = "$runId-$name-supplier"; }
    $item = ['itemId' => $itemId, 'originalItemId' => $itemId, 'name' => "$runId-$name-item", 'qty' => $c['qty'], 'price' => 5, 'costPrice' => 3, 'convQty' => $c['convQty']];
    $body = ['sale' => $header, 'saleItems' => [$item]];
    if ($customerId !== null) { $body['customerId'] = $customerId; }
    if ($supplierId !== null) { $body['supplierId'] = $supplierId; }
    if (isset($c['returnMode'])) { $body['returnMode'] = $c['returnMode']; }
    if ($c['type'] === 'purchase') { $body['purchase'] = $header; $body['items'] = [$item]; unset($body['sale'], $body['saleItems']); }
    return ['clientTransactionId' => "$runId-$name-client-transaction", 'transactionType' => $c['type'], 'createdAt' => '2026-05-22T00:00:00.000Z', 'payload' => $body];
}
function insert_txn(PDO $pdo, array $payload): int { $stmt = $pdo->prepare("INSERT INTO sync_transactions (client_transaction_id, transaction_type, payload_json, status, replay_status, replay_attempts) VALUES (:clientId, :type, :payload, 'stored', 'stored', 0)"); $stmt->execute(['clientId' => $payload['clientTransactionId'], 'type' => $payload['transactionType'], 'payload' => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]); return (int) $pdo->lastInsertId(); }
function insert_item(PDO $pdo, string $name, float $stock, string $category, float $convQty): int { $s = $pdo->prepare("INSERT INTO items (client_id, name, barcode, purchasePrice, retailPrice, discountPrice, wholesalePrice, availableStock, category, brand, minunit, maxunit, ConvQty) VALUES (:id, :name, :barcode, 1, 2, 0, 2, :stock, :category, 'Cylinder Test', 'kg', 'cylinder', :convQty)"); $s->execute(['id' => $name, 'name' => $name, 'barcode' => $name, 'stock' => $stock, 'category' => $category, 'convQty' => $convQty]); return (int) $pdo->lastInsertId(); }
function insert_customer(PDO $pdo, string $name): int { $s = $pdo->prepare("INSERT INTO customers (client_id, name, mobile, cnic, address, invoices, payable, paid, balance) VALUES (:id, :name, '03000000000', 'cylinder-test', 'cylinder customer', 1, 100, 20, 80)"); $s->execute(['id' => $name, 'name' => $name]); return (int) $pdo->lastInsertId(); }
function insert_supplier(PDO $pdo, string $name): int { $s = $pdo->prepare("INSERT INTO suppliers (client_id, name, mobile, cnic, address, invoices, payable, paid, balance) VALUES (:id, :name, '03111111111', 'cylinder-test', 'cylinder supplier', 2, 200, 50, 150)"); $s->execute(['id' => $name, 'name' => $name]); return (int) $pdo->lastInsertId(); }
function insert_cylinder(PDO $pdo, int $itemId, string $title, array $c, float $convQty): array { $qty = (float) $c['filled'] + (float) $c['empty'] + (float) $c['with']; $s = $pdo->prepare("INSERT INTO cylinders (itemId, title, qtyInStock, filledCylinders, emptyCylinders, withCustomers, convQty, isDeleted, deletedAt) VALUES (:itemId, :title, :qty, :filled, :empty, :withCustomers, :convQty, 0, NULL)"); $s->execute(['itemId' => $itemId, 'title' => $title, 'qty' => $qty, 'filled' => $c['filled'], 'empty' => $c['empty'], 'withCustomers' => $c['with'], 'convQty' => $convQty]); return ['id' => (int) $pdo->lastInsertId(), 'title' => $title]; }
function insert_holding(PDO $pdo, int $cylinderId, string $type, string $customerName, float $qty): int { $s = $pdo->prepare("INSERT INTO cylinder_customers (cylinderId, cylinderType, customerName, qtyHeld, isDeleted, deletedAt) VALUES (:cylinderId, :type, :name, :qty, 0, NULL)"); $s->execute(['cylinderId' => $cylinderId, 'type' => $type, 'name' => $customerName, 'qty' => $qty]); return (int) $pdo->lastInsertId(); }
function snapshot(PDO $pdo, int $itemId, int $syncId, ?int $customerId, ?int $supplierId, ?int $cylinderId): array { return ['stock' => stock($pdo, $itemId), 'sales' => sales_rows($pdo, $syncId), 'payments' => payment_rows_count($pdo, $syncId), 'batches' => transaction_batches($pdo, $syncId), 'customer' => $customerId ? party($pdo, 'customers', $customerId) : null, 'supplier' => $supplierId ? party($pdo, 'suppliers', $supplierId) : null, 'cylinder' => $cylinderId ? cylinder($pdo, $cylinderId) : null, 'holdings' => $cylinderId ? holdings($pdo, $cylinderId) : []]; }
function stock(PDO $pdo, int $id): float { $s = $pdo->prepare('SELECT availableStock FROM items WHERE id = :id'); $s->execute(['id' => $id]); return (float) ($s->fetch()['availableStock'] ?? 0); }
function cylinder(PDO $pdo, int $id): ?array { $s = $pdo->prepare('SELECT id, qtyInStock, filledCylinders, emptyCylinders, withCustomers FROM cylinders WHERE id = :id'); $s->execute(['id' => $id]); $r = $s->fetch(); return $r ? ['id' => (int) $r['id'], 'qtyInStock' => (float) $r['qtyInStock'], 'filledCylinders' => (float) $r['filledCylinders'], 'emptyCylinders' => (float) $r['emptyCylinders'], 'withCustomers' => (float) $r['withCustomers']] : null; }
function holdings(PDO $pdo, int $cylinderId): array { $s = $pdo->prepare('SELECT customerName, qtyHeld FROM cylinder_customers WHERE cylinderId = :id AND isDeleted = 0 ORDER BY id ASC'); $s->execute(['id' => $cylinderId]); return array_map(fn($r) => ['customerName' => $r['customerName'], 'qtyHeld' => (float) $r['qtyHeld']], $s->fetchAll()); }
function party(PDO $pdo, string $table, int $id): array { $s = $pdo->prepare("SELECT invoices, payable, paid, balance FROM $table WHERE id = :id"); $s->execute(['id' => $id]); $r = $s->fetch() ?: []; return ['invoices' => (int) ($r['invoices'] ?? 0), 'payable' => (float) ($r['payable'] ?? 0), 'paid' => (float) ($r['paid'] ?? 0), 'balance' => (float) ($r['balance'] ?? 0)]; }
function sales_rows(PDO $pdo, int $syncId): array { $s = $pdo->prepare('SELECT id FROM sales WHERE sync_transaction_id = :id'); $s->execute(['id' => $syncId]); $sales = $s->fetchAll(); $items = 0; foreach ($sales as $sale) { $q = $pdo->prepare('SELECT COUNT(*) AS c FROM sale_items WHERE sale_id = :id'); $q->execute(['id' => $sale['id']]); $items += (int) ($q->fetch()['c'] ?? 0); } return ['sales' => count($sales), 'sale_items' => $items]; }
function payment_rows_count(PDO $pdo, int $syncId): int { $count = 0; foreach (['customer_payments', 'supplier_payments'] as $table) { if (!table_exists($pdo, $table)) continue; $s = $pdo->prepare("SELECT COUNT(*) AS c FROM $table WHERE sync_transaction_id = :id"); $s->execute(['id' => $syncId]); $count += (int) ($s->fetch()['c'] ?? 0); } return $count; }
function transaction_batches(PDO $pdo, int $syncId): array { $s = $pdo->prepare('SELECT id, itemId, qtyPurchased, qtySold, balance FROM item_batches WHERE sync_transaction_id = :id ORDER BY id ASC'); $s->execute(['id' => $syncId]); return array_map(fn($r) => ['id' => (int) $r['id'], 'itemId' => (int) $r['itemId'], 'qtyPurchased' => (float) $r['qtyPurchased'], 'qtySold' => (float) $r['qtySold'], 'balance' => (float) $r['balance']], $s->fetchAll()); }
function sync_row(PDO $pdo, int $id): ?array { $s = $pdo->prepare('SELECT id, client_transaction_id, replay_status, replay_attempts, CASE WHEN replay_error IS NULL OR replay_error = "" THEN 0 ELSE 1 END AS has_replay_error, locked_at, locked_by FROM sync_transactions WHERE id = :id'); $s->execute(['id' => $id]); return $s->fetch() ?: null; }
function audit_rows(PDO $pdo, int $id): array { $s = $pdo->prepare('SELECT event_type, status_before, status_after, message FROM transaction_replay_audit WHERE sync_transaction_id = :id ORDER BY id ASC'); $s->execute(['id' => $id]); return $s->fetchAll(); }
function table_exists(PDO $pdo, string $table): bool { $s = $pdo->prepare('SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = :t'); $s->execute(['t' => $table]); return (int) ($s->fetch()['c'] ?? 0) > 0; }
function ensure_cylinder_test_tables(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS sales (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, sync_transaction_id BIGINT UNSIGNED NULL UNIQUE, client_transaction_id VARCHAR(150) NULL UNIQUE, invoiceNo VARCHAR(120) NOT NULL, date VARCHAR(50) NULL, transactionType VARCHAR(80) NOT NULL, customerId BIGINT UNSIGNED NULL, supplierId BIGINT UNSIGNED NULL, customerName VARCHAR(180) NULL, supplierName VARCHAR(180) NULL, subtotal DECIMAL(12,2) NOT NULL DEFAULT 0, discount DECIMAL(12,2) NOT NULL DEFAULT 0, tax DECIMAL(12,2) NOT NULL DEFAULT 0, dues DECIMAL(12,2) NOT NULL DEFAULT 0, grandTotal DECIMAL(12,2) NOT NULL DEFAULT 0, paid DECIMAL(12,2) NOT NULL DEFAULT 0, arrears DECIMAL(12,2) NOT NULL DEFAULT 0, profit DECIMAL(12,2) NOT NULL DEFAULT 0, isPostponed TINYINT(1) NOT NULL DEFAULT 0, sale_json LONGTEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS sale_items (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, sale_id BIGINT UNSIGNED NOT NULL, originalItemId BIGINT UNSIGNED NULL, name VARCHAR(180) NOT NULL, qty DECIMAL(12,2) NOT NULL DEFAULT 0, price DECIMAL(12,2) NOT NULL DEFAULT 0, priceCategory VARCHAR(80) NULL, discountType VARCHAR(50) NULL, discountValue DECIMAL(12,2) NOT NULL DEFAULT 0, taxType VARCHAR(50) NULL, taxValue DECIMAL(12,2) NOT NULL DEFAULT 0, item_json LONGTEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_sale_items_sale_id (sale_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS customer_payments (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, customerId BIGINT UNSIGNED NOT NULL, customerName VARCHAR(180) NULL, invoiceNo VARCHAR(120) NULL, amount DECIMAL(12,2) NOT NULL DEFAULT 0, paymentDate VARCHAR(50) NULL, remarks TEXT NULL, payableSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, balanceSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, sync_transaction_id BIGINT UNSIGNED NULL, client_transaction_id VARCHAR(150) NULL, sale_id BIGINT UNSIGNED NULL, source VARCHAR(80) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_customer_payments_customerId (customerId)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS supplier_payments (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, supplierId BIGINT UNSIGNED NOT NULL, supplierName VARCHAR(180) NULL, invoiceNo VARCHAR(120) NULL, amount DECIMAL(12,2) NOT NULL DEFAULT 0, paymentDate VARCHAR(50) NULL, remarks TEXT NULL, payableSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, balanceSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, sync_transaction_id BIGINT UNSIGNED NULL, client_transaction_id VARCHAR(150) NULL, sale_id BIGINT UNSIGNED NULL, source VARCHAR(80) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_supplier_payments_supplierId (supplierId)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS item_batches (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, itemId BIGINT UNSIGNED NOT NULL, purchaseDate VARCHAR(50) NOT NULL, qtyPurchased DECIMAL(12,2) NOT NULL DEFAULT 0, qtySold DECIMAL(12,2) NOT NULL DEFAULT 0, balance DECIMAL(12,2) NOT NULL DEFAULT 0, costPrice DECIMAL(12,2) NOT NULL DEFAULT 0, sourceSaleId BIGINT UNSIGNED NULL, invoiceNo VARCHAR(120) NULL, sync_transaction_id BIGINT UNSIGNED NULL, client_transaction_id VARCHAR(150) NULL, batch_json LONGTEXT NULL, isDeleted TINYINT(1) NOT NULL DEFAULT 0, deletedAt DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_item_batches_itemId (itemId)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS cylinders (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, itemId BIGINT UNSIGNED NOT NULL UNIQUE, title VARCHAR(180) NOT NULL, qtyInStock DECIMAL(12,2) NOT NULL DEFAULT 0, filledCylinders DECIMAL(12,2) NOT NULL DEFAULT 0, emptyCylinders DECIMAL(12,2) NOT NULL DEFAULT 0, withCustomers DECIMAL(12,2) NOT NULL DEFAULT 0, convQty DECIMAL(12,2) NOT NULL DEFAULT 1, isDeleted TINYINT(1) NOT NULL DEFAULT 0, deletedAt DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_cylinders_itemId (itemId)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS cylinder_customers (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, cylinderId BIGINT UNSIGNED NOT NULL, cylinderType VARCHAR(180) NOT NULL, customerName VARCHAR(180) NOT NULL, qtyHeld DECIMAL(12,2) NOT NULL DEFAULT 0, isDeleted TINYINT(1) NOT NULL DEFAULT 0, deletedAt DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_cylinder_customers_cylinderId (cylinderId), INDEX idx_cylinder_customers_customerName (customerName)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}
`;
}

function runPhpCylinderMutationTest() {
  const result = spawnSync(findPhpBinary(), ["-r", phpTestCode()], { cwd: projectRoot, encoding: "utf8", env: { ...process.env, CYLINDER_MUTATION_TEST_RUN_ID: runId }, windowsHide: true, maxBuffer: 1024 * 1024 * 100 });
  if (result.error) throw result.error;
  if (result.status !== 0) return { ok: false, status: result.status, stdout: result.stdout, stderr: result.stderr };
  try { return JSON.parse(result.stdout.trim()); } catch (error) { return { ok: false, parseError: String(error), stdout: result.stdout, stderr: result.stderr }; }
}

async function main() {
  console.log(`Testing transaction cylinder mutation against ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);
  const health = await request("health");
  check("backend health reachable", health, (value) => value.status === 200 && value.body?.success === true, "health.php did not return success");
  const result = runPhpCylinderMutationTest();
  check("php cylinder mutation harness completed", result, (value) => value.ok === true, "PHP harness failed");
  if (result.ok !== true) { console.log(`Summary: ${passed} passed, ${failed} failed`); process.exitCode = 1; return; }

  const nonCylinder = result.cases?.non_cylinder_skips;
  check("non-cylinder item skips cylinder mutation", nonCylinder, (v) => v.firstResult?.success === true && v.firstResult?.cylinderMutationsApplied === false && (v.firstResult?.cylinderMutationResult?.reason === "no_items" || v.firstResult?.cylinderMutationResult?.appliedCount === 0), "non-cylinder item did not skip safely");

  const sale = result.cases?.sale_assigns_to_customer;
  check("sale decreases filled and increases withCustomers", sale, (v) => nearlyEqual(v.after.cylinder.filledCylinders, 3) && nearlyEqual(v.after.cylinder.withCustomers, 2) && nearlyEqual(v.after.cylinder.qtyInStock, 6), "sale cylinder counts mismatch");
  check("sale creates customer holding", sale, (v) => v.after.holdings.length === 1 && nearlyEqual(v.after.holdings[0].qtyHeld, 2), "sale holding mismatch");

  const customerReturn = result.cases?.customer_return_reduces_holding;
  check("customer return decreases withCustomers and increases empty", customerReturn, (v) => nearlyEqual(v.after.cylinder.withCustomers, 0) && nearlyEqual(v.after.cylinder.emptyCylinders, 3) && nearlyEqual(v.after.cylinder.qtyInStock, 6), "customer return cylinder counts mismatch");
  check("customer return reduces customer holding", customerReturn, (v) => v.after.holdings.length === 1 && nearlyEqual(v.after.holdings[0].qtyHeld, 0), "customer return holding mismatch");

  const purchase = result.cases?.purchase_increases_filled_stock;
  check("purchase increases filled and stock", purchase, (v) => nearlyEqual(v.after.cylinder.filledCylinders, 3) && nearlyEqual(v.after.cylinder.qtyInStock, 4), "purchase cylinder counts mismatch");

  const supplierReturn = result.cases?.supplier_return_decreases_filled_stock;
  check("supplier return decreases filled and stock", supplierReturn, (v) => nearlyEqual(v.after.cylinder.filledCylinders, 1) && nearlyEqual(v.after.cylinder.qtyInStock, 2), "supplier return cylinder counts mismatch");

  for (const [name, caseResult] of Object.entries(result.cases || {})) {
    check(`${name}: replay committed`, caseResult, (v) => v.firstResult?.success === true && v.row?.replay_status === "committed", "replay did not commit");
    check(`${name}: duplicate replay skipped`, caseResult, (v) => v.secondResult?.terminalStateSkipped === true && Number(v.row?.replay_attempts) === 1, "duplicate was not terminal-skipped");
    check(`${name}: invariant preserved`, caseResult, (v) => !v.after.cylinder || nearlyEqual(v.after.cylinder.qtyInStock, v.after.cylinder.filledCylinders + v.after.cylinder.emptyCylinders + v.after.cylinder.withCustomers), "cylinder invariant failed");
    check(`${name}: cylinder audit completed or skipped`, caseResult, (v) => v.firstResult?.cylinderMutationsApplied === false || auditHas(v.audit, "replay_cylinder_mutation_completed"), "missing cylinder completion audit");
  }

  for (const [name, failureCase] of Object.entries(result.failures || {})) {
    check(`${name}: cylinder failure is safe`, failureCase, (v) => v.result?.success === false && v.result?.reason === "cylinder_mutation_failed" && v.row?.replay_status === "failed", "failure did not report cylinder mutation failure");
    check(`${name}: rollback restores stock`, failureCase, (v) => nearlyEqual(v.before.stock, v.after.stock), "stock not rolled back");
    check(`${name}: rollback removes sales`, failureCase, (v) => v.after.sales.sales === 0 && v.after.sales.sale_items === 0, "sales not rolled back");
    check(`${name}: rollback removes payments`, failureCase, (v) => v.after.payments === 0, "payments not rolled back");
    check(`${name}: rollback restores batch rows`, failureCase, (v) => JSON.stringify(v.before.batches) === JSON.stringify(v.after.batches), "batches not rolled back");
    check(`${name}: rollback restores cylinder`, failureCase, (v) => JSON.stringify(v.before.cylinder) === JSON.stringify(v.after.cylinder), "cylinder not rolled back");
    check(`${name}: rollback restores holdings`, failureCase, (v) => JSON.stringify(v.before.holdings) === JSON.stringify(v.after.holdings), "holdings not rolled back");
    check(`${name}: failure audit exists`, failureCase, (v) => auditHas(v.audit, "replay_cylinder_mutation_failed"), "missing cylinder failure audit");
  }

  const duplicate = result.duplicate;
  check("duplicate replay does not mutate cylinders twice", duplicate, (v) => JSON.stringify(v.after.cylinder) === JSON.stringify(v.afterSecond.cylinder) && JSON.stringify(v.after.holdings) === JSON.stringify(v.afterSecond.holdings), "duplicate replay mutated cylinder state");

  console.log(`Summary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  fail("test runner crashed", undefined, error?.stack || String(error));
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  process.exitCode = 1;
});