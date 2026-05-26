#!/usr/bin/env node

/*
 * Dev-only dry-run hydration action planner.
 *
 * Read-only: does not mutate IndexedDB, mutate backend rows, replay queues,
 * repair rows, hydrate rows, merge conflicts, or print payload/password/token bodies.
 *
 * Windows PowerShell:
 *   $env:APP_URL="http://localhost:5173"
 *   $env:API_BASE_URL="http://localhost/jawad-bro/api"
 *   npm.cmd run sync:plan-hydration
 */

import { tmpdir } from "node:os";
import { resolve } from "node:path";

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const DB_NAME = "POSDatabase";
const DB_VERSION = 20;
const USER_DATA_DIR = process.env.SYNC_TOOLS_USER_DATA_DIR || resolve(tmpdir(), "jawad-bro-sync-tools-profile");
const MAX_ROWS = Number(process.env.HYDRATION_PLAN_MAX_ROWS || 10);
const TIMESTAMP_SKEW_MS = 1000;

const ACTION_CATEGORIES = [
  "createLocalFromRemote",
  "updateLocalFromRemote",
  "possibleConflict",
  "skipSoftDeleted",
  "skipLocalNewer",
  "skipRemoteOlder",
  "manualReviewRequired",
];

const UPDATE_CLASSIFICATIONS = [
  "noOpRows",
  "remoteNewerCandidates",
  "localNewerRows",
  "conflictCandidates",
  "timestampMissingRows",
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

const FIELD_ALIASES = {
  serverId: ["serverId", "server_id", "id"],
  shortName: ["shortName", "short_name"],
  itemCount: ["itemCount", "item_count"],
  isDeleted: ["isDeleted", "is_deleted"],
  deletedAt: ["deletedAt", "deleted_at"],
  businessName: ["businessName", "business_name"],
  cylBPrice: ["cylBPrice", "cyl_b_price"],
  cylSPrice: ["cylSPrice", "cyl_s_price"],
  cylDPrice: ["cylDPrice", "cyl_d_price"],
  cylWPrice: ["cylWPrice", "cyl_w_price"],
  invoiceNo: ["invoiceNo", "invoice_no"],
  transactionType: ["transactionType", "transaction_type"],
  customerId: ["customerId", "customer_id"],
  supplierId: ["supplierId", "supplier_id"],
  customerName: ["customerName", "customer_name"],
  supplierName: ["supplierName", "supplier_name"],
  grandTotal: ["grandTotal", "grand_total"],
  discountMode: ["discountMode", "discount_mode"],
  discountValue: ["discountValue", "discount_value"],
  taxMode: ["taxMode", "tax_mode"],
  taxValue: ["taxValue", "tax_value"],
};

function emptyActionCounts() {
  return Object.fromEntries(ACTION_CATEGORIES.map((category) => [category, 0]));
}

function emptyUpdateCounts() {
  return Object.fromEntries(UPDATE_CLASSIFICATIONS.map((category) => [category, 0]));
}

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
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).slice(0, 120);
    }
  }
  return null;
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

function addAction(actions, category, entity, detail) {
  actions[category].push({ entity, action: category, ...detail });
}

function addUpdateDiagnostic(updateDiagnostics, category, entity, detail) {
  updateDiagnostics[category].push({ entity, classification: category, ...detail });
}

function aliasesFor(field) {
  return FIELD_ALIASES[field] ?? [field];
}

function firstPresent(row, field) {
  for (const alias of aliasesFor(field)) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) return row[alias];
  }
  return undefined;
}

