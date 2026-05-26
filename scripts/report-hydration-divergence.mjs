#!/usr/bin/env node

/*
 * Dev-only hydration divergence diagnostics.
 *
 * Read-only: does not mutate IndexedDB, mutate backend rows, replay queues,
 * repair rows, hydrate rows, or print payload/password/token bodies.
 *
 * Windows PowerShell:
 *   $env:APP_URL="http://localhost:5173"
 *   $env:API_BASE_URL="http://localhost/jawad-bro/api"
 *   npm.cmd run sync:report-hydration-divergence
 */

import { tmpdir } from "node:os";
import { resolve } from "node:path";

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const DB_NAME = "POSDatabase";
const DB_VERSION = 20;
const USER_DATA_DIR = process.env.SYNC_TOOLS_USER_DATA_DIR || resolve(tmpdir(), "jawad-bro-sync-tools-profile");
const MAX_ROWS = Number(process.env.HYDRATION_DIVERGENCE_MAX_ROWS || 10);

const ENTITIES = [
  { entity: "units", store: "units", endpoint: "units.php", labelFields: ["name"] },
  { entity: "taxes", store: "taxes", endpoint: "taxes.php", labelFields: ["name"] },
  { entity: "discounts", store: "discounts", endpoint: "discounts.php", labelFields: ["name"] },
  { entity: "brands", store: "brands", endpoint: "brands.php", labelFields: ["name"] },
  { entity: "categories", store: "categories", endpoint: "categories.php", labelFields: ["name"] },
  { entity: "customers", store: "customers", endpoint: "customers.php", labelFields: ["name"] },
  { entity: "suppliers", store: "suppliers", endpoint: "suppliers.php", labelFields: ["name"] },
  { entity: "settings", store: "settings", endpoint: "settings.php", labelFields: ["businessName"] },
  { entity: "users", store: "users", endpoint: "users.php", labelFields: ["Username", "username", "Name", "name"] },
  { entity: "held", store: "held", endpoint: "held.php", labelFields: ["invoiceNo", "customerName", "supplierName"] },
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
  return {
    entity: config.entity,
    localId: row.id ?? null,
    serverId: row.serverId ?? null,
    clientId: row.client_id ?? row.localId ?? null,
    label: safeLabel(row, config.labelFields),
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
    updatedAtIso: formatDate(row.updatedAt ?? row.updated_at),
    isDeleted: row.isDeleted ?? row.is_deleted ?? null,
    deletedAt: row.deletedAt ?? row.deleted_at ?? null,
    deletedAtIso: formatDate(row.deletedAt ?? row.deleted_at),
  };
}

