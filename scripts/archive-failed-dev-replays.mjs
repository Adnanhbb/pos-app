#!/usr/bin/env node

/*
 * Dev-only failed replay archive tool.
 *
 * Default dry-run: no backend rows are changed. Apply mode requires --apply and
 * only archives rows classified as archiveCandidateDevTest by the same safe
 * planner rules used by plan-archive-failed-replays.mjs.
 *
 * This script never deletes rows, never mutates IndexedDB, never triggers replay,
 * and never selects or prints payload_json/response_json/full bodies.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APPLY = process.argv.includes("--apply");
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost/jawad-bro/api";
const MAX_DISPLAY_ROWS = Number(process.env.FAILED_REPLAY_ARCHIVE_MAX_ROWS || 75);
const EXPECTED_ARCHIVE_CANDIDATES = Number(process.env.FAILED_REPLAY_ARCHIVE_EXPECTED_CANDIDATES || 140);
const EXPECTED_KEEP = Number(process.env.FAILED_REPLAY_ARCHIVE_EXPECTED_KEEP || 6);
const EXPECTED_MANUAL_REVIEW = Number(process.env.FAILED_REPLAY_ARCHIVE_EXPECTED_MANUAL_REVIEW || 0);
const ARCHIVED_STATUS = "archived_dev_test";
const ARCHIVE_EVENT_TYPE = "failed_replay_archived_dev_test";
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

function phpSelectCode() {
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

function phpApplyCode() {
  return String.raw`
require_once getcwd() . '/api/config/database.php';

$rawIds = getenv('ARCHIVE_IDS_JSON');
$ids = json_decode($rawIds ?: '[]', true);
if (!is_array($ids)) {
    fwrite(STDERR, 'ARCHIVE_IDS_JSON must decode to an array.');
    exit(2);
}

$ids = array_values(array_unique(array_map('intval', $ids)));
$ids = array_values(array_filter($ids, static fn($id) => $id > 0));

if (count($ids) === 0) {
    echo json_encode([
        'ok' => true,
        'matchedRows' => 0,
        'updatedRows' => 0,
        'auditRowsInserted' => 0,
        'archivedRows' => [],
        'archivedStatusCount' => 0,
        'failedStatusCount' => 0,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit(0);
}

$pdo = get_pdo();
$placeholders = implode(',', array_fill(0, count($ids), '?'));

$pdo->beginTransaction();
try {
    $select = $pdo->prepare("
        SELECT
            id,
            client_transaction_id,
            transaction_type,
            replay_status,
            replay_attempts,
            replay_error,
            created_at,
            updated_at
        FROM sync_transactions
        WHERE id IN ($placeholders)
        FOR UPDATE
    ");
    $select->execute($ids);
    $rows = $select->fetchAll();

    if (count($rows) !== count($ids)) {
        throw new RuntimeException('Archive candidate set changed before apply; at least one candidate row is missing.');
    }

    foreach ($rows as $row) {
        if (($row['replay_status'] ?? null) !== 'failed') {
            throw new RuntimeException('Archive candidate set changed before apply; all candidates must still be failed.');
        }
    }

    $update = $pdo->prepare("
        UPDATE sync_transactions
        SET replay_status = 'archived_dev_test',
            updated_at = NOW()
        WHERE id IN ($placeholders)
          AND replay_status = 'failed'
    ");
    $update->execute($ids);
    $updatedRows = $update->rowCount();

    if ($updatedRows !== count($ids)) {
        throw new RuntimeException('Archive update count did not match expected candidate count.');
    }

    $audit = $pdo->prepare(
        'INSERT INTO transaction_replay_audit
            (sync_transaction_id, client_transaction_id, event_type, status_before, status_after, message)
         VALUES
            (:sync_transaction_id, :client_transaction_id, :event_type, :status_before, :status_after, :message)'
    );

    $auditRowsInserted = 0;
    foreach ($rows as $row) {
        $audit->execute([
            'sync_transaction_id' => (int) $row['id'],
            'client_transaction_id' => (string) $row['client_transaction_id'],
            'event_type' => 'failed_replay_archived_dev_test',
            'status_before' => 'failed',
            'status_after' => 'archived_dev_test',
            'message' => 'Archived dev/test failed replay row via explicit manual archive tool.',
        ]);
        $auditRowsInserted += $audit->rowCount();
    }

    $countArchived = $pdo->query("SELECT COUNT(*) AS count FROM sync_transactions WHERE replay_status = 'archived_dev_test'")->fetch();
    $countFailed = $pdo->query("SELECT COUNT(*) AS count FROM sync_transactions WHERE replay_status = 'failed'")->fetch();

    $pdo->commit();

    echo json_encode([
        'ok' => true,
        'matchedRows' => count($rows),
        'updatedRows' => $updatedRows,
        'auditRowsInserted' => $auditRowsInserted,
        'archivedStatusCount' => (int) ($countArchived['count'] ?? 0),
        'failedStatusCount' => (int) ($countFailed['count'] ?? 0),
        'archivedRows' => $rows,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    fwrite(STDERR, $exception->getMessage());
    exit(1);
}
`;
}

function runPhp(code, env = {}) {
  const phpBinary = findPhpBinary();
  const result = spawnSync(phpBinary, ["-r", code], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 50,
    env: { ...process.env, ...env },
  });

  if (result.error) {
    return { ok: false, error: `Failed to run PHP CLI: ${result.error.message}`, phpBinary };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      error: "PHP failed replay archive operation failed.",
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
    id: Number(row.id ?? 0),
    clientTransactionId: row.client_transaction_id ?? null,
    transactionType: row.transaction_type ?? null,
    replayStatus: row.replay_status ?? null,
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

function buildPlan(selectResult) {
  const rows = Array.isArray(selectResult.rows) ? selectResult.rows.map(safePlanRow) : [];
  const byProposedAction = countBy(rows, (row) => row.proposedAction);
  const archiveRows = rows.filter((row) => row.proposedAction === "archiveCandidateDevTest");
  const keepRows = rows.filter((row) => row.proposedAction === "keep");
  const manualRows = rows.filter((row) => row.proposedAction === "manualReviewRequired");

  return {
    rows,
    archiveRows,
    keepRows,
    manualRows,
    summary: {
      totalFailedRows: rows.length,
      archiveCandidateDevTest: archiveRows.length,
      keep: keepRows.length,
      manualReviewRequired: manualRows.length,
      groupedErrorCategories: countBy(rows, (row) => row.replayErrorCategory),
    },
    byProposedAction,
    byConfidence: countBy(rows, (row) => row.confidence),
    byTransactionType: countBy(rows, (row) => row.transactionType),
  };
}

function assertApplyAllowed(plan) {
  const errors = [];
  if (plan.manualRows.length > 0) {
    errors.push(`Refusing apply because ${plan.manualRows.length} manualReviewRequired row(s) are present in the plan.`);
  }

  if (plan.archiveRows.length !== EXPECTED_ARCHIVE_CANDIDATES) {
    errors.push(`Refusing apply because archiveCandidateDevTest=${plan.archiveRows.length}, expected ${EXPECTED_ARCHIVE_CANDIDATES}.`);
  }

  if (plan.keepRows.length !== EXPECTED_KEEP) {
    errors.push(`Refusing apply because keep=${plan.keepRows.length}, expected ${EXPECTED_KEEP}.`);
  }

  if (plan.manualRows.length !== EXPECTED_MANUAL_REVIEW) {
    errors.push(`Refusing apply because manualReviewRequired=${plan.manualRows.length}, expected ${EXPECTED_MANUAL_REVIEW}.`);
  }

  if (plan.archiveRows.length === 0) {
    errors.push("Refusing apply because there are no archive candidates.");
  }

  return errors;
}

function printDryRun(plan, selectResult, extra = {}) {
  const report = {
    ok: true,
    mode: "dry-run",
    dryRun: true,
    readOnly: true,
    deletedRows: 0,
    replayTriggered: false,
    API_BASE_URL,
    archiveStatus: ARCHIVED_STATUS,
    expectedApplySummary: {
      archiveCandidateDevTest: EXPECTED_ARCHIVE_CANDIDATES,
      keep: EXPECTED_KEEP,
      manualReviewRequired: EXPECTED_MANUAL_REVIEW,
    },
    summary: plan.summary,
    byProposedAction: plan.byProposedAction,
    byConfidence: plan.byConfidence,
    byTransactionType: plan.byTransactionType,
    wouldArchiveRows: plan.archiveRows.slice(0, MAX_DISPLAY_ROWS),
    untouchedRowsSummary: {
      keep: plan.keepRows.length,
      manualReviewRequired: plan.manualRows.length,
    },
    displayLimits: {
      totalArchiveRows: plan.archiveRows.length,
      shownArchiveRows: Math.min(plan.archiveRows.length, MAX_DISPLAY_ROWS),
      truncated: plan.archiveRows.length > MAX_DISPLAY_ROWS,
    },
    notes: [
      "Dry-run/read-only only: no backend rows, IndexedDB rows, audit rows, or replay state were changed.",
      "Apply mode requires --apply and only updates replay_status for archiveCandidateDevTest rows.",
      "Safe metadata only: payload_json, response_json, full bodies, passwords, tokens, and record payloads are never selected or printed.",
    ],
    phpBinary: selectResult.phpBinary,
    ...extra,
  };

  console.log(JSON.stringify(report, null, 2));
}

function printApply(plan, selectResult, applyResult) {
  const archivedRows = Array.isArray(applyResult.archivedRows) ? applyResult.archivedRows.map(safePlanRow) : [];
  const report = {
    ok: true,
    mode: "apply",
    dryRun: false,
    readOnly: false,
    deletedRows: 0,
    replayTriggered: false,
    API_BASE_URL,
    archiveStatus: ARCHIVED_STATUS,
    auditEvent: ARCHIVE_EVENT_TYPE,
    preApplySummary: plan.summary,
    applyResult: {
      matchedRows: Number(applyResult.matchedRows ?? 0),
      updatedRows: Number(applyResult.updatedRows ?? 0),
      auditRowsInserted: Number(applyResult.auditRowsInserted ?? 0),
      archivedStatusCount: Number(applyResult.archivedStatusCount ?? 0),
      failedStatusCount: Number(applyResult.failedStatusCount ?? 0),
    },
    archivedRows: archivedRows.slice(0, MAX_DISPLAY_ROWS),
    untouchedRowsSummary: {
      keep: plan.keepRows.length,
      manualReviewRequired: plan.manualRows.length,
    },
    displayLimits: {
      totalArchivedRows: archivedRows.length,
      shownArchivedRows: Math.min(archivedRows.length, MAX_DISPLAY_ROWS),
      truncated: archivedRows.length > MAX_DISPLAY_ROWS,
    },
    notes: [
      "No rows were deleted. sync_transactions rows were preserved with replay_status=archived_dev_test.",
      "No IndexedDB rows were changed and no replay was triggered.",
      "Safe metadata only: payload_json, response_json, full bodies, passwords, tokens, and record payloads were never selected or printed.",
    ],
    phpBinary: selectResult.phpBinary,
  };

  console.log(JSON.stringify(report, null, 2));
}

function main() {
  console.log(APPLY ? "Dev-only failed replay archive APPLY mode." : "Dev-only failed replay archive dry-run. No archive/delete/update is applied.");
  console.log(`API_BASE_URL: ${API_BASE_URL}`);

  const selectResult = runPhp(phpSelectCode());
  if (!selectResult.ok) {
    console.error(JSON.stringify({ ok: false, mode: APPLY ? "apply" : "dry-run", dryRun: !APPLY, readOnly: !APPLY, ...selectResult }, null, 2));
    process.exitCode = 1;
    return;
  }

  const plan = buildPlan(selectResult);

  if (!APPLY) {
    printDryRun(plan, selectResult);
    return;
  }

  const safetyErrors = assertApplyAllowed(plan);
  if (safetyErrors.length > 0) {
    printDryRun(plan, selectResult, {
      ok: false,
      mode: "apply-refused",
      dryRun: true,
      readOnly: true,
      applyRefused: true,
      safetyErrors,
    });
    process.exitCode = 1;
    return;
  }

  const ids = plan.archiveRows.map((row) => row.id).filter((id) => Number.isInteger(id) && id > 0);
  const applyResult = runPhp(phpApplyCode(), { ARCHIVE_IDS_JSON: JSON.stringify(ids) });
  if (!applyResult.ok) {
    console.error(JSON.stringify({ ok: false, mode: "apply", dryRun: false, readOnly: false, deletedRows: 0, replayTriggered: false, ...applyResult }, null, 2));
    process.exitCode = 1;
    return;
  }

  printApply(plan, selectResult, applyResult);
}

main();
