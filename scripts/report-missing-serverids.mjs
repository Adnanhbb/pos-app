#!/usr/bin/env node

/*
 * Dev-only missing serverId reconciliation detail report.
 *
 * Read-only: does not replay, repair, mutate IndexedDB, mutate backend rows,
 * or print payload bodies/passwords/full records.
 */

import { tmpdir } from "node:os";
import { resolve } from "node:path";

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const DB_NAME = "POSDatabase";
const DB_VERSION = 20;
const USER_DATA_DIR = process.env.SYNC_TOOLS_USER_DATA_DIR || resolve(tmpdir(), "jawad-bro-sync-tools-profile");

const ENTITIES = [
  { entity: "units", store: "units", endpoint: "units.php", canListBackend: true, matchFields: ["name"] },
  { entity: "taxes", store: "taxes", endpoint: "taxes.php", canListBackend: true, matchFields: ["name"] },
  { entity: "discounts", store: "discounts", endpoint: "discounts.php", canListBackend: true, matchFields: ["name"] },
  { entity: "brands", store: "brands", endpoint: "brands.php", canListBackend: true, matchFields: ["name"] },
  { entity: "categories", store: "categories", endpoint: "categories.php", canListBackend: true, matchFields: ["name"] },
  { entity: "customers", store: "customers", endpoint: "customers.php", canListBackend: true, matchFields: ["name", "mobile", "cnic"] },
  { entity: "suppliers", store: "suppliers", endpoint: "suppliers.php", canListBackend: true, matchFields: ["name", "mobile", "cnic"] },
  { entity: "settings", store: "settings", endpoint: "settings.php", canListBackend: false, matchFields: [] },
  { entity: "users", store: "users", endpoint: "users.php", canListBackend: true, matchFields: ["Username", "username", "Name", "name"] },
  { entity: "held", store: "held", endpoint: "held.php", canListBackend: true, matchFields: ["invoiceNo"] },
];

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

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function safeValue(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value).slice(0, 120);
}

function getLocalMatchHints(row, matchFields) {
  const hints = {};
  for (const field of matchFields) {
    if (field in row) hints[field] = safeValue(row[field]);
  }
  return hints;
}

function queueLinkageFor(row, queueRows, entity) {
  return queueRows
    .filter((queueRow) => queueRow.entity === entity && String(queueRow.localId ?? "") === String(row.id ?? ""))
    .map((queueRow) => ({
      id: queueRow.id ?? null,
      operation: queueRow.operation ?? null,
      status: queueRow.status ?? null,
      createdAt: queueRow.createdAt ?? null,
      createdAtIso: formatDate(queueRow.createdAt),
      updatedAt: queueRow.updatedAt ?? null,
      updatedAtIso: formatDate(queueRow.updatedAt),
      retryCount: queueRow.retryCount ?? queueRow.retries ?? null,
      lastError: queueRow.lastError ?? null,
    }));
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

async function fetchJson(url) {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { parseError: "Response was not JSON." };
      }
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: { message: error instanceof Error ? error.message : String(error) },
    };
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
      const result = { entities: {}, syncQueue: [] };

      for (const config of entities) {
        if (!stores.includes(config.store)) {
          result.entities[config.entity] = [];
          continue;
        }
        const tx = db.transaction(config.store, "readonly");
        result.entities[config.entity] = await getAll(tx.objectStore(config.store));
      }

      if (stores.includes("sync_queue")) {
        const tx = db.transaction("sync_queue", "readonly");
        result.syncQueue = await getAll(tx.objectStore("sync_queue"));
      }

      db.close();
      return result;
    },
    { dbName: DB_NAME, dbVersion: DB_VERSION, entities: ENTITIES },
  );
}

async function readBackendRows(config) {
  if (!config.canListBackend) return { ok: true, rows: [], note: "No list endpoint." };
  const response = await fetchJson(`${API_BASE_URL}/${config.endpoint}`);
  return {
    ok: response.ok && response.body?.success === true && Array.isArray(response.body?.data),
    status: response.status,
    rows: Array.isArray(response.body?.data) ? response.body.data : [],
    error: response.ok ? null : response.body?.message ?? "Backend request failed.",
  };
}