function safeRemoteMeta(config, row) {
  return {
    entity: config.entity,
    serverId: row.serverId ?? row.id ?? null,
    clientId: row.client_id ?? null,
    label: safeLabel(row, config.labelFields),
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    updatedAtIso: formatDate(row.updated_at ?? row.updatedAt),
    isDeleted: row.is_deleted ?? row.isDeleted ?? null,
    deletedAt: row.deleted_at ?? row.deletedAt ?? null,
    deletedAtIso: formatDate(row.deleted_at ?? row.deletedAt),
  };
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

function analyzeEntity(config, localRows, backendResult) {
  const remoteRows = backendResult.rows ?? [];
  const localOnly = [];
  const remoteOnly = [];
  const possibleDivergence = [];
  const softDeleteMismatches = [];

  for (const localRow of localRows) {
    const remote = findRemoteForLocal(localRow, remoteRows);
    if (!remote.row) {
      localOnly.push({ ...safeLocalMeta(config, localRow), reason: "No matching backend row by serverId or client_id/localId." });
      continue;
    }

    const localTime = toTime(localRow.updatedAt ?? localRow.updated_at);
    const remoteTime = toTime(remote.row.updated_at ?? remote.row.updatedAt);
    if (localTime !== null && remoteTime !== null && Math.abs(localTime - remoteTime) > 1000) {
      possibleDivergence.push({
        match: remote.match,
        local: safeLocalMeta(config, localRow),
        remote: safeRemoteMeta(config, remote.row),
        reason: "updatedAt/updated_at differ.",
      });
    }

    const localDeleted = normalizeDeleted(localRow.isDeleted ?? localRow.is_deleted);
    const remoteDeleted = normalizeDeleted(remote.row.is_deleted ?? remote.row.isDeleted);
    if (localDeleted !== remoteDeleted) {
      softDeleteMismatches.push({
        match: remote.match,
        local: safeLocalMeta(config, localRow),
        remote: safeRemoteMeta(config, remote.row),
        reason: "Local and backend soft-delete state differ.",
      });
    }
  }

  for (const remoteRow of remoteRows) {
    const local = findLocalForRemote(remoteRow, localRows);
    if (!local.row) {
      remoteOnly.push({ ...safeRemoteMeta(config, remoteRow), reason: "No matching local row by serverId or client_id/localId." });
    }
  }

  return {
    entity: config.entity,
    localCount: localRows.length,
    remoteCount: remoteRows.length,
    countMismatch: localRows.length !== remoteRows.length,
    backendStatus: backendResult.status,
    backendOk: backendResult.ok,
    authStatus: backendResult.authStatus,
    authEnforcement: backendResult.authEnforcement,
    localOnly: limitRows(localOnly),
    remoteOnly: limitRows(remoteOnly),
    possibleDivergence: limitRows(possibleDivergence),
    softDeleteMismatches: limitRows(softDeleteMismatches),
    totals: {
      localOnly: localOnly.length,
      remoteOnly: remoteOnly.length,
      possibleDivergence: possibleDivergence.length,
      softDeleteMismatches: softDeleteMismatches.length,
    },
    truncation: {
      localOnly: truncation(localOnly),
      remoteOnly: truncation(remoteOnly),
      possibleDivergence: truncation(possibleDivergence),
      softDeleteMismatches: truncation(softDeleteMismatches),
    },
  };
}

async function main() {
  console.log("Dev-only hydration divergence report. Read-only; no hydration or repair is performed.");
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
    const reports = ENTITIES.map((config) => analyzeEntity(config, localState.entities[config.entity]?.rows ?? [], backendState[config.entity] ?? { rows: [], ok: false, status: 0 }));

    const summary = {
      ok: true,
      readOnly: true,
      hydrationImplemented: false,
      autoSyncEnabled: false,
      tokenPresent: localState.tokenPresent,
      totalEntities: ENTITIES.length,
      countMismatches: reports.filter((report) => report.countMismatch).length,
      localOnlyRows: reports.reduce((sum, report) => sum + report.totals.localOnly, 0),
      remoteOnlyRows: reports.reduce((sum, report) => sum + report.totals.remoteOnly, 0),
      possibleDivergenceRows: reports.reduce((sum, report) => sum + report.totals.possibleDivergence, 0),
      softDeleteMismatchRows: reports.reduce((sum, report) => sum + report.totals.softDeleteMismatches, 0),
      byEntity: Object.fromEntries(reports.map((report) => [report.entity, {
        localCount: report.localCount,
        remoteCount: report.remoteCount,
        countMismatch: report.countMismatch,
        localOnly: report.totals.localOnly,
        remoteOnly: report.totals.remoteOnly,
        possibleDivergence: report.totals.possibleDivergence,
        softDeleteMismatches: report.totals.softDeleteMismatches,
        backendOk: report.backendOk,
        backendStatus: report.backendStatus,
        authStatus: report.authStatus,
        authEnforcement: report.authEnforcement,
      }]))
    };

    console.log(JSON.stringify({
      summary,
      countMismatchWarnings: reports.filter((report) => report.countMismatch).map((report) => ({ entity: report.entity, localCount: report.localCount, remoteCount: report.remoteCount })),
      localOnlyRows: Object.fromEntries(reports.map((report) => [report.entity, report.localOnly])),
      remoteOnlyRows: Object.fromEntries(reports.map((report) => [report.entity, report.remoteOnly])),
      possibleDivergenceRows: Object.fromEntries(reports.map((report) => [report.entity, report.possibleDivergence])),
      softDeleteMismatches: Object.fromEntries(reports.map((report) => [report.entity, report.softDeleteMismatches])),
      truncation: Object.fromEntries(reports.map((report) => [report.entity, report.truncation])),
    }, null, 2));
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, readOnly: true, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});