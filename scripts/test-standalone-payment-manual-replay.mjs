#!/usr/bin/env node

/* Isolated backend verifier for authenticated manual standalone Payment v1 replay. */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `standalone-payment-v1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
require_once getcwd() . '/api/lib/standalonePaymentReplayV1.php';

$pdo = get_pdo();
$runId = getenv('STANDALONE_PAYMENT_V1_TEST_RUN_ID') ?: ('standalone-payment-v1-' . time());
ensure_fixture_tables($pdo);
$customerFixture = insert_party_fixture($pdo, $runId . '-customer', 'customer');
$supplierFixture = insert_party_fixture($pdo, $runId . '-supplier', 'supplier');
$unsafeCustomerFixture = insert_party_fixture($pdo, $runId . '-unsafe-customer', 'customer');
$unsafeSupplierFixture = insert_party_fixture($pdo, $runId . '-unsafe-supplier', 'supplier');

try {
    $auth = [
        'authenticated' => true,
        'actorType' => 'replay_worker',
        'actorId' => $runId . '-worker',
        'actorRole' => 'replay',
        'sessionId' => $runId . '-session',
    ];

    $customerPayload = make_payment_payload($runId, 'customer-ready', $customerFixture, 'customer', true, false, 25.0);
    $customerSyncId = insert_sync_row($pdo, $customerPayload);
    $customerBefore = snapshot($pdo, $customerFixture, $customerSyncId, 'customer');
    $customerFirst = replayStoredStandaloneCustomerPaymentV1Authorized($pdo, $customerSyncId, $auth);
    $customerAfterFirst = snapshot($pdo, $customerFixture, $customerSyncId, 'customer');
    $customerSecond = replayStoredStandaloneCustomerPaymentV1Authorized($pdo, $customerSyncId, $auth);
    $customerAfterSecond = snapshot($pdo, $customerFixture, $customerSyncId, 'customer');

    $supplierPayload = make_payment_payload($runId, 'supplier-ready', $supplierFixture, 'supplier', true, false, 35.0);
    $supplierSyncId = insert_sync_row($pdo, $supplierPayload);
    $supplierBefore = snapshot($pdo, $supplierFixture, $supplierSyncId, 'supplier');
    $supplierFirst = replayStoredStandaloneSupplierPaymentV1Authorized($pdo, $supplierSyncId, $auth);
    $supplierAfterFirst = snapshot($pdo, $supplierFixture, $supplierSyncId, 'supplier');
    $supplierSecond = replayStoredStandaloneSupplierPaymentV1Authorized($pdo, $supplierSyncId, $auth);
    $supplierAfterSecond = snapshot($pdo, $supplierFixture, $supplierSyncId, 'supplier');

    $unsafeCustomerPayload = make_payment_payload($runId, 'customer-unsafe', $unsafeCustomerFixture, 'customer', false, true, 0.0);
    $unsafeCustomerSyncId = insert_sync_row($pdo, $unsafeCustomerPayload);
    $unsafeCustomerBefore = snapshot($pdo, $unsafeCustomerFixture, $unsafeCustomerSyncId, 'customer');
    $unsafeCustomerReplay = replayStoredStandaloneCustomerPaymentV1Authorized($pdo, $unsafeCustomerSyncId, $auth);
    $unsafeCustomerAfter = snapshot($pdo, $unsafeCustomerFixture, $unsafeCustomerSyncId, 'customer');

    $unsafeSupplierPayload = make_payment_payload($runId, 'supplier-unsafe', $unsafeSupplierFixture, 'supplier', false, true, -5.0);
    $unsafeSupplierSyncId = insert_sync_row($pdo, $unsafeSupplierPayload);
    $unsafeSupplierBefore = snapshot($pdo, $unsafeSupplierFixture, $unsafeSupplierSyncId, 'supplier');
    $unsafeSupplierReplay = replayStoredStandaloneSupplierPaymentV1Authorized($pdo, $unsafeSupplierSyncId, $auth);
    $unsafeSupplierAfter = snapshot($pdo, $unsafeSupplierFixture, $unsafeSupplierSyncId, 'supplier');

    echo json_encode([
        'ok' => true,
        'customerFixture' => $customerFixture,
        'customerSyncId' => $customerSyncId,
        'customerBefore' => $customerBefore,
        'customerFirst' => $customerFirst,
        'customerAfterFirst' => $customerAfterFirst,
        'customerSecond' => $customerSecond,
        'customerAfterSecond' => $customerAfterSecond,
        'supplierFixture' => $supplierFixture,
        'supplierSyncId' => $supplierSyncId,
        'supplierBefore' => $supplierBefore,
        'supplierFirst' => $supplierFirst,
        'supplierAfterFirst' => $supplierAfterFirst,
        'supplierSecond' => $supplierSecond,
        'supplierAfterSecond' => $supplierAfterSecond,
        'unsafeCustomerBefore' => $unsafeCustomerBefore,
        'unsafeCustomerReplay' => $unsafeCustomerReplay,
        'unsafeCustomerAfter' => $unsafeCustomerAfter,
        'unsafeSupplierBefore' => $unsafeSupplierBefore,
        'unsafeSupplierReplay' => $unsafeSupplierReplay,
        'unsafeSupplierAfter' => $unsafeSupplierAfter,
        'customerAuditRows' => audit_rows($pdo, $customerSyncId),
        'supplierAuditRows' => audit_rows($pdo, $supplierSyncId),
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
} finally {
    cleanup_fixture($pdo, $customerFixture ?? null, 'customer');
    cleanup_fixture($pdo, $supplierFixture ?? null, 'supplier');
    cleanup_fixture($pdo, $unsafeCustomerFixture ?? null, 'customer');
    cleanup_fixture($pdo, $unsafeSupplierFixture ?? null, 'supplier');
}

function make_payment_payload(string $runId, string $name, array $fixture, string $partyType, bool $ready, bool $missingServerId, float $amount): array {
    $clientId = $runId . '-' . $name . '-client';
    $localPaymentId = $partyType === 'customer' ? 91007 : 92007;
    $localPartyId = $partyType === 'customer' ? 91077 : 92077;
    $partyKey = $partyType === 'customer' ? 'customer' : 'supplier';
    $contractKey = $partyType === 'customer' ? 'standaloneCustomerPaymentReplay' : 'standaloneSupplierPaymentReplay';
    $scope = $partyType === 'customer' ? 'standalone_customer_payment' : 'standalone_supplier_payment';
    $serverId = $missingServerId ? null : $fixture['partyId'];
    $paymentDate = '2026-06-04';
    $reasons = [];
    if (!$ready) {
        $reasons[] = [
            'code' => $missingServerId ? 'missing_party_server_id' : 'invalid_payment_amount',
            'message' => 'Standalone Payment fixture intentionally lacks a required backend mapping or amount.',
            'localPaymentId' => $localPaymentId,
        ];
    }
    if ($amount <= 0) {
        $reasons[] = [
            'code' => 'invalid_payment_amount',
            'message' => 'Standalone Payment fixture uses an invalid amount.',
            'localPaymentId' => $localPaymentId,
        ];
    }
    $reasons = array_values(array_unique($reasons, SORT_REGULAR));
    $readiness = [
        'scope' => $scope,
        'payloadVersion' => 1,
        'status' => $reasons === [] ? 'ready' : 'unsafe',
        'reasons' => $reasons,
    ];
    $payableSnapshot = $partyType === 'customer'
        ? (float) $fixture['openingBalance']
        : (float) $fixture['openingPayable'] - (float) $fixture['openingPaid'];
    $balanceSnapshot = $payableSnapshot - $amount;
    $partyMapping = [
        'localId' => $localPartyId,
        'serverId' => $serverId,
        'nameSnapshot' => $fixture['partyName'],
    ];
    $payment = [
        'amount' => $amount,
        'paymentDate' => $paymentDate,
        'remarks' => $runId . ' standalone payment replay fixture',
        'invoiceNo' => '',
        'payableSnapshot' => $payableSnapshot,
        'balanceSnapshot' => $balanceSnapshot,
    ];
    $contract = [
        'payloadVersion' => 1,
        'operation' => 'create',
        'partyType' => $partyType,
        'localPaymentId' => $localPaymentId,
        'clientPaymentId' => $partyType . '-payment-local-' . $localPaymentId,
        'clientTransactionId' => $clientId,
        'createdAt' => 1770000000000,
        $partyKey => $partyMapping,
        'payment' => $payment,
        'replayReadiness' => $readiness,
    ];
    $storedPayment = [
        'id' => $localPaymentId,
        'amount' => $amount,
        'paymentDate' => $paymentDate,
        'remarks' => $payment['remarks'],
        'invoiceNo' => '',
        'payableSnapshot' => $payableSnapshot,
        'balanceSnapshot' => $balanceSnapshot,
    ];
    $storedPayment[$partyType === 'customer' ? 'customerId' : 'supplierId'] = $localPartyId;

    return [
        'clientTransactionId' => $clientId,
        'transactionType' => 'payment',
        'createdAt' => 1770000000000,
        'replayReadiness' => $readiness,
        'payload' => [
            'partyType' => $partyType,
            'payment' => $storedPayment,
            $partyKey => [
                'before' => [
                    'id' => $localPartyId,
                    'serverId' => $serverId,
                    'name' => $fixture['partyName'],
                    'invoices' => 1,
                    'payable' => $fixture['openingPayable'],
                    'paid' => $fixture['openingPaid'],
                    'balance' => $fixture['openingBalance'],
                ],
                'after' => [
                    'id' => $localPartyId,
                    'serverId' => $serverId,
                    'name' => $fixture['partyName'],
                    'invoices' => 1,
                    'payable' => $fixture['openingPayable'],
                    'paid' => $fixture['openingPaid'] + max(0, $amount),
                    'balance' => $fixture['openingBalance'] - max(0, $amount),
                ],
            ],
            $contractKey => $contract,
        ],
    ];
}

function ensure_fixture_tables(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS customer_payments (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, customerId BIGINT UNSIGNED NOT NULL, customerName VARCHAR(180) NULL, invoiceNo VARCHAR(120) NULL, amount DECIMAL(12,2) NOT NULL DEFAULT 0, paymentDate VARCHAR(50) NULL, remarks TEXT NULL, payableSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, balanceSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, sync_transaction_id BIGINT UNSIGNED NULL UNIQUE, client_transaction_id VARCHAR(150) NULL, sale_id BIGINT UNSIGNED NULL, source VARCHAR(80) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_customer_payments_customerId (customerId)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS supplier_payments (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, supplierId BIGINT UNSIGNED NOT NULL, supplierName VARCHAR(180) NULL, invoiceNo VARCHAR(120) NULL, amount DECIMAL(12,2) NOT NULL DEFAULT 0, paymentDate VARCHAR(50) NULL, remarks TEXT NULL, payableSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, balanceSnapshot DECIMAL(12,2) NOT NULL DEFAULT 0, sync_transaction_id BIGINT UNSIGNED NULL UNIQUE, client_transaction_id VARCHAR(150) NULL, sale_id BIGINT UNSIGNED NULL, source VARCHAR(80) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_supplier_payments_supplierId (supplierId)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    ensure_fixture_column($pdo, 'customer_payments', 'sync_transaction_id', 'BIGINT UNSIGNED NULL');
    ensure_fixture_column($pdo, 'customer_payments', 'client_transaction_id', 'VARCHAR(150) NULL');
    ensure_fixture_column($pdo, 'customer_payments', 'sale_id', 'BIGINT UNSIGNED NULL');
    ensure_fixture_column($pdo, 'customer_payments', 'source', 'VARCHAR(80) NULL');
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

function insert_party_fixture(PDO $pdo, string $prefix, string $partyType): array {
    $table = $partyType === 'customer' ? 'customers' : 'suppliers';
    $name = $prefix . '-mapped-' . $partyType;
    $statement = $pdo->prepare("INSERT INTO $table (client_id, name, mobile, cnic, address, invoices, payable, paid, balance, is_deleted) VALUES (:client, :name, '03111111111', 'standalone-payment-test', 'standalone payment replay fixture', 1, 100, :paid, :balance, 0)");
    $paid = $partyType === 'customer' ? 20.0 : 30.0;
    $balance = 100.0 - $paid;
    $statement->execute([
        'client' => $prefix . '-client',
        'name' => $name,
        'paid' => $paid,
        'balance' => $balance,
    ]);
    return [
        'prefix' => $prefix,
        'partyType' => $partyType,
        'partyId' => (int) $pdo->lastInsertId(),
        'partyName' => $name,
        'openingPayable' => 100.0,
        'openingPaid' => $paid,
        'openingBalance' => $balance,
    ];
}

function insert_sync_row(PDO $pdo, array $payload): int {
    $statement = $pdo->prepare("INSERT INTO sync_transactions (client_transaction_id, transaction_type, payload_json, status, replay_status, replay_attempts) VALUES (:client, 'payment', :payload, 'stored', 'stored', 0)");
    $statement->execute(['client' => $payload['clientTransactionId'], 'payload' => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]);
    return (int) $pdo->lastInsertId();
}

function snapshot(PDO $pdo, array $fixture, int $syncId, string $partyType): array {
    $partyTable = $partyType === 'customer' ? 'customers' : 'suppliers';
    $paymentTable = $partyType === 'customer' ? 'customer_payments' : 'supplier_payments';
    $partyColumn = $partyType === 'customer' ? 'customerId' : 'supplierId';
    $clientTransactionId = (string) scalar($pdo, 'SELECT client_transaction_id FROM sync_transactions WHERE id = :id', ['id' => $syncId]);
    return [
        'party' => row($pdo, "SELECT invoices, payable, paid, balance FROM $partyTable WHERE id = :id", ['id' => $fixture['partyId']]),
        'paymentCount' => (int) scalar($pdo, "SELECT COUNT(*) FROM $paymentTable WHERE sync_transaction_id = :id", ['id' => $syncId]),
        'paymentCountByClient' => (int) scalar($pdo, "SELECT COUNT(*) FROM $paymentTable WHERE client_transaction_id = :client_transaction_id", ['client_transaction_id' => $clientTransactionId]),
        'paymentRow' => row($pdo, "SELECT id, $partyColumn AS partyId, amount, paymentDate, remarks, payableSnapshot, balanceSnapshot, source FROM $paymentTable WHERE sync_transaction_id = :id LIMIT 1", ['id' => $syncId]),
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

function cleanup_fixture(PDO $pdo, ?array $fixture, string $partyType): void {
    if (!$fixture) return;
    $like = $fixture['prefix'] . '%';
    $partyTable = $partyType === 'customer' ? 'customers' : 'suppliers';
    $paymentTable = $partyType === 'customer' ? 'customer_payments' : 'supplier_payments';
    $partyColumn = $partyType === 'customer' ? 'customerId' : 'supplierId';
    $pdo->prepare('DELETE FROM transaction_replay_audit WHERE client_transaction_id LIKE :pattern')->execute(['pattern' => $like]);
    $pdo->prepare("DELETE FROM $paymentTable WHERE $partyColumn = :id OR client_transaction_id LIKE :pattern")->execute(['id' => $fixture['partyId'], 'pattern' => $like]);
    $pdo->prepare('DELETE FROM sync_transactions WHERE client_transaction_id LIKE :pattern')->execute(['pattern' => $like]);
    $pdo->prepare("DELETE FROM $partyTable WHERE id = :id")->execute(['id' => $fixture['partyId']]);
}
`;
}

