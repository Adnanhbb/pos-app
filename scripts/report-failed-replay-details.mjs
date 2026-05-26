#!/usr/bin/env node

/*
 * Dev-only failed replay detail report.
 *
 * Read-only: does not replay transactions, mutate backend rows, or print
 * payload_json/response_json/full record bodies.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost/jawad-bro/api";
const RECENT_LIMIT = Number(process.env.FAILED_REPLAY_DETAIL_LIMIT || 50);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");

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

function formatDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function safeMessage(value) {
  if (value === undefined || value === null || value === "") return "(empty)";
  return String(value)
    .replace(/\s+/g, " ")
    .slice(0, 220);
}

function sanitizeRow(row) {
  return {
    id: row.id ?? null,
    clientTransactionId: row.client_transaction_id ?? null,
    transactionType: row.transaction_type ?? null,
    replayStatus: row.replay_status ?? null,
    replayAttempts: Number(row.replay_attempts ?? 0),
    replayError: safeMessage(row.replay_error),
    lockedAtPresent: Boolean(row.locked_at),
    lockedByPresent: Boolean(row.locked_by),
    replayStartedAt: row.replay_started_at ?? null,
    replayStartedAtIso: formatDate(row.replay_started_at),
    replayFinishedAt: row.replay_finished_at ?? null,
    replayFinishedAtIso: formatDate(row.replay_finished_at),
    updatedAt: row.updated_at ?? null,
    updatedAtIso: formatDate(row.updated_at),
  };
}

function phpReportCode(limit) {
  return String.raw`
require_once getcwd() . '/api/config/database.php';

$pdo = get_pdo();
$limit = ` + Number(limit) + String.raw`;

$summaryRows = $pdo->query("
    SELECT
        transaction_type,
        replay_attempts,
        CASE WHEN replay_error IS NULL OR replay_error = '' THEN '(empty)' ELSE replay_error END AS replay_error,
        COUNT(*) AS count
    FROM sync_transactions
    WHERE replay_status = 'failed'
    GROUP BY transaction_type, replay_attempts, replay_error
    ORDER BY count DESC, transaction_type ASC, replay_attempts ASC
")->fetchAll();

$recentStatement = $pdo->prepare("
    SELECT
        id,
        client_transaction_id,
        transaction_type,
        replay_status,
        replay_attempts,
        replay_error,
        locked_at,
        locked_by,
        replay_started_at,
        replay_finished_at,
        updated_at
    FROM sync_transactions
    WHERE replay_status = 'failed'
    ORDER BY updated_at DESC, id DESC
    LIMIT :limit
");
$recentStatement->bindValue('limit', $limit, PDO::PARAM_INT);
$recentStatement->execute();
$recentRows = $recentStatement->fetchAll();

$attemptRows = $pdo->query("
    SELECT replay_attempts, COUNT(*) AS count
    FROM sync_transactions
    WHERE replay_status = 'failed'
    GROUP BY replay_attempts
    ORDER BY replay_attempts ASC
")->fetchAll();

$typeRows = $pdo->query("
    SELECT transaction_type, COUNT(*) AS count
    FROM sync_transactions
    WHERE replay_status = 'failed'
    GROUP BY transaction_type
    ORDER BY count DESC, transaction_type ASC
")->fetchAll();

$errorRows = $pdo->query("
    SELECT
        CASE WHEN replay_error IS NULL OR replay_error = '' THEN '(empty)' ELSE replay_error END AS replay_error,
        COUNT(*) AS count,
        MIN(updated_at) AS first_seen,
        MAX(updated_at) AS last_seen
    FROM sync_transactions
    WHERE replay_status = 'failed'
    GROUP BY replay_error
    ORDER BY count DESC, last_seen DESC
")->fetchAll();

echo json_encode([
    'ok' => true,
    'summaryRows' => $summaryRows,
    'recentRows' => $recentRows,
    'attemptRows' => $attemptRows,
    'typeRows' => $typeRows,
    'errorRows' => $errorRows,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
`;
}

function runPhpReport() {
  const phpBinary = findPhpBinary();
  const result = spawnSync(phpBinary, ["-r", phpReportCode(RECENT_LIMIT)], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 50,
  });

  if (result.error) {
    return { ok: false, error: `Failed to run PHP CLI: ${result.error.message}`, phpBinary };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      error: "PHP failed replay detail query failed.",
      status: result.status,
      stderr: result.stderr.trim(),
      phpBinary,
    };
  }

  try {
    return { ...JSON.parse(result.stdout), phpBinary };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      stdout: result.stdout,
      stderr: result.stderr,
      phpBinary,
    };
  }
}

function normalizeCountRows(rows, keyField) {
  return Object.fromEntries(
    (Array.isArray(rows) ? rows : []).map((row) => [String(row[keyField] ?? "unknown"), Number(row.count ?? 0)])
  );
}

function buildReport(result) {
  const recentRows = Array.isArray(result.recentRows) ? result.recentRows.map(sanitizeRow) : [];
  const errorRows = (Array.isArray(result.errorRows) ? result.errorRows : []).map((row) => ({
    replayError: safeMessage(row.replay_error),
    count: Number(row.count ?? 0),
    firstSeen: row.first_seen ?? null,
    firstSeenIso: formatDate(row.first_seen),
    lastSeen: row.last_seen ?? null,
    lastSeenIso: formatDate(row.last_seen),
  }));
  const summaryRows = (Array.isArray(result.summaryRows) ? result.summaryRows : []).map((row) => ({
    transactionType: row.transaction_type ?? null,
    replayAttempts: Number(row.replay_attempts ?? 0),
    replayError: safeMessage(row.replay_error),
    count: Number(row.count ?? 0),
  }));

  const totalFailedRows = errorRows.reduce((sum, row) => sum + row.count, 0);
  const retryLoopCandidates = recentRows.filter((row) => row.replayAttempts > 1);

  return {
    ok: true,
    readOnly: true,
    API_BASE_URL,
    recentLimit: RECENT_LIMIT,
    totalFailedRows,
    byTransactionType: normalizeCountRows(result.typeRows, "transaction_type"),
    byReplayAttempts: normalizeCountRows(result.attemptRows, "replay_attempts"),
    byReplayError: Object.fromEntries(errorRows.map((row) => [row.replayError, row.count])),
    dominantReplayErrors: errorRows.slice(0, 15),
    summaryByTypeAttemptAndError: summaryRows.slice(0, 50),
    retryLoopCandidates,
    recentRows,
    notes: [
      "This report is read-only and does not print payload_json or response_json.",
      "Replay errors are truncated safe messages for grouping and inspection.",
      "Rows with replayAttempts greater than 1 may indicate retry-loop candidates or intentional retry tests.",
    ],
  };
}

function main() {
  console.log("Dev-only failed replay detail report. Read-only; no replay is performed.");
  console.log(`API_BASE_URL: ${API_BASE_URL}`);

  const result = runPhpReport();
  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, readOnly: true, ...result }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(buildReport(result), null, 2));
}

main();