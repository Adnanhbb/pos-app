#!/usr/bin/env node

/*
 * Dev-only manual-review hydration classification report.
 *
 * Read-only: does not mutate IndexedDB, mutate backend rows, replay queues,
 * repair rows, hydrate rows, delete rows, or print payload/password/token bodies.
 *
 * Windows PowerShell:
 *   $env:APP_URL="http://localhost:5173"
 *   $env:API_BASE_URL="http://localhost/jawad-bro/api"
 *   npm.cmd run sync:report-hydration-manual-review
 */

import { tmpdir } from "node:os";
import { resolve } from "node:path";

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const DB_NAME = "POSDatabase";
const DB_VERSION = 20;
const USER_DATA_DIR = process.env.SYNC_TOOLS_USER_DATA_DIR || resolve(tmpdir(), "jawad-bro-sync-tools-profile");
const MAX_ROWS = Number(process.env.HYDRATION_MANUAL_REVIEW_MAX_ROWS || 10);

const CATEGORY_KEYS = [
  "localOnlyUnmatched",
  "remoteOnlyDevTest",
  "timestampMissing",
  "auth/security-sensitive",
  "unsafeEntityOrField",
];

const DEV_TEST_MARKERS = [
  "mirror ",
  "real ",
  "real-",
  "test ",
  "test-",
  "crud-auth",
  "auth-session",
  "transaction-",
  "replay-",
  "sync-test",
  "low-risk",
  "hydration-test",
];

const ENTITIES = [
  { entity: "units", store: "units", endpoint: "units.php", labelFields: ["name"], updateFields: ["serverId", "name", "shortName", "itemCount", "isDeleted", "deletedAt"] },
  { entity: "taxes", store: "taxes", endpoint: "taxes.php", labelFields: ["name"], updateFields: ["serverId", "name", "value", "type", "isDeleted", "deletedAt"] },
  { entity: "discounts", store: "discounts", endpoint: "discounts.php", labelFields: ["name"], updateFields: ["serverId", "name", "value", "type", "isDeleted", "deletedAt"] },
  { entity: "brands", store: "brands", endpoint: "brands.php", labelFields: ["name"], updateFields: ["serverId", "name", "itemCount", "isDeleted", "deletedAt"] },
  { entity: "categories", store: "categories", endpoint: "categories.php", labelFields: ["name"], updateFields: ["serverId", "name", "itemCount", "isDeleted", "deletedAt"] },
  { entity: "customers", store: "customers", endpoint: "customers.php", labelFields: ["name"], updateFields: ["serverId", "name", "mobile", "cnic", "address", "isDeleted", "deletedAt"] },
  { entity: "suppliers", store: "suppliers", endpoint: "suppliers.php", labelFields: ["name"], updateFields: ["serverId", "name", "mobile", "cnic", "address", "isDeleted", "deletedAt"] },
  {
    entity: "settings",
    store: "settings",
    endpoint: "settings.php",
    labelFields: ["businessName", "shopName", "name", "key"],
    updateFields: ["serverId", "businessName", "email", "contact", "address", "printer", "language", "logo", "cylBPrice", "cylSPrice", "cylDPrice", "cylWPrice"],
  },
  { entity: "users", store: "users", endpoint: "users.php", labelFields: ["Username", "username", "Name", "name"], updateFields: [] },
  {
    entity: "held",
    store: "held",
    endpoint: "held.php",
    labelFields: ["invoiceNo", "customerName", "supplierName"],
    updateFields: [
      "serverId",
      "invoiceNo",
      "date",
      "transactionType",
      "customerId",
      "supplierId",
      "customerName",
      "supplierName",
      "subtotal",
      "discount",
      "tax",
      "grandTotal",
      "paid",
      "discountMode",
      "discountValue",
      "taxMode",
      "taxValue",
    ],
  },
];

function limitRows(rows) {
  return rows.slice(0, MAX_ROWS);
}

function truncation(rows) {
  return { total: rows.length, shown: Math.min(rows.length, MAX_ROWS), truncated: rows.length > MAX_ROWS };
}

function formatDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    const date = new Date(numeric);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }
  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function toTime(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isNaN(numeric)) return numeric;
  const parsed = new Date(String(value).replace(" ", "T")).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeDeleted(value) {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0" || value === undefined || value === null) return false;
  return Boolean(value);
}

function containsDevMarker(value) {
  const text = String(value ?? "").toLowerCase();
  return DEV_TEST_MARKERS.some((marker) => text.includes(marker));
}

function safeLabel(row, fields) {
  for (const field of fields) {
    const value = row?.[field];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).slice(0, 120);
  }
  return null;
}

