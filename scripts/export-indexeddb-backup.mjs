#!/usr/bin/env node

/*
 * Export-only IndexedDB backup tool.
 *
 * This script reads local IndexedDB stores through Playwright and writes a
 * redacted JSON backup under backups/. It does not implement restore/import,
 * mutate IndexedDB, mutate backend rows, trigger replay, or start auto-sync.
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const DB_NAME = process.env.INDEXEDDB_BACKUP_DB_NAME || "POSDatabase";
const USER_DATA_DIR = process.env.BACKUP_USER_DATA_DIR || process.env.SYNC_TOOLS_USER_DATA_DIR || resolve(tmpdir(), "jawad-bro-sync-tools-profile");
const BACKUP_DIR = resolve(process.cwd(), "backups");
const PROJECT_NAME = "jawad-bro";
const EXPORT_FORMAT = "jawad-bro-indexeddb-backup";
const EXPORT_FORMAT_VERSION = 1;

const HIGH_RISK_STORES = new Set([
  "items",
  "sales",
  "sale_items",
  "customer_payments",
  "supplier_payments",
  "item_batches",
  "cylinders",
  "cylinder_customers",
]);

const SYNC_METADATA_STORES = new Set(["sync_queue"]);
const HELD_STORES = new Set(["held", "held_items"]);

const SECRET_KEY_PATTERNS = [
  /password/i,
  /password_hash/i,
  /pass_hash/i,
  /token/i,
  /bearer/i,
  /session/i,
  /secret/i,
  /auth/i,
  /credential/i,
  /api[_-]?key/i,
];

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function isSecretKey(key) {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(String(key)));
}

function createRedactor() {
  const summary = {
    totalRedactedFields: 0,
    byStore: {},
    byField: {},
  };

  function record(storeName, path) {
    summary.totalRedactedFields += 1;
    summary.byStore[storeName] = (summary.byStore[storeName] ?? 0) + 1;
    summary.byField[path] = (summary.byField[path] ?? 0) + 1;
  }

  function redact(value, storeName, path = "") {
    if (Array.isArray(value)) {
      return value.map((item, index) => redact(item, storeName, `${path}[${index}]`));
    }

    if (value && typeof value === "object") {
      const output = {};
      for (const [key, childValue] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key;
        if (isSecretKey(key)) {
          output[key] = "[redacted]";
          record(storeName, childPath);
        } else {
          output[key] = redact(childValue, storeName, childPath);
        }
      }
      return output;
    }

    return value;
  }

  return { redact, summary };
}

function classifyStore(storeName) {
  if (HIGH_RISK_STORES.has(storeName)) return "pos-sales-transactional-warning";
  if (SYNC_METADATA_STORES.has(storeName)) return "sync-metadata";
  if (HELD_STORES.has(storeName)) return "held";
  return "local-entity";
}

async function readIndexedDB(page) {
  return await page.evaluate(async ({ dbName }) => {
    function openDatabase(name) {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error(`Failed to open IndexedDB ${name}`));
      });
    }

    function getAll(store) {
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error || new Error(`Failed to read store ${store.name}`));
      });
    }

    const detectedDatabases = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
    const db = await openDatabase(dbName);
    const storeNames = Array.from(db.objectStoreNames);
    const stores = {};
    const indexes = {};

    for (const storeName of storeNames) {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      stores[storeName] = await getAll(store);
      indexes[storeName] = Array.from(store.indexNames || []);
    }

    const result = {
      dbName: db.name,
      dbVersion: db.version,
      detectedDatabases,
      storeNames,
      stores,
      indexes,
      localStorageKeys: Object.keys(localStorage || {}),
      authTokenPresent: Boolean(localStorage.getItem("jawadBro.authToken")),
    };

    db.close();
    return result;
  }, { dbName: DB_NAME });
}

function buildBackup(raw) {
  const exportedAt = new Date();
  const { redact, summary: redactionSummary } = createRedactor();
  const stores = {};
  const storeCounts = {};
  const storeClassifications = {};
  const warningStores = [];

  const storeNames = Array.isArray(raw.storeNames) ? raw.storeNames.sort() : [];
  for (const storeName of storeNames) {
    const rows = Array.isArray(raw.stores?.[storeName]) ? raw.stores[storeName] : [];
    stores[storeName] = rows.map((row) => redact(row, storeName));
    storeCounts[storeName] = rows.length;
    storeClassifications[storeName] = classifyStore(storeName);
    if (HIGH_RISK_STORES.has(storeName)) warningStores.push(storeName);
  }

  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    metadata: {
      exportedAt: exportedAt.toISOString(),
      appName: PROJECT_NAME,
      projectName: PROJECT_NAME,
      appUrl: APP_URL,
      dbName: raw.dbName ?? DB_NAME,
      dbVersion: raw.dbVersion ?? null,
      detectedDatabases: raw.detectedDatabases ?? [],
      exportOnly: true,
      restoreImplemented: false,
      importImplemented: false,
      replayTriggered: false,
      indexedDbMutated: false,
      backendMutated: false,
      autoSyncAdded: false,
      warning: "Restore/import is not implemented. This backup is for export/safekeeping/inspection only and still contains sensitive business data even after secret redaction.",
    },
    storeCounts,
    storeClassifications,
    indexes: raw.indexes ?? {},
    redactionSummary,
    warnings: {
      protectThisFile: true,
      restoreNotImplemented: true,
      containsBusinessData: true,
      rawAuthTokenExported: false,
      authTokenPresentButNotExported: Boolean(raw.authTokenPresent),
      highRiskPOSTransactionStores: warningStores,
      highRiskWarning: "POS/sales/payment/batch/cylinder stores are included for backup completeness only. Do not restore or replay from this file without future restore planning and validation.",
      syncQueueWarning: storeNames.includes("sync_queue") ? "sync_queue is included as metadata. Restored queues must be quarantined and must never be replayed blindly." : null,
    },
    stores,
  };
}

function summarizeBackup(backup, filePath) {
  return {
    ok: true,
    exportOnly: true,
    restoreImplemented: false,
    backupFilePath: filePath,
    dbName: backup.metadata.dbName,
    dbVersion: backup.metadata.dbVersion,
    storeCounts: backup.storeCounts,
    redactionSummary: backup.redactionSummary,
    warnings: backup.warnings,
    notes: [
      "Export-only: no restore/import behavior exists in this script.",
      "Read-only: IndexedDB and backend data were not mutated.",
      "No replay, auto-sync, background sync, startup replay, polling, or listeners were added.",
      "Raw auth tokens/passwords/session secrets are not exported; matching fields inside rows are redacted recursively.",
    ],
  };
}

async function main() {
  console.log("IndexedDB backup export tool. Export-only; no restore/import is performed.");
  console.log(`APP_URL: ${APP_URL}`);
  console.log(`DB_NAME: ${DB_NAME}`);

  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

  const browser = await chromium.launchPersistentContext(USER_DATA_DIR, { headless: true });
  try {
    const page = await browser.newPage();
    const response = await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    if (!response || !response.ok()) {
      throw new Error(`Unable to open app at ${APP_URL}; status=${response?.status() ?? "unknown"}`);
    }
    await page.waitForTimeout(500);

    const raw = await readIndexedDB(page);
    const backup = buildBackup(raw);
    const filePath = resolve(BACKUP_DIR, `indexeddb-backup-${timestampForFile()}.json`);
    writeFileSync(filePath, JSON.stringify(backup, null, 2), "utf8");

    console.log(JSON.stringify(summarizeBackup(backup, filePath), null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, exportOnly: true, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
