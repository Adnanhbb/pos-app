#!/usr/bin/env node

/*
 * Dev-only stored transaction sync report.
 *
 * This script is read-only: it does not call syncEngine, replay transactions,
 * mutate backend rows, or print full payload_json/response_json bodies.
 *
 * It uses PHP CLI plus api/config/database.php so it can inspect the local
 * shared-hosting-style database without adding a new HTTP endpoint.
 *
 * Windows PowerShell:
 *   $env:API_BASE_URL="http://localhost/jawad-bro/api"
 *   npm run sync:report-transactions
 *
 * Optional PHP path override:
 *   $env:PHP_BIN="C:\laragon\bin\php\php-8.3.16-Win32-vs16-x64\php.exe"
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost/jawad-bro/api";

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
  if (!Number.isNaN(date.getTime())) return date.toISOString();

  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    const numericDate = new Date(numeric);
    return Number.isNaN(numericDate.getTime()) ? String(value) : numericDate.toISOString();
  }

  return String(value);
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function toTime(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value).replace(" ", "T")).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function sanitizeRow(row) {
  return {
    id: row.id ?? null,
    clientTransactionId: row.client_transaction_id ?? null,
    transactionType: row.transaction_type ?? null,
    status: row.status ?? null,
    replayStatus: row.replay_status ?? null,
    replayAttempts: Number(row.replay_attempts ?? 0),
    replayStartedAt: row.replay_started_at ?? null,
    replayStartedAtIso: formatDate(row.replay_started_at),
    replayFinishedAt: row.replay_finished_at ?? null,
    replayFinishedAtIso: formatDate(row.replay_finished_at),
    hasReplayError: Boolean(Number(row.has_replay_error ?? 0)),
    lockedAtPresent: Boolean(row.locked_at),
    lockedByPresent: Boolean(row.locked_by),
    idempotencyStatus: row.idempotency_status ?? null,
    createdAt: row.created_at ?? null,
    createdAtIso: formatDate(row.created_at),
    updatedAt: row.updated_at ?? null,
    updatedAtIso: formatDate(row.updated_at),
    idempotencyUpdatedAt: row.idempotency_updated_at ?? null,
    idempotencyUpdatedAtIso: formatDate(row.idempotency_updated_at),
    hasIdempotencyRecord: Boolean(row.idempotency_status),
    hasResponse: Boolean(Number(row.has_response ?? 0)),
    hasError: Boolean(Number(row.has_error ?? 0)),
    errorMessage: row.error_message ?? null,
  };
}

function phpReportCode() {
  return String.raw`
require_once getcwd() . '/api/config/database.php';

$pdo = get_pdo();
$sql = "
    SELECT
        st.id,
        st.client_transaction_id,
        st.transaction_type,
        st.status,
        st.replay_status,
        st.replay_attempts,
        st.replay_started_at,
        st.replay_finished_at,
        CASE WHEN st.replay_error IS NULL OR st.replay_error = '' THEN 0 ELSE 1 END AS has_replay_error,
        st.locked_at,
        st.locked_by,
        st.created_at,
        st.updated_at,
        ti.status AS idempotency_status,
        ti.updated_at AS idempotency_updated_at,
        CASE WHEN ti.response_json IS NULL OR ti.response_json = '' THEN 0 ELSE 1 END AS has_response,
        CASE WHEN ti.error_message IS NULL OR ti.error_message = '' THEN 0 ELSE 1 END AS has_error,
        ti.error_message
    FROM sync_transactions st
    LEFT JOIN transaction_idempotency ti
        ON ti.client_transaction_id = st.client_transaction_id
    ORDER BY st.created_at ASC, st.id ASC
";

$rows = $pdo->query($sql)->fetchAll();

echo json_encode([
    'ok' => true,
    'rows' => $rows,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
`;
}

function runPhpReport() {
  const phpBinary = findPhpBinary();
  const result = spawnSync(phpBinary, ["-r", phpReportCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 100,
  });

  if (result.error) {
    return {
      ok: false,
      error: `Failed to run PHP CLI: ${result.error.message}`,
      phpBinary,
      hint: "Set PHP_BIN to your php.exe path or ensure Laragon PHP is available in PATH.",
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      error: "PHP transaction report query failed.",
      status: result.status,
      phpBinary,
      stderr: result.stderr.trim(),
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

function buildReport(rows) {
  const safeRows = rows.map(sanitizeRow);
  const timestamps = safeRows
    .map((row) => toTime(row.createdAt))
    .filter((value) => value !== null);
  const oldest = timestamps.length ? Math.min(...timestamps) : null;
  const newest = timestamps.length ? Math.max(...timestamps) : null;

  return {
    ok: true,
    readOnly: true,
    API_BASE_URL,
    totalTransactions: safeRows.length,
    byTransactionType: countBy(safeRows, (row) => row.transactionType),
    byStatus: countBy(safeRows, (row) => row.status),
    byReplayStatus: countBy(safeRows, (row) => row.replayStatus),
    byIdempotencyStatus: countBy(safeRows, (row) => row.idempotencyStatus),
    oldestCreatedAt: oldest,
    oldestCreatedAtIso: oldest === null ? null : new Date(oldest).toISOString(),
    newestCreatedAt: newest,
    newestCreatedAtIso: newest === null ? null : new Date(newest).toISOString(),
    rows: safeRows,
  };
}

function main() {
  console.log("Dev-only stored transaction sync report. Read-only; no replay is performed.");
  console.log(`API_BASE_URL: ${API_BASE_URL}`);

  const result = runPhpReport();

  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, readOnly: true, ...result }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(buildReport(Array.isArray(result.rows) ? result.rows : []), null, 2));
}

main();