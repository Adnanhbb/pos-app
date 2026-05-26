#!/usr/bin/env node

/*
 * Dev-only sync_queue cleanup candidate report.
 *
 * This script is read-only: it does not import syncEngine, replay queue rows,
 * call backend APIs, delete rows, or write to IndexedDB.
 *
 * Windows PowerShell:
 *   $env:APP_URL="http://localhost:5173"
 *   npm run sync:report-cleanup
 *
 * Optional threshold:
 *   npm run sync:report-cleanup -- --older-than-days=1
 */

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const DB_NAME = "POSDatabase";
const DB_VERSION = 20;
const DEFAULT_THRESHOLD_DAYS = 7;

function parseThresholdDays(argv) {
  const prefix = "--older-than-days=";
  const arg = argv.find((value) => value.startsWith(prefix));

  if (!arg) return DEFAULT_THRESHOLD_DAYS;

  const rawValue = arg.slice(prefix.length);
  const days = Number(rawValue);

  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`Invalid --older-than-days value: ${rawValue}`);
  }

  return days;
}

function formatDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  const date = new Date(numeric);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function getTimestamp(value) {
  const timestamp = Number(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function sanitizeQueueRow(row) {
  return {
    id: row.id ?? null,
    entity: row.entity ?? null,
    operation: row.operation ?? null,
    status: row.status ?? null,
    createdAt: row.createdAt ?? null,
    createdAtIso: formatDate(row.createdAt),
    updatedAt: row.updatedAt ?? null,
    updatedAtIso: formatDate(row.updatedAt),
    retryCount: row.retryCount ?? null,
    retries: row.retries ?? null,
  };
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    console.error("Playwright is not installed. Install it with:");
    console.error("  npm i -D playwright");
    console.error("  npx playwright install chromium");
    process.exitCode = 1;
    return null;
  }
}

async function readSyncQueue(page) {
  return await page.evaluate(
    async ({ dbName, dbVersion }) => {
      function openDb() {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName, dbVersion);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
      }

      function getAll(store) {
        return new Promise((resolve, reject) => {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      const db = await openDb();
      const stores = Array.from(db.objectStoreNames);

      if (!stores.includes("sync_queue")) {
        db.close();
        throw new Error(`sync_queue store not found. Stores: ${stores.join(", ")}`);
      }

      const tx = db.transaction("sync_queue", "readonly");
      const rows = await getAll(tx.objectStore("sync_queue"));
      db.close();
      return rows;
    },
    { dbName: DB_NAME, dbVersion: DB_VERSION },
  );
}

async function main() {
  const thresholdDays = parseThresholdDays(process.argv.slice(2));
  const now = Date.now();
  const cutoff = now - thresholdDays * 24 * 60 * 60 * 1000;

  console.log("Dev-only sync_queue cleanup candidate report. Read-only; no cleanup is performed.");
  console.log(`APP_URL: ${APP_URL}`);
  console.log(`Threshold: ${thresholdDays} day(s)`);

  const playwright = await loadPlaywright();
  if (!playwright) return;

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const pageResponse = await page.goto(APP_URL, { waitUntil: "networkidle" });
    if (!pageResponse || !pageResponse.ok()) {
      console.error(JSON.stringify({
        ok: false,
        error: "Failed to open app",
        status: pageResponse?.status() ?? null,
        url: APP_URL,
      }, null, 2));
      process.exitCode = 1;
      return;
    }

    const rows = await readSyncQueue(page);
    const doneRows = rows.filter((row) => row.status === "done");
    const cleanupCandidates = doneRows.filter((row) => {
      const updatedAt = getTimestamp(row.updatedAt);
      const createdAt = getTimestamp(row.createdAt);
      const comparisonTimestamp = updatedAt ?? createdAt;
      return comparisonTimestamp !== null && comparisonTimestamp < cutoff;
    });
    const candidateTimestamps = cleanupCandidates
      .map((row) => getTimestamp(row.updatedAt) ?? getTimestamp(row.createdAt))
      .filter((value) => value !== null);
    const oldestCandidate = candidateTimestamps.length ? Math.min(...candidateTimestamps) : null;
    const newestCandidate = candidateTimestamps.length ? Math.max(...candidateTimestamps) : null;

    const report = {
      ok: true,
      readOnly: true,
      thresholdDays,
      now,
      nowIso: formatDate(now),
      totalRows: rows.length,
      doneRows: doneRows.length,
      cleanupCandidateRows: cleanupCandidates.length,
      cleanupByEntity: countBy(cleanupCandidates, (row) => row.entity),
      cleanupByOperation: countBy(cleanupCandidates, (row) => row.operation),
      oldestCandidateTimestamp: oldestCandidate,
      oldestCandidateTimestampIso: formatDate(oldestCandidate),
      newestCandidateTimestamp: newestCandidate,
      newestCandidateTimestampIso: formatDate(newestCandidate),
      rows: cleanupCandidates.map(sanitizeQueueRow),
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }, null, 2));
  process.exitCode = 1;
});
