#!/usr/bin/env node

/* Dev-only transaction payment persistence replay tests. */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `transaction-payment-persistence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
function check(name, details, predicate, message) { if (predicate(details)) { pass(name, details); return true; } fail(name, details, message); return false; }
function nearlyEqual(a, b) { return Math.abs(Number(a) - Number(b)) < 0.000001; }
function auditHas(rows, eventType) { return Array.isArray(rows) && rows.some((row) => row.event_type === eventType); }
function totalPaymentRows(rowsByTable) { return Object.values(rowsByTable || {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0); }
async function request(file) { const r = await fetch(`${API_BASE_URL}/${file}.php`); const t = await r.text(); let body = null; try { body = t.trim() ? JSON.parse(t) : null; } catch { body = t; } return { status: r.status, body }; }

function phpTestCode() {
  return String.raw`
require_once getcwd() . '/api/config/database.php';
require_once getcwd() . '/api/lib/transactionReplayProcessor.php';
$pdo = get_pdo();
$runId = getenv('PAYMENT_PERSISTENCE_TEST_RUN_ID') ?: ('transaction-payment-persistence-' . time());
$workerPrefix = $runId . '-worker';
ensure_payment_test_tables($pdo);
$protectedCountsBefore = table_counts($pdo, ['cylinders', 'batches']);
$cases = [];
$cases['sale_customer_payment'] = run_payment_case($pdo, $workerPrefix, $runId, 'sale', ['party' => 'customer', 'type' => 'sale', 'headerKey' => 'sale', 'headerType' => 'Sale', 'amount' => 30, 'paid' => 10, 'qty' => 3, 'stock' => 100, 'table' => 'customer_payments', 'expectedAmount' => 10]);
$cases['purchase_supplier_payment'] = run_payment_case($pdo, $workerPrefix, $runId, 'purchase', ['party' => 'supplier', 'type' => 'purchase', 'headerKey' => 'purchase', 'headerType' => 'Purchase', 'amount' => 40, 'paid' => 15, 'qty' => 4, 'stock' => 50, 'table' => 'supplier_payments', 'expectedAmount' => 15]);
$cases['customer_return_negative_payment'] = run_payment_case($pdo, $workerPrefix, $runId, 'customer-return', ['party' => 'customer', 'type' => 'return', 'returnMode' => 'customer', 'headerKey' => 'sale', 'headerType' => 'Customer Return', 'amount' => 50, 'paid' => 5, 'qty' => 5, 'stock' => 1, 'table' => 'customer_payments', 'expectedAmount' => -5]);
$cases['supplier_return_negative_payment'] = run_payment_case($pdo, $workerPrefix, $runId, 'supplier-return', ['party' => 'supplier', 'type' => 'return', 'returnMode' => 'supplier', 'headerKey' => 'sale', 'headerType' => 'Supplier Return', 'amount' => 60, 'paid' => 7, 'qty' => 6, 'stock' => 20, 'table' => 'supplier_payments', 'expectedAmount' => -7]);
$cases['zero_paid_sale'] = run_payment_case($pdo, $workerPrefix, $runId, 'zero-sale', ['party' => 'customer', 'type' => 'sale', 'headerKey' => 'sale', 'headerType' => 'Sale', 'amount' => 20, 'paid' => 0, 'qty' => 2, 'stock' => 100, 'table' => 'customer_payments', 'expectedAmount' => 0, 'noPayment' => true]);
$cases['zero_paid_purchase'] = run_payment_case($pdo, $workerPrefix, $runId, 'zero-purchase', ['party' => 'supplier', 'type' => 'purchase', 'headerKey' => 'purchase', 'headerType' => 'Purchase', 'amount' => 20, 'paid' => 0, 'qty' => 2, 'stock' => 10, 'table' => 'supplier_payments', 'expectedAmount' => 0, 'noPayment' => true]);
$rollback = run_payment_failure_case($pdo, $workerPrefix, $runId);
$protectedCountsAfter = table_counts($pdo, ['cylinders', 'batches']);
echo json_encode(['ok' => true, 'cases' => $cases, 'rollback' => $rollback, 'protectedCountsBefore' => $protectedCountsBefore, 'protectedCountsAfter' => $protectedCountsAfter], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
function run_payment_case(PDO $pdo, string $workerPrefix, string $runId, string $name, array $c): array {
    $itemId = insert_item($pdo, "$runId-$name-item", (float) $c['stock']);
    $partyId = $c['party'] === 'customer' ? insert_customer($pdo, "$runId-$name-customer") : insert_supplier($pdo, "$runId-$name-supplier");
    $payload = make_payload($runId, $name, $c, $itemId, $partyId);
    $syncId = insert_txn($pdo, $payload);
    $stockBefore = stock($pdo, $itemId);
    $partyBefore = party($pdo, $c['party'], $partyId);
    $first = replayStoredTransaction($pdo, $syncId, "$workerPrefix-$name");
    $row = sync_row($pdo, $syncId);
    $audit = audit_rows($pdo, $syncId);
    $stockAfter = stock($pdo, $itemId);
    $partyAfter = party($pdo, $c['party'], $partyId);
    $payments = payment_rows($pdo, $syncId);
    $second = replayStoredTransaction($pdo, $syncId, "$workerPrefix-$name-again");
    $paymentsAfterSecond = payment_rows($pdo, $syncId);
    return ['syncTransactionId' => $syncId, 'expectedTable' => $c['table'], 'expectedAmount' => (float) $c['expectedAmount'], 'noPayment' => (bool) ($c['noPayment'] ?? false), 'firstResult' => $first, 'row' => $row, 'audit' => $audit, 'stockBefore' => $stockBefore, 'stockAfter' => $stockAfter, 'stockAfterSecond' => stock($pdo, $itemId), 'partyBefore' => $partyBefore, 'partyAfter' => $partyAfter, 'partyAfterSecond' => party($pdo, $c['party'], $partyId), 'payments' => $payments, 'secondResult' => $second, 'paymentsAfterSecond' => $paymentsAfterSecond];
}

function run_payment_failure_case(PDO $pdo, string $workerPrefix, string $runId): array {
    $itemId = insert_item($pdo, "$runId-failure-item", 100);
    $customerId = insert_customer($pdo, "$runId-failure-customer");
    $payload = make_payload($runId, 'failure', ['party' => 'customer', 'type' => 'sale', 'headerKey' => 'sale', 'headerType' => 'Sale', 'amount' => 30, 'paid' => 10, 'qty' => 3], $itemId, $customerId);
    $syncId = insert_txn($pdo, $payload);
    $stmt = $pdo->prepare("INSERT INTO customer_payments (customerId, customerName, invoiceNo, amount, paymentDate, remarks, payableSnapshot, balanceSnapshot, sync_transaction_id, client_transaction_id, source) VALUES (:customerId, :customerName, :invoiceNo, 1, :paymentDate, 'preexisting conflict', 0, 0, :syncId, :clientId, 'test_conflict')");
    $stmt->execute(['customerId' => $customerId, 'customerName' => "$runId-failure-customer", 'invoiceNo' => "$runId-failure-conflict", 'paymentDate' => date('c'), 'syncId' => $syncId, 'clientId' => $payload['clientTransactionId']]);
    $before = ['stock' => stock($pdo, $itemId), 'party' => party($pdo, 'customer', $customerId), 'sales' => sales_rows($pdo, $syncId), 'payments' => payment_rows($pdo, $syncId)];
    $result = replayStoredTransaction($pdo, $syncId, "$workerPrefix-failure");
    $after = ['stock' => stock($pdo, $itemId), 'party' => party($pdo, 'customer', $customerId), 'sales' => sales_rows($pdo, $syncId), 'payments' => payment_rows($pdo, $syncId)];
    return ['syncTransactionId' => $syncId, 'result' => $result, 'row' => sync_row($pdo, $syncId), 'audit' => audit_rows($pdo, $syncId), 'before' => $before, 'after' => $after];
}

function make_payload(string $runId, string $name, array $c, int $itemId, int $partyId): array {
    $header = ['transactionType' => $c['headerType'], 'invoiceNo' => "$runId-$name-INVOICE", 'date' => '2026-05-21', 'subtotal' => $c['amount'], 'grandTotal' => $c['amount'], 'paid' => $c['paid'], 'arrears' => $c['amount'] - $c['paid']];
    if ($c['party'] === 'customer') { $header['customerId'] = $partyId; $header['customerName'] = "$runId-$name-customer"; }
    else { $header['supplierId'] = $partyId; $header['supplierName'] = "$runId-$name-supplier"; }
    $body = [$c['headerKey'] => $header, 'saleItems' => [['itemId' => $itemId, 'originalItemId' => $itemId, 'name' => "$runId-$name-item", 'qty' => $c['qty'], 'price' => 10]]];
    if ($c['party'] === 'customer') { $body['customerId'] = $partyId; } else { $body['supplierId'] = $partyId; }
    if (isset($c['returnMode'])) { $body['returnMode'] = $c['returnMode']; }
    if ($c['type'] === 'purchase') { $body['items'] = $body['saleItems']; unset($body['saleItems']); }
    return ['clientTransactionId' => "$runId-$name-client-transaction", 'transactionType' => $c['type'], 'createdAt' => '2026-05-21T00:00:00.000Z', 'payload' => $body];
}

function insert_txn(PDO $pdo, array $payload): int {
    $stmt = $pdo->prepare("INSERT INTO sync_transactions (client_transaction_id, transaction_type, payload_json, status, replay_status, replay_attempts) VALUES (:clientId, :type, :payload, 'stored', 'stored', 0)");
    $stmt->execute(['clientId' => $payload['clientTransactionId'], 'type' => $payload['transactionType'], 'payload' => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]);
    return (int) $pdo->lastInsertId();
}
function insert_item(PDO $pdo, string $name, float $stock): int { $s = $pdo->prepare("INSERT INTO items (client_id, name, barcode, purchasePrice, retailPrice, discountPrice, wholesalePrice, availableStock, category, brand, minunit, maxunit, ConvQty) VALUES (:id, :name, :barcode, 1, 2, 0, 2, :stock, 'Payment Persistence', 'Payment Persistence', 'pc', 'box', 1)"); $s->execute(['id' => $name, 'name' => $name, 'barcode' => $name, 'stock' => $stock]); return (int) $pdo->lastInsertId(); }
function insert_customer(PDO $pdo, string $name): int { $s = $pdo->prepare("INSERT INTO customers (client_id, name, mobile, cnic, address, invoices, payable, paid, balance) VALUES (:id, :name, '03000000000', 'payment-test', 'payment customer', 1, 100, 20, 80)"); $s->execute(['id' => $name, 'name' => $name]); return (int) $pdo->lastInsertId(); }
function insert_supplier(PDO $pdo, string $name): int { $s = $pdo->prepare("INSERT INTO suppliers (client_id, name, mobile, cnic, address, invoices, payable, paid, balance) VALUES (:id, :name, '03111111111', 'payment-test', 'payment supplier', 2, 200, 50, 150)"); $s->execute(['id' => $name, 'name' => $name]); return (int) $pdo->lastInsertId(); }
function stock(PDO $pdo, int $id): float { $s = $pdo->prepare('SELECT availableStock FROM items WHERE id = :id'); $s->execute(['id' => $id]); return (float) ($s->fetch()['availableStock'] ?? 0); }
function party(PDO $pdo, string $type, int $id): array { $table = $type === 'customer' ? 'customers' : 'suppliers'; $s = $pdo->prepare("SELECT invoices, payable, paid, balance FROM $table WHERE id = :id"); $s->execute(['id' => $id]); $r = $s->fetch() ?: []; return ['invoices' => (int) ($r['invoices'] ?? 0), 'payable' => (float) ($r['payable'] ?? 0), 'paid' => (float) ($r['paid'] ?? 0), 'balance' => (float) ($r['balance'] ?? 0)]; }
function payment_rows(PDO $pdo, int $syncId): array { return ['customer_payments' => payment_rows_table($pdo, 'customer_payments', $syncId), 'supplier_payments' => payment_rows_table($pdo, 'supplier_payments', $syncId)]; }
function payment_rows_table(PDO $pdo, string $table, int $syncId): array { $s = $pdo->prepare("SELECT id, amount, invoiceNo, paymentDate, remarks, payableSnapshot, balanceSnapshot, sync_transaction_id, client_transaction_id, sale_id, source FROM $table WHERE sync_transaction_id = :id ORDER BY id ASC"); $s->execute(['id' => $syncId]); return array_map(static function(array $r): array { $r['id'] = (int) $r['id']; $r['amount'] = (float) $r['amount']; $r['payableSnapshot'] = (float) $r['payableSnapshot']; $r['balanceSnapshot'] = (float) $r['balanceSnapshot']; $r['sync_transaction_id'] = (int) $r['sync_transaction_id']; $r['sale_id'] = $r['sale_id'] === null ? null : (int) $r['sale_id']; return $r; }, $s->fetchAll()); }
function sales_rows(PDO $pdo, int $syncId): array { $s = $pdo->prepare('SELECT id FROM sales WHERE sync_transaction_id = :id'); $s->execute(['id' => $syncId]); $sales = $s->fetchAll(); $items = 0; foreach ($sales as $sale) { $q = $pdo->prepare('SELECT COUNT(*) AS c FROM sale_items WHERE sale_id = :id'); $q->execute(['id' => $sale['id']]); $items += (int) ($q->fetch()['c'] ?? 0); } return ['sales' => count($sales), 'sale_items' => $items]; }
function sync_row(PDO $pdo, int $id): ?array { $s = $pdo->prepare('SELECT id, client_transaction_id, replay_status, replay_attempts, CASE WHEN replay_error IS NULL OR replay_error = "" THEN 0 ELSE 1 END AS has_replay_error, locked_at, locked_by FROM sync_transactions WHERE id = :id'); $s->execute(['id' => $id]); return $s->fetch() ?: null; }
function audit_rows(PDO $pdo, int $id): array { $s = $pdo->prepare('SELECT event_type, status_before, status_after, message FROM transaction_replay_audit WHERE sync_transaction_id = :id ORDER BY id ASC'); $s->execute(['id' => $id]); return $s->fetchAll(); }
function table_counts(PDO $pdo, array $tables): array { $out = []; foreach ($tables as $table) { if (!table_exists($pdo, $table)) { $out[$table] = null; continue; } $out[$table] = (int) ($pdo->query("SELECT COUNT(*) AS c FROM $table")->fetch()['c'] ?? 0); } return $out; }
function table_exists(PDO $pdo, string $table): bool { $s = $pdo->prepare('SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = :t'); $s->execute(['t' => $table]); return (int) ($s->fetch()['c'] ?? 0) > 0; }
function column_exists(PDO $pdo, string $table, string $column): bool { $s = $pdo->prepare('SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = :t AND column_name = :c'); $s->execute(['t' => $table, 'c' => $column]); return (int) ($s->fetch()['c'] ?? 0) > 0; }
function index_exists(PDO $pdo, string $table, string $index): bool { $s = $pdo->prepare('SELECT COUNT(*) AS c FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = :t AND index_name = :i'); $s->execute(['t' => $table, 'i' => $index]); return (int) ($s->fetch()['c'] ?? 0) > 0; }
function ensure_col(PDO $pdo, string $table, string $column, string $definition): void { if (!column_exists($pdo, $table, $column)) { $pdo->exec("ALTER TABLE $table ADD COLUMN $column $definition"); } }
function ensure_payment_index(PDO $pdo, string $table, string $index): void { if (!index_exists($pdo, $table, $index)) { $pdo->exec("ALTER TABLE $table ADD UNIQUE KEY $index (sync_transaction_id)"); } }

function ensure_payment_test_tables(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS sales (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, sync_transaction_id BIGINT UNSIGNED NULL UNIQUE, client_transaction_id VARCHAR(150) NULL UNIQUE, invoiceNo VARCHAR(120) NOT NULL, date VARCHAR(50) NULL, transactionType VARCHAR(80) NOT NULL, customerId BIGINT UNSIGNED NULL, supplierId BIGINT UNSIGNED NULL, customerName VARCHAR(180) NULL, supplierName VARCHAR(180) NULL, subtotal DECIMAL(12,2) NOT NULL DEFAULT 0, discount DECIMAL(12,2) NOT NULL DEFAULT 0, tax DECIMAL(12,2) NOT NULL DEFAULT 0, dues DECIMAL(12,2) NOT NULL DEFAULT 0, grandTotal DECIMAL(12,2) NOT NULL DEFAULT 0, paid DECIMAL(12,2) NOT NULL DEFAULT 0, arrears DECIMAL(12,2) NOT NULL DEFAULT 0, profit DECIMAL(12,2) NOT NULL DEFAULT 0, isPostponed TINYINT(1) NOT NULL DEFAULT 0, sale_json LONGTEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS sale_items (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, sale_id BIGINT UNSIGNED NOT NULL, originalItemId BIGINT UNSIGNED NULL, name VARCHAR(180) NOT NULL, qty DECIMAL(12,2) NOT NULL DEFAULT 0, price DECIMAL(12,2) NOT NULL DEFAULT 0, priceCategory VARCHAR(80) NULL, discountType VARCHAR(50) NULL, discountValue DECIMAL(12,2) NOT NULL DEFAULT 0, taxType VARCHAR(50) NULL, taxValue DECIMAL(12,2) NOT NULL DEFAULT 0, item_json LONGTEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_sale_items_sale_id (sale_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS customer_payments (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, customerId BIGINT UNSIGNED NOT NULL, customerName VARCHAR(180) NULL, invoiceNo VARCHAR(120) NULL, amount DECIMAL(12,2) NOT NULL DEFAULT 0, paymentDate VARCHAR(50) NULL, remarks TEXT NULL, payableSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, balanceSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, sync_transaction_id BIGINT UNSIGNED NULL, client_transaction_id VARCHAR(150) NULL, sale_id BIGINT UNSIGNED NULL, source VARCHAR(80) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_customer_payments_customerId (customerId), INDEX idx_customer_payments_invoiceNo (invoiceNo)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS supplier_payments (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, supplierId BIGINT UNSIGNED NOT NULL, supplierName VARCHAR(180) NULL, invoiceNo VARCHAR(120) NULL, amount DECIMAL(12,2) NOT NULL DEFAULT 0, paymentDate VARCHAR(50) NULL, remarks TEXT NULL, payableSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, balanceSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, sync_transaction_id BIGINT UNSIGNED NULL, client_transaction_id VARCHAR(150) NULL, sale_id BIGINT UNSIGNED NULL, source VARCHAR(80) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_supplier_payments_supplierId (supplierId), INDEX idx_supplier_payments_invoiceNo (invoiceNo)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    foreach (['customer_payments', 'supplier_payments'] as $table) { ensure_col($pdo, $table, 'sync_transaction_id', 'BIGINT UNSIGNED NULL'); ensure_col($pdo, $table, 'client_transaction_id', 'VARCHAR(150) NULL'); ensure_col($pdo, $table, 'sale_id', 'BIGINT UNSIGNED NULL'); ensure_col($pdo, $table, 'source', 'VARCHAR(80) NULL'); ensure_payment_index($pdo, $table, 'uniq_' . $table . '_sync_transaction_id'); }
}
`;
}

function runPhpPaymentPersistenceTest() {
  const result = spawnSync(findPhpBinary(), ["-r", phpTestCode()], { cwd: projectRoot, encoding: "utf8", env: { ...process.env, PAYMENT_PERSISTENCE_TEST_RUN_ID: runId }, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) return { ok: false, status: result.status, stdout: result.stdout, stderr: result.stderr };
  try { return JSON.parse(result.stdout.trim()); } catch (error) { return { ok: false, parseError: String(error), stdout: result.stdout, stderr: result.stderr }; }
}

async function main() {
  console.log(`Testing transaction payment persistence against ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);
  const health = await request("health");
  check("backend health reachable", health, (value) => value.status === 200 && value.body?.success === true, "health.php did not return success");
  const result = runPhpPaymentPersistenceTest();
  check("php payment persistence harness completed", result, (value) => value.ok === true, "PHP harness failed");
  if (result.ok !== true) { console.log(`Summary: ${passed} passed, ${failed} failed`); process.exitCode = 1; return; }

  for (const [name, caseResult] of Object.entries(result.cases || {})) {
    const rows = caseResult.payments?.[caseResult.expectedTable] || [];
    const totalRows = totalPaymentRows(caseResult.payments);
    const totalRowsAfterDuplicate = totalPaymentRows(caseResult.paymentsAfterSecond);
    check(`${name}: replay committed`, caseResult, (value) => value.firstResult?.success === true && value.row?.replay_status === "committed", "first replay did not commit");
    check(`${name}: payment audit completed`, caseResult, (value) => auditHas(value.audit, "replay_payment_persistence_completed"), "missing payment completion audit");
    check(`${name}: duplicate replay skipped`, caseResult, (value) => value.secondResult?.terminalStateSkipped === true && Number(value.row?.replay_attempts) === 1, "duplicate replay was not terminal-skipped");
    check(`${name}: duplicate replay did not change payment rows`, { totalRows, totalRowsAfterDuplicate }, (value) => value.totalRows === value.totalRowsAfterDuplicate, "duplicate replay changed payment rows");
    check(`${name}: duplicate replay did not change stock`, caseResult, (value) => nearlyEqual(value.stockAfter, value.stockAfterSecond), "duplicate replay changed stock");
    check(`${name}: duplicate replay did not change accounting`, caseResult, (value) => JSON.stringify(value.partyAfter) === JSON.stringify(value.partyAfterSecond), "duplicate replay changed accounting");
    if (caseResult.noPayment) {
      check(`${name}: zero-paid transaction created no payment row`, caseResult.payments, (value) => totalPaymentRows(value) === 0, "zero-paid transaction created payment rows");
      check(`${name}: result reports zero-paid skip`, caseResult, (value) => value.firstResult?.paymentsPersisted === false && value.firstResult?.paymentPersistenceResult?.reason === "zero_paid", "zero-paid skip was not reported");
    } else {
      check(`${name}: exactly one payment row inserted`, { rows, totalRows }, (value) => value.rows.length === 1 && value.totalRows === 1, "expected exactly one payment row");
      check(`${name}: payment amount matches`, { expected: caseResult.expectedAmount, actual: rows[0]?.amount }, (value) => nearlyEqual(value.actual, value.expected), "payment amount mismatch");
      check(`${name}: payment row has replay metadata`, rows[0], (value) => value?.sync_transaction_id === caseResult.syncTransactionId && value?.client_transaction_id && value?.sale_id && value?.source === "transaction_replay", "payment metadata missing");
      check(`${name}: replay result reports payment persisted`, caseResult, (value) => value.firstResult?.paymentsPersisted === true && value.firstResult?.paymentPersistenceResult?.insertedCount === 1, "result did not report payment persistence");
    }
  }

  const rollback = result.rollback || {};
  check("payment failure rollback returns safe failure", rollback, (value) => value.result?.success === false && value.result?.reason === "payment_persistence_failed" && value.row?.replay_status === "failed", "payment failure did not fail safely");
  check("payment failure rollback leaves stock unchanged", rollback, (value) => nearlyEqual(value.before?.stock, value.after?.stock), "stock changed despite payment rollback");
  check("payment failure rollback leaves accounting unchanged", rollback, (value) => JSON.stringify(value.before?.party) === JSON.stringify(value.after?.party), "accounting changed despite payment rollback");
  check("payment failure rollback leaves sales uninserted", rollback, (value) => value.before?.sales?.sales === 0 && value.after?.sales?.sales === 0 && value.after?.sales?.sale_items === 0, "sales rows were not rolled back");
  check("payment failure preserves only preexisting conflict payment", rollback, (value) => totalPaymentRows(value.before?.payments) === 1 && totalPaymentRows(value.after?.payments) === 1, "unexpected payment rows after rollback");
  check("payment failure audit written", rollback, (value) => auditHas(value.audit, "replay_payment_persistence_failed"), "missing payment failure audit event");
  check("cylinder/batch table counts unchanged", { before: result.protectedCountsBefore, after: result.protectedCountsAfter }, (value) => JSON.stringify(value.before) === JSON.stringify(value.after), "cylinder or batch tables changed");

  console.log(`Summary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  fail("test runner crashed", undefined, error?.stack || String(error));
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  process.exitCode = 1;
});
