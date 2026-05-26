#!/usr/bin/env node

/*
 * Backup JSON validator.
 *
 * Validation only: parses an IndexedDB/MySQL backup envelope, verifies basic
 * metadata/count integrity, checks exported data for unsafe sensitive fields,
 * computes a SHA-256 checksum, and prints a safe summary. It does not restore,
 * import, mutate backup files, mutate IndexedDB/backend rows, trigger replay,
 * or start auto-sync/background behavior.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const SENSITIVE_KEY_PATTERNS = [
  /^password$/i,
  /^Password$/,
  /^password_hash$/i,
  /^token_hash$/i,
  /bearer[_-]?token/i,
  /^payload_json$/i,
  /^response_json$/i,
  /secret/i,
  /api[_-]?key/i,
  /credential/i,
];

const REDACTED_VALUES = new Set(["[redacted]", "[omitted]", "[removed]", null, undefined]);

function usage() {
  console.error("Usage: node scripts/validate-backup-file.mjs <backup-json-file>");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(String(key)));
}

function safeSample(list, limit = 20) {
  return list.slice(0, limit);
}

function addIssue(issues, severity, code, message, details = {}) {
  issues.push({ severity, code, message, details });
}

function detectBackupType(backup) {
  if (backup && typeof backup === "object" && backup.stores && backup.storeCounts) return "indexeddb";
  if (backup && typeof backup === "object" && backup.tables && backup.exportedRowCounts) return "mysql";
  return "unknown";
}

function validateMetadata(backup, issues) {
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
    addIssue(issues, "error", "invalidRoot", "Backup root must be a JSON object.");
    return;
  }

  if (!backup.metadata || typeof backup.metadata !== "object" || Array.isArray(backup.metadata)) {
    addIssue(issues, "error", "missingMetadata", "Backup metadata object is missing.");
    return;
  }

  if (!backup.metadata.exportedAt) {
    addIssue(issues, "error", "missingExportedAt", "metadata.exportedAt is missing.");
  }

  if (backup.metadata.restoreImplemented !== false) {
    addIssue(issues, "warning", "restoreFlagUnexpected", "metadata.restoreImplemented should be false for current export-only backups.");
  }

  if (backup.metadata.importImplemented !== false) {
    addIssue(issues, "warning", "importFlagUnexpected", "metadata.importImplemented should be false for current export-only backups.");
  }

  if (backup.metadata.replayTriggered !== false) {
    addIssue(issues, "warning", "replayFlagUnexpected", "metadata.replayTriggered should be false for backup exports.");
  }
}

function validateIndexedDbCounts(backup, issues) {
  const stores = backup.stores && typeof backup.stores === "object" ? backup.stores : null;
  const storeCounts = backup.storeCounts && typeof backup.storeCounts === "object" ? backup.storeCounts : null;

  if (!stores) addIssue(issues, "error", "missingStores", "IndexedDB backup stores object is missing.");
  if (!storeCounts) addIssue(issues, "error", "missingStoreCounts", "IndexedDB backup storeCounts object is missing.");
  if (!stores || !storeCounts) return { checked: 0, mismatches: [] };

  const mismatches = [];
  for (const [storeName, expectedCount] of Object.entries(storeCounts)) {
    const rows = stores[storeName];
    if (!Array.isArray(rows)) {
      mismatches.push({ store: storeName, expectedCount, actualCount: null, reason: "store_array_missing" });
      continue;
    }

    if (rows.length !== expectedCount) {
      mismatches.push({ store: storeName, expectedCount, actualCount: rows.length, reason: "count_mismatch" });
    }
  }

  for (const storeName of Object.keys(stores)) {
    if (!(storeName in storeCounts)) {
      mismatches.push({ store: storeName, expectedCount: null, actualCount: Array.isArray(stores[storeName]) ? stores[storeName].length : null, reason: "count_missing" });
    }
  }

  if (mismatches.length > 0) {
    addIssue(issues, "error", "storeCountMismatch", "One or more IndexedDB store counts do not match exported arrays.", { mismatches: safeSample(mismatches) });
  }

  return { checked: Object.keys(storeCounts).length, mismatches };
}

function validateMysqlCounts(backup, issues) {
  const tables = backup.tables && typeof backup.tables === "object" ? backup.tables : null;
  const exportedRowCounts = backup.exportedRowCounts && typeof backup.exportedRowCounts === "object" ? backup.exportedRowCounts : null;
  const tableCounts = backup.tableCounts && typeof backup.tableCounts === "object" ? backup.tableCounts : null;

  if (!tables) addIssue(issues, "error", "missingTables", "MySQL backup tables object is missing.");
  if (!exportedRowCounts) addIssue(issues, "error", "missingExportedRowCounts", "MySQL backup exportedRowCounts object is missing.");
  if (!tableCounts) addIssue(issues, "warning", "missingTableCounts", "MySQL backup tableCounts object is missing.");
  if (!tables || !exportedRowCounts) return { checked: 0, mismatches: [] };

  const mismatches = [];
  for (const [tableName, expectedCount] of Object.entries(exportedRowCounts)) {
    const rows = tables[tableName];
    if (!Array.isArray(rows)) {
      mismatches.push({ table: tableName, expectedCount, actualCount: null, reason: "table_array_missing" });
      continue;
    }

    if (rows.length !== expectedCount) {
      mismatches.push({ table: tableName, expectedCount, actualCount: rows.length, reason: "count_mismatch" });
    }
  }

  for (const tableName of Object.keys(tables)) {
    if (!(tableName in exportedRowCounts)) {
      mismatches.push({ table: tableName, expectedCount: null, actualCount: Array.isArray(tables[tableName]) ? tables[tableName].length : null, reason: "exported_count_missing" });
    }
  }

  if (mismatches.length > 0) {
    addIssue(issues, "error", "tableCountMismatch", "One or more MySQL table counts do not match exported arrays.", { mismatches: safeSample(mismatches) });
  }

  return { checked: Object.keys(exportedRowCounts).length, mismatches };
}

function inspectSensitiveData(value, path = "", findings = { unsafe: [], redacted: [] }) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => inspectSensitiveData(child, `${path}[${index}]`, findings));
    return findings;
  }

  if (!value || typeof value !== "object") return findings;

  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (isSensitiveKey(key)) {
      if (REDACTED_VALUES.has(child)) {
        findings.redacted.push({ path: childPath, status: "redacted" });
      } else {
        findings.unsafe.push({ path: childPath, status: "present_unredacted" });
      }
      continue;
    }

    inspectSensitiveData(child, childPath, findings);
  }

  return findings;
}

function validateSensitiveData(backup, backupType, issues) {
  const dataRoot = backupType === "indexeddb" ? backup.stores : backupType === "mysql" ? backup.tables : null;
  if (!dataRoot) {
    addIssue(issues, "warning", "sensitiveScanSkipped", "Sensitive field scan skipped because backup type is unknown.");
    return { unsafe: [], redacted: [] };
  }

  const findings = inspectSensitiveData(dataRoot, backupType === "indexeddb" ? "stores" : "tables");
  if (findings.unsafe.length > 0) {
    addIssue(issues, "error", "unsafeSensitiveFields", "Exported data contains sensitive fields that are not redacted/omitted.", { unsafe: safeSample(findings.unsafe) });
  }

  return findings;
}

function validateExpectedRedactionFlags(backup, issues) {
  const summary = backup.redactionSummary;
  if (!summary || typeof summary !== "object") {
    addIssue(issues, "warning", "missingRedactionSummary", "redactionSummary is missing.");
    return;
  }

  for (const [key, value] of Object.entries(summary)) {
    if (/Exported$/.test(key) && value !== false && typeof value === "boolean") {
      addIssue(issues, "error", "redactionFlagUnsafe", `redactionSummary.${key} should be false.`, { key, value });
    }
  }
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    usage();
    process.exitCode = 1;
    return;
  }

  const backupPath = resolve(process.cwd(), inputPath);
  const issues = [];

  if (!existsSync(backupPath)) {
    console.error(JSON.stringify({ ok: false, validationOnly: true, error: `Backup file not found: ${backupPath}` }, null, 2));
    process.exitCode = 1;
    return;
  }

  const fileBuffer = readFileSync(backupPath);
  const checksum = sha256(fileBuffer);
  const fileStats = statSync(backupPath);

  let backup;
  try {
    backup = JSON.parse(fileBuffer.toString("utf8"));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      validationOnly: true,
      backupFilePath: backupPath,
      sha256: checksum,
      fileSizeBytes: fileStats.size,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const backupType = detectBackupType(backup);
  validateMetadata(backup, issues);
  const countValidation = backupType === "indexeddb"
    ? validateIndexedDbCounts(backup, issues)
    : backupType === "mysql"
      ? validateMysqlCounts(backup, issues)
      : { checked: 0, mismatches: [] };

  if (backupType === "unknown") {
    addIssue(issues, "error", "unknownBackupType", "Backup type could not be detected as IndexedDB or MySQL.");
  }

  const sensitiveFindings = validateSensitiveData(backup, backupType, issues);
  validateExpectedRedactionFlags(backup, issues);

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;

  const result = {
    ok: errorCount === 0,
    validationOnly: true,
    restoreImplemented: false,
    importImplemented: false,
    backupFilePath: backupPath,
    backupType,
    format: backup.format ?? null,
    formatVersion: backup.formatVersion ?? null,
    exportedAt: backup.metadata?.exportedAt ?? null,
    fileSizeBytes: fileStats.size,
    sha256: checksum,
    countValidation: {
      checkedCollections: countValidation.checked,
      mismatchCount: countValidation.mismatches.length,
      mismatches: safeSample(countValidation.mismatches),
    },
    sensitiveFieldValidation: {
      unsafeSensitiveFieldCount: sensitiveFindings.unsafe.length,
      redactedSensitiveFieldCount: sensitiveFindings.redacted.length,
      unsafeSensitiveFields: safeSample(sensitiveFindings.unsafe),
      redactedSensitiveFields: safeSample(sensitiveFindings.redacted),
    },
    issueSummary: {
      errors: errorCount,
      warnings: warningCount,
    },
    issues: safeSample(issues, 30),
    notes: [
      "Validation-only: this script does not restore/import data or mutate backup files.",
      "IndexedDB/backend data are not read or mutated by this validator.",
      "Checksum verifies file identity/integrity for this exact file, but does not prove restore success.",
      "Restore/import tooling is still not implemented.",
    ],
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main();