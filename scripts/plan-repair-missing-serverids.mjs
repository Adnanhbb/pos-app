#!/usr/bin/env node

/*
 * Dev-only dry-run repair plan for local rows missing serverId.
 *
 * Dry-run only: does not mutate IndexedDB, mutate backend rows, trigger replay,
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

function safeLocalHints(row, fields) {
  const hints = {};
  for (const field of fields) {
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
      lastErrorPresent: Boolean(queueRow.lastError),
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
    exists: response.ok && response.body?.success === true && Boolean(response.body?.data),
    matchType: "client_id/localId",
    serverId: response.body?.data?.serverId ?? response.body?.data?.id ?? null,
    status: response.status,
  };
}

function findBackendMatch(row, backendRows, config) {
  const localId = row.id ?? row.localId;
  const byClientId = backendRows.filter((backendRow) => String(backendRow.client_id ?? "") === String(localId ?? ""));
  if (byClientId.length === 1) {
    return { exists: true, matchType: "client_id/localId", serverId: byClientId[0].serverId ?? byClientId[0].id ?? null, matchCount: 1 };
  }
  if (byClientId.length > 1) {
    return { exists: true, matchType: "client_id/localId", serverId: null, matchCount: byClientId.length };
  }

  for (const field of config.matchFields) {
    if (!(field in row)) continue;
    const value = row[field];
    if (value === undefined || value === null || value === "") continue;
    const matches = backendRows.filter((backendRow) => String(backendRow[field] ?? "") === String(value));
    if (matches.length === 1) {
      return { exists: true, matchType: field, serverId: matches[0].serverId ?? matches[0].id ?? null, matchCount: 1 };
    }
    if (matches.length > 1) {
      return { exists: true, matchType: field, serverId: null, matchCount: matches.length };
    }
  }

  return { exists: false, matchType: null, serverId: null, matchCount: 0 };
}

function isHighConfidenceMatch(entity, backendMatch) {
  if (!backendMatch?.exists || !backendMatch.serverId || backendMatch.matchCount !== 1) return false;
  if (backendMatch.matchType === "client_id/localId") return true;
  if (entity === "users" && ["Username", "username"].includes(backendMatch.matchType)) return true;
  return false;
}

function buildPlanItem({ config, row, backendMatch, queueLinkage }) {
  const localId = row.id ?? row.localId ?? null;
  const highConfidence = isHighConfidenceMatch(config.entity, backendMatch);
  const hasQueueLinkage = queueLinkage.length > 0;

  if (highConfidence) {
    return {
      entity: config.entity,
      localId,
      proposedAction: "patchLocalServerIdLater",
      confidence: "high",
      reason: `Single backend match by ${backendMatch.matchType}; future apply script could patch local serverId to ${backendMatch.serverId}.`,
      serverIdCandidate: backendMatch.serverId,
      queueLinkageCount: queueLinkage.length,
      createdAt: row.createdAt ?? row.created_at ?? null,
      createdAtIso: formatDate(row.createdAt ?? row.created_at),
      updatedAt: row.updatedAt ?? row.updated_at ?? null,
      updatedAtIso: formatDate(row.updatedAt ?? row.updated_at),
      matchHints: safeLocalHints(row, config.matchFields),
    };
  }

  if (backendMatch?.exists && backendMatch.matchCount > 1) {
    return {
      entity: config.entity,
      localId,
      proposedAction: "manualReview",
      confidence: "low",
      reason: `Multiple backend matches by ${backendMatch.matchType}; automatic serverId patch would be unsafe.`,
      serverIdCandidate: null,
      queueLinkageCount: queueLinkage.length,
      matchHints: safeLocalHints(row, config.matchFields),
    };
  }

  if (backendMatch?.exists && backendMatch.serverId) {
    return {
      entity: config.entity,
      localId,
      proposedAction: "manualReview",
      confidence: "medium",
      reason: `Backend match by ${backendMatch.matchType} exists, but this match type is not high-confidence enough for an automatic patch plan.`,
      serverIdCandidate: backendMatch.serverId,
      queueLinkageCount: queueLinkage.length,
      matchHints: safeLocalHints(row, config.matchFields),
    };
  }

  return {
    entity: config.entity,
    localId,
    proposedAction: hasQueueLinkage ? "leaveUntouchedPendingQueueReview" : "leaveUntouchedNoSafeMatch",
    confidence: "none",
    reason: hasQueueLinkage
      ? "Local row has queue linkage; inspect queue state before any serverId repair."
      : "No safe backend match found; do not patch serverId automatically.",
    serverIdCandidate: null,
    queueLinkageCount: queueLinkage.length,
    matchHints: safeLocalHints(row, config.matchFields),
  };
}

async function main() {
  console.log("Dev-only missing serverId dry-run repair plan. No repair is applied.");
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
      console.error(JSON.stringify({ ok: false, dryRun: true, error: "Failed to open app", status: pageResponse?.status() ?? null }, null, 2));
      process.exitCode = 1;
      return;
    }

    const localState = await readIndexedDbState(page);
    const backendByEntity = {};
    for (const config of ENTITIES) {
      backendByEntity[config.entity] = await readBackendRows(config);
    }

    const plan = [];
    for (const config of ENTITIES) {
      const localRows = Array.isArray(localState.entities[config.entity]) ? localState.entities[config.entity] : [];
      const missingRows = localRows.filter((row) => row.serverId === undefined || row.serverId === null || row.serverId === "");
      const backend = backendByEntity[config.entity];

      for (const row of missingRows) {
        const localId = row.id ?? row.localId ?? null;
        const backendMatch = config.entity === "settings"
          ? await checkSettingsByLocalId(config, localId)
          : backend.ok
            ? findBackendMatch(row, backend.rows, config)
            : { exists: null, matchType: null, serverId: null, matchCount: null, backendStatus: backend.status ?? null };
        const queueLinkage = queueLinkageFor(row, localState.syncQueue, config.entity);
        plan.push(buildPlanItem({ config, row, backendMatch, queueLinkage }));
      }
    }

    const report = {
      ok: true,
      dryRun: true,
      readOnly: true,
      APP_URL,
      API_BASE_URL,
      totalPlanRows: plan.length,
      byEntity: countBy(plan, (row) => row.entity),
      byProposedAction: countBy(plan, (row) => row.proposedAction),
      byConfidence: countBy(plan, (row) => row.confidence),
      proposedActions: plan,
      notes: [
        "No IndexedDB or backend rows were changed.",
        "Only high-confidence matches are proposed for a future serverId patch apply script.",
        "Natural-key matches such as names are treated conservatively unless uniqueness is strong enough.",
        "This script does not print payloads, passwords, or full records.",
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
    dryRun: true,
    readOnly: true,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }, null, 2));
  process.exitCode = 1;
});
