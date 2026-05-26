#!/usr/bin/env node

/*
 * Dev-only read-only report for the remaining non-archived failed replay rows.
 *
 * This script does not update backend rows, delete rows, mutate IndexedDB,
 * trigger replay, or print payload_json/response_json/full sensitive bodies.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost/jawad-bro/api";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const now = new Date();

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

function parseDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function ageDays(value) {
  const date = parseDate(value);
  if (!date) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000));
}

function ageBucket(value) {
  const days = ageDays(value);
  if (days === null) return "unknown";
  if (days < 1) return "under1Day";
  if (days < 7) return "1to6Days";
  if (days < 30) return "7to29Days";
  return "30PlusDays";
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
  return String(value).replace(/\s+/g, " ").slice(0, 240);
}

function replayErrorCategory(errorMessage) {
  const text = safeMessage(errorMessage).toLowerCase();

  if (text.includes("duplicate entry") && text.includes("sales.sync_transaction_id")) return "duplicateFinalizedSalesRow";
  if (text.includes("sqlstate") || text.includes("fatal") || text.includes("exception") || text.includes("class \"")) return "historicalImplementationFailure";
  if (text.includes("insufficient stock") || text.includes("insufficient batch") || text.includes("cylinder")) return "validationFailure";
  if (text.includes("missing") || text.includes("malformed") || text.includes("invalid") || text.includes("does not exist")) return "validationFailure";
  if (text === "(empty)") return "missingErrorMessage";
  return "unclassifiedFailure";
}

function classify(row) {
  const category = replayErrorCategory(row.replay_error);
  const attempts = Number(row.replay_attempts ?? 0);
  const text = safeMessage(row.replay_error).toLowerCase();

  if (category === "duplicateFinalizedSalesRow") {
    return {
      reviewClass: "fixCandidate",
      recommendedNextAction: "Inspect finalized sales row and sync_transactions terminal status; consider explicit manual status repair or later archival plan after confirming no business mutation is missing.",
      retryCouldSucceed: false,
      likelyHistoricalImplementationFailure: true,
      reason: "A finalized sales row already exists for the same sync_transaction_id, so blind retry is expected to hit the same unique constraint.",
    };
  }

  if (category === "historicalImplementationFailure") {
    return {
      reviewClass: "manualReview",
      recommendedNextAction: "Inspect associated audit/history before retry or archival; do not auto-retry.",
      retryCouldSucceed: attempts > 1 ? false : "unknown",
      likelyHistoricalImplementationFailure: true,
      reason: "Failure is SQL/runtime shaped and may reflect historical implementation churn rather than a current payload problem.",
    };
  }

  if (category === "validationFailure") {
    return {
      reviewClass: "keep",
      recommendedNextAction: "Keep unless a future cleanup policy explicitly archives validation-test rows.",
      retryCouldSucceed: false,
      likelyHistoricalImplementationFailure: false,
      reason: "Validation failures generally require payload/reference correction before retry.",
    };
  }

  if (text === "(empty)") {
    return {
      reviewClass: "manualReview",
      recommendedNextAction: "Inspect audit trail because replay_error is empty.",
      retryCouldSucceed: "unknown",
      likelyHistoricalImplementationFailure: false,
      reason: "No safe error summary is available.",
    };
  }

  return {
    reviewClass: "manualReview",
    recommendedNextAction: "Manually inspect audit metadata before deciding whether to keep, repair, retry, or archive.",
    retryCouldSucceed: "unknown",
    likelyHistoricalImplementationFailure: false,
    reason: "Failure category is not specific enough for an automated recommendation.",
  };
}

function phpReportCode() {
  return String.raw`
require_once getcwd() . '/api/config/database.php';

$pdo = get_pdo();

$rows = $pdo->query("
    SELECT
        id,
        client_transaction_id,
        transaction_type,
        replay_status,
        replay_attempts,
        replay_error,
        locked_at,
        locked_by,
        created_at,
        updated_at,
        replay_started_at,
        replay_finished_at
    FROM sync_transactions
    WHERE replay_status = 'failed'
    ORDER BY updated_at DESC, id DESC
")->fetchAll();

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
    maxBuffer: 1024 * 1024 * 50,
  });

  if (result.error) return { ok: false, error: `Failed to run PHP CLI: ${result.error.message}`, phpBinary };

  if (result.status !== 0) {
    return {
      ok: false,
      error: "PHP remaining failed replay report query failed.",
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

function safeRow(row) {
  const classification = classify(row);
  const category = replayErrorCategory(row.replay_error);
  const createdAgeDays = ageDays(row.created_at);

  return {
    id: Number(row.id ?? 0),
    clientTransactionId: row.client_transaction_id ?? null,
    transactionType: row.transaction_type ?? null,
    replayStatus: row.replay_status ?? null,
    replayAttempts: Number(row.replay_attempts ?? 0),
    replayError: safeMessage(row.replay_error),
    replayErrorCategory: category,
    ageBucket: ageBucket(row.created_at),
    ageDays: createdAgeDays,
    likelyHistoricalImplementationFailure: classification.likelyHistoricalImplementationFailure,
    retryCouldSucceed: classification.retryCouldSucceed,
    reviewClass: classification.reviewClass,
    reason: classification.reason,
    recommendedNextAction: classification.recommendedNextAction,
    lockedAtPresent: Boolean(row.locked_at),
    lockedByPresent: Boolean(row.locked_by),
    createdAt: row.created_at ?? null,
    createdAtIso: formatDate(row.created_at),
    updatedAt: row.updated_at ?? null,
    updatedAtIso: formatDate(row.updated_at),
    replayStartedAt: row.replay_started_at ?? null,
    replayStartedAtIso: formatDate(row.replay_started_at),
    replayFinishedAt: row.replay_finished_at ?? null,
    replayFinishedAtIso: formatDate(row.replay_finished_at),
  };
}

function buildReport(result) {
  const rows = Array.isArray(result.rows) ? result.rows.map(safeRow) : [];

  return {
    ok: true,
    readOnly: true,
    replayTriggered: false,
    backendMutated: false,
    indexedDbMutated: false,
    autoSyncAdded: false,
    API_BASE_URL,
    generatedAt: now.toISOString(),
    totalRemainingFailedRows: rows.length,
    byReplayErrorCategory: countBy(rows, (row) => row.replayErrorCategory),
    byTransactionType: countBy(rows, (row) => row.transactionType),
    byAgeBucket: countBy(rows, (row) => row.ageBucket),
    byLikelyHistoricalImplementationFailure: countBy(rows, (row) => String(row.likelyHistoricalImplementationFailure)),
    byRetryCouldSucceed: countBy(rows, (row) => String(row.retryCouldSucceed)),
    byReviewClass: countBy(rows, (row) => row.reviewClass),
    recommendedNextActions: countBy(rows, (row) => row.recommendedNextAction),
    rows,
    notes: [
      "Read-only report only: no backend rows, IndexedDB rows, or replay state were changed.",
      "Only non-archived rows with replay_status=failed are selected.",
      "Safe metadata only: payload_json, response_json, customer/supplier/item bodies, tokens, passwords, and auth/session data are never selected or printed.",
    ],
    phpBinary: result.phpBinary,
  };
}

function main() {
  console.log("Dev-only remaining failed replay review report. Read-only; no replay is performed.");
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
