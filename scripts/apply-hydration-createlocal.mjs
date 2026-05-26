#!/usr/bin/env node

/*
 * Dev-only controlled hydration apply for createLocalFromRemote actions only.
 *
 * Default mode is dry-run. Apply requires --apply.
 *
 * This script does not update existing local rows, delete rows, mutate backend data,
 * trigger replay, call repositories, enqueue sync_queue rows, resolve conflicts,
 * or hydrate manualReviewRequired rows.
 *
 * Windows PowerShell:
 *   $env:APP_URL="http://localhost:5173"
 *   $env:API_BASE_URL="http://localhost/jawad-bro/api"
 *   npm.cmd run sync:hydrate-create-local:dry
 *   npm.cmd run sync:hydrate-create-local
 */

import { tmpdir } from "node:os";
import { resolve } from "node:path";

const APPLY = process.argv.includes("--apply");
const APP_URL = process.env.APP_URL || "http://localhost:5173";
const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const DB_NAME = "POSDatabase";
const DB_VERSION = 20;
const USER_DATA_DIR = process.env.SYNC_TOOLS_USER_DATA_DIR || resolve(tmpdir(), "jawad-bro-sync-tools-profile");
const MAX_ROWS = Number(process.env.HYDRATION_APPLY_MAX_ROWS || 20);
const TIMESTAMP_SKEW_MS = 1000;

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
  { entity: "units", store: "units", endpoint: "units.php", labelFields: ["name"] },
  { entity: "taxes", store: "taxes", endpoint: "taxes.php", labelFields: ["name"] },
  { entity: "discounts", store: "discounts", endpoint: "discounts.php", labelFields: ["name"] },
  { entity: "brands", store: "brands", endpoint: "brands.php", labelFields: ["name"] },
  { entity: "categories", store: "categories", endpoint: "categories.php", labelFields: ["name"] },
  { entity: "customers", store: "customers", endpoint: "customers.php", labelFields: ["name"] },
  { entity: "suppliers", store: "suppliers", endpoint: "suppliers.php", labelFields: ["name"] },
  { entity: "settings", store: "settings", endpoint: "settings.php", labelFields: ["businessName", "shopName", "name", "key"] },
  { entity: "users", store: "users", endpoint: "users.php", labelFields: ["Username", "username", "Name", "name"] },
  { entity: "held", store: "held", endpoint: "held.php", labelFields: ["invoiceNo", "customerName", "supplierName"] },
];

const HYDRATE_FIELDS = {
  units: ["name", "shortName", "itemCount", "isDeleted", "deletedAt", "updatedAt"],
  taxes: ["name", "value", "type", "isDeleted", "deletedAt", "updatedAt"],
  discounts: ["name", "value", "type", "isDeleted", "deletedAt", "updatedAt"],
  brands: ["name", "itemCount", "isDeleted", "deletedAt", "updatedAt"],
  categories: ["name", "itemCount", "isDeleted", "deletedAt", "updatedAt"],
  customers: ["name", "mobile", "cnic", "address", "invoices", "payable", "paid", "balance", "isDeleted", "deletedAt", "updatedAt"],
  suppliers: ["name", "mobile", "cnic", "address", "invoices", "payable", "paid", "balance", "isDeleted", "deletedAt", "updatedAt"],
  settings: ["businessName", "email", "contact", "address", "printer", "language", "logo", "cylBPrice", "cylSPrice", "cylDPrice", "cylWPrice", "updatedAt"],
  users: ["Name", "Username", "Mobile", "Role", "isDeleted", "deletedAt", "updatedAt"],
  held: ["invoiceNo", "date", "transactionType", "customerId", "supplierId", "customerName", "supplierName", "subtotal", "discount", "tax", "grandTotal", "paid", "discountMode", "discountValue", "taxMode", "taxValue", "updatedAt"],
};

const REMOTE_TO_LOCAL_FIELD = {
  short_name: "shortName",
  item_count: "itemCount",
  is_deleted: "isDeleted",
  deleted_at: "deletedAt",
  updated_at: "updatedAt",
  business_name: "businessName",
  cyl_b_price: "cylBPrice",
  cyl_s_price: "cylSPrice",
  cyl_d_price: "cylDPrice",
  cyl_w_price: "cylWPrice",
  customer_id: "customerId",
  supplier_id: "supplierId",
  customer_name: "customerName",
  supplier_name: "supplierName",
  grand_total: "grandTotal",
  discount_mode: "discountMode",
  discount_value: "discountValue",
  tax_mode: "taxMode",
  tax_value: "taxValue",
};

