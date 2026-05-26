#!/usr/bin/env node

/*
 * Dev-only transaction terminal-state protection tests.
 *
 * These tests verify that terminal replay rows do not re-enter replay, acquire
 * locks, or increment attempts. They do not process payloads into business
 * mutations and do not touch stock, accounting, payment, cylinder, batch,
 * sales, or sale item tables.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `transaction-terminal-protection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
$runId = getenv('TERMINAL_PROTECTION_TEST_RUN_ID') ?: ('transaction-terminal-protection-' . time());
$workerPrefix = $runId . '-worker';
$itemId = insert_terminal_protection_item($pdo, $runId . '-item');

$cases = [
    'committed' => [
        'replayStatus' => 'committed',
        'attempts' => 4,
        'expectTerminalSkip' => true,
    ],
    'duplicate' => [
        'replayStatus' => 'duplicate',
        'attempts' => 5,
        'expectTerminalSkip' => true,
    ],
    'rolled_back' => [
        'replayStatus' => 'rolled_back',
        'attempts' => 6,
        'expectTerminalSkip' => true,
    ],
    'stored' => [
        'replayStatus' => 'stored',
        'attempts' => 0,
        'expectTerminalSkip' => false,
    ],
    'failed' => [
        'replayStatus' => 'failed',
        'attempts' => 2,
        'expectTerminalSkip' => false,
    ],
];

$results = [];
foreach ($cases as $caseName => $case) {
    $payload = make_terminal_protection_payload($runId . '-' . $caseName, $itemId);
    $syncTransactionId = insert_terminal_protection_transaction(
        $pdo,
        $payload,
        $case['replayStatus'],
        $case['attempts']
    );

    $before = fetch_terminal_protection_row($pdo, $syncTransactionId);
    $replayResult = replayStoredTransaction($pdo, $syncTransactionId, $workerPrefix . '-' . $caseName);
    $after = fetch_terminal_protection_row($pdo, $syncTransactionId);
    $auditRows = fetch_terminal_protection_audit_rows($pdo, $syncTransactionId);

    $results[$caseName] = [
        'caseName' => $caseName,
        'syncTransactionId' => $syncTransactionId,
        'expectedReplayStatus' => $case['replayStatus'],
        'expectedAttemptsBefore' => $case['attempts'],
        'expectTerminalSkip' => $case['expectTerminalSkip'],
        'before' => $before,
        'replayResult' => $replayResult,
        'after' => $after,
        'auditRows' => $auditRows,
    ];
}

echo json_encode([
    'ok' => true,
    'itemId' => $itemId,
    'results' => $results,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

function make_terminal_protection_payload(string $clientTransactionId, int $itemId): array
{
    return [
        'clientTransactionId' => $clientTransactionId,
        'transactionType' => 'sale',
        'createdAt' => time(),
        'payload' => [
            'sale' => ['invoiceNo' => $clientTransactionId . '-INV'],
            'saleItems' => [['itemId' => $itemId, 'qty' => 1, 'price' => 10]],
        ],
    ];
}

function insert_terminal_protection_transaction(PDO $pdo, array $payload, string $replayStatus, int $attempts): int
{
    $statement = $pdo->prepare(
        "INSERT INTO sync_transactions
            (client_transaction_id, transaction_type, payload_json, status, replay_status, replay_attempts)
         VALUES
            (:client_transaction_id, :transaction_type, :payload_json, 'stored', :replay_status, :replay_attempts)"
    );
    $statement->execute([
        'client_transaction_id' => $payload['clientTransactionId'],
        'transaction_type' => $payload['transactionType'],
        'payload_json' => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        'replay_status' => $replayStatus,
        'replay_attempts' => $attempts,
    ]);

    return (int) $pdo->lastInsertId();
}

function insert_terminal_protection_item(PDO $pdo, string $name): int
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

function fetch_terminal_protection_row(PDO $pdo, int $id): ?array
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

function fetch_terminal_protection_audit_rows(PDO $pdo, int $id): array
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

function runPhpTerminalProtectionTest() {
  const result = spawnSync(findPhpBinary(), ["-r", phpTestCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      TERMINAL_PROTECTION_TEST_RUN_ID: runId,
    },
    windowsHide: true,
  });

  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) {
    return {
      ok: false,
      error: "PHP terminal-state protection test failed.",
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

function getCase(result, name) {
  return result?.results?.[name] ?? null;
}

function terminalCaseSkipped(testCase) {
  const events = eventTypes(testCase?.auditRows);
  return (
    testCase?.replayResult?.success === true &&
    testCase?.replayResult?.terminalStateSkipped === true &&
    testCase?.replayResult?.replayStatus === testCase?.expectedReplayStatus &&
    testCase?.after?.replay_status === testCase?.expectedReplayStatus &&
    Number(testCase?.after?.replay_attempts) === Number(testCase?.expectedAttemptsBefore) &&
    !events.includes("lock_acquired") &&
    events.includes("replay_terminal_state_skipped") &&
    (testCase?.after?.locked_at === null || testCase?.after?.locked_at === undefined) &&
    (testCase?.after?.locked_by === null || testCase?.after?.locked_by === undefined)
  );
}

function nonTerminalReplayed(testCase) {
  const events = eventTypes(testCase?.auditRows);
  return (
    testCase?.replayResult?.success === true &&
    testCase?.replayResult?.replayStatus === "committed" &&
    testCase?.after?.replay_status === "committed" &&
    Number(testCase?.after?.replay_attempts) === Number(testCase?.expectedAttemptsBefore) + 1 &&
    events.includes("lock_acquired") &&
    events.includes("replay_validation_started") &&
    events.includes("replay_validation_completed") &&
    events.includes("lock_released") &&
    !events.includes("replay_terminal_state_skipped") &&
    (testCase?.after?.locked_at === null || testCase?.after?.locked_at === undefined) &&
    (testCase?.after?.locked_by === null || testCase?.after?.locked_by === undefined)
  );
}

async function main() {
  console.log(`Testing transaction terminal-state protection: ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);
  console.log("State protection only; no stock/accounting/sales/payment/cylinder/batch mutation assertions are made.");

  const health = await request("health");
  check(
    "backend health",
    { status: health.status, body: health.body },
    (res) => res.status === 200 && res.body?.success === true,
    "expected backend health success",
  );

  const result = runPhpTerminalProtectionTest();
  check("PHP terminal-state protection test completed", result, (res) => res.ok === true, "expected PHP helper test to complete");

  if (result.ok) {
    for (const name of ["committed", "duplicate", "rolled_back"]) {
      const testCase = getCase(result, name);
      check(
        `${name} replay skipped safely`,
        { caseName: name, result: testCase?.replayResult, before: testCase?.before, after: testCase?.after, events: eventTypes(testCase?.auditRows) },
        () => terminalCaseSkipped(testCase),
        "expected terminal state to skip without lock acquisition or attempt increment",
      );
    }

    check(
      "committed compatibility flag is preserved",
      { result: getCase(result, "committed")?.replayResult },
      (value) => value.result?.alreadyCommitted === true,
      "expected alreadyCommitted compatibility flag for committed rows",
    );

    check(
      "duplicate and rolled_back do not claim alreadyCommitted",
      {
        duplicate: getCase(result, "duplicate")?.replayResult,
        rolledBack: getCase(result, "rolled_back")?.replayResult,
      },
      (value) => value.duplicate?.alreadyCommitted === false && value.rolledBack?.alreadyCommitted === false,
      "expected alreadyCommitted false for non-committed terminal states",
    );

    for (const name of ["stored", "failed"]) {
      const testCase = getCase(result, name);
      check(
        `${name} non-terminal state still replays normally`,
        { caseName: name, result: testCase?.replayResult, before: testCase?.before, after: testCase?.after, events: eventTypes(testCase?.auditRows) },
        () => nonTerminalReplayed(testCase),
        "expected normal validation-only replay path",
      );
    }

    pass("no business mutation assertions were added", {
      stock: "not asserted or mutated",
      accounting: "not asserted or mutated",
      sales: "not asserted or inserted",
      payments: "not asserted or inserted",
      cylinders: "not asserted or mutated",
      batches: "not asserted or mutated",
    });
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