#!/usr/bin/env node

/*
 * Dev-only transaction replay audit report.
 *
 * This script is read-only: it does not call syncEngine, replay transactions,
 * mutate backend rows, or print transaction payload bodies.
 *
 * It uses PHP CLI plus api/config/database.php so it can inspect the local
 * shared-hosting-style database without adding a new HTTP endpoint.
 *
 * Windows PowerShell:
 *   $env:API_BASE_URL="http://localhost/jawad-bro/api"
 *   npm run sync:report-replay-audit
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
const RECENT_LIMIT = Number.parseInt(process.env.REPLAY_AUDIT_LIMIT || "25", 10);

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

function toTime(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value).replace(" ", "T")).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item) ?? "none";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function sanitizeRow(row) {
  return {
    id: row.id ?? null,
    syncTransactionId: row.sync_transaction_id ?? null,
    clientTransactionId: row.client_transaction_id ?? null,
    eventType: row.event_type ?? null,
    statusBefore: row.status_before ?? null,
    statusAfter: row.status_after ?? null,
    message: row.message ?? null,
    createdAt: row.created_at ?? null,
    createdAtIso: formatDate(row.created_at),
  };
}

function phpReportCode(limit) {
  return String.raw`
require_once getcwd() . '/api/config/database.php';

$limit = max(1, min(200, (int) getenv('REPLAY_AUDIT_LIMIT')));
if ($limit <= 0) {
    $limit = ${limit};
}

$pdo = get_pdo();
$allSql = "
    SELECT
        id,
        sync_transaction_id,
        client_transaction_id,
        event_type,
        status_before,
        status_after,
        message,
        created_at
    FROM transaction_replay_audit
    ORDER BY created_at ASC, id ASC
";
$recentSql = "
    SELECT
        id,
        sync_transaction_id,
        client_transaction_id,
        event_type,
        status_before,
        status_after,
        message,
        created_at
    FROM transaction_replay_audit
    ORDER BY created_at DESC, id DESC
    LIMIT " . $limit;

$rows = $pdo->query($allSql)->fetchAll();
$recentRows = $pdo->query($recentSql)->fetchAll();

echo json_encode([
    'ok' => true,
    'rows' => $rows,
    'recentRows' => $recentRows,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
`;
}

function runPhpReport() {
  const phpBinary = findPhpBinary();
  const env = {
    ...process.env,
    REPLAY_AUDIT_LIMIT: String(Number.isFinite(RECENT_LIMIT) && RECENT_LIMIT > 0 ? RECENT_LIMIT : 25),
  };
  const result = spawnSync(phpBinary, ["-r", phpReportCode(RECENT_LIMIT)], {
    cwd: projectRoot,
    encoding: "utf8",
    env,
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
      error: "PHP replay audit report query failed.",
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

function buildReport(rows, recentRows) {
  const safeRows = rows.map(sanitizeRow);
  const safeRecentRows = recentRows.map(sanitizeRow);
  const timestamps = safeRows
    .map((row) => toTime(row.createdAt))
    .filter((value) => value !== null);
  const oldest = timestamps.length ? Math.min(...timestamps) : null;
  const newest = timestamps.length ? Math.max(...timestamps) : null;

  return {
    ok: true,
    readOnly: true,
    API_BASE_URL,
    recentLimit: Number.isFinite(RECENT_LIMIT) && RECENT_LIMIT > 0 ? RECENT_LIMIT : 25,
    totalAuditRows: safeRows.length,
    byEventType: countBy(safeRows, (row) => row.eventType),
    byStatusBefore: countBy(safeRows, (row) => row.statusBefore),
    byStatusAfter: countBy(safeRows, (row) => row.statusAfter),
    oldestCreatedAt: oldest,
    oldestCreatedAtIso: oldest === null ? null : new Date(oldest).toISOString(),
    newestCreatedAt: newest,
    newestCreatedAtIso: newest === null ? null : new Date(newest).toISOString(),
    recentRows: safeRecentRows,
  };
}

function main() {
  console.log("Dev-only transaction replay audit report. Read-only; no replay is performed.");
  console.log(`API_BASE_URL: ${API_BASE_URL}`);

  const result = runPhpReport();

  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, readOnly: true, ...result }, null, 2));
    process.exitCode = 1;
    return;
  }

  const rows = Array.isArray(result.rows) ? result.rows : [];
  const recentRows = Array.isArray(result.recentRows) ? result.recentRows : [];
  console.log(JSON.stringify(buildReport(rows, recentRows), null, 2));
}

main();