function limitRows(rows) {
  return rows.slice(0, MAX_ROWS);
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

function normalizeDeletedAt(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isNaN(numeric)) return numeric;
  const parsed = Date.parse(String(value).replace(" ", "T"));
  return Number.isNaN(parsed) ? null : parsed;
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

function pickRemoteValue(remoteRow, localField) {
  if (remoteRow[localField] !== undefined) return remoteRow[localField];
  const snake = Object.entries(REMOTE_TO_LOCAL_FIELD).find(([, mapped]) => mapped === localField)?.[0];
  return snake ? remoteRow[snake] : undefined;
}

function normalizeHydratedValue(field, value) {
  if (value === undefined) return undefined;
  if (field === "isDeleted") return normalizeDeleted(value);
  if (field === "deletedAt") return normalizeDeletedAt(value);
  if (["itemCount", "invoices"].includes(field)) return value === null || value === "" ? 0 : Number(value);
  if (["value", "payable", "paid", "balance", "subtotal", "discount", "tax", "grandTotal", "discountValue", "taxValue"].includes(field)) {
    return value === null || value === "" ? 0 : Number(value);
  }
  return value;
}

function buildHydratedLocalRecord(config, remoteRow) {
  const serverId = remoteRow.serverId ?? remoteRow.id ?? null;
  if (serverId === undefined || serverId === null || serverId === "") {
    throw new Error(`Missing serverId/id for ${config.entity} hydration candidate.`);
  }

  const record = { serverId: Number.isNaN(Number(serverId)) ? serverId : Number(serverId) };
  const clientId = remoteRow.client_id ?? remoteRow.localId ?? null;
  if (clientId !== undefined && clientId !== null && clientId !== "") record.client_id = clientId;

  for (const field of HYDRATE_FIELDS[config.entity] ?? []) {
    const raw = pickRemoteValue(remoteRow, field);
    const value = normalizeHydratedValue(field, raw);
    if (value !== undefined) record[field] = value;
  }

  if (record.isDeleted === undefined && (remoteRow.is_deleted !== undefined || remoteRow.isDeleted !== undefined)) {
    record.isDeleted = normalizeDeleted(remoteRow.is_deleted ?? remoteRow.isDeleted);
  }
  if (record.deletedAt === undefined && (remoteRow.deleted_at !== undefined || remoteRow.deletedAt !== undefined)) {
    record.deletedAt = normalizeDeletedAt(remoteRow.deleted_at ?? remoteRow.deletedAt);
  }
  if (record.updatedAt === undefined && (remoteRow.updated_at !== undefined || remoteRow.updatedAt !== undefined)) {
    record.updatedAt = remoteRow.updated_at ?? remoteRow.updatedAt;
  }

  delete record.id;
  delete record.Password;
  delete record.password;
  delete record.password_hash;
  delete record.payload;
  delete record.data;
  delete record.body;

  return record;
}

function planCreateLocalFromRemote(config, localRows, remoteRows) {
  const actions = [];
  for (const remoteRow of remoteRows) {
    const local = findLocalForRemote(remoteRow, localRows);
    if (local.row) continue;

    const remote = safeRemoteMeta(config, remoteRow);
    if (normalizeDeleted(remote.isDeleted)) continue;
    if (likelyDevTest(remote)) continue;

    actions.push({
      entity: config.entity,
      store: config.store,
      action: "createLocalFromRemote",
      remote,
      localRecord: buildHydratedLocalRecord(config, remoteRow),
      reason: "Active backend-only row has no local match and no obvious dev/test marker.",
    });
  }
  return actions;
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
      const result = {
        stores,
        entities: {},
        syncQueueCount: stores.includes("sync_queue") ? 0 : null,
        tokenPresent: Boolean(localStorage.getItem("jawadBro.authToken")),
        authToken: localStorage.getItem("jawadBro.authToken") || null,
      };

      for (const config of entities) {
        if (!stores.includes(config.store)) {
          result.entities[config.entity] = { missingStore: true, rows: [] };
          continue;
        }
        const tx = db.transaction(config.store, "readonly");
        result.entities[config.entity] = { missingStore: false, rows: await getAll(tx.objectStore(config.store)) };
      }

      if (stores.includes("sync_queue")) {
        const tx = db.transaction("sync_queue", "readonly");
        result.syncQueueCount = (await getAll(tx.objectStore("sync_queue"))).length;
      }

      db.close();
      return result;
    },
    { dbName: DB_NAME, dbVersion: DB_VERSION, entities: ENTITIES },
  );
}

