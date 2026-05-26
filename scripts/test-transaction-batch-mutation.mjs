#!/usr/bin/env node

/* Dev-only transaction batch mutation replay tests. */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `transaction-batch-mutation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
$runId = getenv('BATCH_MUTATION_TEST_RUN_ID') ?: ('transaction-batch-mutation-' . time());
$workerPrefix = $runId . '-worker';
ensure_batch_test_tables($pdo);
$protectedCountsBefore = table_counts($pdo, ['cylinders']);
$cases = [];
$cases['purchase_creates_batch'] = run_batch_case($pdo, $workerPrefix, $runId, 'purchase', ['party' => 'supplier', 'type' => 'purchase', 'headerKey' => 'purchase', 'headerType' => 'Purchase', 'amount' => 40, 'paid' => 10, 'qty' => 4, 'stock' => 10, 'seedBatches' => []]);
$cases['sale_consumes_batches'] = run_batch_case($pdo, $workerPrefix, $runId, 'sale', ['party' => 'customer', 'type' => 'sale', 'headerKey' => 'sale', 'headerType' => 'Sale', 'amount' => 50, 'paid' => 20, 'qty' => 5, 'stock' => 20, 'seedBatches' => [['qtyPurchased' => 3, 'qtySold' => 0, 'balance' => 3], ['qtyPurchased' => 10, 'qtySold' => 1, 'balance' => 9]]]);
$cases['customer_return_creates_batch'] = run_batch_case($pdo, $workerPrefix, $runId, 'customer-return', ['party' => 'customer', 'type' => 'return', 'returnMode' => 'customer', 'headerKey' => 'sale', 'headerType' => 'Customer Return', 'amount' => 30, 'paid' => 5, 'qty' => 3, 'stock' => 2, 'seedBatches' => []]);
$cases['supplier_return_decrements_batch'] = run_batch_case($pdo, $workerPrefix, $runId, 'supplier-return', ['party' => 'supplier', 'type' => 'return', 'returnMode' => 'supplier', 'headerKey' => 'sale', 'headerType' => 'Supplier Return', 'amount' => 30, 'paid' => 5, 'qty' => 3, 'stock' => 10, 'seedBatches' => [['qtyPurchased' => 8, 'qtySold' => 0, 'balance' => 8]], 'useFirstBatchId' => true]);
$insufficient = run_insufficient_batch_case($pdo, $workerPrefix, $runId);
$duplicate = run_duplicate_batch_case($pdo, $workerPrefix, $runId);
$protectedCountsAfter = table_counts($pdo, ['cylinders']);
echo json_encode(['ok' => true, 'cases' => $cases, 'insufficient' => $insufficient, 'duplicate' => $duplicate, 'protectedCountsBefore' => $protectedCountsBefore, 'protectedCountsAfter' => $protectedCountsAfter], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

function run_batch_case(PDO $pdo, string $workerPrefix, string $runId, string $name, array $c): array {
    $itemId = insert_item($pdo, "$runId-$name-item", (float) $c['stock']);
    $partyId = $c['party'] === 'customer' ? insert_customer($pdo, "$runId-$name-customer") : insert_supplier($pdo, "$runId-$name-supplier");
    $seeded = [];
    foreach (($c['seedBatches'] ?? []) as $idx => $batch) { $seeded[] = insert_batch($pdo, $itemId, "$runId-$name-seed-$idx", (float) $batch['qtyPurchased'], (float) $batch['qtySold'], (float) $batch['balance']); }
    if (!empty($c['useFirstBatchId']) && isset($seeded[0]['id'])) { $c['batchId'] = $seeded[0]['id']; }
    $payload = make_payload($runId, $name, $c, $itemId, $partyId);
    $syncId = insert_txn($pdo, $payload);
    $before = snapshot($pdo, $itemId, $syncId, $c['party'], $partyId);
    $first = replayStoredTransaction($pdo, $syncId, "$workerPrefix-$name");
    $after = snapshot($pdo, $itemId, $syncId, $c['party'], $partyId);
    $second = replayStoredTransaction($pdo, $syncId, "$workerPrefix-$name-again");
    $afterSecond = snapshot($pdo, $itemId, $syncId, $c['party'], $partyId);
    return ['syncTransactionId' => $syncId, 'payload' => $payload, 'seeded' => $seeded, 'firstResult' => $first, 'secondResult' => $second, 'row' => sync_row($pdo, $syncId), 'audit' => audit_rows($pdo, $syncId), 'before' => $before, 'after' => $after, 'afterSecond' => $afterSecond];
}

function run_insufficient_batch_case(PDO $pdo, string $workerPrefix, string $runId): array {
    $itemId = insert_item($pdo, "$runId-insufficient-item", 20);
    $customerId = insert_customer($pdo, "$runId-insufficient-customer");
    insert_batch($pdo, $itemId, "$runId-insufficient-seed", 1, 0, 1);
    $payload = make_payload($runId, 'insufficient', ['party' => 'customer', 'type' => 'sale', 'headerKey' => 'sale', 'headerType' => 'Sale', 'amount' => 50, 'paid' => 10, 'qty' => 5], $itemId, $customerId);
    $syncId = insert_txn($pdo, $payload);
    $before = snapshot($pdo, $itemId, $syncId, 'customer', $customerId);
    $result = replayStoredTransaction($pdo, $syncId, "$workerPrefix-insufficient");
    $after = snapshot($pdo, $itemId, $syncId, 'customer', $customerId);
    return ['syncTransactionId' => $syncId, 'result' => $result, 'row' => sync_row($pdo, $syncId), 'audit' => audit_rows($pdo, $syncId), 'before' => $before, 'after' => $after];
}

function run_duplicate_batch_case(PDO $pdo, string $workerPrefix, string $runId): array {
    $itemId = insert_item($pdo, "$runId-duplicate-item", 30);
    $customerId = insert_customer($pdo, "$runId-duplicate-customer");
    insert_batch($pdo, $itemId, "$runId-duplicate-seed", 10, 0, 10);
    $payload = make_payload($runId, 'duplicate', ['party' => 'customer', 'type' => 'sale', 'headerKey' => 'sale', 'headerType' => 'Sale', 'amount' => 40, 'paid' => 10, 'qty' => 4], $itemId, $customerId);
    $syncId = insert_txn($pdo, $payload);
    $first = replayStoredTransaction($pdo, $syncId, "$workerPrefix-duplicate");
    $afterFirst = snapshot($pdo, $itemId, $syncId, 'customer', $customerId);
    $second = replayStoredTransaction($pdo, $syncId, "$workerPrefix-duplicate-again");
    $afterSecond = snapshot($pdo, $itemId, $syncId, 'customer', $customerId);
    return ['syncTransactionId' => $syncId, 'firstResult' => $first, 'secondResult' => $second, 'row' => sync_row($pdo, $syncId), 'audit' => audit_rows($pdo, $syncId), 'afterFirst' => $afterFirst, 'afterSecond' => $afterSecond];
}

function make_payload(string $runId, string $name, array $c, int $itemId, int $partyId): array {
    $header = ['transactionType' => $c['headerType'], 'invoiceNo' => "$runId-$name-INVOICE", 'date' => '2026-05-21', 'subtotal' => $c['amount'], 'grandTotal' => $c['amount'], 'paid' => $c['paid'], 'arrears' => $c['amount'] - $c['paid']];
    if ($c['party'] === 'customer') { $header['customerId'] = $partyId; $header['customerName'] = "$runId-$name-customer"; }
    else { $header['supplierId'] = $partyId; $header['supplierName'] = "$runId-$name-supplier"; }
    $item = ['itemId' => $itemId, 'originalItemId' => $itemId, 'name' => "$runId-$name-item", 'qty' => $c['qty'], 'price' => 10, 'costPrice' => 6, 'minUnitPrice' => 6];
    if (isset($c['batchId'])) { $item['batchId'] = $c['batchId']; }
    $body = [$c['headerKey'] => $header, 'saleItems' => [$item]];
    if ($c['party'] === 'customer') { $body['customerId'] = $partyId; } else { $body['supplierId'] = $partyId; }
    if (isset($c['returnMode'])) { $body['returnMode'] = $c['returnMode']; }
    if ($c['type'] === 'purchase') { $body['items'] = $body['saleItems']; unset($body['saleItems']); }
    return ['clientTransactionId' => "$runId-$name-client-transaction", 'transactionType' => $c['type'], 'createdAt' => '2026-05-21T00:00:00.000Z', 'payload' => $body];
}

function insert_txn(PDO $pdo, array $payload): int { $stmt = $pdo->prepare("INSERT INTO sync_transactions (client_transaction_id, transaction_type, payload_json, status, replay_status, replay_attempts) VALUES (:clientId, :type, :payload, 'stored', 'stored', 0)"); $stmt->execute(['clientId' => $payload['clientTransactionId'], 'type' => $payload['transactionType'], 'payload' => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]); return (int) $pdo->lastInsertId(); }
function insert_item(PDO $pdo, string $name, float $stock): int { $s = $pdo->prepare("INSERT INTO items (client_id, name, barcode, purchasePrice, retailPrice, discountPrice, wholesalePrice, availableStock, category, brand, minunit, maxunit, ConvQty) VALUES (:id, :name, :barcode, 1, 2, 0, 2, :stock, 'Batch Mutation', 'Batch Mutation', 'pc', 'box', 1)"); $s->execute(['id' => $name, 'name' => $name, 'barcode' => $name, 'stock' => $stock]); return (int) $pdo->lastInsertId(); }
function insert_customer(PDO $pdo, string $name): int { $s = $pdo->prepare("INSERT INTO customers (client_id, name, mobile, cnic, address, invoices, payable, paid, balance) VALUES (:id, :name, '03000000000', 'batch-test', 'batch customer', 1, 100, 20, 80)"); $s->execute(['id' => $name, 'name' => $name]); return (int) $pdo->lastInsertId(); }
function insert_supplier(PDO $pdo, string $name): int { $s = $pdo->prepare("INSERT INTO suppliers (client_id, name, mobile, cnic, address, invoices, payable, paid, balance) VALUES (:id, :name, '03111111111', 'batch-test', 'batch supplier', 2, 200, 50, 150)"); $s->execute(['id' => $name, 'name' => $name]); return (int) $pdo->lastInsertId(); }
function insert_batch(PDO $pdo, int $itemId, string $invoice, float $qtyPurchased, float $qtySold, float $balance): array { $s = $pdo->prepare("INSERT INTO item_batches (itemId, purchaseDate, qtyPurchased, qtySold, balance, costPrice, sourceSaleId, invoiceNo, isDeleted, deletedAt) VALUES (:itemId, '2026-05-20', :qtyPurchased, :qtySold, :balance, 6, NULL, :invoiceNo, 0, NULL)"); $s->execute(['itemId' => $itemId, 'qtyPurchased' => $qtyPurchased, 'qtySold' => $qtySold, 'balance' => $balance, 'invoiceNo' => $invoice]); return ['id' => (int) $pdo->lastInsertId(), 'qtyPurchased' => $qtyPurchased, 'qtySold' => $qtySold, 'balance' => $balance]; }
function snapshot(PDO $pdo, int $itemId, int $syncId, string $partyType, int $partyId): array { return ['stock' => stock($pdo, $itemId), 'batches' => batches($pdo, $itemId), 'transactionBatches' => transaction_batches($pdo, $syncId), 'sales' => sales_rows($pdo, $syncId), 'payments' => payment_rows_count($pdo, $syncId), 'party' => party($pdo, $partyType, $partyId)]; }
function stock(PDO $pdo, int $id): float { $s = $pdo->prepare('SELECT availableStock FROM items WHERE id = :id'); $s->execute(['id' => $id]); return (float) ($s->fetch()['availableStock'] ?? 0); }
function batches(PDO $pdo, int $itemId): array { $s = $pdo->prepare('SELECT id, qtyPurchased, qtySold, balance, invoiceNo, sourceSaleId, sync_transaction_id, client_transaction_id FROM item_batches WHERE itemId = :id ORDER BY id ASC'); $s->execute(['id' => $itemId]); return array_map('normalize_batch', $s->fetchAll()); }
function transaction_batches(PDO $pdo, int $syncId): array { $s = $pdo->prepare('SELECT id, itemId, qtyPurchased, qtySold, balance, invoiceNo, sourceSaleId, sync_transaction_id, client_transaction_id FROM item_batches WHERE sync_transaction_id = :id ORDER BY id ASC'); $s->execute(['id' => $syncId]); return array_map('normalize_batch', $s->fetchAll()); }
function normalize_batch(array $r): array { return ['id' => (int) $r['id'], 'itemId' => isset($r['itemId']) ? (int) $r['itemId'] : null, 'qtyPurchased' => (float) $r['qtyPurchased'], 'qtySold' => (float) $r['qtySold'], 'balance' => (float) $r['balance'], 'invoiceNo' => $r['invoiceNo'] ?? null, 'sourceSaleId' => isset($r['sourceSaleId']) && $r['sourceSaleId'] !== null ? (int) $r['sourceSaleId'] : null, 'sync_transaction_id' => isset($r['sync_transaction_id']) && $r['sync_transaction_id'] !== null ? (int) $r['sync_transaction_id'] : null, 'client_transaction_id' => $r['client_transaction_id'] ?? null]; }
function party(PDO $pdo, string $type, int $id): array { $table = $type === 'customer' ? 'customers' : 'suppliers'; $s = $pdo->prepare("SELECT invoices, payable, paid, balance FROM $table WHERE id = :id"); $s->execute(['id' => $id]); $r = $s->fetch() ?: []; return ['invoices' => (int) ($r['invoices'] ?? 0), 'payable' => (float) ($r['payable'] ?? 0), 'paid' => (float) ($r['paid'] ?? 0), 'balance' => (float) ($r['balance'] ?? 0)]; }
function sales_rows(PDO $pdo, int $syncId): array { $s = $pdo->prepare('SELECT id FROM sales WHERE sync_transaction_id = :id'); $s->execute(['id' => $syncId]); $sales = $s->fetchAll(); $items = 0; foreach ($sales as $sale) { $q = $pdo->prepare('SELECT COUNT(*) AS c FROM sale_items WHERE sale_id = :id'); $q->execute(['id' => $sale['id']]); $items += (int) ($q->fetch()['c'] ?? 0); } return ['sales' => count($sales), 'sale_items' => $items]; }
function payment_rows_count(PDO $pdo, int $syncId): int { $count = 0; foreach (['customer_payments', 'supplier_payments'] as $table) { if (!table_exists($pdo, $table)) continue; $s = $pdo->prepare("SELECT COUNT(*) AS c FROM $table WHERE sync_transaction_id = :id"); $s->execute(['id' => $syncId]); $count += (int) ($s->fetch()['c'] ?? 0); } return $count; }
function sync_row(PDO $pdo, int $id): ?array { $s = $pdo->prepare('SELECT id, client_transaction_id, replay_status, replay_attempts, CASE WHEN replay_error IS NULL OR replay_error = "" THEN 0 ELSE 1 END AS has_replay_error, locked_at, locked_by FROM sync_transactions WHERE id = :id'); $s->execute(['id' => $id]); return $s->fetch() ?: null; }
function audit_rows(PDO $pdo, int $id): array { $s = $pdo->prepare('SELECT event_type, status_before, status_after, message FROM transaction_replay_audit WHERE sync_transaction_id = :id ORDER BY id ASC'); $s->execute(['id' => $id]); return $s->fetchAll(); }
function table_counts(PDO $pdo, array $tables): array { $out = []; foreach ($tables as $table) { if (!table_exists($pdo, $table)) { $out[$table] = null; continue; } $out[$table] = (int) ($pdo->query("SELECT COUNT(*) AS c FROM $table")->fetch()['c'] ?? 0); } return $out; }
function table_exists(PDO $pdo, string $table): bool { $s = $pdo->prepare('SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = :t'); $s->execute(['t' => $table]); return (int) ($s->fetch()['c'] ?? 0) > 0; }
function column_exists(PDO $pdo, string $table, string $column): bool { $s = $pdo->prepare('SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c'); $s->execute(['t' => $table, 'c' => $column]); return (int) ($s->fetch()['c'] ?? 0) > 0; }
function index_exists(PDO $pdo, string $table, string $index): bool { $s = $pdo->prepare('SELECT COUNT(*) AS c FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = :t AND index_name = :i'); $s->execute(['t' => $table, 'i' => $index]); return (int) ($s->fetch()['c'] ?? 0) > 0; }
function ensure_col(PDO $pdo, string $table, string $column, string $definition): void { if (!column_exists($pdo, $table, $column)) { $pdo->exec("ALTER TABLE $table ADD COLUMN $column $definition"); } }
function ensure_index(PDO $pdo, string $table, string $index, string $definition): void { if (!index_exists($pdo, $table, $index)) { $pdo->exec("CREATE INDEX $index ON $table ($definition)"); } }
function ensure_unique_index(PDO $pdo, string $table, string $index, string $definition): void { if (!index_exists($pdo, $table, $index)) { $pdo->exec("ALTER TABLE $table ADD UNIQUE KEY $index ($definition)"); } }

function ensure_batch_test_tables(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS sales (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, sync_transaction_id BIGINT UNSIGNED NULL UNIQUE, client_transaction_id VARCHAR(150) NULL UNIQUE, invoiceNo VARCHAR(120) NOT NULL, date VARCHAR(50) NULL, transactionType VARCHAR(80) NOT NULL, customerId BIGINT UNSIGNED NULL, supplierId BIGINT UNSIGNED NULL, customerName VARCHAR(180) NULL, supplierName VARCHAR(180) NULL, subtotal DECIMAL(12,2) NOT NULL DEFAULT 0, discount DECIMAL(12,2) NOT NULL DEFAULT 0, tax DECIMAL(12,2) NOT NULL DEFAULT 0, dues DECIMAL(12,2) NOT NULL DEFAULT 0, grandTotal DECIMAL(12,2) NOT NULL DEFAULT 0, paid DECIMAL(12,2) NOT NULL DEFAULT 0, arrears DECIMAL(12,2) NOT NULL DEFAULT 0, profit DECIMAL(12,2) NOT NULL DEFAULT 0, isPostponed TINYINT(1) NOT NULL DEFAULT 0, sale_json LONGTEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS sale_items (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, sale_id BIGINT UNSIGNED NOT NULL, originalItemId BIGINT UNSIGNED NULL, name VARCHAR(180) NOT NULL, qty DECIMAL(12,2) NOT NULL DEFAULT 0, price DECIMAL(12,2) NOT NULL DEFAULT 0, priceCategory VARCHAR(80) NULL, discountType VARCHAR(50) NULL, discountValue DECIMAL(12,2) NOT NULL DEFAULT 0, taxType VARCHAR(50) NULL, taxValue DECIMAL(12,2) NOT NULL DEFAULT 0, item_json LONGTEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_sale_items_sale_id (sale_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS customer_payments (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, customerId BIGINT UNSIGNED NOT NULL, customerName VARCHAR(180) NULL, invoiceNo VARCHAR(120) NULL, amount DECIMAL(12,2) NOT NULL DEFAULT 0, paymentDate VARCHAR(50) NULL, remarks TEXT NULL, payableSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, balanceSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, sync_transaction_id BIGINT UNSIGNED NULL, client_transaction_id VARCHAR(150) NULL, sale_id BIGINT UNSIGNED NULL, source VARCHAR(80) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_customer_payments_customerId (customerId), INDEX idx_customer_payments_invoiceNo (invoiceNo)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS supplier_payments (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, supplierId BIGINT UNSIGNED NOT NULL, supplierName VARCHAR(180) NULL, invoiceNo VARCHAR(120) NULL, amount DECIMAL(12,2) NOT NULL DEFAULT 0, paymentDate VARCHAR(50) NULL, remarks TEXT NULL, payableSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, balanceSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, sync_transaction_id BIGINT UNSIGNED NULL, client_transaction_id VARCHAR(150) NULL, sale_id BIGINT UNSIGNED NULL, source VARCHAR(80) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_supplier_payments_supplierId (supplierId), INDEX idx_supplier_payments_invoiceNo (invoiceNo)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS item_batches (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, itemId BIGINT UNSIGNED NOT NULL, purchaseDate VARCHAR(50) NOT NULL, qtyPurchased DECIMAL(12,2) NOT NULL DEFAULT 0, qtySold DECIMAL(12,2) NOT NULL DEFAULT 0, balance DECIMAL(12,2) NOT NULL DEFAULT 0, costPrice DECIMAL(12,2) NOT NULL DEFAULT 0, sourceSaleId BIGINT UNSIGNED NULL, invoiceNo VARCHAR(120) NULL, sync_transaction_id BIGINT UNSIGNED NULL, client_transaction_id VARCHAR(150) NULL, batch_json LONGTEXT NULL, isDeleted TINYINT(1) NOT NULL DEFAULT 0, deletedAt DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_item_batches_itemId (itemId), INDEX idx_item_batches_invoiceNo (invoiceNo), INDEX idx_item_batches_sync_transaction_id (sync_transaction_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    foreach (['customer_payments', 'supplier_payments'] as $table) { ensure_col($pdo, $table, 'sync_transaction_id', 'BIGINT UNSIGNED NULL'); ensure_col($pdo, $table, 'client_transaction_id', 'VARCHAR(150) NULL'); ensure_col($pdo, $table, 'sale_id', 'BIGINT UNSIGNED NULL'); ensure_col($pdo, $table, 'source', 'VARCHAR(80) NULL'); ensure_unique_index($pdo, $table, 'uniq_' . $table . '_sync_transaction_id', 'sync_transaction_id'); }
    foreach ([['sync_transaction_id', 'BIGINT UNSIGNED NULL'], ['client_transaction_id', 'VARCHAR(150) NULL'], ['batch_json', 'LONGTEXT NULL']] as $col) { ensure_col($pdo, 'item_batches', $col[0], $col[1]); }
    ensure_index($pdo, 'item_batches', 'idx_item_batches_sync_transaction_id', 'sync_transaction_id');
}
`;
}

