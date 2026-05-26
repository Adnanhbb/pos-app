#!/usr/bin/env node

/* Dev-only replay auth/session foundation tests. */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `replay-auth-foundation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function pass(name) {
  passed += 1;
  console.log(`PASS ${name}`);
}

function fail(name, details, message) {
  failed += 1;
  console.error(`FAIL ${name}${message ? `: ${message}` : ""}`);
  if (details !== undefined) console.error(JSON.stringify(details, null, 2));
}

function check(name, details, predicate, message) {
  if (predicate(details)) {
    pass(name);
    return true;
  }
  fail(name, details, message);
  return false;
}

async function request(file) {
  const response = await fetch(`${API_BASE_URL}/${file}.php`);
  const text = await response.text();
  let body = null;
  try {
    body = text.trim() ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

function phpTestCode() {
  return String.raw`
require_once getcwd() . '/api/config/database.php';
require_once getcwd() . '/api/lib/auth.php';
require_once getcwd() . '/api/lib/transactionReplayProcessor.php';

$pdo = get_pdo();
$runId = getenv('REPLAY_AUTH_TEST_RUN_ID') ?: ('replay-auth-foundation-' . time());
$plainToken = $runId . '-secret-token';
$actorId = $runId . '-worker';
ensure_replay_auth_foundation_schema($pdo);
$tokenRowId = insert_replay_auth_token($pdo, $plainToken, $actorId);

$itemId = insert_replay_auth_item($pdo, $runId . '-item', 25);
$customerId = insert_replay_auth_customer($pdo, $runId . '-customer');
$syncId = insert_replay_auth_transaction($pdo, $runId, $itemId, $customerId);

$unauthorizedResult = replayStoredTransactionAuthorized($pdo, $syncId, [
    'authenticated' => false,
]);
$afterUnauthorized = fetch_replay_auth_sync_row($pdo, $syncId);

$badTokenAuth = authenticate_api_bearer_token($pdo, $runId . '-bad-token');
$authorizedAuth = authenticate_api_bearer_token($pdo, $plainToken);
$authorizedResult = replayStoredTransactionAuthorized($pdo, $syncId, $authorizedAuth);
$afterAuthorized = fetch_replay_auth_sync_row($pdo, $syncId);
$auditRows = fetch_replay_auth_audit_rows($pdo, $syncId);
$tokenLeakFound = replay_auth_token_leak_found($plainToken, [
    'badTokenAuth' => $badTokenAuth,
    'authorizedAuth' => $authorizedAuth,
    'authorizedResult' => $authorizedResult,
    'auditRows' => $auditRows,
]);

$forbiddenId = insert_replay_auth_transaction($pdo, $runId . '-forbidden', $itemId, $customerId);
$forbiddenResult = replayStoredTransactionAuthorized($pdo, $forbiddenId, [
    'authenticated' => true,
    'actorType' => 'user',
    'actorId' => $runId . '-clerk',
    'actorRole' => 'viewer',
    'sessionId' => 'safe-session-id',
]);
$afterForbidden = fetch_replay_auth_sync_row($pdo, $forbiddenId);

$latestTokenRow = fetch_replay_auth_token_row($pdo, $tokenRowId);

