#!/usr/bin/env node

/*
 * Dev-only dry-run repair plan for failed replay rows that already have a
 * finalized sales row for the same sync_transaction_id.
 *
 * Dry-run/read-only only: does not update backend rows, delete rows, trigger
 * replay, mutate IndexedDB, or print payload_json/response_json/full bodies.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost/jawad-bro/api";
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

function safeMessage(value) {
  if (value === undefined || value === null || value === "") return "(empty)";
  return String(value).replace(/\s+/g, " ").slice(0, 240);
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

function phpReportCode() {
  return String.raw`
require_once getcwd() . '/api/config/database.php';

$pdo = get_pdo();

function duplicate_sales_repair_table_exists(PDO $pdo, string $table): bool {
    $statement = $pdo->prepare('SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = :table_name');
    $statement->execute(['table_name' => $table]);
    return (int) ($statement->fetch()['count'] ?? 0) > 0;
}

$hasCustomerPayments = duplicate_sales_repair_table_exists($pdo, 'customer_payments');
$hasSupplierPayments = duplicate_sales_repair_table_exists($pdo, 'supplier_payments');
$hasItemBatches = duplicate_sales_repair_table_exists($pdo, 'item_batches');

$rows = $pdo->query("
    SELECT
        st.id,
        st.client_transaction_id,
        st.transaction_type,
        st.replay_status,
        st.replay_attempts,
        st.replay_error,
        st.created_at,
        st.updated_at,
        st.replay_started_at,
        st.replay_finished_at,
        st.locked_at,
        st.locked_by
    FROM sync_transactions st
    WHERE st.replay_status = 'failed'
      AND st.replay_error LIKE '%Duplicate entry%'
      AND st.replay_error LIKE '%sales.sync_transaction_id%'
    ORDER BY st.updated_at DESC, st.id DESC
")->fetchAll();

$details = [];
foreach ($rows as $row) {
    $syncId = (int) $row['id'];

    $salesStatement = $pdo->prepare("
        SELECT id, sync_transaction_id, client_transaction_id, invoiceNo, transactionType, created_at, updated_at
        FROM sales
        WHERE sync_transaction_id = :sync_id
        ORDER BY id ASC
    ");
    $salesStatement->execute(['sync_id' => $syncId]);
    $salesRows = $salesStatement->fetchAll();

    $saleIds = array_map(static fn($sale) => (int) $sale['id'], $salesRows);
    $saleItemsCount = 0;
    if (count($saleIds) > 0) {
        $placeholders = implode(',', array_fill(0, count($saleIds), '?'));
        $saleItemsStatement = $pdo->prepare("SELECT COUNT(*) AS count FROM sale_items WHERE sale_id IN ($placeholders)");
        $saleItemsStatement->execute($saleIds);
        $saleItemsCount = (int) ($saleItemsStatement->fetch()['count'] ?? 0);
    }

    $customerPaymentsCount = 0;
    if ($hasCustomerPayments) {
        $statement = $pdo->prepare('SELECT COUNT(*) AS count FROM customer_payments WHERE sync_transaction_id = :sync_id');
        $statement->execute(['sync_id' => $syncId]);
        $customerPaymentsCount = (int) ($statement->fetch()['count'] ?? 0);
    }

    $supplierPaymentsCount = 0;
    if ($hasSupplierPayments) {
        $statement = $pdo->prepare('SELECT COUNT(*) AS count FROM supplier_payments WHERE sync_transaction_id = :sync_id');
        $statement->execute(['sync_id' => $syncId]);
        $supplierPaymentsCount = (int) ($statement->fetch()['count'] ?? 0);
    }

    $batchRowsCount = 0;
    if ($hasItemBatches) {
        $statement = $pdo->prepare('SELECT COUNT(*) AS count FROM item_batches WHERE sync_transaction_id = :sync_id');
        $statement->execute(['sync_id' => $syncId]);
        $batchRowsCount = (int) ($statement->fetch()['count'] ?? 0);
    }

    $auditStatement = $pdo->prepare("
        SELECT event_type, status_before, status_after, created_at
        FROM transaction_replay_audit
        WHERE sync_transaction_id = :sync_id
        ORDER BY id ASC
    ");
    $auditStatement->execute(['sync_id' => $syncId]);
    $auditRows = $auditStatement->fetchAll();

    $details[] = [
        'transaction' => $row,
        'salesRows' => array_map(static function(array $sale): array {
            return [
                'id' => (int) $sale['id'],
                'sync_transaction_id' => $sale['sync_transaction_id'] === null ? null : (int) $sale['sync_transaction_id'],
                'client_transaction_id_matches' => isset($sale['client_transaction_id']) && isset($sale['sync_transaction_id']),
                'invoiceNo' => $sale['invoiceNo'] ?? null,
                'transactionType' => $sale['transactionType'] ?? null,
                'created_at' => $sale['created_at'] ?? null,
                'updated_at' => $sale['updated_at'] ?? null,
            ];
        }, $salesRows),
        'saleItemsCount' => $saleItemsCount,
        'customerPaymentsCount' => $customerPaymentsCount,
        'supplierPaymentsCount' => $supplierPaymentsCount,
        'batchRowsCount' => $batchRowsCount,
        'auditRows' => $auditRows,
    ];
}

echo json_encode([
    'ok' => true,
    'hasCustomerPayments' => $hasCustomerPayments,
    'hasSupplierPayments' => $hasSupplierPayments,
    'hasItemBatches' => $hasItemBatches,
    'details' => $details,
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
      error: "PHP duplicate sales repair planning query failed.",
      status: result.status,
      stderr: result.stderr.trim(),
      stdout: result.stdout.trim(),
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

function auditEvents(detail) {
  return Array.isArray(detail.auditRows) ? detail.auditRows.map((row) => row.event_type).filter(Boolean) : [];
}

function hasAudit(detail, eventType) {
  return auditEvents(detail).includes(eventType);
}

function safeAuditSummary(detail) {
  const rows = Array.isArray(detail.auditRows) ? detail.auditRows : [];
  return {
    count: rows.length,
    eventTypes: Array.from(new Set(rows.map((row) => row.event_type).filter(Boolean))),
    hasLockReleasedCommitted: rows.some((row) => row.event_type === "lock_released" && row.status_after === "committed"),
    hasReplayTerminalStateSkipped: rows.some((row) => row.event_type === "replay_terminal_state_skipped"),
  };
}

function planAction(detail) {
  const tx = detail.transaction ?? {};
  const salesRows = Array.isArray(detail.salesRows) ? detail.salesRows : [];
  const salesRowFound = salesRows.length > 0;
  const salesRowCount = salesRows.length;
  const saleItemsCount = Number(detail.saleItemsCount ?? 0);
  const status = tx.replay_status ?? null;

  const completedEvidence = {
    stock: hasAudit(detail, "replay_stock_mutation_completed"),
    sales: hasAudit(detail, "replay_sales_persistence_completed"),
    accounting: hasAudit(detail, "replay_accounting_mutation_completed"),
    payment: hasAudit(detail, "replay_payment_persistence_completed"),
    batch: hasAudit(detail, "replay_batch_mutation_completed"),
    cylinder: hasAudit(detail, "replay_cylinder_mutation_completed"),
    lockCommitted: safeAuditSummary(detail).hasLockReleasedCommitted,
  };
  const coreCommitted = completedEvidence.stock && completedEvidence.sales && completedEvidence.accounting;

  if (!salesRowFound) {
    return {
      proposedAction: "keepFailed",
      confidence: "high",
      reason: "Replay error says sales duplicate, but no finalized sales row is currently linked by sync_transaction_id.",
      retryCouldSucceed: "unknown",
      statusRelationship: `${status || "unknown"} without linked sales row`,
      completedEvidence,
    };
  }

  if (salesRowCount !== 1) {
    return {
      proposedAction: "manualReviewRequired",
      confidence: "high",
      reason: `Expected exactly one linked finalized sales row, found ${salesRowCount}.`,
      retryCouldSucceed: false,
      statusRelationship: `${status || "unknown"} with unexpected sales row count`,
      completedEvidence,
    };
  }

  if (coreCommitted && completedEvidence.lockCommitted) {
    return {
      proposedAction: "markReplayCommittedHistorical",
      confidence: "high",
      reason: "Linked sales row exists and audit trail shows committed replay milestones plus committed lock release.",
      retryCouldSucceed: false,
      statusRelationship: "failed status appears inconsistent with committed audit trail",
      completedEvidence,
    };
  }

  if (coreCommitted) {
    return {
      proposedAction: "markReplayCommittedHistorical",
      confidence: "medium",
      reason: "Linked sales row exists and core stock/sales/accounting completion audit events are present, but final committed lock release was not found.",
      retryCouldSucceed: false,
      statusRelationship: "failed status may be historical/inconsistent; needs explicit apply review",
      completedEvidence,
    };
  }

  return {
    proposedAction: "manualReviewRequired",
    confidence: "medium",
    reason: "Linked finalized sales row exists, but safe audit metadata does not prove the full replay chain committed. Do not mark committed without deeper inspection.",
    retryCouldSucceed: false,
    statusRelationship: "failed status with existing finalized sales row",
    completedEvidence,
  };
}

function safeDetail(detail) {
  const tx = detail.transaction ?? {};
  const plan = planAction(detail);
  const salesRows = Array.isArray(detail.salesRows) ? detail.salesRows : [];
  const audit = safeAuditSummary(detail);

  return {
    syncTransactionId: Number(tx.id ?? 0),
    clientTransactionId: tx.client_transaction_id ?? null,
    transactionType: tx.transaction_type ?? null,
    replayStatus: tx.replay_status ?? null,
    replayAttempts: Number(tx.replay_attempts ?? 0),
    replayError: safeMessage(tx.replay_error),
    salesRowFound: salesRows.length > 0,
    salesRowCount: salesRows.length,
    salesRows: salesRows.map((row) => ({
      id: row.id ?? null,
      invoiceNo: row.invoiceNo ?? null,
      transactionType: row.transactionType ?? null,
      createdAt: row.created_at ?? null,
      createdAtIso: formatDate(row.created_at),
    })),
    saleItemsCount: Number(detail.saleItemsCount ?? 0),
    linkedEffectPresence: {
      customerPaymentsCount: Number(detail.customerPaymentsCount ?? 0),
      supplierPaymentsCount: Number(detail.supplierPaymentsCount ?? 0),
      batchRowsCount: Number(detail.batchRowsCount ?? 0),
      cylinderEffectsDetectableBySyncTransactionId: false,
    },
    audit,
    completedEvidence: plan.completedEvidence,
    statusRelationship: plan.statusRelationship,
    proposedAction: plan.proposedAction,
    confidence: plan.confidence,
    reason: plan.reason,
    retryCouldSucceed: plan.retryCouldSucceed,
    createdAt: tx.created_at ?? null,
    createdAtIso: formatDate(tx.created_at),
    updatedAt: tx.updated_at ?? null,
    updatedAtIso: formatDate(tx.updated_at),
    replayStartedAt: tx.replay_started_at ?? null,
    replayStartedAtIso: formatDate(tx.replay_started_at),
    replayFinishedAt: tx.replay_finished_at ?? null,
    replayFinishedAtIso: formatDate(tx.replay_finished_at),
  };
}

function buildReport(result) {
  const rows = Array.isArray(result.details) ? result.details.map(safeDetail) : [];

  return {
    ok: true,
    dryRun: true,
    readOnly: true,
    replayTriggered: false,
    backendMutated: false,
    indexedDbMutated: false,
    autoSyncAdded: false,
    API_BASE_URL,
    totalDuplicateSalesFailures: rows.length,
    summary: {
      byProposedAction: countBy(rows, (row) => row.proposedAction),
      byConfidence: countBy(rows, (row) => row.confidence),
      salesRowFound: countBy(rows, (row) => (row.salesRowFound ? "yes" : "no")),
      byStatusRelationship: countBy(rows, (row) => row.statusRelationship),
      retryCouldSucceed: countBy(rows, (row) => String(row.retryCouldSucceed)),
    },
    effectDetection: {
      customerPaymentsTablePresent: Boolean(result.hasCustomerPayments),
      supplierPaymentsTablePresent: Boolean(result.hasSupplierPayments),
      itemBatchesTablePresent: Boolean(result.hasItemBatches),
      cylinderEffectsDetectableBySyncTransactionId: false,
    },
    rows,
    notes: [
      "Dry-run/read-only only: no backend rows, IndexedDB rows, or replay state were changed.",
      "Only non-archived failed rows with duplicate finalized sales-row errors are inspected.",
      "Safe metadata only: payload_json, response_json, full bodies, passwords, tokens, and auth/session data are never selected or printed.",
      "markReplayCommittedHistorical is only a proposed future action; this script does not apply it.",
    ],
    phpBinary: result.phpBinary,
  };
}

function main() {
  console.log("Dev-only duplicate finalized-sales failed replay repair plan. Dry-run/read-only only.");
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
