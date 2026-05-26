#!/usr/bin/env node

/*
 * Dev-only failed sync_queue reset tool.
 *
 * Dry-run by default. Use --apply to reset failed rows to pending.
 * This script does not import syncEngine, replay queue rows, delete rows,
 * call backend APIs, or touch payload/body/data fields.
 *
 * Windows PowerShell:
 *   $env:APP_URL="http://localhost:5173"
 *   npm run sync:reset-failed:dry
 *   npm run sync:reset-failed
 */

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const DB_NAME = "POSDatabase";
const DB_VERSION = 20;
const APPLY = process.argv.includes("--apply");

function sanitizeQueueRow(row) {
  return {
    id: row.id ?? null,
    entity: row.entity ?? null,
    operation: row.operation ?? null,
    status: row.status ?? null,
    retryCount: row.retryCount ?? null,
    retries: row.retries ?? null,
    lastError: row.lastError ?? null,
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

async function inspectOrResetFailedRows(page, apply) {
  return await page.evaluate(
    async ({ dbName, dbVersion, apply }) => {
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

      function put(store, value) {
        return new Promise((resolve, reject) => {
          const request = store.put(value);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      function waitTransaction(tx) {
        return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve(undefined);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      }

      const db = await openDb();
      const stores = Array.from(db.objectStoreNames);

      if (!stores.includes("sync_queue")) {
        db.close();
        throw new Error(`sync_queue store not found. Stores: ${stores.join(", ")}`);
      }

      const readTx = db.transaction("sync_queue", "readonly");
      const rows = await getAll(readTx.objectStore("sync_queue"));
      const failedRows = rows.filter((row) => row.status === "failed");

      if (!apply || failedRows.length === 0) {
        db.close();
        return {
          totalRows: rows.length,
          failedRows,
          resetCount: 0,
        };
      }

      const now = Date.now();
      const writeTx = db.transaction("sync_queue", "readwrite");
      const store = writeTx.objectStore("sync_queue");

      for (const row of failedRows) {
        const next = {
          ...row,
          status: "pending",
        };

        if (Object.prototype.hasOwnProperty.call(next, "retryCount")) {
          next.retryCount = 0;
        }

        if (Object.prototype.hasOwnProperty.call(next, "retries")) {
          next.retries = 0;
        }

        if (Object.prototype.hasOwnProperty.call(next, "lastError")) {
          next.lastError = null;
        }

        if (Object.prototype.hasOwnProperty.call(next, "updatedAt")) {
          next.updatedAt = now;
        }

        await put(store, next);
      }

      await waitTransaction(writeTx);
      db.close();

      return {
        totalRows: rows.length,
        failedRows,
        resetCount: failedRows.length,
      };
    },
    { dbName: DB_NAME, dbVersion: DB_VERSION, apply },
  );
}

async function main() {
  console.log("Dev-only failed sync_queue reset tool.");
  console.log(`Mode: ${APPLY ? "apply" : "dry-run"}`);
  console.log(`APP_URL: ${APP_URL}`);

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

    const result = await inspectOrResetFailedRows(page, APPLY);
    const safeFailedRows = result.failedRows.map(sanitizeQueueRow);

    console.log(JSON.stringify({
      ok: true,
      mode: APPLY ? "apply" : "dry-run",
      applyRequired: !APPLY,
      readOnly: !APPLY,
      totalRows: result.totalRows,
      failedRowsFound: result.failedRows.length,
      wouldReset: APPLY ? 0 : result.failedRows.length,
      resetCount: result.resetCount,
      rows: safeFailedRows,
    }, null, 2));
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