function compactMeta(meta) {
  const result = { entity: meta.entity };
  if (meta.localId !== undefined) result.localId = meta.localId;
  if (meta.serverId !== undefined) result.serverId = meta.serverId;
  if (meta.clientId !== undefined && meta.clientId !== null) result.clientId = meta.clientId;
  if (meta.label !== undefined && meta.label !== null) result.label = meta.label;
  if (meta.isDeleted !== undefined && meta.isDeleted !== null) result.isDeleted = meta.isDeleted;
  if (meta.deletedAt !== undefined && meta.deletedAt !== null) result.deletedAt = meta.deletedAt;
  if (meta.deletedAtIso !== undefined && meta.deletedAtIso !== null) result.deletedAtIso = meta.deletedAtIso;
  if (meta.updatedAt !== undefined && meta.updatedAt !== null) result.updatedAt = meta.updatedAt;
  if (meta.updatedAtIso !== undefined && meta.updatedAtIso !== null) result.updatedAtIso = meta.updatedAtIso;
  return result;
}

function safeLocalMeta(config, row) {
  return compactMeta({
    entity: config.entity,
    localId: row.id ?? null,
    serverId: row.serverId ?? row.server_id ?? null,
    clientId: row.client_id ?? row.localId ?? null,
    label: safeLabel(row, config.labelFields),
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
    updatedAtIso: formatDate(row.updatedAt ?? row.updated_at),
    isDeleted: row.isDeleted ?? row.is_deleted ?? null,
    deletedAt: row.deletedAt ?? row.deleted_at ?? null,
    deletedAtIso: formatDate(row.deletedAt ?? row.deleted_at),
  });
}

function safeRemoteMeta(config, row) {
  return compactMeta({
    entity: config.entity,
    serverId: row.serverId ?? row.id ?? null,
    clientId: row.client_id ?? null,
    label: safeLabel(row, config.labelFields),
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    updatedAtIso: formatDate(row.updated_at ?? row.updatedAt),
    isDeleted: row.is_deleted ?? row.isDeleted ?? null,
    deletedAt: row.deleted_at ?? row.deletedAt ?? null,
    deletedAtIso: formatDate(row.deleted_at ?? row.deletedAt),
  });
}

function likelyDevTest(meta) {
  return containsDevMarker(meta.label) || containsDevMarker(meta.clientId) || containsDevMarker(meta.serverId);
}

function localServerId(row) {
  const value = row.serverId ?? row.server_id ?? null;
  return value === undefined || value === null || value === "" ? null : String(value);
}

function remoteServerId(row) {
  const value = row.serverId ?? row.id ?? null;
  return value === undefined || value === null || value === "" ? null : String(value);
}

function localClientId(row) {
  const value = row.client_id ?? row.localId ?? row.id ?? null;
  return value === undefined || value === null || value === "" ? null : String(value);
}

function remoteClientId(row) {
  const value = row.client_id ?? null;
  return value === undefined || value === null || value === "" ? null : String(value);
}

function findRemoteForLocal(localRow, remoteRows) {
  const sid = localServerId(localRow);
  if (sid) {
    const byServerId = remoteRows.find((row) => remoteServerId(row) === sid);
    if (byServerId) return { row: byServerId, match: "serverId" };
  }

  const cid = localClientId(localRow);
  if (cid) {
    const byClientId = remoteRows.find((row) => remoteClientId(row) === cid);
    if (byClientId) return { row: byClientId, match: "client_id/localId" };
  }

  return { row: null, match: null };
}

function findLocalForRemote(remoteRow, localRows) {
  const sid = remoteServerId(remoteRow);
  if (sid) {
    const byServerId = localRows.find((row) => localServerId(row) === sid || String(row.id ?? "") === sid);
    if (byServerId) return { row: byServerId, match: "serverId" };
  }

  const cid = remoteClientId(remoteRow);
  if (cid) {
    const byClientId = localRows.find((row) => localClientId(row) === cid);
    if (byClientId) return { row: byClientId, match: "client_id/localId" };
  }

  return { row: null, match: null };
}

