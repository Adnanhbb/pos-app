#!/usr/bin/env node

/*
 * Dev-only sync reconciliation diagnostics.
 *
 * This script is read-only: it does not call syncEngine.processPending(), replay
 * queue rows, repair IndexedDB, mutate backend rows, or print payload bodies.
 *
 * Windows PowerShell:
 *   $env:APP_URL="http://localhost:5173"
 *   $env:API_BASE_URL="http://localhost/jawad-bro/api"
 *   npm run sync:report-reconciliation
 */

import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const DB_NAME = "POSDatabase";
const DB_VERSION = 20;
const PROCESSING_STUCK_MINUTES = Number(process.env.SYNC_RECONCILIATION_STUCK_MINUTES || 15);
const MAX_DISPLAY_ROWS = Number(process.env.SYNC_RECONCILIATION_MAX_ROWS || 50);
const USER_DATA_DIR = process.env.SYNC_TOOLS_USER_DATA_DIR || resolve(tmpdir(), "jawad-bro-sync-tools-profile");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");

const ENTITIES = [
  { entity: "units", store: "units", endpoint: "units.php", canListBackend: true },
  { entity: "taxes", store: "taxes", endpoint: "taxes.php", canListBackend: true },
  { entity: "discounts", store: "discounts", endpoint: "discounts.php", canListBackend: true },
  { entity: "brands", store: "brands", endpoint: "brands.php", canListBackend: true },
  { entity: "categories", store: "categories", endpoint: "categories.php", canListBackend: true },
  { entity: "customers", store: "customers", endpoint: "customers.php", canListBackend: true },
  { entity: "suppliers", store: "suppliers", endpoint: "suppliers.php", canListBackend: true },
  { entity: "settings", store: "settings", endpoint: "settings.php", canListBackend: false },
  { entity: "users", store: "users", endpoint: "users.php", canListBackend: true },
  { entity: "held", store: "held", endpoint: "held.php", canListBackend: true },
];

const ENTITY_BY_NAME = new Map(ENTITIES.map((config) => [config.entity, config]));

function limitedRows(items) {
  return Array.isArray(items) ? items.slice(0, MAX_DISPLAY_ROWS) : [];
}

function truncationInfo(items) {
  const count = Array.isArray(items) ? items.length : 0;
  return {
    total: count,
    shown: Math.min(count, MAX_DISPLAY_ROWS),
    truncated: count > MAX_DISPLAY_ROWS,
  };
}
function formatDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    const numericDate = new Date(numeric);
    return Number.isNaN(numericDate.getTime()) ? String(value) : numericDate.toISOString();
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

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function safeQueueMetadata(row) {
  return {
    id: row.id ?? null,
    entity: row.entity ?? null,
    operation: row.operation ?? null,
    status: row.status ?? null,
    localId: row.localId ?? null,
    serverId: row.serverId ?? null,
    createdAt: row.createdAt ?? null,
    createdAtIso: formatDate(row.createdAt),
    updatedAt: row.updatedAt ?? null,
    updatedAtIso: formatDate(row.updatedAt),
    retryCount: row.retryCount ?? row.retries ?? null,
    lastError: row.lastError ?? null,
  };
}

function safeLocalMetadata(entity, row) {
  return {
    entity,
    id: row.id ?? null,
    serverId: row.serverId ?? null,
    isDeleted: row.isDeleted ?? row.is_deleted ?? null,
    deletedAt: row.deletedAt ?? row.deleted_at ?? null,
    deletedAtIso: formatDate(row.deletedAt ?? row.deleted_at),
  };
}

