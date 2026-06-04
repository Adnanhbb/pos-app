#!/usr/bin/env node

/*
 * Backup/restore readiness audit.
 *
 * Read-only source audit: checks IndexedDB store coverage, backup tooling,
 * restore/import absence, docs, and package scripts. It does not open
 * IndexedDB, read business rows, restore/import, replay, or mutate MySQL.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUSINESS_CRITICAL_INDEXEDDB_STORES } from "./lib/indexeddb-store-inventory.mjs";

const REPORT_JSON = resolve(process.cwd(), "backup-restore-readiness-report.json");
const REPORT_MD = resolve(process.cwd(), "backup-restore-readiness-report.md");

const REQUIRED_FILES = [
  "scripts/export-indexeddb-backup.mjs",
  "scripts/export-mysql-backup.mjs",
  "scripts/validate-backup-file.mjs",
  "docs/backup-restore-migration-strategy.md",
  "docs/backup-disaster-recovery-handover.md",
];

const FORBIDDEN_RESTORE_FILES = [
  "scripts/import-indexeddb-backup.mjs",
  "scripts/restore-indexeddb-backup.mjs",
  "scripts/import-mysql-backup.mjs",
  "scripts/restore-mysql-backup.mjs",
];

function readText(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function findCreateObjectStores() {
  const dbText = readText("src/db.ts");
  const stores = new Set();
  const regex = /createObjectStore\(["']([^"']+)["']/g;
  let match;

  while ((match = regex.exec(dbText))) {
    stores.add(match[1]);
  }

  return [...stores].sort();
}

function scriptNames() {
  const packageJson = JSON.parse(readText("package.json"));
  return Object.keys(packageJson.scripts ?? {}).sort();
}

function includesAll(text, values) {
  return values.filter((value) => !text.includes(value));
}

function main() {
  const actualStores = findCreateObjectStores();
  const actualSet = new Set(actualStores);
  const expectedSet = new Set(BUSINESS_CRITICAL_INDEXEDDB_STORES);
  const missingStores = BUSINESS_CRITICAL_INDEXEDDB_STORES.filter((store) => !actualSet.has(store));
  const unexpectedStores = actualStores.filter((store) => !expectedSet.has(store));
  const scripts = scriptNames();
  const indexedDbExport = readText("scripts/export-indexeddb-backup.mjs");
  const validator = readText("scripts/validate-backup-file.mjs");
  const strategyDoc = existsSync(resolve(process.cwd(), "docs/backup-restore-migration-strategy.md"))
    ? readText("docs/backup-restore-migration-strategy.md")
    : "";
  const handoverDoc = existsSync(resolve(process.cwd(), "docs/backup-disaster-recovery-handover.md"))
    ? readText("docs/backup-disaster-recovery-handover.md")
    : "";

  const checks = [
    {
      name: "required backup/readiness files exist",
      ok: REQUIRED_FILES.every((file) => existsSync(resolve(process.cwd(), file))),
      missing: REQUIRED_FILES.filter((file) => !existsSync(resolve(process.cwd(), file))),
    },
    {
      name: "all expected IndexedDB stores exist in schema",
      ok: missingStores.length === 0,
      expectedStores: BUSINESS_CRITICAL_INDEXEDDB_STORES,
      actualStores,
      missingStores,
      unexpectedStores,
    },
    {
      name: "IndexedDB exporter reads runtime objectStoreNames",
      ok: indexedDbExport.includes("Array.from(db.objectStoreNames)") && indexedDbExport.includes("expectedStoreCoverage"),
    },
    {
      name: "backup validator checks expected IndexedDB stores",
      ok: validator.includes("missingExpectedIndexedDbStores") && validator.includes("BUSINESS_CRITICAL_INDEXEDDB_STORES"),
    },
    {
      name: "restore/import implementation remains absent",
      ok: FORBIDDEN_RESTORE_FILES.every((file) => !existsSync(resolve(process.cwd(), file))),
      forbiddenRestoreFilesPresent: FORBIDDEN_RESTORE_FILES.filter((file) => existsSync(resolve(process.cwd(), file))),
    },
    {
      name: "backup npm scripts exist",
      ok: ["backup:indexeddb:export", "backup:mysql:export", "backup:validate", "backup:audit-readiness"].every((name) => scripts.includes(name)),
    },
    {
      name: "documentation covers disaster recovery and no-go restore rules",
      ok: includesAll(`${strategyDoc}\n${handoverDoc}`, [
        "Restore/import is not implemented",
        "Do not restore stale replay queues blindly",
        "Do not restore expired auth tokens",
        "Do not restore partial transactional state",
        "post-restore",
        "client handover",
      ]).length === 0,
      missingPhrases: includesAll(`${strategyDoc}\n${handoverDoc}`, [
        "Restore/import is not implemented",
        "Do not restore stale replay queues blindly",
        "Do not restore expired auth tokens",
        "Do not restore partial transactional state",
        "post-restore",
        "client handover",
      ]),
    },
  ];

  const report = {
    ok: checks.every((check) => check.ok),
    generatedAt: new Date().toISOString(),
    readOnly: true,
    restoreImplemented: false,
    importImplemented: false,
    indexedDbMutated: false,
    mysqlMutated: false,
    replayTriggered: false,
    autoSyncEnabled: false,
    expectedIndexedDbStores: BUSINESS_CRITICAL_INDEXEDDB_STORES,
    actualIndexedDbStores: actualStores,
    missingStores,
    unexpectedStores,
    restoreSafety: {
      overwriteWithoutConfirmationPossible: false,
      reason: "No restore/import apply tool exists.",
      validatesBackupBeforeRestore: "No restore exists; backup validator validates exports before any future restore.",
      preservesIdsAndRelationships: "Future restore requirement only; current export preserves row fields and IDs in backup JSON.",
      marksUnsyncedAsSynced: false,
      resetsSyncState: false,
    },
    checks,
  };

  const md = [
    "# Backup/Restore Readiness Audit",
    "",
    `- ok: ${report.ok}`,
    `- generatedAt: ${report.generatedAt}`,
    `- readOnly: ${report.readOnly}`,
    `- restoreImplemented: ${report.restoreImplemented}`,
    `- importImplemented: ${report.importImplemented}`,
    `- indexedDbMutated: ${report.indexedDbMutated}`,
    `- mysqlMutated: ${report.mysqlMutated}`,
    `- replayTriggered: ${report.replayTriggered}`,
    `- autoSyncEnabled: ${report.autoSyncEnabled}`,
    "",
    "## IndexedDB Store Coverage",
    ...BUSINESS_CRITICAL_INDEXEDDB_STORES.map((store) => `- ${actualSet.has(store) ? "PASS" : "FAIL"}: ${store}`),
    "",
    `Missing stores: ${missingStores.length === 0 ? "none" : missingStores.join(", ")}`,
    `Unexpected stores: ${unexpectedStores.length === 0 ? "none" : unexpectedStores.join(", ")}`,
    "",
    "## Checks",
    ...checks.map((check) => `- ${check.ok ? "PASS" : "FAIL"}: ${check.name}`),
    "",
    "Restore/import apply tooling remains absent. Restore rehearsal is validation/documentation-only until a future quarantined dry-run restore planner exists.",
  ].join("\n");

  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");
  writeFileSync(REPORT_MD, md, "utf8");
  console.log(JSON.stringify({
    ok: report.ok,
    readOnly: true,
    reportFiles: {
      json: "backup-restore-readiness-report.json",
      markdown: "backup-restore-readiness-report.md",
    },
    missingStores,
    unexpectedStores,
    restoreImplemented: false,
    replayTriggered: false,
    mysqlMutated: false,
    indexedDbMutated: false,
  }, null, 2));

  if (!report.ok) process.exitCode = 1;
}

main();
