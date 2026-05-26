#!/usr/bin/env node

/*
 * Export-only backend MySQL backup tool.
 *
 * This script reads selected backend MySQL tables through the existing PHP
 * database helper and writes a sanitized JSON backup under backups/. It does
 * not implement restore/import, mutate backend rows, mutate IndexedDB, trigger
 * replay, or start auto-sync/background behavior.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const BACKUP_DIR = resolve(PROJECT_ROOT, "backups");
const PROJECT_NAME = "jawad-bro";
const EXPORT_FORMAT = "jawad-bro-mysql-backup";
const EXPORT_FORMAT_VERSION = 1;
const PHP_MAX_BUFFER = 200 * 1024 * 1024;

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
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

const phpCode = String.raw`
require_once getcwd() . '/api/config/database.php';

$tablesToExport = [
    'schema_migrations',
    'units',
    'taxes',
    'discounts',
    'brands',
    'categories',
    'customers',
    'suppliers',
    'expenses',
    'expense_categories',
    'settings',
    'users',
    'held',
    'held_items',
    'items',
    'sales',
    'sale_items',
    'customer_payments',
    'supplier_payments',
    'item_batches',
    'cylinders',
    'cylinder_customers',
    'sync_transactions',
    'transaction_idempotency',
    'transaction_replay_audit',
    'api_auth_tokens',
];

function quote_identifier(string $identifier): string
{
    return chr(96) . str_replace(chr(96), chr(96) . chr(96), $identifier) . chr(96);
}

function should_omit_column(string $column): bool
{
    $normalized = strtolower($column);

    if (in_array($normalized, [
        'password',
        'password_hash',
        'pass_hash',
        'token_hash',
        'access_token',
        'refresh_token',
        'bearer_token',
        'session_token',
        'payload_json',
        'response_json',
        'request_hash',
    ], true)) {
        return true;
    }

    return preg_match('/password|token_hash|bearer|session_token|secret|api_key|credential/i', $column) === 1;
}

function fetch_table_columns(PDO $pdo, string $databaseName, string $table): array
{
    $stmt = $pdo->prepare(
        'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION ASC'
    );
    $stmt->execute([$databaseName, $table]);
    return array_map(static fn(array $row): string => (string) $row['COLUMN_NAME'], $stmt->fetchAll());
}

try {
    $pdo = get_pdo();
    $databaseName = (string) ($pdo->query('SELECT DATABASE() AS database_name')->fetch()['database_name'] ?? '');

    if ($databaseName === '') {
        throw new RuntimeException('Unable to detect selected database name.');
    }

    $existingStmt = $pdo->prepare(
        'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?'
    );
    $existingStmt->execute([$databaseName]);
    $existingTables = array_fill_keys(array_map(static fn(array $row): string => (string) $row['TABLE_NAME'], $existingStmt->fetchAll()), true);

    $tables = [];
    $tableCounts = [];
    $exportedRowCounts = [];
    $exportedFields = [];
    $omittedFields = [];
    $omittedTables = [];
    $totalOmittedFields = 0;

    foreach ($tablesToExport as $table) {
        if (!isset($existingTables[$table])) {
            $omittedTables[] = [
                'table' => $table,
                'reason' => 'table_missing',
            ];
            continue;
        }

        $columns = fetch_table_columns($pdo, $databaseName, $table);
        $safeColumns = [];
        $unsafeColumns = [];

        foreach ($columns as $column) {
            if (should_omit_column($column)) {
                $unsafeColumns[] = $column;
            } else {
                $safeColumns[] = $column;
            }
        }

        $countStmt = $pdo->query('SELECT COUNT(*) AS row_count FROM ' . quote_identifier($table));
        $tableCounts[$table] = (int) ($countStmt->fetch()['row_count'] ?? 0);
        $exportedFields[$table] = $safeColumns;
        $omittedFields[$table] = $unsafeColumns;
        $totalOmittedFields += count($unsafeColumns);

        if (count($safeColumns) === 0) {
            $tables[$table] = [];
            $exportedRowCounts[$table] = 0;
            continue;
        }

        $selectList = implode(', ', array_map('quote_identifier', $safeColumns));
        $orderClause = in_array('id', $columns, true) ? ' ORDER BY ' . quote_identifier('id') . ' ASC' : '';
        $rows = $pdo->query('SELECT ' . $selectList . ' FROM ' . quote_identifier($table) . $orderClause)->fetchAll();

        $tables[$table] = $rows;
        $exportedRowCounts[$table] = count($rows);
    }

    echo json_encode([
        'ok' => true,
        'databaseName' => $databaseName,
        'tables' => $tables,
        'tableCounts' => $tableCounts,
        'exportedRowCounts' => $exportedRowCounts,
        'exportedFields' => $exportedFields,
        'omittedTables' => $omittedTables,
        'omittedFields' => $omittedFields,
        'redactionSummary' => [
            'strategy' => 'sensitive_columns_omitted',
            'totalOmittedFields' => $totalOmittedFields,
            'omittedFieldsByTable' => $omittedFields,
            'rawPasswordsExported' => false,
            'passwordHashesExported' => false,
            'rawAuthTokensExported' => false,
            'tokenHashesExported' => false,
            'payloadJsonExported' => false,
            'responseJsonExported' => false,
        ],
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    fwrite(STDERR, json_encode([
        'ok' => false,
        'error' => $error->getMessage(),
    ], JSON_UNESCAPED_SLASHES));
    exit(1);
}
`;

function runPhpExport() {
  const phpBinary = findPhpBinary();
  const result = spawnSync(phpBinary, ["-r", phpCode], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: PHP_MAX_BUFFER,
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || "";
    const stdout = result.stdout?.trim() || "";
    throw new Error(`MySQL export query failed with PHP exit ${result.status}: ${stderr || stdout || "no output"}`);
  }

  const output = result.stdout?.trim();
  if (!output) throw new Error("MySQL export query produced no output.");

  const parsed = JSON.parse(output);
  if (!parsed.ok) throw new Error(parsed.error || "MySQL export query failed.");
  return { phpBinary, parsed };
}

function buildBackup(raw) {
  const exportedAt = new Date();

  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    metadata: {
      exportedAt: exportedAt.toISOString(),
      appName: PROJECT_NAME,
      projectName: PROJECT_NAME,
      databaseName: raw.databaseName ?? null,
      exportOnly: true,
      restoreImplemented: false,
      importImplemented: false,
      replayTriggered: false,
      indexedDbMutated: false,
      backendMutated: false,
      autoSyncAdded: false,
      warning: "Restore/import is not implemented. This backup is for export/safekeeping/inspection only and still contains sensitive business data even after secret columns are omitted.",
    },
    tableCounts: raw.tableCounts ?? {},
    exportedRowCounts: raw.exportedRowCounts ?? {},
    exportedFields: raw.exportedFields ?? {},
    omittedTables: raw.omittedTables ?? [],
    omittedFields: raw.omittedFields ?? {},
    redactionSummary: raw.redactionSummary ?? {},
    warnings: {
      protectThisFile: true,
      restoreNotImplemented: true,
      containsBusinessData: true,
      rawPasswordsExported: false,
      passwordHashesExported: false,
      rawAuthTokensExported: false,
      tokenHashesExported: false,
      payloadJsonExported: false,
      responseJsonExported: false,
      transactionalWarning: "Transactional tables are exported for backup completeness only. Do not restore, replay, or merge from this file without future restore planning and validation.",
      syncMetadataWarning: "Sync/replay metadata is included without payload_json/response_json/request_hash. Future restore tooling must quarantine and validate it before any use.",
    },
    tables: raw.tables ?? {},
  };
}

function summarizeBackup(backup, filePath, phpBinary) {
  return {
    ok: true,
    exportOnly: true,
    restoreImplemented: false,
    backupFilePath: filePath,
    databaseName: backup.metadata.databaseName,
    phpBinary,
    tableCounts: backup.tableCounts,
    exportedRowCounts: backup.exportedRowCounts,
    omittedTables: backup.omittedTables,
    redactionSummary: backup.redactionSummary,
    warnings: backup.warnings,
    notes: [
      "Export-only: no restore/import behavior exists in this script.",
      "Read-only: backend MySQL rows and IndexedDB data were not mutated.",
      "No replay, auto-sync, background sync, startup replay, polling, or listeners were added.",
      "Password/auth/session/token/hash columns and sync payload/response JSON columns are omitted from the backup.",
    ],
  };
}

function main() {
  console.log("MySQL backup export tool. Export-only; no restore/import is performed.");

  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

  const { phpBinary, parsed } = runPhpExport();
  const backup = buildBackup(parsed);
  const filePath = resolve(BACKUP_DIR, `mysql-backup-${timestampForFile()}.json`);
  writeFileSync(filePath, JSON.stringify(backup, null, 2), "utf8");

  console.log(JSON.stringify(summarizeBackup(backup, filePath, phpBinary), null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ ok: false, exportOnly: true, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}