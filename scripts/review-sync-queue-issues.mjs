#!/usr/bin/env node

/*
 * Safe sync_queue issue review.
 *
 * Read-only: does not import syncEngine, replay rows, call backend APIs,
 * mutate IndexedDB/MySQL, or print payload bodies.
 */

import { tmpdir } from "node:os";
import { resolve } from "node:path";

export const APP_URL = process.env.APP_URL || "http://localhost/jawad-bro-rehearsal/";
export const TEMP_USER_DATA_DIR = resolve(tmpdir(), "jawad-bro-sync-tools-profile");
export const DB_NAME = "POSDatabase";
export const DB_VERSION = 20;

function argValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return null;
}

function chromeProfilePath(profileName) {
  const localAppData = process.env.LOCALAPPDATA || "";
  if (!localAppData) return null;
  return resolve(localAppData, "Google", "Chrome", "User Data", profileName);
}

export function resolveProfileTarget() {
  const userDataDirArg = argValue("user-data-dir");
  if (userDataDirArg) {
    return {
      label: "custom",
      source: "--user-data-dir",
      userDataDir: resolve(userDataDirArg),
      liveBrowserProfile: true,
      warning: "Inspecting an explicitly selected browser profile. Close Chrome if the profile is locked.",
    };
  }

  const profileArg = argValue("profile");
  if (profileArg && profileArg !== "temp") {
    const profileNameByAlias = {
      "chrome-default": "Default",
      "chrome-profile-1": "Profile 1",
      "chrome-profile-2": "Profile 2",
      "chrome-profile-3": "Profile 3",
    };
    const profileName = profileNameByAlias[profileArg] ?? profileArg;
    const userDataDir = chromeProfilePath(profileName);

    if (!userDataDir) {
      throw new Error("LOCALAPPDATA is not available, so the Chrome profile path could not be resolved. Use --user-data-dir instead.");
    }

    return {
      label: profileArg,
      source: "--profile",
      chromeProfileName: profileName,
      userDataDir,
      liveBrowserProfile: true,
      warning: "Inspecting a real Chrome profile. Close Chrome first if this profile is locked by the browser.",
    };
  }

  if (process.env.SYNC_TOOLS_USER_DATA_DIR) {
    return {
      label: "env",
      source: "SYNC_TOOLS_USER_DATA_DIR",
      userDataDir: resolve(process.env.SYNC_TOOLS_USER_DATA_DIR),
      liveBrowserProfile: true,
      warning: "Inspecting the profile selected by SYNC_TOOLS_USER_DATA_DIR.",
    };
  }

  return {
    label: "temp",
    source: "default-temp",
    userDataDir: TEMP_USER_DATA_DIR,
    liveBrowserProfile: false,
    warning: "This may not be the live browser profile.",
  };
}

export const PROFILE_TARGET = resolveProfileTarget();
export const USER_DATA_DIR = PROFILE_TARGET.userDataDir;