echo json_encode([
    'ok' => true,
    'syncId' => $syncId,
    'tokenRowId' => $tokenRowId,
    'unauthorizedResult' => $unauthorizedResult,
    'afterUnauthorized' => $afterUnauthorized,
    'badTokenAuth' => $badTokenAuth,
    'authorizedAuth' => $authorizedAuth,
    'authorizedResult' => $authorizedResult,
    'afterAuthorized' => $afterAuthorized,
    'auditRows' => $auditRows,
    'tokenLeakFound' => $tokenLeakFound,
    'forbiddenResult' => $forbiddenResult,
    'afterForbidden' => $afterForbidden,
    'latestTokenRow' => $latestTokenRow,
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

function ensure_replay_auth_foundation_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS api_auth_tokens (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, token_hash CHAR(64) NOT NULL UNIQUE, actor_type VARCHAR(50) NOT NULL, actor_id VARCHAR(150) NOT NULL, role VARCHAR(80) NOT NULL, label VARCHAR(180) NULL, is_active TINYINT(1) NOT NULL DEFAULT 1, expires_at DATETIME NULL, last_used_at DATETIME NULL, revoked_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_api_auth_tokens_actor (actor_type, actor_id), INDEX idx_api_auth_tokens_role (role), INDEX idx_api_auth_tokens_active (is_active)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    ensure_replay_auth_column($pdo, 'transaction_replay_audit', 'actor_type', "ALTER TABLE transaction_replay_audit ADD COLUMN actor_type VARCHAR(50) NULL AFTER message");
    ensure_replay_auth_column($pdo, 'transaction_replay_audit', 'actor_id', "ALTER TABLE transaction_replay_audit ADD COLUMN actor_id VARCHAR(150) NULL AFTER actor_type");
    ensure_replay_auth_column($pdo, 'transaction_replay_audit', 'actor_role', "ALTER TABLE transaction_replay_audit ADD COLUMN actor_role VARCHAR(80) NULL AFTER actor_id");
    ensure_replay_auth_column($pdo, 'transaction_replay_audit', 'session_id', "ALTER TABLE transaction_replay_audit ADD COLUMN session_id VARCHAR(150) NULL AFTER actor_role");
    ensure_replay_auth_foundation_business_tables($pdo);
}

function ensure_replay_auth_column(PDO $pdo, string $table, string $column, string $alterSql): void
{
    $statement = $pdo->prepare("SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column");
    $statement->execute(['table' => $table, 'column' => $column]);
    $row = $statement->fetch();
    if ((int) ($row['count'] ?? 0) === 0) {
        $pdo->exec($alterSql);
    }
}

function ensure_replay_auth_foundation_business_tables(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS sales (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, sync_transaction_id BIGINT UNSIGNED NULL UNIQUE, client_transaction_id VARCHAR(150) NULL UNIQUE, invoiceNo VARCHAR(120) NOT NULL, date VARCHAR(50) NULL, transactionType VARCHAR(80) NOT NULL, customerId BIGINT UNSIGNED NULL, supplierId BIGINT UNSIGNED NULL, customerName VARCHAR(180) NULL, supplierName VARCHAR(180) NULL, subtotal DECIMAL(12,2) NOT NULL DEFAULT 0, discount DECIMAL(12,2) NOT NULL DEFAULT 0, tax DECIMAL(12,2) NOT NULL DEFAULT 0, dues DECIMAL(12,2) NOT NULL DEFAULT 0, grandTotal DECIMAL(12,2) NOT NULL DEFAULT 0, paid DECIMAL(12,2) NOT NULL DEFAULT 0, arrears DECIMAL(12,2) NOT NULL DEFAULT 0, profit DECIMAL(12,2) NOT NULL DEFAULT 0, isPostponed TINYINT(1) NOT NULL DEFAULT 0, sale_json LONGTEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS sale_items (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, sale_id BIGINT UNSIGNED NOT NULL, originalItemId BIGINT UNSIGNED NULL, name VARCHAR(180) NOT NULL, qty DECIMAL(12,2) NOT NULL DEFAULT 0, price DECIMAL(12,2) NOT NULL DEFAULT 0, priceCategory VARCHAR(80) NULL, discountType VARCHAR(50) NULL, discountValue DECIMAL(12,2) NOT NULL DEFAULT 0, taxType VARCHAR(50) NULL, taxValue DECIMAL(12,2) NOT NULL DEFAULT 0, item_json LONGTEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_sale_items_sale_id (sale_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS customer_payments (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, customerId BIGINT UNSIGNED NOT NULL, customerName VARCHAR(180) NULL, invoiceNo VARCHAR(120) NULL, amount DECIMAL(12,2) NOT NULL DEFAULT 0, paymentDate VARCHAR(50) NULL, remarks TEXT NULL, payableSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, balanceSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, sync_transaction_id BIGINT UNSIGNED NULL, client_transaction_id VARCHAR(150) NULL, sale_id BIGINT UNSIGNED NULL, source VARCHAR(80) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_customer_payments_customerId (customerId)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS supplier_payments (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, supplierId BIGINT UNSIGNED NOT NULL, supplierName VARCHAR(180) NULL, invoiceNo VARCHAR(120) NULL, amount DECIMAL(12,2) NOT NULL DEFAULT 0, paymentDate VARCHAR(50) NULL, remarks TEXT NULL, payableSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, balanceSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, sync_transaction_id BIGINT UNSIGNED NULL, client_transaction_id VARCHAR(150) NULL, sale_id BIGINT UNSIGNED NULL, source VARCHAR(80) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_supplier_payments_supplierId (supplierId)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS item_batches (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, itemId BIGINT UNSIGNED NOT NULL, purchaseDate VARCHAR(50) NOT NULL, qtyPurchased DECIMAL(12,2) NOT NULL DEFAULT 0, qtySold DECIMAL(12,2) NOT NULL DEFAULT 0, balance DECIMAL(12,2) NOT NULL DEFAULT 0, costPrice DECIMAL(12,2) NOT NULL DEFAULT 0, sourceSaleId BIGINT UNSIGNED NULL, invoiceNo VARCHAR(120) NULL, sync_transaction_id BIGINT UNSIGNED NULL, client_transaction_id VARCHAR(150) NULL, batch_json LONGTEXT NULL, isDeleted TINYINT(1) NOT NULL DEFAULT 0, deletedAt DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_item_batches_itemId (itemId)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS cylinders (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, itemId BIGINT UNSIGNED NOT NULL UNIQUE, title VARCHAR(180) NOT NULL, qtyInStock DECIMAL(12,2) NOT NULL DEFAULT 0, filledCylinders DECIMAL(12,2) NOT NULL DEFAULT 0, emptyCylinders DECIMAL(12,2) NOT NULL DEFAULT 0, withCustomers DECIMAL(12,2) NOT NULL DEFAULT 0, convQty DECIMAL(12,2) NOT NULL DEFAULT 1, isDeleted TINYINT(1) NOT NULL DEFAULT 0, deletedAt DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_cylinders_itemId (itemId)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS cylinder_customers (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, cylinderId BIGINT UNSIGNED NOT NULL, cylinderType VARCHAR(180) NOT NULL, customerName VARCHAR(180) NOT NULL, qtyHeld DECIMAL(12,2) NOT NULL DEFAULT 0, isDeleted TINYINT(1) NOT NULL DEFAULT 0, deletedAt DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_cylinder_customers_cylinderId (cylinderId), INDEX idx_cylinder_customers_customerName (customerName)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

function insert_replay_auth_token(PDO $pdo, string $plainToken, string $actorId): int
{
    $statement = $pdo->prepare("INSERT INTO api_auth_tokens (token_hash, actor_type, actor_id, role, label, is_active) VALUES (:hash, 'replay_worker', :actor_id, 'replay', 'Replay auth foundation test worker', 1)");
    $statement->execute([
        'hash' => hash_auth_token($plainToken),
        'actor_id' => $actorId,
    ]);
    return (int) $pdo->lastInsertId();
}

function insert_replay_auth_item(PDO $pdo, string $name, float $stock): int
{
    $statement = $pdo->prepare("INSERT INTO items (client_id, name, barcode, purchasePrice, retailPrice, discountPrice, wholesalePrice, availableStock, category, brand, minunit, maxunit, ConvQty) VALUES (:id, :name, :barcode, 1, 2, 0, 2, :stock, 'General Goods', 'Auth Test', 'pcs', 'box', 1)");
    $statement->execute(['id' => $name, 'name' => $name, 'barcode' => $name, 'stock' => $stock]);
    return (int) $pdo->lastInsertId();
}

function insert_replay_auth_customer(PDO $pdo, string $name): int
{
    $statement = $pdo->prepare("INSERT INTO customers (client_id, name, mobile, cnic, address, invoices, payable, paid, balance) VALUES (:id, :name, '03000000000', 'auth-test', 'auth test customer', 0, 0, 0, 0)");
    $statement->execute(['id' => $name, 'name' => $name]);
    return (int) $pdo->lastInsertId();
}

function insert_replay_auth_transaction(PDO $pdo, string $runId, int $itemId, int $customerId): int
{
    $clientId = $runId . '-' . bin2hex(random_bytes(4));
    $payload = [
        'clientTransactionId' => $clientId,
        'transactionType' => 'sale',
        'createdAt' => '2026-05-24T00:00:00.000Z',
        'payload' => [
            'customerId' => $customerId,
            'sale' => [
                'transactionType' => 'Sale',
                'invoiceNo' => $clientId . '-INV',
                'date' => '2026-05-24',
                'customerId' => $customerId,
                'customerName' => $runId . '-customer',
                'subtotal' => 10,
                'grandTotal' => 10,
                'paid' => 0,
                'arrears' => 10,
            ],
            'saleItems' => [[
                'itemId' => $itemId,
                'originalItemId' => $itemId,
                'name' => $runId . '-item',
                'qty' => 1,
                'price' => 10,
                'costPrice' => 5,
                'convQty' => 1,
            ]],
        ],
    ];

    $statement = $pdo->prepare("INSERT INTO sync_transactions (client_transaction_id, transaction_type, payload_json, status, replay_status, replay_attempts) VALUES (:client_id, 'sale', :payload, 'stored', 'stored', 0)");
    $statement->execute([
        'client_id' => $clientId,
        'payload' => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
    ]);
    return (int) $pdo->lastInsertId();
}

function fetch_replay_auth_sync_row(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare("SELECT id, client_transaction_id, replay_status, replay_attempts, locked_at, locked_by, CASE WHEN replay_error IS NULL OR replay_error = '' THEN 0 ELSE 1 END AS has_replay_error FROM sync_transactions WHERE id = :id LIMIT 1");
    $statement->execute(['id' => $id]);
    $row = $statement->fetch();
    return $row ?: null;
}

function fetch_replay_auth_audit_rows(PDO $pdo, int $id): array
{
    $statement = $pdo->prepare("SELECT id, event_type, status_before, status_after, message, actor_type, actor_id, actor_role, session_id FROM transaction_replay_audit WHERE sync_transaction_id = :id ORDER BY id ASC");
    $statement->execute(['id' => $id]);
    return $statement->fetchAll();
}

function fetch_replay_auth_token_row(PDO $pdo, int $id): ?array
{
    $statement = $pdo->prepare("SELECT id, actor_type, actor_id, role, CASE WHEN token_hash IS NULL OR token_hash = '' THEN 0 ELSE 1 END AS has_token_hash, CASE WHEN last_used_at IS NULL THEN 0 ELSE 1 END AS has_last_used_at FROM api_auth_tokens WHERE id = :id LIMIT 1");
    $statement->execute(['id' => $id]);
    $row = $statement->fetch();
    return $row ?: null;
}

function replay_auth_token_leak_found(string $plainToken, array $values): bool
{
    return strpos(json_encode($values, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), $plainToken) !== false;
}
`;
}

function runPhpReplayAuthTest() {
  const result = spawnSync(findPhpBinary(), ["-r", phpTestCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      REPLAY_AUTH_TEST_RUN_ID: runId,
    },
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 50,
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

async function main() {
  console.log(`Testing replay auth foundation against ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);

  const health = await request("health");
  check("backend health reachable", health, (value) => value.status === 200 && value.body?.success === true, "health.php did not return success");

  const result = runPhpReplayAuthTest();
  check("php auth foundation harness completed", result, (value) => value.ok === true, "PHP harness failed");

  if (result.ok === true) {
    check("unauthorized replay rejected", result, (value) => value.unauthorizedResult?.success === false && value.unauthorizedResult?.reason === "unauthorized", "unauthorized replay was not rejected");
    check("unauthorized replay did not increment attempts", result, (value) => Number(value.afterUnauthorized?.replay_attempts) === 0 && value.afterUnauthorized?.replay_status === "stored", "unauthorized replay changed row state");
    check("invalid bearer token rejected", result, (value) => value.badTokenAuth?.authenticated === false && value.badTokenAuth?.reason === "invalid_bearer_token", "bad token was accepted");
    check("authorized token accepted", result, (value) => value.authorizedAuth?.authenticated === true && value.authorizedAuth?.actorType === "replay_worker" && value.authorizedAuth?.actorRole === "replay", "valid replay token was not accepted");
    check("authorized replay committed", result, (value) => value.authorizedResult?.success === true && value.authorizedResult?.authorized === true && value.afterAuthorized?.replay_status === "committed", "authorized replay did not commit");
    check("authorized replay incremented attempts once", result, (value) => Number(value.afterAuthorized?.replay_attempts) === 1, "authorized replay attempts mismatch");
    check("forbidden role rejected", result, (value) => value.forbiddenResult?.success === false && value.forbiddenResult?.reason === "unauthorized" && Number(value.afterForbidden?.replay_attempts) === 0, "forbidden role was not rejected safely");
    check("auth token last_used_at updated", result, (value) => Number(value.latestTokenRow?.has_last_used_at) === 1 && Number(value.latestTokenRow?.has_token_hash) === 1, "token usage metadata was not updated");
    check("audit actor attribution recorded", result, (value) => Array.isArray(value.auditRows) && value.auditRows.some((row) => row.actor_type === "replay_worker" && row.actor_role === "replay" && row.actor_id), "audit rows do not include actor attribution");
    check("raw token not leaked", result, (value) => value.tokenLeakFound === false, "raw token appeared in result or audit output");
  }

  console.log(`Summary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  fail("test runner crashed", { message: String(error?.message || error), stack: error?.stack }, "unexpected error");
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  process.exitCode = 1;
});

