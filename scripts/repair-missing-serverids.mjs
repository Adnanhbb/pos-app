#!/usr/bin/env node

/*
 * Dev-only controlled repair for high-confidence local rows missing serverId.
 *
 * Default mode is dry-run. Apply requires --apply.
 * This script never mutates backend rows, deletes rows, triggers replay, or
 * prints payload bodies/passwords/full records.
 */

const APPLY = process.argv.includes("--apply");
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
      const result = { entities: {} };

      for (const config of entities) {
        if (!stores.includes(config.store)) {
          result.entities[config.entity] = [];
          continue;
        }
        const tx = db.transaction(config.store, "readonly");
        result.entities[config.entity] = await getAll(tx.objectStore(config.store));
      }

      db.close();
      return result;
    },
    { dbName: DB_NAME, dbVersion: DB_VERSION, entities: ENTITIES },
  );
}

async function patchLocalServerIds(page, patches) {
  return await page.evaluate(
    async ({ dbName, dbVersion, patches }) => {
      function openDb() {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName, dbVersion);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
      }

      function get(store, key) {
        return new Promise((resolve, reject) => {
          if (key === undefined || key === null || key === "") {
            reject(new Error("Missing localId before IndexedDB get."));
            return;
          }
          const request = store.get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      function put(store, row) {
        return new Promise((resolve, reject) => {
          const request = store.put(row);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      const db = await openDb();
      const results = [];

      try {
        for (const patch of patches) {
          if (!Array.from(db.objectStoreNames).includes(patch.store)) {
            results.push({ ...patch, patched: false, reason: "Store does not exist." });
            continue;
          }

          const tx = db.transaction(patch.store, "readwrite");
          const store = tx.objectStore(patch.store);
          const current = await get(store, patch.localId);
          if (!current) {
            results.push({ ...patch, patched: false, reason: "Local row not found." });
            continue;
          }

          if (current.serverId !== undefined && current.serverId !== null && current.serverId !== "") {
            results.push({ ...patch, patched: false, reason: "Local row already has serverId.", existingServerId: current.serverId });
            continue;
          }

          await put(store, { ...current, serverId: patch.serverIdCandidate });
          results.push({ ...patch, patched: true, reason: "Patched local serverId." });
        }
      } finally {
        db.close();
      }

      return results;
    },
    { dbName: DB_NAME, dbVersion: DB_VERSION, patches },
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
    matchCount: response.ok && response.body?.success === true && Boolean(response.body?.data) ? 1 : 0,
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

function buildPlanItem({ config, row, backendMatch }) {
  const localId = row.id ?? row.localId ?? null;
  const highConfidence = isHighConfidenceMatch(config.entity, backendMatch);

  if (highConfidence) {
    return {
      entity: config.entity,
      store: config.store,
      localId,
      proposedAction: "patchLocalServerIdLater",
      confidence: "high",
      reason: `Single backend match by ${backendMatch.matchType}; patch local serverId to ${backendMatch.serverId}.`,
      serverIdCandidate: backendMatch.serverId,
      matchType: backendMatch.matchType,
      matchHints: safeLocalHints(row, config.matchFields),
    };
  }

  return {
    entity: config.entity,
    store: config.store,
    localId,
    proposedAction: backendMatch?.exists ? "manualReview" : "leaveUntouchedNoSafeMatch",
    confidence: backendMatch?.exists ? "medium" : "none",
    reason: backendMatch?.exists
      ? `Backend match by ${backendMatch.matchType} is not allowed for automatic serverId repair.`
      : "No safe backend match found; do not patch serverId automatically.",
    serverIdCandidate: backendMatch?.serverId ?? null,
    matchType: backendMatch?.matchType ?? null,
    matchHints: safeLocalHints(row, config.matchFields),
  };
}

async function computePlan(page) {
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
      plan.push(buildPlanItem({ config, row, backendMatch }));
    }
  }

  return plan;
}

function safePatchOutput(patch) {
  return {
    entity: patch.entity,
    localId: patch.localId,
    serverIdCandidate: patch.serverIdCandidate,
    proposedAction: patch.proposedAction,
    confidence: patch.confidence,
    reason: patch.reason,
    matchType: patch.matchType,
    matchHints: patch.matchHints,
  };
}

async function main() {
  console.log(`Dev-only missing serverId repair tool. Mode: ${APPLY ? "apply" : "dry-run"}.`);
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

    const plan = await computePlan(page);
    const allowedPatches = plan.filter((row) => row.proposedAction === "patchLocalServerIdLater" && row.confidence === "high");
    const blockedRows = plan.filter((row) => !allowedPatches.includes(row));

    const patchResults = APPLY ? await patchLocalServerIds(page, allowedPatches) : [];

    const report = {
      ok: true,
      mode: APPLY ? "apply" : "dry-run",
      dryRun: !APPLY,
      readOnly: !APPLY,
      backendMutation: false,
      replayTriggered: false,
      deletedRows: 0,
      APP_URL,
      API_BASE_URL,
      totalMissingServerIdRows: plan.length,
      allowedPatchRows: allowedPatches.length,
      blockedRows: blockedRows.length,
      byProposedAction: countBy(plan, (row) => row.proposedAction),
      wouldPatch: allowedPatches.map(safePatchOutput),
      untouched: blockedRows.map(safePatchOutput),
      patched: patchResults.map((row) => ({
        entity: row.entity,
        localId: row.localId,
        serverIdCandidate: row.serverIdCandidate,
        patched: row.patched,
        reason: row.reason,
        existingServerId: row.existingServerId ?? null,
      })),
      notes: [
        APPLY
          ? "Apply mode only patched high-confidence local serverId candidates."
          : "Dry-run only; run with --apply to patch allowed high-confidence local serverId candidates.",
        "Customers/settings with no safe match are intentionally left untouched.",
        "This tool does not mutate backend rows, delete rows, trigger replay, or add auto-sync.",
        "This tool does not print passwords, payloads, or full record bodies.",
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
    mode: APPLY ? "apply" : "dry-run",
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }, null, 2));
  process.exitCode = 1;
});