function safeReplayMetadata(row) {
  return {
    id: row.id ?? null,
    clientTransactionId: row.client_transaction_id ?? null,
    transactionType: row.transaction_type ?? null,
    status: row.status ?? null,
    replayStatus: row.replay_status ?? null,
    replayAttempts: Number(row.replay_attempts ?? 0),
    lockedAt: row.locked_at ?? null,
    lockedAtIso: formatDate(row.locked_at),
    lockedBy: row.locked_by ?? null,
    replayErrorPresent: Boolean(Number(row.has_replay_error ?? 0)),
    updatedAt: row.updated_at ?? null,
    updatedAtIso: formatDate(row.updated_at),
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
      const result = {
        stores,
        entities: {},
        syncQueue: [],
      };

      for (const config of entities) {
        if (!stores.includes(config.store)) {
          result.entities[config.entity] = { missingStore: true, rows: [] };
          continue;
        }

        const tx = db.transaction(config.store, "readonly");
        result.entities[config.entity] = {
          missingStore: false,
          rows: await getAll(tx.objectStore(config.store)),
        };
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

async function readBackendCrudState() {
  const backend = {};

  for (const config of ENTITIES) {
    if (!config.canListBackend) {
      backend[config.entity] = {
        ok: true,
        status: null,
        rows: [],
        note: "Backend list endpoint is not available; rows are checked individually when possible.",
      };
      continue;
    }

    const response = await fetchJson(`${API_BASE_URL}/${config.endpoint}`);
    backend[config.entity] = {
      ok: response.ok && response.body?.success === true && Array.isArray(response.body?.data),
      status: response.status,
      rows: Array.isArray(response.body?.data) ? response.body.data : [],
      error: response.ok ? null : response.body?.message ?? "Backend request failed.",
    };
  }

  return backend;
}

async function checkBackendRowByLocalId(config, localId) {
  const response = await fetchJson(`${API_BASE_URL}/${config.endpoint}?id=${encodeURIComponent(String(localId))}`);
  return {
    ok: response.ok && response.body?.success === true && Boolean(response.body?.data),
    status: response.status,
  };
}

function findPhpBinary() {
  if (process.env.PHP_BIN) return process.env.PHP_BIN;

  const laragonPhpRoot = "C:\\laragon\\bin\\php";
  if (existsSync(laragonPhpRoot)) {
    const candidates = readdirSync(laragonPhpRoot)
      .map((entry) => resolve(laragonPhpRoot, entry, "php.exe"))
      .filter((candidate) => existsSync(candidate))
      .sort()
      .reverse();

    if (candidates.length > 0) return candidates[0];
  }

  return "php";
}

function phpReplayReportCode() {
  return String.raw`
require_once getcwd() . '/api/config/database.php';

$pdo = get_pdo();
$sql = "
    SELECT
        id,
        client_transaction_id,
        transaction_type,
        status,
        replay_status,
        replay_attempts,
        locked_at,
        locked_by,
        CASE WHEN replay_error IS NULL OR replay_error = '' THEN 0 ELSE 1 END AS has_replay_error,
        updated_at
    FROM sync_transactions
    WHERE replay_status IN ('failed', 'processing')
    ORDER BY updated_at ASC, id ASC
";
$rows = $pdo->query($sql)->fetchAll();

echo json_encode(['ok' => true, 'rows' => $rows], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
`;
}

function readBackendReplayRows() {
  const phpBinary = findPhpBinary();
  const result = spawnSync(phpBinary, ["-r", phpReplayReportCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 20,
  });

  if (result.error) {
    return {
      ok: false,
      rows: [],
      error: `Failed to run PHP CLI: ${result.error.message}`,
      phpBinary,
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      rows: [],
      error: "PHP replay diagnostics query failed.",
      status: result.status,
      phpBinary,
      stderr: result.stderr.trim(),
    };
  }

  try {
    const parsed = JSON.parse(result.stdout);
    return {
      ok: parsed.ok === true,
      rows: Array.isArray(parsed.rows) ? parsed.rows : [],
      phpBinary,
    };
  } catch (error) {
    return {
      ok: false,
      rows: [],
      error: error instanceof Error ? error.message : String(error),
      phpBinary,
    };
  }
}

function analyzeLocalAndQueue(localState, backendState) {
  const now = Date.now();
  const stuckCutoff = now - PROCESSING_STUCK_MINUTES * 60 * 1000;
  const missingServerIds = [];
  const duplicateServerIds = [];
  const missingBackendRows = [];
  const countMismatchWarnings = [];
  const localRowsByEntity = {};

  for (const config of ENTITIES) {
    const entityState = localState.entities[config.entity] ?? { rows: [] };
    const rows = Array.isArray(entityState.rows) ? entityState.rows : [];
    localRowsByEntity[config.entity] = new Map(rows.map((row) => [String(row.id), row]));

    for (const row of rows) {
      if (row.serverId === undefined || row.serverId === null || row.serverId === "") {
        missingServerIds.push(safeLocalMetadata(config.entity, row));
      }
    }

    const serverIdGroups = new Map();
    for (const row of rows) {
      if (row.serverId === undefined || row.serverId === null || row.serverId === "") continue;
      const key = String(row.serverId);
      if (!serverIdGroups.has(key)) serverIdGroups.set(key, []);
      serverIdGroups.get(key).push(row);
    }

    for (const [serverId, groupedRows] of serverIdGroups.entries()) {
      if (groupedRows.length <= 1) continue;
      duplicateServerIds.push({
        entity: config.entity,
        serverId,
        localIds: groupedRows.map((row) => row.id ?? null),
      });
    }

    const backend = backendState[config.entity];
    if (config.canListBackend && backend?.ok) {
      const backendIds = new Set(backend.rows.map((row) => String(row.serverId ?? row.id)));
      for (const row of rows) {
        if (row.serverId === undefined || row.serverId === null || row.serverId === "") continue;
        if (!backendIds.has(String(row.serverId))) {
          missingBackendRows.push(safeLocalMetadata(config.entity, row));
        }
      }

      if (rows.length !== backend.rows.length) {
        countMismatchWarnings.push({
          entity: config.entity,
          localRows: rows.length,
          backendRows: backend.rows.length,
          warningOnly: true,
        });
      }
    } else if (config.canListBackend) {
      countMismatchWarnings.push({
        entity: config.entity,
        localRows: rows.length,
        backendRows: null,
        warningOnly: true,
        backendStatus: backend?.status ?? null,
        note: backend?.error ?? "Backend list could not be read.",
      });
    }
  }

  const queueRows = Array.isArray(localState.syncQueue) ? localState.syncQueue : [];
  const queueRowsInScope = queueRows.filter((row) => ENTITY_BY_NAME.has(row.entity));
  const orphanQueueRows = [];
  const orphanedPendingRows = [];
  const failedQueueRows = [];
  const stuckQueueRows = [];

  for (const row of queueRowsInScope) {
    const config = ENTITY_BY_NAME.get(row.entity);
    const localId = row.localId ?? null;
    const localRows = localRowsByEntity[row.entity] ?? new Map();
    const isDelete = row.operation === "delete";
    const missingLocal = localId === null || !localRows.has(String(localId));

    if (missingLocal && !isDelete) {
      const safeRow = safeQueueMetadata(row);
      orphanQueueRows.push(safeRow);
      if (row.status === "pending") orphanedPendingRows.push(safeRow);
    }

    if (row.status === "failed") {
      failedQueueRows.push(safeQueueMetadata(row));
    }

    if (row.status === "processing") {
      const updatedAt = toTime(row.updatedAt ?? row.createdAt);
      if (updatedAt === null || updatedAt <= stuckCutoff) {
        stuckQueueRows.push(safeQueueMetadata(row));
      }
    }
  }

  return {
    missingServerIds,
    orphanQueueRows,
    orphanedPendingRows,
    duplicateServerIds,
    missingBackendRows,
    failedQueueRows,
    stuckQueueRows,
    countMismatchWarnings,
    totals: {
      localRowsByEntity: Object.fromEntries(
        Object.entries(localRowsByEntity).map(([entity, rows]) => [entity, rows.size])
      ),
      queueRows: queueRows.length,
      queueRowsInScope: queueRowsInScope.length,
    },
  };
}

async function analyzeSettingsBackendRows(localRows) {
  const config = ENTITY_BY_NAME.get("settings");
  const missing = [];

  for (const row of localRows) {
    if (row.serverId === undefined || row.serverId === null || row.serverId === "") continue;
    const localId = row.id ?? row.localId;
    if (localId === undefined || localId === null || localId === "") continue;
    const result = await checkBackendRowByLocalId(config, localId);
    if (!result.ok) {
      missing.push({
        ...safeLocalMetadata("settings", row),
        backendStatus: result.status,
        lookup: "client_id/localId",
      });
    }
  }

  return missing;
}

function analyzeReplayRows(replayResult) {
  const now = Date.now();
  const stuckCutoff = now - PROCESSING_STUCK_MINUTES * 60 * 1000;
  const rows = Array.isArray(replayResult.rows) ? replayResult.rows : [];
  const safeRows = rows.map(safeReplayMetadata);

  return {
    failedReplayRows: safeRows.filter((row) => row.replayStatus === "failed"),
    stuckReplayRows: safeRows.filter((row) => {
      if (row.replayStatus !== "processing") return false;
      const lockedAt = toTime(row.lockedAt);
      return lockedAt === null || lockedAt <= stuckCutoff;
    }),
    backendReplayDiagnosticsAvailable: replayResult.ok === true,
    backendReplayDiagnosticsError: replayResult.ok === true ? null : replayResult.error ?? "Unavailable",
  };
}

async function main() {
  console.log("Dev-only sync reconciliation report. Read-only; no replay or repair is performed.");
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
        url: APP_URL,
      }, null, 2));
      process.exitCode = 1;
      return;
    }

    const [localState, backendState] = await Promise.all([
      readIndexedDbState(page),
      readBackendCrudState(),
    ]);
    const replayResult = readBackendReplayRows();
    const localAnalysis = analyzeLocalAndQueue(localState, backendState);
    const settingsRows = localState.entities.settings?.rows ?? [];
    const missingSettingsBackendRows = await analyzeSettingsBackendRows(settingsRows);
    const replayAnalysis = analyzeReplayRows(replayResult);

    const missingBackendRows = [
      ...localAnalysis.missingBackendRows,
      ...missingSettingsBackendRows,
    ];

    const report = {
      ok: true,
      readOnly: true,
      APP_URL,
      API_BASE_URL,
      scope: ENTITIES.map((config) => config.entity),
      thresholds: {
        processingStuckMinutes: PROCESSING_STUCK_MINUTES,
        maxDisplayRowsPerCategory: MAX_DISPLAY_ROWS,
      },
      totals: {
        ...localAnalysis.totals,
        backendRowsByEntity: Object.fromEntries(
          Object.entries(backendState).map(([entity, state]) => [entity, state.rows?.length ?? null])
        ),
      },
      categories: {
        missingServerIds: limitedRows(localAnalysis.missingServerIds),
        orphanQueueRows: limitedRows(localAnalysis.orphanQueueRows),
        orphanedPendingRows: limitedRows(localAnalysis.orphanedPendingRows),
        duplicateServerIds: limitedRows(localAnalysis.duplicateServerIds),
        missingBackendRows: limitedRows(missingBackendRows),
        failedReplayRows: limitedRows([
          ...localAnalysis.failedQueueRows,
          ...replayAnalysis.failedReplayRows,
        ]),
        stuckReplayRows: limitedRows([
          ...localAnalysis.stuckQueueRows,
          ...replayAnalysis.stuckReplayRows,
        ]),
        countMismatchWarnings: limitedRows(localAnalysis.countMismatchWarnings),
      },
      displayLimits: {
        missingServerIds: truncationInfo(localAnalysis.missingServerIds),
        orphanQueueRows: truncationInfo(localAnalysis.orphanQueueRows),
        orphanedPendingRows: truncationInfo(localAnalysis.orphanedPendingRows),
        duplicateServerIds: truncationInfo(localAnalysis.duplicateServerIds),
        missingBackendRows: truncationInfo(missingBackendRows),
        failedReplayRows: truncationInfo([
          ...localAnalysis.failedQueueRows,
          ...replayAnalysis.failedReplayRows,
        ]),
        stuckReplayRows: truncationInfo([
          ...localAnalysis.stuckQueueRows,
          ...replayAnalysis.stuckReplayRows,
        ]),
        countMismatchWarnings: truncationInfo(localAnalysis.countMismatchWarnings),
      },
      summaryCounts: {
        missingServerIds: localAnalysis.missingServerIds.length,
        orphanQueueRows: localAnalysis.orphanQueueRows.length,
        orphanedPendingRows: localAnalysis.orphanedPendingRows.length,
        duplicateServerIds: localAnalysis.duplicateServerIds.length,
        missingBackendRows: missingBackendRows.length,
        failedReplayRows: localAnalysis.failedQueueRows.length + replayAnalysis.failedReplayRows.length,
        stuckReplayRows: localAnalysis.stuckQueueRows.length + replayAnalysis.stuckReplayRows.length,
        countMismatchWarnings: localAnalysis.countMismatchWarnings.length,
      },
      byStatus: {
        syncQueue: countBy(localState.syncQueue ?? [], (row) => row.status),
        backendReplay: countBy(replayResult.rows ?? [], (row) => row.replay_status),
      },
      backendReplayDiagnosticsAvailable: replayAnalysis.backendReplayDiagnosticsAvailable,
      backendReplayDiagnosticsError: replayAnalysis.backendReplayDiagnosticsError,
      notes: [
        "This report is diagnostic only and intentionally prints no payload/body/password fields.",
        "Count mismatches are warnings because local IndexedDB can be a partial cache while MySQL may contain rows from other sessions or test runs.",
        "Settings backend rows are checked by localId/client_id because settings.php does not expose a list endpoint.",
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