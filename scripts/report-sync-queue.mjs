#!/usr/bin/env node

/*
 * Dev-only sync_queue diagnostics report.
 *
 * This script is read-only: it does not import syncEngine, replay queue rows,
 * call backend APIs, or write to IndexedDB.
 *
 * Windows PowerShell:
 *   $env:APP_URL="http://localhost:5173"
 *   $env:SYNC_TOOLS_USER_DATA_DIR="<optional-shared-profile-path>"
 *   npm run sync:report
 */

import { tmpdir } from "node:os";
import { resolve } from "node:path";

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const USER_DATA_DIR =
  process.env.SYNC_TOOLS_USER_DATA_DIR ||
  resolve(tmpdir(), "jawad-bro-sync-tools-profile");
const DB_NAME = "POSDatabase";
const DB_VERSION = 20;

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
    retryCount: row.retryCount ?? row.retries ?? null,
    lastError: row.lastError ?? null,
    replayReadiness: row.replayReadiness
      ? {
          scope: row.replayReadiness.scope ?? null,
          payloadVersion: row.replayReadiness.payloadVersion ?? null,
          status: row.replayReadiness.status ?? null,
          reasons: Array.isArray(row.replayReadiness.reasons)
            ? row.replayReadiness.reasons.map((reason) => ({
                code: reason.code ?? null,
                message: reason.message ?? null,
                localSaleId: reason.localSaleId ?? null,
                localCustomerId: reason.localCustomerId ?? null,
                localSupplierId: reason.localSupplierId ?? null,
                localItemId: reason.localItemId ?? null,
                localBatchId: reason.localBatchId ?? null,
                localCylinderId: reason.localCylinderId ?? null,
              }))
            : [],
        }
      : null,
  };
}

function isFinalizedSaleQueueRow(row) {
  return (
    row.entity === "transactions" &&
    row.operation === "transaction" &&
    row.payload?.transactionType === "sale" &&
    row.payload?.payload?.sale?.transactionType === "Sale" &&
    row.payload?.payload?.sale?.isPostponed !== true
  );
}

function isFinalizedPurchaseQueueRow(row) {
  return (
    row.entity === "transactions" &&
    row.operation === "transaction" &&
    row.payload?.transactionType === "sale" &&
    row.payload?.payload?.sale?.transactionType === "Purchase" &&
    row.payload?.payload?.sale?.isPostponed !== true
  );
}

function isFinalizedCustomerReturnQueueRow(row) {
  return (
    row.entity === "transactions" &&
    row.operation === "transaction" &&
    row.payload?.transactionType === "return" &&
    row.payload?.payload?.returnMode === "customer" &&
    row.payload?.payload?.sale?.transactionType === "Return" &&
    row.payload?.payload?.sale?.isPostponed !== true
  );
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
  console.log("Dev-only sync_queue diagnostics report. Read-only; no replay is performed.");
  console.log(`APP_URL: ${APP_URL}`);
  console.log(`SYNC_TOOLS_USER_DATA_DIR: ${USER_DATA_DIR}`);

  const playwright = await loadPlaywright();
  if (!playwright) return;

  const browser = await playwright.chromium.launchPersistentContext(
    USER_DATA_DIR,
    { headless: true }
  );
  const page = browser.pages()[0] ?? await browser.newPage();

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
    const pendingRows = rows.filter((row) => row.status === "pending");
    const failedRows = rows.filter((row) => row.status === "failed");
    const finalizedSaleRows = rows.filter(isFinalizedSaleQueueRow);
    const finalizedPurchaseRows = rows.filter(isFinalizedPurchaseQueueRow);
    const finalizedCustomerReturnRows = rows.filter(isFinalizedCustomerReturnQueueRow);
    const pendingCreatedAtValues = pendingRows
      .map((row) => Number(row.createdAt))
      .filter((value) => !Number.isNaN(value));
    const oldestPending = pendingCreatedAtValues.length ? Math.min(...pendingCreatedAtValues) : null;
    const newestPending = pendingCreatedAtValues.length ? Math.max(...pendingCreatedAtValues) : null;

    const report = {
      ok: true,
      readOnly: true,
      totalRows: rows.length,
      byStatus: countBy(rows, (row) => row.status),
      byEntity: countBy(rows, (row) => row.entity),
      byOperation: countBy(rows, (row) => row.operation),
      pending: {
        count: pendingRows.length,
        oldestCreatedAt: oldestPending,
        oldestCreatedAtIso: formatDate(oldestPending),
        newestCreatedAt: newestPending,
        newestCreatedAtIso: formatDate(newestPending),
      },
      failed: {
        count: failedRows.length,
      },
      retryCountDistribution: countBy(rows, (row) => String(row.retryCount ?? row.retries ?? 0)),
      replayReadiness: {
        byStatus: countBy(
          rows.filter((row) => row.replayReadiness),
          (row) => row.replayReadiness?.status
        ),
        unsafeReasons: countBy(
          rows.flatMap((row) => row.replayReadiness?.reasons ?? []),
          (reason) => reason.code
        ),
      },
      finalizedSaleReplayReadiness: {
        totalRows: finalizedSaleRows.length,
        ready: finalizedSaleRows.filter(
          (row) => row.replayReadiness?.status === "ready"
        ).length,
        unsafe: finalizedSaleRows.filter(
          (row) => row.replayReadiness?.status === "unsafe"
        ).length,
        missingContract: finalizedSaleRows.filter(
          (row) => !row.payload?.payload?.finalizedSaleReplay
        ).length,
        unsafeReasons: countBy(
          finalizedSaleRows.flatMap(
            (row) => row.replayReadiness?.reasons ?? []
          ),
          (reason) => reason.code
        ),
      },
      finalizedPurchaseReplayReadiness: {
        totalRows: finalizedPurchaseRows.length,
        ready: finalizedPurchaseRows.filter(
          (row) => row.replayReadiness?.status === "ready"
        ).length,
        unsafe: finalizedPurchaseRows.filter(
          (row) => row.replayReadiness?.status === "unsafe"
        ).length,
        missingContract: finalizedPurchaseRows.filter(
          (row) => !row.payload?.payload?.finalizedPurchaseReplay
        ).length,
        unsafeReasons: countBy(
          finalizedPurchaseRows.flatMap(
            (row) => row.replayReadiness?.reasons ?? []
          ),
          (reason) => reason.code
        ),
      },
      finalizedCustomerReturnReplayReadiness: {
        totalRows: finalizedCustomerReturnRows.length,
        ready: finalizedCustomerReturnRows.filter(
          (row) => row.replayReadiness?.status === "ready"
        ).length,
        unsafe: finalizedCustomerReturnRows.filter(
          (row) => row.replayReadiness?.status === "unsafe"
        ).length,
        missingContract: finalizedCustomerReturnRows.filter(
          (row) => !row.payload?.payload?.finalizedCustomerReturnReplay
        ).length,
        unsafeReasons: countBy(
          finalizedCustomerReturnRows.flatMap(
            (row) => row.replayReadiness?.reasons ?? []
          ),
          (reason) => reason.code
        ),
      },
      pendingRows: pendingRows.map(sanitizeQueueRow),
      failedRows: failedRows.map(sanitizeQueueRow),
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
