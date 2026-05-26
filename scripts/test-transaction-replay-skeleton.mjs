#!/usr/bin/env node

/*
 * Dev-only transaction replay skeleton tests.
 *
 * This exercises lock/status/audit/rollback flow only. It does not process
 * transaction payloads into business mutations and does not touch stock,
 * accounting, payment, cylinder, batch, sales, or sale item tables.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `transaction-replay-skeleton-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
$runId = getenv('REPLAY_SKELETON_TEST_RUN_ID') ?: ('transaction-replay-skeleton-' . time());
$workerId = $runId . '-worker';
$itemId = insert_replay_skeleton_item($pdo, $runId . '-item');

$validId = insert_replay_skeleton_row($pdo, $runId . '-valid', [
    'clientTransactionId' => $runId . '-valid',
    'transactionType' => 'sale',
    'createdAt' => time(),
    'payload' => [
        'sale' => ['invoiceNo' => $runId . '-INV'],
        'saleItems' => [['itemId' => $itemId, 'qty' => 1, 'price' => 10]],
    ],
]);

$validFirst = replayStoredTransaction($pdo, $validId, $workerId);
$validRowAfterFirst = fetch_replay_skeleton_row($pdo, $validId);
$validAuditAfterFirst = fetch_replay_skeleton_audit_rows($pdo, $validId);
$validSecond = replayStoredTransaction($pdo, $validId, $workerId . '-second');
$validRowAfterSecond = fetch_replay_skeleton_row($pdo, $validId);
$validAuditAfterSecond = fetch_replay_skeleton_audit_rows($pdo, $validId);

$badId = insert_replay_skeleton_raw_row($pdo, $runId . '-bad-json', '{broken json');
$badResult = replayStoredTransaction($pdo, $badId, $workerId . '-bad');
$badRowAfter = fetch_replay_skeleton_row($pdo, $badId);
$badAuditRows = fetch_replay_skeleton_audit_rows($pdo, $badId);

echo json_encode([
    'ok' => true,
    'validId' => $validId,
    'validFirst' => $validFirst,
    'validRowAfterFirst' => $validRowAfterFirst,
    'validAuditAfterFirst' => $validAuditAfterFirst,
    'validSecond' => $validSecond,
    'validRowAfterSecond' => $validRowAfterSecond,
    'validAuditAfterSecond' => $validAuditAfterSecond,
    'badId' => $badId,
    'badResult' => $badResult,
    'badRowAfter' => $badRowAfter,
    'badAuditRows' => $badAuditRows,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

function insert_replay_skeleton_row(PDO $pdo, string $clientTransactionId, array $payload): int
{
    $payloadJson = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return insert_replay_skeleton_raw_row($pdo, $clientTransactionId, $payloadJson);
}

function insert_replay_skeleton_raw_row(PDO $pdo, string $clientTransactionId, string $payloadJson): int
{
    $statement = $pdo->prepare(
        "INSERT INTO sync_transactions
            (client_transaction_id, transaction_type, payload_json, status, replay_status, replay_attempts)
         VALUES
            (:client_transaction_id, 'sale', :payload_json, 'stored', 'stored', 0)"
    );
    $statement->execute([
        'client_transaction_id' => $clientTransactionId,
        'payload_json' => $payloadJson,
    ]);

    return (int) $pdo->lastInsertId();
}
function insert_replay_skeleton_item(PDO $pdo, string $name): int
{
    $statement = $pdo->prepare(
        "INSERT INTO items
            (client_id, name, purchasePrice, retailPrice, discountPrice, wholesalePrice, availableStock, ConvQty)
         VALUES
            (:client_id, :name, 1, 2, 0, 2, 10, 1)"
    );
    $statement->execute([
        'client_id' => $name,
        'name' => $name,
    ]);

    return (int) $pdo->lastInsertId();
}

function fetch_replay_skeleton_row(PDO $pdo, int $id): ?array
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
    $statement->execute(['id' => $id]);
    $row = $statement->fetch();

    return $row ?: null;
}

function fetch_replay_skeleton_audit_rows(PDO $pdo, int $id): array
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

function runPhpReplaySkeletonTest() {
  const result = spawnSync(findPhpBinary(), ["-r", phpTestCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      REPLAY_SKELETON_TEST_RUN_ID: runId,
    },
    windowsHide: true,
  });

  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) {
    return {
      ok: false,
      error: "PHP replay skeleton test failed.",
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

async function main() {
  console.log(`Testing transaction replay skeleton: ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);
  console.log("Replay skeleton plus stock-only replay; no accounting/sales/payment/cylinder/batch mutation assertions are made.");

  const health = await request("health");
  check(
    "backend health",
    { status: health.status, body: health.body },
    (res) => res.status === 200 && res.body?.success === true,
    "expected backend health success",
  );

  const result = runPhpReplaySkeletonTest();
  check("PHP replay skeleton test completed", result, (res) => res.ok === true, "expected PHP helper test to complete");

  if (result.ok) {
    check(
      "valid stored transaction becomes committed",
      { result: result.validFirst, row: result.validRowAfterFirst },
      (value) =>
        value.result?.success === true &&
        value.result?.replayStatus === "committed" &&
        value.result?.businessMutationsApplied === true &&
        value.row?.replay_status === "committed",
      "expected replay skeleton to commit metadata and stock-only mutation",
    );

    check(
      "lock is released after successful skeleton replay",
      { row: result.validRowAfterFirst },
      (value) =>
        (value.row?.locked_at === null || value.row?.locked_at === undefined) &&
        (value.row?.locked_by === null || value.row?.locked_by === undefined) &&
        Boolean(value.row?.replay_finished_at),
      "expected lock fields cleared",
    );

    check(
      "replay_attempts increments on successful acquisition",
      { row: result.validRowAfterFirst },
      (value) => Number(value.row?.replay_attempts) === 1,
      "expected one replay attempt",
    );

    check(
      "successful skeleton replay audit rows are created",
      { events: eventTypes(result.validAuditAfterFirst), rows: result.validAuditAfterFirst },
      (value) =>
        value.events.includes("lock_acquired") &&
        value.events.includes("replay_validation_started") &&
        value.events.includes("replay_validation_completed") &&
        value.events.includes("lock_released"),
      "expected lock and validation audit events",
    );

    check(
      "second replay is handled safely without another attempt",
      { result: result.validSecond, row: result.validRowAfterSecond },
      (value) =>
        value.result?.success === true &&
        value.result?.alreadyCommitted === true &&
        value.row?.replay_status === "committed" &&
        Number(value.row?.replay_attempts) === 1,
      "expected already committed response and no second attempt increment",
    );

    check(
      "malformed stored payload fails safely",
      { result: result.badResult, row: result.badRowAfter },
      (value) =>
        value.result?.success === false &&
        value.result?.reason === "validation_failed" &&
        value.row?.replay_status === "failed" &&
        Number(value.row?.has_replay_error ?? 0) === 1,
      "expected failed replay metadata without business mutation",
    );

    check(
      "failed skeleton replay releases lock and writes audit",
      { row: result.badRowAfter, events: eventTypes(result.badAuditRows), rows: result.badAuditRows },
      (value) =>
        (value.row?.locked_at === null || value.row?.locked_at === undefined) &&
        (value.row?.locked_by === null || value.row?.locked_by === undefined) &&
        value.events.includes("lock_acquired") &&
        value.events.includes("replay_failed") &&
        value.events.includes("lock_released"),
      "expected failed validation audit and released lock",
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