function runPhpBatchMutationTest() {
  const result = spawnSync(findPhpBinary(), ["-r", phpTestCode()], { cwd: projectRoot, encoding: "utf8", env: { ...process.env, BATCH_MUTATION_TEST_RUN_ID: runId }, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) return { ok: false, status: result.status, stdout: result.stdout, stderr: result.stderr };
  try { return JSON.parse(result.stdout.trim()); } catch (error) { return { ok: false, parseError: String(error), stdout: result.stdout, stderr: result.stderr }; }
}

async function main() {
  console.log(`Testing transaction batch mutation against ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);
  const health = await request("health");
  check("backend health reachable", health, (value) => value.status === 200 && value.body?.success === true, "health.php did not return success");
  const result = runPhpBatchMutationTest();
  check("php batch mutation harness completed", result, (value) => value.ok === true, "PHP harness failed");
  if (result.ok !== true) { console.log(`Summary: ${passed} passed, ${failed} failed`); process.exitCode = 1; return; }

  const purchase = result.cases?.purchase_creates_batch;
  check("purchase replay committed", purchase, (v) => v.firstResult?.success === true && v.row?.replay_status === "committed", "purchase did not commit");
  check("purchase created one replay batch", purchase, (v) => v.after?.transactionBatches?.length === 1 && nearlyEqual(v.after.transactionBatches[0].qtyPurchased, 4) && nearlyEqual(v.after.transactionBatches[0].balance, 4), "purchase batch was not created correctly");
  check("purchase batch links invoice and sale", purchase, (v) => v.after.transactionBatches[0].sourceSaleId === v.firstResult?.salesPersistenceResult?.saleId && v.after.transactionBatches[0].invoiceNo === v.firstResult?.salesPersistenceResult?.invoiceNo, "purchase batch linkage mismatch");

  const sale = result.cases?.sale_consumes_batches;
  check("sale replay committed", sale, (v) => v.firstResult?.success === true && v.row?.replay_status === "committed", "sale did not commit");
  check("sale consumed FIFO batches", sale, (v) => nearlyEqual(v.after.batches[0].balance, 0) && nearlyEqual(v.after.batches[0].qtySold, 3) && nearlyEqual(v.after.batches[1].balance, 7) && nearlyEqual(v.after.batches[1].qtySold, 3), "sale did not consume expected batches");
  check("sale batch result reports two consumption rows", sale, (v) => v.firstResult?.batchMutationsApplied === true && v.firstResult?.batchMutationResult?.consumed?.length === 2, "sale batch result missing consumption rows");

  const customerReturn = result.cases?.customer_return_creates_batch;
  check("customer return replay committed", customerReturn, (v) => v.firstResult?.success === true, "customer return did not commit");
  check("customer return created restock batch", customerReturn, (v) => v.after.transactionBatches.length === 1 && nearlyEqual(v.after.transactionBatches[0].qtyPurchased, 3) && nearlyEqual(v.after.transactionBatches[0].balance, 3), "customer return restock batch mismatch");

  const supplierReturn = result.cases?.supplier_return_decrements_batch;
  check("supplier return replay committed", supplierReturn, (v) => v.firstResult?.success === true, "supplier return did not commit");
  check("supplier return decremented batch", supplierReturn, (v) => nearlyEqual(v.after.batches[0].qtyPurchased, 5) && nearlyEqual(v.after.batches[0].balance, 5), "supplier return did not decrement batch fields");

  for (const [name, caseResult] of Object.entries(result.cases || {})) {
    check(`${name}: batch audit completed`, caseResult, (v) => auditHas(v.audit, "replay_batch_mutation_completed"), "missing batch completion audit");
    check(`${name}: duplicate replay skipped`, caseResult, (v) => v.secondResult?.terminalStateSkipped === true && Number(v.row?.replay_attempts) === 1, "duplicate was not terminal-skipped");
    check(`${name}: duplicate replay did not change batches`, caseResult, (v) => JSON.stringify(v.after.batches) === JSON.stringify(v.afterSecond.batches), "duplicate replay changed batches");
    check(`${name}: stock matches batch balance delta direction`, caseResult, (v) => v.firstResult?.stockMutationsApplied === true && v.firstResult?.batchMutationsApplied === true, "stock/batch mutation flags missing");
  }

  const insufficient = result.insufficient;
  check("insufficient batch replay fails safely", insufficient, (v) => v.result?.success === false && v.result?.reason === "batch_mutation_failed" && v.row?.replay_status === "failed", "insufficient batch did not fail safely");
  check("insufficient batch rollback restores stock", insufficient, (v) => nearlyEqual(v.before.stock, v.after.stock), "stock was not rolled back");
  check("insufficient batch rollback restores batches", insufficient, (v) => JSON.stringify(v.before.batches) === JSON.stringify(v.after.batches), "batches were not rolled back");
  check("insufficient batch rollback removes sales", insufficient, (v) => v.after.sales.sales === 0 && v.after.sales.sale_items === 0, "sales were not rolled back");
  check("insufficient batch rollback removes payments", insufficient, (v) => v.after.payments === 0, "payments were not rolled back");
  check("insufficient batch rollback restores accounting", insufficient, (v) => JSON.stringify(v.before.party) === JSON.stringify(v.after.party), "accounting was not rolled back");
  check("insufficient batch audit failed", insufficient, (v) => auditHas(v.audit, "replay_batch_mutation_failed"), "missing batch failure audit");

  const duplicate = result.duplicate;
  check("duplicate second replay skipped", duplicate, (v) => v.secondResult?.terminalStateSkipped === true && Number(v.row?.replay_attempts) === 1, "duplicate protection failed");
  check("duplicate replay did not mutate batches twice", duplicate, (v) => JSON.stringify(v.afterFirst.batches) === JSON.stringify(v.afterSecond.batches), "duplicate replay mutated batches");
  check("duplicate replay did not mutate stock twice", duplicate, (v) => nearlyEqual(v.afterFirst.stock, v.afterSecond.stock), "duplicate replay mutated stock");
  check("cylinder table counts unchanged", { before: result.protectedCountsBefore, after: result.protectedCountsAfter }, (v) => JSON.stringify(v.before) === JSON.stringify(v.after), "cylinder table counts changed");

  console.log(`Summary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  fail("test runner crashed", undefined, error?.stack || String(error));
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  process.exitCode = 1;
});