function countBy(rows, getKey) {
  return rows.reduce((acc, row) => {
    const key = getKey(row) ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function classifyManualReview(input) {
  const meta = input.local ?? input.remote ?? {};

  if (input.kind === "remoteOnly" && likelyDevTest(meta)) {
    return {
      category: "remoteOnlyDevTest",
      likelyDevTestData: true,
      suggestedDisposition: "ignoreDevTest",
      reason: "Remote-only row appears to be dev/test data; do not auto-plan hydration without review.",
    };
  }

  if (input.kind === "localOnly") {
    return {
      category: "localOnlyUnmatched",
      likelyDevTestData: likelyDevTest(meta),
      suggestedDisposition: likelyDevTest(meta) ? "reviewForCleanup" : "reviewForHydration",
      reason: "Local-only row has no backend match; dry-run planner never overwrites or deletes unresolved local rows.",
    };
  }

  if (input.kind === "timestampMissing") {
    return {
      category: "timestampMissing",
      likelyDevTestData: likelyDevTest(input.local) || likelyDevTest(input.remote),
      suggestedDisposition: "reviewForHydration",
      reason: "Matched row is missing comparable local updatedAt or backend updated_at.",
    };
  }

  if (input.kind === "authSensitive") {
    return {
      category: "auth/security-sensitive",
      likelyDevTestData: likelyDevTest(input.local) || likelyDevTest(input.remote),
      suggestedDisposition: "keep",
      reason: "Matched row is outside automatic update planning scope; security/auth-sensitive fields require explicit review.",
    };
  }

  return {
    category: "unsafeEntityOrField",
    likelyDevTestData: likelyDevTest(input.local) || likelyDevTest(input.remote),
    suggestedDisposition: "manualReview",
    reason: input.reason ?? "Row requires manual review before future hydration or cleanup.",
  };
}

function manualReviewRow(config, input) {
  const classification = classifyManualReview(input);
  return {
    entity: config.entity,
    category: classification.category,
    likelyDevTestData: classification.likelyDevTestData,
    suggestedDisposition: classification.suggestedDisposition,
    reason: classification.reason,
    ...(input.match ? { match: input.match } : {}),
    ...(input.local ? { local: input.local } : {}),
    ...(input.remote ? { remote: input.remote } : {}),
  };
}

function collectManualReviewRows(config, localRows, backendResult) {
  const remoteRows = backendResult.rows ?? [];
  const rows = [];

  for (const localRow of localRows) {
    const remote = findRemoteForLocal(localRow, remoteRows);
    if (!remote.row) {
      rows.push(manualReviewRow(config, { kind: "localOnly", local: safeLocalMeta(config, localRow) }));
      continue;
    }

    const localDeleted = normalizeDeleted(localRow.isDeleted ?? localRow.is_deleted);
    const remoteDeleted = normalizeDeleted(remote.row.is_deleted ?? remote.row.isDeleted);
    if (localDeleted !== remoteDeleted) {
      rows.push(manualReviewRow(config, {
        kind: "unsafeEntityOrField",
        match: remote.match,
        local: safeLocalMeta(config, localRow),
        remote: safeRemoteMeta(config, remote.row),
        reason: "Local and backend soft-delete states differ.",
      }));
      continue;
    }

    if (!config.updateFields?.length) {
      rows.push(manualReviewRow(config, {
        kind: "authSensitive",
        match: remote.match,
        local: safeLocalMeta(config, localRow),
        remote: safeRemoteMeta(config, remote.row),
      }));
      continue;
    }

    const localTime = toTime(localRow.updatedAt ?? localRow.updated_at);
    const remoteTime = toTime(remote.row.updated_at ?? remote.row.updatedAt);
    if (localTime === null || remoteTime === null) {
      rows.push(manualReviewRow(config, {
        kind: "timestampMissing",
        match: remote.match,
        local: safeLocalMeta(config, localRow),
        remote: safeRemoteMeta(config, remote.row),
      }));
    }
  }

  for (const remoteRow of remoteRows) {
    const local = findLocalForRemote(remoteRow, localRows);
    if (local.row) continue;

    const remote = safeRemoteMeta(config, remoteRow);
    if (likelyDevTest(remote)) {
      rows.push(manualReviewRow(config, { kind: "remoteOnly", remote }));
    }
  }

  return rows;
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

async function fetchJson(url, authToken) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    });
    const text = await response.text();
    let body = null;
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { parseError: "Response was not JSON." };
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      body,
      authStatus: response.headers.get("x-auth-status"),
      authEnforcement: response.headers.get("x-auth-enforcement"),
    };
  } catch (error) {
    return { ok: false, status: 0, body: { message: error instanceof Error ? error.message : String(error) }, authStatus: null, authEnforcement: null };
  }
}

async function readIndexedDbState(page) {
  return await page.evaluate(
    async ({ dbName, dbVersion, entities }) => {
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
      const result = { stores, entities: {}, tokenPresent: Boolean(localStorage.getItem("jawadBro.authToken")), authToken: localStorage.getItem("jawadBro.authToken") || null };

      for (const config of entities) {
        if (!stores.includes(config.store)) {
          result.entities[config.entity] = { missingStore: true, rows: [] };
          continue;
        }
        const tx = db.transaction(config.store, "readonly");
        result.entities[config.entity] = { missingStore: false, rows: await getAll(tx.objectStore(config.store)) };
      }

      db.close();
      return result;
    },
    { dbName: DB_NAME, dbVersion: DB_VERSION, entities: ENTITIES },
  );
}