function runPhpHarness() {
  const result = spawnSync(findPhpBinary(), ["-r", phpTestCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, STANDALONE_PAYMENT_V1_TEST_RUN_ID: runId },
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
const customerEndpointSource = readFileSync(resolve(projectRoot, "api/replay/customer-payment.php"), "utf8");
const supplierEndpointSource = readFileSync(resolve(projectRoot, "api/replay/supplier-payment.php"), "utf8");
const finalizedSaleEndpointSource = readFileSync(resolve(projectRoot, "api/replay/sale.php"), "utf8");
const result = runPhpHarness();

check("PHP standalone Payment replay harness completed", result, (value) => value.ok === true, "Harness failed.");
if (result.ok === true) {
  check("ready customer payment replays once", result, (value) =>
    value.customerFirst?.success === true &&
    value.customerFirst?.replayStatus === "committed" &&
    value.customerFirst?.partyType === "customer" &&
    Number(value.customerAfterFirst?.paymentCount) === 1 &&
    Number(value.customerAfterFirst?.paymentCountByClient) === 1,
  "Ready customer payment did not commit exactly once.");
  check("customer payment mutates paid and balance only", result, (value) =>
    nearlyEqual(value.customerBefore?.party?.payable, 100) &&
    nearlyEqual(value.customerAfterFirst?.party?.payable, 100) &&
    Number(value.customerAfterFirst?.party?.invoices) === 1 &&
    nearlyEqual(value.customerAfterFirst?.party?.paid, 45) &&
    nearlyEqual(value.customerAfterFirst?.party?.balance, 55),
  "Customer accounting mutation mismatch.");
  check("customer payment ledger row uses backend customer id and safe metadata", result, (value) =>
    Number(value.customerAfterFirst?.paymentRow?.partyId) === Number(value.customerFixture?.partyId) &&
    Number(value.customerAfterFirst?.paymentRow?.partyId) !== 91077 &&
    nearlyEqual(value.customerAfterFirst?.paymentRow?.amount, 25) &&
    value.customerAfterFirst?.paymentRow?.source === "standalone_payment_replay",
  "Customer payment row did not use backend id or safe replay metadata.");
  check("second customer replay creates no duplicate", result, (value) =>
    value.customerSecond?.success === true &&
    value.customerSecond?.terminalStateSkipped === true &&
    value.customerSecond?.alreadyCommitted === true &&
    JSON.stringify(value.customerAfterFirst) === JSON.stringify(value.customerAfterSecond),
  "Second customer payment replay changed state.");
  check("unsafe customer payment is rejected without mutation", result, (value) =>
    value.unsafeCustomerReplay?.success === false &&
    value.unsafeCustomerReplay?.reason === "invalid_standalone_customer_payment_contract" &&
    JSON.stringify(value.unsafeCustomerBefore) === JSON.stringify(value.unsafeCustomerAfter),
  "Unsafe customer payment replay changed state or was accepted.");

  check("ready supplier payment replays once", result, (value) =>
    value.supplierFirst?.success === true &&
    value.supplierFirst?.replayStatus === "committed" &&
    value.supplierFirst?.partyType === "supplier" &&
    Number(value.supplierAfterFirst?.paymentCount) === 1 &&
    Number(value.supplierAfterFirst?.paymentCountByClient) === 1,
  "Ready supplier payment did not commit exactly once.");
  check("supplier payment mutates paid and balance only", result, (value) =>
    nearlyEqual(value.supplierBefore?.party?.payable, 100) &&
    nearlyEqual(value.supplierAfterFirst?.party?.payable, 100) &&
    Number(value.supplierAfterFirst?.party?.invoices) === 1 &&
    nearlyEqual(value.supplierAfterFirst?.party?.paid, 65) &&
    nearlyEqual(value.supplierAfterFirst?.party?.balance, 35),
  "Supplier accounting mutation mismatch.");
  check("supplier payment ledger row uses backend supplier id and safe metadata", result, (value) =>
    Number(value.supplierAfterFirst?.paymentRow?.partyId) === Number(value.supplierFixture?.partyId) &&
    Number(value.supplierAfterFirst?.paymentRow?.partyId) !== 92077 &&
    nearlyEqual(value.supplierAfterFirst?.paymentRow?.amount, 35) &&
    value.supplierAfterFirst?.paymentRow?.source === "standalone_payment_replay",
  "Supplier payment row did not use backend id or safe replay metadata.");
  check("second supplier replay creates no duplicate", result, (value) =>
    value.supplierSecond?.success === true &&
    value.supplierSecond?.terminalStateSkipped === true &&
    value.supplierSecond?.alreadyCommitted === true &&
    JSON.stringify(value.supplierAfterFirst) === JSON.stringify(value.supplierAfterSecond),
  "Second supplier payment replay changed state.");
  check("unsafe supplier payment is rejected without mutation", result, (value) =>
    value.unsafeSupplierReplay?.success === false &&
    value.unsafeSupplierReplay?.reason === "invalid_standalone_supplier_payment_contract" &&
    JSON.stringify(value.unsafeSupplierBefore) === JSON.stringify(value.unsafeSupplierAfter),
  "Unsafe supplier payment replay changed state or was accepted.");
  check("actor attribution is recorded safely for standalone payments", result, (value) =>
    value.customerAuditRows?.some((row) => row.event_type === "standalone_customer_payment_v1_replay_completed" && row.actor_type === "replay_worker") &&
    value.supplierAuditRows?.some((row) => row.event_type === "standalone_supplier_payment_v1_replay_completed" && row.actor_type === "replay_worker"),
  "Standalone payment replay audit attribution missing.");
}

check("manual sync router stores then explicitly replays ready standalone payments", syncEngineSource, (source) =>
  source.includes("assertReadyStandaloneCustomerPaymentReplay(item.payload)") &&
    source.includes("assertReadyStandaloneSupplierPaymentReplay(item.payload)") &&
    source.includes("transactionApi.replayStandaloneCustomerPayment(item.payload.clientTransactionId)") &&
    source.includes("transactionApi.replayStandaloneSupplierPayment(item.payload.clientTransactionId)"),
"Frontend manual router does not call narrow standalone payment replay endpoints.");
check("transaction API targets narrow standalone payment endpoints", transactionApiSource, (source) =>
  source.includes('apiClient.post("/replay/customer-payment.php", { clientTransactionId })') &&
    source.includes('apiClient.post("/replay/supplier-payment.php", { clientTransactionId })') &&
    !source.includes("/replay/payment.php") &&
    !source.includes("/replay/standalone-payment.php"),
"Narrow standalone payment endpoints are not wired correctly.");
check("standalone payment endpoints require replay auth before execution", `${customerEndpointSource}\n${supplierEndpointSource}`, (source) =>
  source.includes("require_replay_request_auth($pdo)") &&
    source.includes("replayStoredStandaloneCustomerPaymentV1Authorized") &&
    source.includes("replayStoredStandaloneSupplierPaymentV1Authorized"),
"Standalone payment endpoint auth guard is missing.");
check("finalized Sale replay endpoint remains wired to Sale adapter", finalizedSaleEndpointSource, (source) =>
  source.includes("replayStoredFinalizedSaleV1Authorized") &&
    !source.includes("replayStoredStandaloneCustomerPaymentV1Authorized") &&
    !source.includes("replayStoredStandaloneSupplierPaymentV1Authorized"),
"Finalized Sale endpoint was altered unexpectedly.");

console.log(`Summary: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
