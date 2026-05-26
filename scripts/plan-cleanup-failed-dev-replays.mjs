#!/usr/bin/env node

/*
 * Dev-only dry-run cleanup plan for failed transaction replay rows.
 *
 * Dry-run only: does not mutate backend rows, delete/archive rows, trigger
 * replay, or print payload_json/response_json/full record bodies.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost/jawad-bro/api";
const RECENT_LIMIT = Number(process.env.FAILED_REPLAY_PLAN_LIMIT || 100);
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
  return String(value).replace(/\s+/g, " ").slice(0, 220);
}

function phpReportCode(limit) {
  return String.raw`
require_once getcwd() . '/api/config/database.php';

$pdo = get_pdo();
$limit = ` + Number(limit) + String.raw`;

$statement = $pdo->prepare("
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
        created_at,
        updated_at
    FROM sync_transactions
    WHERE replay_status = 'failed'
    ORDER BY updated_at DESC, id DESC
    LIMIT :limit
");
$statement->bindValue('limit', $limit, PDO::PARAM_INT);
$statement->execute();
$rows = $statement->fetchAll();

$countRows = $pdo->query("
    SELECT
        transaction_type,
        replay_attempts,
        CASE WHEN replay_error IS NULL OR replay_error = '' THEN '(empty)' ELSE replay_error END AS replay_error,
        COUNT(*) AS count,
        MIN(created_at) AS first_created_at,
        MAX(updated_at) AS last_updated_at
    FROM sync_transactions
    WHERE replay_status = 'failed'
    GROUP BY transaction_type, replay_attempts, replay_error
    ORDER BY count DESC, last_updated_at DESC
")->fetchAll();

$total = $pdo->query("SELECT COUNT(*) AS count FROM sync_transactions WHERE replay_status = 'failed'")->fetch();

echo json_encode([
    'ok' => true,
    'totalFailedRows' => (int)($total['count'] ?? 0),
    'rows' => $rows,
    'countRows' => $countRows,
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
      error: "PHP failed replay cleanup plan query failed.",
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

function isLikelyDevClientTransactionId(value) {
  const text = String(value ?? "").toLowerCase();
  return [
    "test",
    "api-test",
    "replay",
    "validation",
    "mutation",
    "stock",
    "batch",
    "cylinder",
    "payment",
    "accounting",
    "skeleton",
    "terminal",
    "lock",
  ].some((marker) => text.includes(marker));
}

function classifyReplayError(errorMessage) {
  const text = safeMessage(errorMessage).toLowerCase();

  if (text.includes("class \"") || text.includes("fatal") || text.includes("exception") || text.includes("sqlstate")) {
    return { category: "possibleImplementationOrHistoricalFailure", confidence: "medium" };
  }

  const knownValidationMarkers = [
    "must include originalitemid or itemid",
    "payload_json must decode to an object",
    "must be greater than zero",
    "insufficient stock",
    "insufficient batch",
    "insufficient filled cylinders",
    "cylinder inventory row does not exist",
    "does not hold enough cylinders",
    "referenced customer",
    "referenced supplier",
    "referenced item",
    "malformed",
    "invalid",
    "negative",
    "invariant",
    "missing",
    "not found",
  ];

  if (knownValidationMarkers.some((marker) => text.includes(marker))) {
    return { category: "expectedValidationFailure", confidence: "high" };
  }

  if (text === "(empty)") {
    return { category: "missingErrorMessage", confidence: "low" };
  }

  return { category: "unclassifiedFailure", confidence: "low" };
}

function classifyRow(row) {
  const replayError = safeMessage(row.replay_error);
  const errorClass = classifyReplayError(replayError);
  const likelyDevId = isLikelyDevClientTransactionId(row.client_transaction_id);
  const attempts = Number(row.replay_attempts ?? 0);

  if (likelyDevId && errorClass.category === "expectedValidationFailure") {
    return {
      proposedAction: "archiveLater",
      confidence: "high",
      reason: "Looks like an intentional dev/test validation failure; future archive tool may be appropriate after manual confirmation.",
      classification: errorClass.category,
    };
  }

  if (likelyDevId && errorClass.confidence !== "low") {
    return {
      proposedAction: "manualReview",
      confidence: "medium",
      reason: "Client transaction id looks dev/test-related, but the failure category should be reviewed before cleanup.",
      classification: errorClass.category,
    };
  }

  if (attempts > 1) {
    return {
      proposedAction: "manualReview",
      confidence: "medium",
      reason: "Row has multiple replay attempts; inspect before cleanup or retry planning.",
      classification: "retryLoopCandidate",
    };
  }

  if (errorClass.category === "expectedValidationFailure") {
    return {
      proposedAction: "manualReview",
      confidence: "medium",
      reason: "Validation failure is recognizable, but the client transaction id is not clearly dev/test-only.",
      classification: errorClass.category,
    };
  }

  return {
    proposedAction: "keep",
    confidence: "low",
    reason: "Failure is not clearly safe to classify as dev/test cleanup. Keep until manually inspected.",
    classification: errorClass.category,
  };
}

function sanitizePlanRow(row) {
  const plan = classifyRow(row);
  return {
    id: row.id ?? null,
    clientTransactionId: row.client_transaction_id ?? null,
    transactionType: row.transaction_type ?? null,
    replayStatus: row.replay_status ?? null,
    replayAttempts: Number(row.replay_attempts ?? 0),
    replayError: safeMessage(row.replay_error),
    proposedAction: plan.proposedAction,
    confidence: plan.confidence,
    classification: plan.classification,
    reason: plan.reason,
    lockedAtPresent: Boolean(row.locked_at),
    lockedByPresent: Boolean(row.locked_by),
    replayStartedAt: row.replay_started_at ?? null,
    replayStartedAtIso: formatDate(row.replay_started_at),
    replayFinishedAt: row.replay_finished_at ?? null,
    replayFinishedAtIso: formatDate(row.replay_finished_at),
    createdAt: row.created_at ?? null,
    createdAtIso: formatDate(row.created_at),
    updatedAt: row.updated_at ?? null,
    updatedAtIso: formatDate(row.updated_at),
  };
}

function buildReport(result) {
  const planRows = Array.isArray(result.rows) ? result.rows.map(sanitizePlanRow) : [];
  const groupedFailureCategories = (Array.isArray(result.countRows) ? result.countRows : []).map((row) => {
    const classification = classifyReplayError(row.replay_error);
    return {
      transactionType: row.transaction_type ?? null,
      replayAttempts: Number(row.replay_attempts ?? 0),
      replayError: safeMessage(row.replay_error),
      count: Number(row.count ?? 0),
      classification: classification.category,
      confidence: classification.confidence,
      firstCreatedAt: row.first_created_at ?? null,
      firstCreatedAtIso: formatDate(row.first_created_at),
      lastUpdatedAt: row.last_updated_at ?? null,
      lastUpdatedAtIso: formatDate(row.last_updated_at),
    };
  });

  return {
    ok: true,
    dryRun: true,
    readOnly: true,
    API_BASE_URL,
    totalFailedRows: Number(result.totalFailedRows ?? planRows.length),
    sampledRows: planRows.length,
    byProposedAction: countBy(planRows, (row) => row.proposedAction),
    byConfidence: countBy(planRows, (row) => row.confidence),
    byClassification: countBy(planRows, (row) => row.classification),
    byTransactionType: countBy(planRows, (row) => row.transactionType),
    groupedFailureCategories: groupedFailureCategories.slice(0, 50),
    proposedActions: planRows,
    notes: [
      "No backend rows were changed, deleted, archived, or replayed.",
      "archiveLater means a future explicit --apply archive tool might be safe after human confirmation; this script does not archive anything.",
      "manualReview means the row should not be cleaned automatically without deeper inspection.",
      "This script never selects or prints payload_json, response_json, passwords, or full record bodies.",
    ],
  };
}

function main() {
  console.log("Dev-only failed replay cleanup dry-run plan. No cleanup is applied.");
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