async function applyCreateLocalActions(page, actions) {
  return await page.evaluate(
    async ({ dbName, dbVersion, actions }) => {
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
      function add(store, value) {
        return new Promise((resolve, reject) => {
          const request = store.add(value);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      const db = await openDb();
      const stores = Array.from(db.objectStoreNames);
      const beforeQueueCount = stores.includes("sync_queue") ? (await getAll(db.transaction("sync_queue", "readonly").objectStore("sync_queue"))).length : null;
      const applied = [];

      try {
        for (const action of actions) {
          if (!stores.includes(action.store)) {
            applied.push({ entity: action.entity, serverId: action.remote.serverId, skipped: true, reason: "Missing IndexedDB store." });
            continue;
          }
          const tx = db.transaction(action.store, "readwrite");
          const localId = await add(tx.objectStore(action.store), action.localRecord);
          applied.push({ entity: action.entity, localId, serverId: action.localRecord.serverId, label: action.remote.label ?? null });
        }

        const afterQueueCount = stores.includes("sync_queue") ? (await getAll(db.transaction("sync_queue", "readonly").objectStore("sync_queue"))).length : null;
        return { applied, beforeQueueCount, afterQueueCount, queueRowsCreated: beforeQueueCount === null || afterQueueCount === null ? null : afterQueueCount - beforeQueueCount };
      } finally {
        db.close();
      }
    },
    { dbName: DB_NAME, dbVersion: DB_VERSION, actions },
  );
}

function buildSummary(actions, localState, backendState) {
  const byEntity = Object.fromEntries(ENTITIES.map((config) => [config.entity, {
    localCount: localState.entities[config.entity]?.rows?.length ?? 0,
    remoteCount: backendState[config.entity]?.rows?.length ?? 0,
    createLocalFromRemote: actions.filter((action) => action.entity === config.entity).length,
    backendOk: backendState[config.entity]?.ok ?? false,
    backendStatus: backendState[config.entity]?.status ?? null,
    authStatus: backendState[config.entity]?.authStatus ?? null,
    authEnforcement: backendState[config.entity]?.authEnforcement ?? null,
  }]));

  return {
    ok: true,
    mode: APPLY ? "apply" : "dry-run",
    dryRun: !APPLY,
    readOnly: !APPLY,
    applyRequiresFlag: true,
    hydrationApplied: APPLY,
    appliedActionType: "createLocalFromRemote",
    updateLocalFromRemoteApplied: false,
    manualReviewRequiredApplied: false,
    autoSyncEnabled: false,
    tokenPresent: localState.tokenPresent,
    syncQueueCountBefore: localState.syncQueueCount,
    plannedCreates: actions.length,
    byEntity,
  };
}

async function main() {
  console.log(`Dev-only hydration create-local ${APPLY ? "apply" : "dry-run"}. Only createLocalFromRemote is eligible.`);
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
      console.error(JSON.stringify({ ok: false, mode: APPLY ? "apply" : "dry-run", error: "Failed to open app", status: pageResponse?.status() ?? null }, null, 2));
      process.exitCode = 1;
      return;
    }

    const localState = await readIndexedDbState(page);
    const backendState = await readBackendState(localState.authToken);
    const actions = ENTITIES.flatMap((config) => planCreateLocalFromRemote(config, localState.entities[config.entity]?.rows ?? [], backendState[config.entity]?.rows ?? []));
    const summary = buildSummary(actions, localState, backendState);

    if (!APPLY) {
      console.log(JSON.stringify({
        summary,
        plannedCreates: limitRows(actions.map((action) => ({
          entity: action.entity,
          store: action.store,
          action: action.action,
          remote: action.remote,
          localRecordPreview: safeLocalMeta({ entity: action.entity, labelFields: ENTITIES.find((config) => config.entity === action.entity)?.labelFields ?? [] }, action.localRecord),
          reason: action.reason,
        }))),
        truncation: { plannedCreates: { total: actions.length, shown: Math.min(actions.length, MAX_ROWS), truncated: actions.length > MAX_ROWS } },
        notes: [
          "Dry-run only by default. Use --apply to write createLocalFromRemote rows.",
          "Only createLocalFromRemote actions are eligible.",
          "No updateLocalFromRemote, manualReviewRequired, conflict, delete, replay, or enqueue behavior is applied.",
        ],
      }, null, 2));
      return;
    }

    const applyResult = await applyCreateLocalActions(page, actions);
    const afterState = await readIndexedDbState(page);

    console.log(JSON.stringify({
      summary: {
        ...summary,
        syncQueueCountAfter: afterState.syncQueueCount,
        queueRowsCreated: applyResult.queueRowsCreated,
        appliedRows: applyResult.applied.filter((row) => !row.skipped).length,
        skippedRows: applyResult.applied.filter((row) => row.skipped).length,
      },
      appliedRows: applyResult.applied,
      notes: [
        "Apply mode wrote direct IndexedDB rows only for createLocalFromRemote actions.",
        "No repository create/update methods were called.",
        "No sync_queue rows should be created by this hydration apply.",
      ],
    }, null, 2));
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, mode: APPLY ? "apply" : "dry-run", error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});