const BUSINESS_QUEUE_ENTITIES = new Set([
  "transactions",
  "sales",
  "sale_items",
  "customer_payments",
  "supplier_payments",
  "item_batches",
  "cylinders",
  "cylinder_customers",
]);

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function formatDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  const date = new Date(numeric);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function titleCase(value) {
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function nestedPayload(row) {
  return row?.payload?.payload ?? row?.payload ?? {};
}

function getInvoiceNo(row) {
  const payload = nestedPayload(row);
  const contracts = [
    payload.finalizedSaleReplay,
    payload.finalizedPurchaseReplay,
    payload.finalizedCustomerReturnReplay,
    payload.finalizedSupplierReturnReplay,
  ];

  for (const contract of contracts) {
    if (typeof contract?.invoiceNo === "string" && contract.invoiceNo.trim()) {
      return contract.invoiceNo.trim();
    }
  }

  const candidates = [payload.sale?.invoiceNo, payload.invoiceNo, row?.payload?.invoiceNo];
  const value = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  return typeof value === "string" ? value.trim() : null;
}

function getTransactionType(row) {
  const payload = nestedPayload(row);
  const contracts = [
    payload.finalizedSaleReplay,
    payload.finalizedPurchaseReplay,
    payload.finalizedCustomerReturnReplay,
    payload.finalizedSupplierReturnReplay,
  ];

  for (const contract of contracts) {
    if (typeof contract?.transactionType === "string") {
      if (contract.returnMode === "customer") return "Customer Return";
      if (contract.returnMode === "supplier") return "Supplier Return";
      return contract.transactionType;
    }
  }

  const saleType = payload.sale?.transactionType;
  if (saleType === "Return" && payload.returnMode === "customer") return "Customer Return";
  if (saleType === "Return" && payload.returnMode === "supplier") return "Supplier Return";
  if (typeof saleType === "string") return saleType;
  if (typeof row?.payload?.transactionType === "string") return row.payload.transactionType;
  return null;
}

function getReasonCodes(row) {
  const direct = row?.replayReadiness?.reasons?.map((reason) => reason.code).filter(Boolean) ?? [];
  const nested = nestedPayload(row)?.replayReadiness?.reasons?.map((reason) => reason.code).filter(Boolean) ?? [];
  return Array.from(new Set([...direct, ...nested]));
}

export function reviewQueueRow(row) {
  if (row?.status !== "failed") return null;

  const lastError = row.lastError ?? null;
  const lowerError = String(lastError ?? "").toLowerCase();
  const reasonCodes = getReasonCodes(row);
  const invoiceNo = getInvoiceNo(row);
  const transactionType = getTransactionType(row);
  const businessRow = BUSINESS_QUEUE_ENTITIES.has(row.entity);

  let category = "other";
  let friendlyReason = "Some records need support.";
  let archivable = false;

  if (lowerError.includes("auth") || lowerError.includes("session") || lowerError.includes("sign in")) {
    category = "sign_in_required";
    friendlyReason = "Please sign in again before syncing.";
  } else if (
    row.replayReadiness?.status === "unsafe" ||
    reasonCodes.length > 0 ||
    lowerError.includes("not replay-ready") ||
    lowerError.includes("mappings are not replay-ready")
  ) {
    category = "business_transaction_needs_support";
    friendlyReason = "A business record needs support before it can sync.";
  } else if (lowerError.includes("not found") && !businessRow) {
    category = "old_incomplete_record";
    friendlyReason = "Some old sync records could not be completed.";
    archivable = true;
  } else if (lowerError.includes("validation") || lowerError.includes("invalid")) {
    category = "could_not_validate";
  }

  return {
    id: row.id ?? null,
    entity: row.entity ?? null,
    operation: row.operation ?? null,
    status: row.status ?? null,
    transactionType,
    invoiceNo,
    retryCount: Number(row.retryCount ?? 0),
    createdAtIso: formatDate(row.createdAt),
    updatedAtIso: formatDate(row.updatedAt),
    friendlyType: row.entity === "transactions"
      ? `${transactionType ?? "Business"} record`
      : `${titleCase(row.entity ?? "record")} record`,
    friendlyReason,
    category,
    archivable,
    reasonCodes,
    backendResponseSummary: lastError,
  };
}

export function summarizeQueueIssues(rows) {
  const issues = rows.map(reviewQueueRow).filter(Boolean);
  return {
    totalFailedRows: issues.length,
    archivableRows: issues.filter((issue) => issue.archivable).length,
    needsSupportRows: issues.filter((issue) => !issue.archivable).length,
    byCategory: countBy(issues, (issue) => issue.category),
    byEntity: countBy(issues, (issue) => issue.entity),
    byTransactionType: countBy(issues.filter((issue) => issue.transactionType), (issue) => issue.transactionType),
    issues,
    safety: {
      readOnly: true,
      payloadBodiesPrinted: false,
      replayTriggered: false,
      mysqlMutated: false,
      indexedDbMutated: false,
    },
  };
}

export async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error("Playwright is not installed. Install it with npm i -D playwright.");
  }
}

export async function readSyncQueueRows({ appUrl = APP_URL, profileTarget = PROFILE_TARGET, userDataDir = profileTarget.userDataDir } = {}) {
  const { chromium } = await loadPlaywright();
  const context = await chromium.launchPersistentContext(userDataDir, { headless: true });

  try {
    const page = await context.newPage();
    await page.goto(appUrl, { waitUntil: "networkidle", timeout: 20000 });
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
        try {
          if (!Array.from(db.objectStoreNames).includes("sync_queue")) return [];
          const tx = db.transaction("sync_queue", "readonly");
          return await getAll(tx.objectStore("sync_queue"));
        } finally {
          db.close();
        }
      },
      { dbName: DB_NAME, dbVersion: DB_VERSION }
    );
  } finally {
    await context.close();
  }
}

export async function buildIssueReport(options = {}) {
  const profileTarget = options.profileTarget ?? PROFILE_TARGET;
  const rows = await readSyncQueueRows({ ...options, profileTarget });
  return {
    appUrl: options.appUrl ?? APP_URL,
    profile: {
      label: profileTarget.label,
      source: profileTarget.source,
      chromeProfileName: profileTarget.chromeProfileName ?? null,
      userDataDir: options.userDataDir ?? profileTarget.userDataDir,
      liveBrowserProfile: profileTarget.liveBrowserProfile,
    },
    warnings: profileTarget.warning ? [profileTarget.warning] : [],
    totalQueueRows: rows.length,
    ...summarizeQueueIssues(rows),
  };
}

async function main() {
  console.log("Safe sync_queue issue review. Read-only; no replay/archive is performed.");
  console.log(`Profile: ${PROFILE_TARGET.label} (${PROFILE_TARGET.userDataDir})`);
  if (PROFILE_TARGET.warning) console.log(`Warning: ${PROFILE_TARGET.warning}`);
  const report = await buildIssueReport();
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/review-sync-queue-issues.mjs")) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      replayTriggered: false,
      mysqlMutated: false,
      indexedDbMutated: false,
    }, null, 2));
    process.exitCode = 1;
  });
}