async function checkSettingsByLocalId(config, localId) {
  const response = await fetchJson(`${API_BASE_URL}/${config.endpoint}?id=${encodeURIComponent(String(localId))}`);
  return {
    lookup: "client_id/localId",
    exists: response.ok && response.body?.success === true && Boolean(response.body?.data),
    status: response.status,
  };
}

function findBackendMatch(row, backendRows, config) {
  const localId = row.id ?? row.localId;
  const byClientId = backendRows.find((backendRow) => String(backendRow.client_id ?? "") === String(localId ?? ""));
  if (byClientId) {
    return { exists: true, matchType: "client_id/localId", serverId: byClientId.serverId ?? byClientId.id ?? null };
  }

  for (const field of config.matchFields) {
    if (!(field in row)) continue;
    const value = row[field];
    if (value === undefined || value === null || value === "") continue;
    const backendMatch = backendRows.find((backendRow) => String(backendRow[field] ?? "") === String(value));
    if (backendMatch) {
      return { exists: true, matchType: field, serverId: backendMatch.serverId ?? backendMatch.id ?? null };
    }
  }

  return { exists: false, matchType: null, serverId: null };
}

async function main() {
  console.log("Dev-only missing serverId detail report. Read-only; no repair is performed.");
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
      console.error(JSON.stringify({
        ok: false,
        readOnly: true,
        error: "Failed to open app",
        status: pageResponse?.status() ?? null,
      }, null, 2));
      process.exitCode = 1;
      return;
    }

    const localState = await readIndexedDbState(page);
    const backendByEntity = {};
    for (const config of ENTITIES) {
      backendByEntity[config.entity] = await readBackendRows(config);
    }

    const rows = [];
    for (const config of ENTITIES) {
      const localRows = Array.isArray(localState.entities[config.entity]) ? localState.entities[config.entity] : [];
      const missing = localRows.filter((row) => row.serverId === undefined || row.serverId === null || row.serverId === "");
      const backend = backendByEntity[config.entity];

      for (const row of missing) {
        const localId = row.id ?? row.localId ?? null;
        const backendMatch = config.entity === "settings"
          ? await checkSettingsByLocalId(config, localId)
          : backend.ok
            ? findBackendMatch(row, backend.rows, config)
            : { exists: null, matchType: null, serverId: null, backendStatus: backend.status ?? null };

        rows.push({
          entity: config.entity,
          localId,
          createdAt: row.createdAt ?? row.created_at ?? null,
          createdAtIso: formatDate(row.createdAt ?? row.created_at),
          updatedAt: row.updatedAt ?? row.updated_at ?? null,
          updatedAtIso: formatDate(row.updatedAt ?? row.updated_at),
          isDeleted: row.isDeleted ?? row.is_deleted ?? null,
          queueLinkage: queueLinkageFor(row, localState.syncQueue, config.entity),
          queueLinkageCount: queueLinkageFor(row, localState.syncQueue, config.entity).length,
          backendMatch,
          matchHints: getLocalMatchHints(row, config.matchFields),
        });
      }
    }

    const report = {
      ok: true,
      readOnly: true,
      APP_URL,
      API_BASE_URL,
      totalMissingServerIds: rows.length,
      byEntity: countBy(rows, (row) => row.entity),
      byBackendMatch: countBy(rows, (row) => row.backendMatch?.exists === true ? "matched" : row.backendMatch?.exists === false ? "notMatched" : "unknown"),
      rows,
      notes: [
        "This report prints safe metadata only and does not print payloads, passwords, or full records.",
        "Backend matches are heuristic for non-settings entities: client_id/localId first, then safe natural keys such as name or username where available.",
        "Rows should be inspected before any dry-run repair plan is created.",
      ],
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    readOnly: true,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }, null, 2));
  process.exitCode = 1;
});