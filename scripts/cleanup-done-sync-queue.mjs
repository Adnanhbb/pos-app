#!/usr/bin/env node

/*
 * Dev-only completed sync_queue cleanup tool.
 *
 * Dry-run is the default. Apply mode requires --apply.
 *
 * This script does not import syncEngine, replay queue rows, call backend APIs,
 * modify payloads, or touch pending/failed rows. Apply mode deletes only rows
 * whose status is exactly "done" and whose timestamp is older than the threshold.
 *
 * Windows PowerShell:
 *   $env:APP_URL="http://localhost:5173"
 *   npm run sync:cleanup-done:dry
 *
 * Apply:
 *   npm run sync:cleanup-done
 *
 * Optional threshold:
 *   npm run sync:cleanup-done:dry -- --older-than-days=1
 */

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const DB_NAME = "POSDatabase";
const DB_VERSION = 20;
const DEFAULT_THRESHOLD_DAYS = 7;

function parseArgs(argv) {
  const prefix = "--older-than-days=";
  const thresholdArg = argv.find((value) => value.startsWith(prefix));
  const apply = argv.includes("--apply");

  if (!thresholdArg) {
    return { apply, thresholdDays: DEFAULT_THRESHOLD_DAYS };
  }

  const rawValue = thresholdArg.slice(prefix.length);
  const thresholdDays = Number(rawValue);

  if (!Number.isFinite(thresholdDays) || thresholdDays <= 0) {
    throw new Error(`Invalid --older-than-days value: ${rawValue}`);
  }

  return { apply, thresholdDays };
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

async function inspectAndMaybeCleanup(page, options) {
  return await page.evaluate(
    async ({ dbName, dbVersion, thresholdDays, apply }) => {
      function openDb() {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName, dbVersion);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
      }

      function requestToPromise(request) {
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      function getTimestamp(value) {
        const timestamp = Number(value);
        return Number.isNaN(timestamp) ? null : timestamp;
      }

      const now = Date.now();
      const cutoff = now - thresholdDays * 24 * 60 * 60 * 1000;
      const db = await openDb();
      const stores = Array.from(db.objectStoreNames);

      if (!stores.includes("sync_queue")) {
        db.close();
        throw new Error(`sync_queue store not found. Stores: ${stores.join(", ")}`);
      }

      const tx = db.transaction("sync_queue", apply ? "readwrite" : "readonly");
      const store = tx.objectStore("sync_queue");
      const rows = await requestToPromise(store.getAll());
      const doneRows = rows.filter((row) => row.status === "done");
      const candidates = doneRows.filter((row) => {
        const updatedAt = getTimestamp(row.updatedAt);
        const createdAt = getTimestamp(row.createdAt);
        const comparisonTimestamp = updatedAt ?? createdAt;
        return comparisonTimestamp !== null && comparisonTimestamp < cutoff;
      });

      let deletedRows = 0;

      if (apply) {
        for (const row of candidates) {
          if (row.status === "done" && row.id !== undefined && row.id !== null) {
            await requestToPromise(store.delete(row.id));
            deletedRows += 1;
          }
        }
      }

      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });

      db.close();

      return {
        now,
        totalRows: rows.length,
        doneRows: doneRows.length,
        candidates,
        deletedRows,
      };
    },
    options,
  );
}

async function main() {
  const { apply, thresholdDays } = parseArgs(process.argv.slice(2));
  const mode = apply ? "apply" : "dry-run";

  console.log("Dev-only completed sync_queue cleanup tool.");
  console.log(`Mode: ${mode}`);
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

    const result = await inspectAndMaybeCleanup(page, {
      dbName: DB_NAME,
      dbVersion: DB_VERSION,
      thresholdDays,
      apply,
    });

    const candidates = result.candidates;
    const report = {
      ok: true,
      mode,
      readOnly: !apply,
      thresholdDays,
      now: result.now,
      nowIso: formatDate(result.now),
      totalRows: result.totalRows,
      doneRows: result.doneRows,
      candidateRows: candidates.length,
      deletedRows: result.deletedRows,
      byEntity: countBy(candidates, (row) => row.entity),
      byOperation: countBy(candidates, (row) => row.operation),
      rows: candidates.map(sanitizeQueueRow),
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
