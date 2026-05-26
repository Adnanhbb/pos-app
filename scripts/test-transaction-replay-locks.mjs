#!/usr/bin/env node

/*
 * Dev-only transaction replay lock primitive tests.
 *
 * These tests exercise replay metadata locking only. They do not process
 * payloads, replay transactions, or mutate stock/accounting/cylinder/batch/
 * payment/sales tables. Output intentionally avoids payload bodies.
 *
 * Windows PowerShell:
 *   $env:API_BASE_URL="http://localhost/jawad-bro/api"
 *   npm run test:transactions:locks
 *
 * Optional PHP path override:
 *   $env:PHP_BIN="C:\laragon\bin\php\php-8.3.16-Win32-vs16-x64\php.exe"
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `transaction-locks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
require_once getcwd() . '/api/lib/transactionReplayLock.php';

$pdo = get_pdo();
$runId = getenv('LOCK_TEST_RUN_ID') ?: ('transaction-locks-' . time());
$clientTransactionId = $runId . '-lock-target';
$payloadJson = json_encode([
    'clientTransactionId' => $clientTransactionId,
    'transactionType' => 'sale',
    'createdAt' => time(),
    'payload' => ['test' => 'lock-only-no-replay'],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

$pdo->beginTransaction();
try {
    $insert = $pdo->prepare(
        "INSERT INTO sync_transactions
            (client_transaction_id, transaction_type, payload_json, status, replay_status, replay_attempts)
         VALUES
            (:client_transaction_id, 'sale', :payload_json, 'stored', 'stored', 0)"
    );
    $insert->execute([
        'client_transaction_id' => $clientTransactionId,
        'payload_json' => $payloadJson,
    ]);
    $syncTransactionId = (int) $pdo->lastInsertId();

    $workerA = $runId . '-worker-a';
    $workerB = $runId . '-worker-b';

    $acquireA = acquireReplayLock($pdo, $syncTransactionId, $workerA);
    $rowAfterAcquire = fetch_lock_test_row($pdo, $syncTransactionId);
    $acquireB = acquireReplayLock($pdo, $syncTransactionId, $workerB);
    $wrongRelease = releaseReplayLock($pdo, $syncTransactionId, $workerB, 'failed', 'wrong worker test');
    $rowAfterWrongRelease = fetch_lock_test_row($pdo, $syncTransactionId);
    $releaseA = releaseReplayLock($pdo, $syncTransactionId, $workerA, 'stored', null);
    $rowAfterRelease = fetch_lock_test_row($pdo, $syncTransactionId);
    $auditRows = fetch_lock_test_audit_rows($pdo, $syncTransactionId);

    $pdo->commit();

    echo json_encode([
        'ok' => true,
        'syncTransactionId' => $syncTransactionId,
        'clientTransactionId' => $clientTransactionId,
        'acquireA' => $acquireA,
        'rowAfterAcquire' => $rowAfterAcquire,
        'acquireB' => $acquireB,
        'wrongRelease' => $wrongRelease,
        'rowAfterWrongRelease' => $rowAfterWrongRelease,
        'releaseA' => $releaseA,
        'rowAfterRelease' => $rowAfterRelease,
        'auditRows' => $auditRows,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    echo json_encode([
        'ok' => false,
        'error' => $exception->getMessage(),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit(1);
}

function fetch_lock_test_row(PDO $pdo, int $syncTransactionId): ?array
{
    $statement = $pdo->prepare(
        "SELECT
            id,
            client_transaction_id,
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
    $statement->execute(['id' => $syncTransactionId]);
    $row = $statement->fetch();

    return $row ?: null;
}

function fetch_lock_test_audit_rows(PDO $pdo, int $syncTransactionId): array
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
         WHERE sync_transaction_id = :sync_transaction_id
         ORDER BY id ASC"
    );
    $statement->execute(['sync_transaction_id' => $syncTransactionId]);

    return $statement->fetchAll();
}
`;
}

function runPhpLockTest() {
  const result = spawnSync(findPhpBinary(), ["-r", phpTestCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      LOCK_TEST_RUN_ID: runId,
    },
    windowsHide: true,
  });

  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) {
    return {
      ok: false,
      error: "PHP lock test failed.",
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

function auditEventTypes(result) {
  return Array.isArray(result.auditRows) ? result.auditRows.map((row) => row.event_type) : [];
}

async function main() {
  console.log(`Testing transaction replay lock helpers: ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);
  console.log("Lock metadata only; no replay or stock/accounting mutation assertions are made.");

  const health = await request("health");
  check(
    "backend health",
    { status: health.status, body: health.body },
    (res) => res.status === 200 && res.body?.success === true,
    "expected backend health success",
  );

  const result = runPhpLockTest();
  check("PHP lock helper test completed", result, (res) => res.ok === true, "expected PHP helper test to complete");

  if (result.ok) {
    check(
      "can acquire lock on stored transaction",
      {
        acquireA: result.acquireA,
        rowAfterAcquire: result.rowAfterAcquire,
      },
      (res) =>
        res.acquireA?.success === true &&
        res.rowAfterAcquire?.replay_status === "processing" &&
        Number(res.rowAfterAcquire?.replay_attempts) === 1 &&
        Boolean(res.rowAfterAcquire?.locked_at) &&
        Boolean(res.rowAfterAcquire?.locked_by),
      "expected processing status, one attempt, and lock owner metadata",
    );

    check(
      "second worker cannot acquire same lock",
      { acquireB: result.acquireB },
      (res) => res.acquireB?.success === false && res.acquireB?.reason === "not_lockable",
      "expected second acquire to fail safely",
    );

    check(
      "wrong worker cannot release lock",
      {
        wrongRelease: result.wrongRelease,
        rowAfterWrongRelease: result.rowAfterWrongRelease,
      },
      (res) =>
        res.wrongRelease?.success === false &&
        res.wrongRelease?.reason === "worker_mismatch" &&
        res.rowAfterWrongRelease?.replay_status === "processing" &&
        Boolean(res.rowAfterWrongRelease?.locked_by),
      "expected wrong worker release to fail and keep lock intact",
    );

    check(
      "correct worker can release lock",
      {
        releaseA: result.releaseA,
        rowAfterRelease: result.rowAfterRelease,
      },
      (res) =>
        res.releaseA?.success === true &&
        res.rowAfterRelease?.replay_status === "stored" &&
        (res.rowAfterRelease?.locked_at === null || res.rowAfterRelease?.locked_at === undefined) &&
        (res.rowAfterRelease?.locked_by === null || res.rowAfterRelease?.locked_by === undefined) &&
        Boolean(res.rowAfterRelease?.replay_finished_at),
      "expected lock cleared and replay status restored",
    );

    check(
      "replay_attempts increments once on acquisition",
      { rowAfterRelease: result.rowAfterRelease },
      (res) => Number(res.rowAfterRelease?.replay_attempts) === 1,
      "expected exactly one replay attempt increment",
    );

    check(
      "audit rows are created for lock events",
      {
        syncTransactionId: result.syncTransactionId,
        auditRows: result.auditRows,
        eventTypes: auditEventTypes(result),
      },
      (res) =>
        Array.isArray(res.auditRows) &&
        res.auditRows.length >= 4 &&
        res.eventTypes.includes("lock_acquired") &&
        res.eventTypes.includes("lock_acquire_failed") &&
        res.eventTypes.includes("lock_release_failed") &&
        res.eventTypes.includes("lock_released"),
      "expected lock acquired/failed/released audit events",
    );
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