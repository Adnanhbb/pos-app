#!/usr/bin/env node

/*
 * Dev-only dry-run archive plan for failed backend replay rows.
 *
 * Dry-run/read-only only: does not mutate backend rows, delete/archive rows,
 * mutate IndexedDB, trigger replay, or print payload_json/response_json/full bodies.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost/jawad-bro/api";
const MAX_DISPLAY_ROWS = Number(process.env.FAILED_REPLAY_ARCHIVE_PLAN_MAX_ROWS || 75);
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
  return String(value).replace(/\s+/g, " ").slice(0, 240);
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
        replay_attempts,
        replay_error,
        created_at,
        updated_at,
        replay_started_at,
        replay_finished_at
    FROM sync_transactions
    WHERE replay_status = 'failed'
    ORDER BY updated_at DESC, id DESC
")->fetchAll();

$errorRows = $pdo->query("
    SELECT
        CASE WHEN replay_error IS NULL OR replay_error = '' THEN '(empty)' ELSE replay_error END AS replay_error,
        transaction_type,
        COUNT(*) AS count,
        MIN(created_at) AS first_created_at,
        MAX(updated_at) AS last_updated_at
    FROM sync_transactions
    WHERE replay_status = 'failed'
    GROUP BY replay_error, transaction_type
    ORDER BY count DESC, last_updated_at DESC
")->fetchAll();

echo json_encode([
    'ok' => true,
    'rows' => $rows,
    'errorRows' => $errorRows,
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

  if (result.error) {
    return { ok: false, error: `Failed to run PHP CLI: ${result.error.message}`, phpBinary };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      error: "PHP failed replay archive plan query failed.",
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

function hasDevClientTransactionId(value) {
  const text = String(value ?? "").toLowerCase();
  return [
    "test",
    "api-test",
    "auth-",
    "crud-auth",
    "replay",
    "validation",
    "business-validation",
    "inventory-validation",
    "mutation",
    "stock",
    "batch",
    "cylinder",
    "payment",
    "accounting",
    "skeleton",
    "terminal",
    "lock",
    "mirror",
    "low-risk",
    "real-sync",
  ].some((marker) => text.includes(marker));
}

function errorCategory(errorMessage) {
  const text = safeMessage(errorMessage).toLowerCase();

  const knownValidation = [
    "payload_json must decode to an object",
    "clienttransactionid mismatch",
    "must include originalitemid or itemid",
    "must be greater than zero",
    "referenced customer",
    "referenced supplier",
    "referenced item",
    "does not exist",
    "not found",
    "missing",
    "malformed",
    "invalid",
  ];

  const inventoryBatchCylinder = [
    "insufficient stock",
    "insufficient batch",
    "batch inventory",
    "insufficient filled cylinders",
    "cylinder inventory row does not exist",
    "does not hold enough cylinders",
    "negative cylinder",
    "invariant",
  ];

  const historicalSkeleton = [
    "validation-only",
    "business validation",
    "replay skeleton",
    "terminal state",
    "already committed",
  ];

  if (text.includes("sqlstate") || text.includes("fatal") || text.includes("exception") || text.includes("class \"")) return "historicalImplementationFailure";
  if (inventoryBatchCylinder.some((marker) => text.includes(marker))) return "stockBatchCylinderValidationTest";
  if (historicalSkeleton.some((marker) => text.includes(marker))) return "historicalReplaySkeletonTest";
  if (knownValidation.some((marker) => text.includes(marker))) return "knownValidationTest";
  if (text === "(empty)") return "missingErrorMessage";
  return "unclassifiedFailure";
}

function classifyRow(row) {
  const category = errorCategory(row.replay_error);
  const devId = hasDevClientTransactionId(row.client_transaction_id);
  const attempts = Number(row.replay_attempts ?? 0);

  if (devId && ["knownValidationTest", "stockBatchCylinderValidationTest", "historicalReplaySkeletonTest"].includes(category)) {
    return {
      proposedAction: "archiveCandidateDevTest",
      confidence: "high",
      reason: "Client transaction id and replay error both match known dev/test replay failure patterns.",
      errorCategory: category,
    };
  }

  if (devId && category === "historicalImplementationFailure") {
    return {
      proposedAction: "archiveCandidateDevTest",
      confidence: "medium",
      reason: "Client transaction id is dev/test-like and error appears to be historical implementation churn; review before any apply tool.",
      errorCategory: category,
    };
  }

  if (devId) {
    return {
      proposedAction: "manualReviewRequired",
      confidence: "medium",
      reason: "Client transaction id is dev/test-like, but the failure category is not specific enough for archive planning.",
      errorCategory: category,
    };
  }

  if (["knownValidationTest", "stockBatchCylinderValidationTest"].includes(category)) {
    return {
      proposedAction: "manualReviewRequired",
      confidence: "medium",
      reason: "Replay error matches validation-test style, but client transaction id is not clearly dev/test-only.",
      errorCategory: category,
    };
  }

  if (attempts > 1) {
    return {
      proposedAction: "manualReviewRequired",
      confidence: "medium",
      reason: "Multiple attempts may indicate a retry loop or a real failed replay that needs inspection.",
      errorCategory: "retryLoopCandidate",
    };
  }

  return {
    proposedAction: "keep",
    confidence: "low",
    reason: "Not clearly dev/test archival noise. Keep until manually inspected.",
    errorCategory: category,
  };
}

function safePlanRow(row) {
  const plan = classifyRow(row);
  return {
    id: row.id ?? null,
    clientTransactionId: row.client_transaction_id ?? null,
    transactionType: row.transaction_type ?? null,
    replayAttempts: Number(row.replay_attempts ?? 0),
    replayError: safeMessage(row.replay_error),
    replayErrorCategory: plan.errorCategory,
    proposedAction: plan.proposedAction,
    reason: plan.reason,
    confidence: plan.confidence,
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
  const rows = Array.isArray(result.rows) ? result.rows.map(safePlanRow) : [];
  const groupedErrorCategories = (Array.isArray(result.errorRows) ? result.errorRows : []).map((row) => {
    const category = errorCategory(row.replay_error);
    return {
      transactionType: row.transaction_type ?? null,
      replayError: safeMessage(row.replay_error),
      replayErrorCategory: category,
      count: Number(row.count ?? 0),
      firstCreatedAt: row.first_created_at ?? null,
      firstCreatedAtIso: formatDate(row.first_created_at),
      lastUpdatedAt: row.last_updated_at ?? null,
      lastUpdatedAtIso: formatDate(row.last_updated_at),
    };
  });

  const byProposedAction = countBy(rows, (row) => row.proposedAction);

  return {
    ok: true,
    dryRun: true,
    readOnly: true,
    API_BASE_URL,
    totalFailedRows: rows.length,
    summary: {
      totalFailedRows: rows.length,
      archiveCandidateDevTest: byProposedAction.archiveCandidateDevTest ?? 0,
      keep: byProposedAction.keep ?? 0,
      manualReviewRequired: byProposedAction.manualReviewRequired ?? 0,
      groupedErrorCategories: countBy(rows, (row) => row.replayErrorCategory),
    },
    byProposedAction,
    byConfidence: countBy(rows, (row) => row.confidence),
    byTransactionType: countBy(rows, (row) => row.transactionType),
    groupedErrorCategories: groupedErrorCategories.slice(0, 50),
    rows: rows.slice(0, MAX_DISPLAY_ROWS),
    displayLimits: {
      totalRows: rows.length,
      shownRows: Math.min(rows.length, MAX_DISPLAY_ROWS),
      truncated: rows.length > MAX_DISPLAY_ROWS,
    },
    notes: [
      "Dry-run/read-only only: no backend rows, IndexedDB rows, or replay state were changed.",
      "archiveCandidateDevTest is a proposal only; no archive/delete/update behavior exists in this script.",
      "Safe metadata only: payload_json, response_json, full bodies, passwords, tokens, and record payloads are never selected or printed.",
    ],
  };
}

function main() {
  console.log("Dev-only failed replay archival dry-run plan. No archive/delete/update is applied.");
  console.log(`API_BASE_URL: ${API_BASE_URL}`);

  const result = runPhpReport();
  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, dryRun: true, readOnly: true, ...result }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(buildReport(result), null, 2));
}

main();