function normalizeComparableValue(field, value) {
  if (value === undefined) return undefined;
  if (field === "serverId" && value !== null && value !== "") return String(value);
  if (field === "isDeleted") return normalizeDeleted(value);
  if (field === "deletedAt") return value === null || value === "" ? null : toTime(value) ?? String(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean" || value === null) return value;
  const text = String(value);
  const numeric = Number(text);
  if (text.trim() !== "" && !Number.isNaN(numeric) && ["itemCount", "value", "subtotal", "discount", "tax", "grandTotal", "paid", "discountValue", "taxValue"].includes(field)) {
    return numeric;
  }
  return text;
}

function safeFieldDiffs(config, localRow, remoteRow) {
  const fields = config.updateFields ?? [];
  const changedFields = [];

  for (const field of fields) {
    const localValue = normalizeComparableValue(field, firstPresent(localRow, field));
    const remoteValue = normalizeComparableValue(field, firstPresent(remoteRow, field));
    if (remoteValue === undefined) continue;
    if (localValue !== remoteValue) changedFields.push(field);
  }

  return changedFields;
}

function planRemoteOnly(config, remoteRow, actions) {
  const remote = safeRemoteMeta(config, remoteRow);
  if (normalizeDeleted(remote.isDeleted)) {
    addAction(actions, "skipSoftDeleted", config.entity, {
      remote,
      reason: "Remote-only row is soft-deleted; do not create local row in dry-run planning.",
    });
    return;
  }

  if (likelyDevTest(remote)) {
    addAction(actions, "manualReviewRequired", config.entity, {
      remote,
      reason: "Remote-only row appears to be dev/test data; do not auto-plan hydration without review.",
    });
    return;
  }

  addAction(actions, "createLocalFromRemote", config.entity, {
    remote,
    reason: "Active backend-only row has no local match and no obvious dev/test marker.",
  });
}

function planLocalOnly(config, localRow, actions) {
  addAction(actions, "manualReviewRequired", config.entity, {
    local: safeLocalMeta(config, localRow),
    reason: "Local-only row has no backend match; dry-run planner never overwrites or deletes unresolved local rows.",
  });
}

function planMatched(config, localRow, remoteRow, match, actions, updateDiagnostics) {
  const local = safeLocalMeta(config, localRow);
  const remote = safeRemoteMeta(config, remoteRow);
  const localDeleted = normalizeDeleted(localRow.isDeleted ?? localRow.is_deleted);
  const remoteDeleted = normalizeDeleted(remoteRow.is_deleted ?? remoteRow.isDeleted);

  if (localDeleted !== remoteDeleted) {
    addUpdateDiagnostic(updateDiagnostics, "conflictCandidates", config.entity, {
      match,
      local,
      remote,
      reason: "Local and backend soft-delete states differ.",
    });
    addAction(actions, "possibleConflict", config.entity, {
      match,
      local,
      remote,
      reason: "Local and backend soft-delete states differ.",
    });
    return;
  }

  if (!config.updateFields?.length) {
    addAction(actions, "manualReviewRequired", config.entity, {
      match,
      local,
      remote,
      reason: "Matched row is outside automatic update planning scope; security/auth-sensitive fields require explicit review.",
    });
    return;
  }

  const localTime = toTime(localRow.updatedAt ?? localRow.updated_at);
  const remoteTime = toTime(remoteRow.updated_at ?? remoteRow.updatedAt);
  const changedFields = safeFieldDiffs(config, localRow, remoteRow);
  const safeFields = [...config.updateFields];

  if (localTime === null || remoteTime === null) {
    addUpdateDiagnostic(updateDiagnostics, "timestampMissingRows", config.entity, {
      match,
      local,
      remote,
      changedFields,
      safeFields,
      reason: "Matched row is missing a comparable local updatedAt or backend updated_at; future update hydration requires timestamp review.",
    });
    addAction(actions, "manualReviewRequired", config.entity, {
      match,
      local,
      remote,
      changedFields,
      safeFields,
      reason: "Matched row is missing timestamps; dry-run planner will not classify it as a safe update.",
    });
    return;
  }

  if (remoteTime > localTime + TIMESTAMP_SKEW_MS) {
    if (changedFields.length === 0) {
      addUpdateDiagnostic(updateDiagnostics, "noOpRows", config.entity, {
        match,
        local,
        remote,
        changedFields,
        safeFields,
        reason: "Backend timestamp is newer, but safe hydration fields already match locally.",
      });
      return;
    }

    addUpdateDiagnostic(updateDiagnostics, "remoteNewerCandidates", config.entity, {
      match,
      local,
      remote,
      changedFields,
      safeFields,
      reason: "Backend row is newer and safe fields differ; dry-run candidate only.",
    });
    addAction(actions, "updateLocalFromRemote", config.entity, {
      match,
      local,
      remote,
      changedFields,
      safeFields,
      reason: "Backend row is newer by updated_at/updatedAt, safe fields differ, and no delete conflict was detected. Dry-run only.",
    });
    return;
  }

  if (localTime > remoteTime + TIMESTAMP_SKEW_MS) {
    addUpdateDiagnostic(updateDiagnostics, "localNewerRows", config.entity, {
      match,
      local,
      remote,
      changedFields,
      safeFields,
      reason: "Local row is newer; future hydration should not overwrite it automatically.",
    });
    addAction(actions, "skipLocalNewer", config.entity, {
      match,
      local,
      remote,
      reason: "Local row is newer; future hydration should not overwrite it automatically.",
    });
    addAction(actions, "skipRemoteOlder", config.entity, {
      match,
      local,
      remote,
      reason: "Backend row is older than local row.",
    });
    return;
  }

  if (changedFields.length === 0) {
    addUpdateDiagnostic(updateDiagnostics, "noOpRows", config.entity, {
      match,
      local,
      remote,
      changedFields,
      safeFields,
      reason: "Comparable timestamps are equal and safe fields already match.",
    });
    return;
  }

  addUpdateDiagnostic(updateDiagnostics, "conflictCandidates", config.entity, {
    match,
    local,
    remote,
    changedFields,
    safeFields,
    reason: "Comparable timestamps are equal or within skew, but safe fields differ.",
  });
  addAction(actions, "possibleConflict", config.entity, {
    match,
    local,
    remote,
    changedFields,
    safeFields,
    reason: "Comparable timestamps are equal or within skew, but safe fields differ.",
  });
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

function planEntity(config, localRows, backendResult) {
  const remoteRows = backendResult.rows ?? [];
  const actions = Object.fromEntries(ACTION_CATEGORIES.map((category) => [category, []]));
  const updateDiagnostics = Object.fromEntries(UPDATE_CLASSIFICATIONS.map((category) => [category, []]));

  for (const localRow of localRows) {
    const remote = findRemoteForLocal(localRow, remoteRows);
    if (!remote.row) {
      planLocalOnly(config, localRow, actions);
      continue;
    }
    planMatched(config, localRow, remote.row, remote.match, actions, updateDiagnostics);
  }

  for (const remoteRow of remoteRows) {
    const local = findLocalForRemote(remoteRow, localRows);
    if (!local.row) {
      planRemoteOnly(config, remoteRow, actions);
    }
  }

  const actionCounts = emptyActionCounts();
  for (const category of ACTION_CATEGORIES) {
    actionCounts[category] = actions[category].length;
  }

  const updateClassificationCounts = emptyUpdateCounts();
  for (const category of UPDATE_CLASSIFICATIONS) {
    updateClassificationCounts[category] = updateDiagnostics[category].length;
  }

  return {
    entity: config.entity,
    localCount: localRows.length,
    remoteCount: remoteRows.length,
    backendOk: backendResult.ok,
    backendStatus: backendResult.status,
    authStatus: backendResult.authStatus,
    authEnforcement: backendResult.authEnforcement,
    actionCounts,
    updateClassificationCounts,
    actions: Object.fromEntries(ACTION_CATEGORIES.map((category) => [category, limitRows(actions[category])])),
    updateDiagnostics: Object.fromEntries(UPDATE_CLASSIFICATIONS.map((category) => [category, limitRows(updateDiagnostics[category])])),
    truncation: {
      actions: Object.fromEntries(ACTION_CATEGORIES.map((category) => [category, truncation(actions[category])])),
      updateDiagnostics: Object.fromEntries(UPDATE_CLASSIFICATIONS.map((category) => [category, truncation(updateDiagnostics[category])])),
    },
  };
}

async function main() {
  console.log("Dev-only hydration action planner. Dry-run only; no hydration, merge, repair, replay, or mutation is performed.");
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
      console.error(JSON.stringify({ ok: false, dryRun: true, readOnly: true, error: "Failed to open app", status: pageResponse?.status() ?? null }, null, 2));
      process.exitCode = 1;
      return;
    }

    const localState = await readIndexedDbState(page);
    const backendState = await readBackendState(localState.authToken);
    const plans = ENTITIES.map((config) => planEntity(config, localState.entities[config.entity]?.rows ?? [], backendState[config.entity] ?? { rows: [], ok: false, status: 0 }));
    const globalActionCounts = emptyActionCounts();
    const globalUpdateClassificationCounts = emptyUpdateCounts();
    for (const plan of plans) {
      for (const category of ACTION_CATEGORIES) {
        globalActionCounts[category] += plan.actionCounts[category];
      }
      for (const category of UPDATE_CLASSIFICATIONS) {
        globalUpdateClassificationCounts[category] += plan.updateClassificationCounts[category];
      }
    }

    const summary = {
      ok: true,
      dryRun: true,
      readOnly: true,
      hydrationApplied: false,
      autoSyncEnabled: false,
      tokenPresent: localState.tokenPresent,
      totalEntities: ENTITIES.length,
      actionCounts: globalActionCounts,
      updateClassificationCounts: globalUpdateClassificationCounts,
      byEntity: Object.fromEntries(plans.map((plan) => [plan.entity, {
        localCount: plan.localCount,
        remoteCount: plan.remoteCount,
        actionCounts: plan.actionCounts,
        updateClassificationCounts: plan.updateClassificationCounts,
        backendOk: plan.backendOk,
        backendStatus: plan.backendStatus,
        authStatus: plan.authStatus,
        authEnforcement: plan.authEnforcement,
      }])),
    };

    console.log(JSON.stringify({
      summary,
      plannedActions: Object.fromEntries(plans.map((plan) => [plan.entity, plan.actions])),
      updateDiagnostics: Object.fromEntries(plans.map((plan) => [plan.entity, plan.updateDiagnostics])),
      truncation: Object.fromEntries(plans.map((plan) => [plan.entity, plan.truncation])),
      notes: [
        "Dry-run only: no IndexedDB or backend rows were changed.",
        "Local-only rows are manualReviewRequired and are never overwritten or deleted by this planner.",
        "Update planning is limited to explicit safe fields; accounting, password, stock, transaction, cylinder, and batch fields are excluded.",
        "User rows never plan auth/session/security field overwrites.",
        "updateLocalFromRemote remains a dry-run planning category only; no update apply path exists.",
        "Conflict handling and hydration apply are still unresolved future work.",
      ],
    }, null, 2));
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, dryRun: true, readOnly: true, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
