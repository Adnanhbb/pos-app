#!/usr/bin/env node

/*
 * Dev-only stale replay lock report.
 *
 * This script is read-only: it does not release locks, replay transactions,
 * mutate sync_transactions, write audit rows, or print payload bodies.
 *
 * Windows PowerShell:
 *   $env:API_BASE_URL="http://localhost/jawad-bro/api"
 *   npm run sync:report-stale-replay-locks
 *
 * Optional threshold:
 *   npm run sync:report-stale-replay-locks -- --older-than-minutes=5
 *
 * Optional PHP path override:
 *   $env:PHP_BIN="C:\laragon\bin\php\php-8.3.16-Win32-vs16-x64\php.exe"
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost/jawad-bro/api";
const thresholdMinutes = parseThresholdMinutes(process.argv.slice(2));

function parseThresholdMinutes(args) {
  const arg = args.find((value) => value.startsWith("--older-than-minutes="));
  if (!arg) return 15;

  const value = Number.parseInt(arg.split("=")[1] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : 15;
}

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
    const key = getKey(item) || "none";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function sanitizeRow(row) {
  return {
    id: row.id ?? null,
    clientTransactionId: row.client_transaction_id ?? null,
    replayStatus: row.replay_status ?? null,
    replayAttempts: Number(row.replay_attempts ?? 0),
    lockedAt: row.locked_at ?? null,
    lockedAtIso: formatDate(row.locked_at),
    lockedBy: row.locked_by ?? null,
    replayStartedAt: row.replay_started_at ?? null,
    replayStartedAtIso: formatDate(row.replay_started_at),
    hasReplayError: Boolean(Number(row.has_replay_error ?? 0)),
  };
}

function phpReportCode() {
  return String.raw`
require_once getcwd() . '/api/config/database.php';

$thresholdMinutes = max(1, (int) getenv('STALE_REPLAY_LOCK_THRESHOLD_MINUTES'));
$pdo = get_pdo();

$sql = "
    SELECT
        id,
        client_transaction_id,
        replay_status,
        replay_attempts,
        locked_at,
        locked_by,
        replay_started_at,
        CASE WHEN replay_error IS NULL OR replay_error = '' THEN 0 ELSE 1 END AS has_replay_error
    FROM sync_transactions
    WHERE replay_status = 'processing'
      AND locked_at IS NOT NULL
    ORDER BY locked_at ASC, id ASC
";

$rows = $pdo->query($sql)->fetchAll();
$thresholdSeconds = $thresholdMinutes * 60;
$now = time();
$staleRows = [];

foreach ($rows as $row) {
    $lockedAt = strtotime((string) ($row['locked_at'] ?? ''));
    if ($lockedAt !== false && ($now - $lockedAt) >= $thresholdSeconds) {
        $staleRows[] = $row;
    }
}

echo json_encode([
    'ok' => true,
    'now' => date('c', $now),
    'thresholdMinutes' => $thresholdMinutes,
    'processingRows' => $rows,
    'staleRows' => $staleRows,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
`;
}

function runPhpReport() {
  const phpBinary = findPhpBinary();
  const result = spawnSync(phpBinary, ["-r", phpReportCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      STALE_REPLAY_LOCK_THRESHOLD_MINUTES: String(thresholdMinutes),
    },
    windowsHide: true,
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
      error: "PHP stale replay lock report query failed.",
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

function buildReport(result) {
  const processingRows = Array.isArray(result.processingRows) ? result.processingRows.map(sanitizeRow) : [];
  const staleRows = Array.isArray(result.staleRows) ? result.staleRows.map(sanitizeRow) : [];
  const timestamps = staleRows
    .map((row) => toTime(row.lockedAt))
    .filter((value) => value !== null);
  const oldest = timestamps.length ? Math.min(...timestamps) : null;
  const newest = timestamps.length ? Math.max(...timestamps) : null;

  return {
    ok: true,
    readOnly: true,
    API_BASE_URL,
    thresholdMinutes: result.thresholdMinutes ?? thresholdMinutes,
    now: result.now ?? new Date().toISOString(),
    totalProcessingRows: processingRows.length,
    staleLockRows: staleRows.length,
    byLockedBy: countBy(staleRows, (row) => row.lockedBy),
    oldestLockedAt: oldest,
    oldestLockedAtIso: oldest === null ? null : new Date(oldest).toISOString(),
    newestLockedAt: newest,
    newestLockedAtIso: newest === null ? null : new Date(newest).toISOString(),
    rows: staleRows,
  };
}

function main() {
  console.log("Dev-only stale replay lock report. Read-only; no locks are released and no replay is performed.");
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