async function readBackendState(authToken) {
  const result = {};
  for (const config of ENTITIES) {
    const response = await fetchJson(`${API_BASE_URL}/${config.endpoint}`, authToken);
    const data = response.body?.data;
    const rows = Array.isArray(data) ? data : data && typeof data === "object" ? [data] : [];
    result[config.entity] = {
      ok: response.ok && response.body?.success === true,
      status: response.status,
      authStatus: response.authStatus,
      authEnforcement: response.authEnforcement,
      rows,
      error: response.ok ? null : response.body?.message ?? "Backend request failed.",
    };
  }
  return result;
}

function buildEntityReport(config, rows, backendResult) {
  const byCategory = countBy(rows, (row) => row.category);
  const byDisposition = countBy(rows, (row) => row.suggestedDisposition);
  const byReason = countBy(rows, (row) => row.reason);

  return {
    entity: config.entity,
    backendOk: backendResult.ok,
    backendStatus: backendResult.status,
    authStatus: backendResult.authStatus,
    authEnforcement: backendResult.authEnforcement,
    totalManualReviewRows: rows.length,
    byCategory,
    byDisposition,
    byReason,
    rows: limitRows(rows),
    truncation: truncation(rows),
  };
}

async function main() {
  console.log("Dev-only hydration manual review report. Read-only; no hydration, cleanup, repair, replay, or mutation is performed.");
  console.log(`APP_URL: ${APP_URL}`);
  console.log(`API_BASE_URL: ${API_BASE_URL}`);
  console.log(`SYNC_TOOLS_USER_DATA_DIR: ${USER_DATA_DIR}`);

  const playwright = await loadPlaywright();
  if (!playwright) return;

  const context = await playwright.chromium.launchPersistentContext(USER_DATA_DIR, { headless: true });
  const page = await context.newPage();

  try {
    const pageResponse = await page.goto(APP_URL, { waitUntil: "networkidle" });
    if (!pageResponse || !pageResponse.ok()) {
      console.error(JSON.stringify({ ok: false, readOnly: true, error: "Failed to open app", status: pageResponse?.status() ?? null }, null, 2));
      process.exitCode = 1;
      return;
    }

    const localState = await readIndexedDbState(page);
    const backendState = await readBackendState(localState.authToken);
    const reports = ENTITIES.map((config) => {
      const backendResult = backendState[config.entity] ?? { rows: [], ok: false, status: 0 };
      const rows = collectManualReviewRows(config, localState.entities[config.entity]?.rows ?? [], backendResult);
      return buildEntityReport(config, rows, backendResult);
    });
    const allRows = reports.flatMap((report) => report.rows.map((row) => ({ ...row })));
    const fullRowsForCounts = ENTITIES.flatMap((config) => {
      const backendResult = backendState[config.entity] ?? { rows: [], ok: false, status: 0 };
      return collectManualReviewRows(config, localState.entities[config.entity]?.rows ?? [], backendResult);
    });

    const summary = {
      ok: true,
      readOnly: true,
      hydrationApplied: false,
      cleanupApplied: false,
      autoSyncEnabled: false,
      tokenPresent: localState.tokenPresent,
      totalEntities: ENTITIES.length,
      totalManualReviewRows: fullRowsForCounts.length,
      likelyDevTestDataRows: fullRowsForCounts.filter((row) => row.likelyDevTestData).length,
      byCategory: Object.fromEntries(CATEGORY_KEYS.map((key) => [key, fullRowsForCounts.filter((row) => row.category === key).length])),
      byDisposition: countBy(fullRowsForCounts, (row) => row.suggestedDisposition),
      byEntity: Object.fromEntries(reports.map((report) => [report.entity, {
        totalManualReviewRows: report.totalManualReviewRows,
        likelyDevTestDataRows: fullRowsForCounts.filter((row) => row.entity === report.entity && row.likelyDevTestData).length,
        byCategory: report.byCategory,
        byDisposition: report.byDisposition,
        backendOk: report.backendOk,
        backendStatus: report.backendStatus,
        authStatus: report.authStatus,
        authEnforcement: report.authEnforcement,
      }])),
    };

    console.log(JSON.stringify({
      summary,
      byEntity: Object.fromEntries(reports.map((report) => [report.entity, {
        byCategory: report.byCategory,
        byDisposition: report.byDisposition,
        byReason: report.byReason,
        rows: report.rows,
        truncation: report.truncation,
      }])),
      sampleRows: limitRows(allRows),
      notes: [
        "Read-only only: no IndexedDB or backend rows were changed.",
        "Rows are safe metadata only; payloads, passwords, tokens, full user bodies, and full customer bodies are not printed.",
        "Suggested dispositions are advisory classifications, not repair or hydration instructions.",
      ],
    }, null, 2));
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, readOnly: true, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
