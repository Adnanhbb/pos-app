#!/usr/bin/env node

/*
 * Units sync mirror test helper.
 *
 * Windows PowerShell:
 *   $env:APP_URL="http://localhost:5173"
 *   $env:API_BASE_URL="http://localhost/jawad-bro/api"
 *   npm run test:sync:units
 *
 * Requirements:
 *   npm i -D playwright
 *   npx playwright install chromium
 *
 * This is dev/test tooling only. It does not change app runtime behavior and it
 * does not auto-start sync in production.
 *
 * TODO: Later add a dev-only exported window hook or proper bundled test entry
 * if we want this helper to test actual syncEngine.processPending.
 */

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const DB_NAME = "POSDatabase";
const DB_VERSION = 20;
const runId = `units-sync-mirror-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let passed = 0;
let failed = 0;

function logPass(name, details) {
  passed += 1;
  console.log(`PASS ${name}`);
  if (details !== undefined) console.log(formatDetails(details));
}

function logFail(name, details) {
  failed += 1;
  console.error(`FAIL ${name}`);
  if (details !== undefined) console.error(formatDetails(details));
}

function formatDetails(details) {
  if (typeof details === "string") return details;
  return JSON.stringify(details, null, 2);
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    console.error("Playwright is not installed. Install it with:");
    console.error("  npm i -D playwright");
    console.error("  npx playwright install chromium");
    process.exitCode = 1;
    return null;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;

  if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return { status: response.status, ok: response.ok, body };
}

async function verifyBackendHealth() {
  const response = await fetchJson(`${API_BASE_URL}/health.php`);
  const ok = response.ok && response.body?.success === true;

  if (ok) {
    logPass("backend health", { status: response.status, url: `${API_BASE_URL}/health.php` });
    return true;
  }

  logFail("backend health", {
    status: response.status,
    url: `${API_BASE_URL}/health.php`,
    body: response.body,
  });
  return false;
}

async function injectUnitAndQueue(page) {
  return await page.evaluate(
    async ({ dbName, dbVersion, runId }) => {
      function openDb() {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName, dbVersion);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
      }

      function waitTransaction(tx) {
        return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve(undefined);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      }

      function add(store, value) {
        return new Promise((resolve, reject) => {
          const request = store.add(value);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      function get(store, key) {
        return new Promise((resolve, reject) => {
          const request = store.get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      const db = await openDb();
      const stores = Array.from(db.objectStoreNames);

      if (!stores.includes("units") || !stores.includes("sync_queue")) {
        throw new Error(`Required stores missing. Found stores: ${stores.join(", ")}`);
      }

      const unitName = `Mirror Test Unit ${runId}`;
      const now = Date.now();
      const tx = db.transaction(["units", "sync_queue"], "readwrite");
      const units = tx.objectStore("units");
      const queue = tx.objectStore("sync_queue");
      const unitId = await add(units, {
        name: unitName,
        itemCount: 0,
      });
      const unit = await get(units, unitId);
      const queueId = await add(queue, {
        entity: "units",
        operation: "create",
        localId: unitId,
        serverId: null,
        payload: unit,
        createdAt: now,
        updatedAt: now,
        retryCount: 0,
        lastError: null,
        status: "pending",
      });

      await waitTransaction(tx);
      db.close();

      return {
        unitId,
        queueId,
        unitName,
      };
    },
    { dbName: DB_NAME, dbVersion: DB_VERSION, runId },
  );
}

async function simulateUnitsReplay(page, injected) {
  console.log(
    "Simulated units replay path used because syncEngine TS browser import is not available in this test environment."
  );

  console.log({ unitId: injected.unitId, queueId: injected.queueId, unitName: injected.unitName });

  const queued = await readQueueItem(page, injected.queueId);
  const queueItem = queued.queueItem;

  if (!queueItem) {
    throw new Error(`Queued item ${injected.queueId} was not found.`);
  }

  if (queueItem.entity !== "units" || queueItem.operation !== "create") {
    throw new Error(
      `Expected units/create queue item, got ${queueItem.entity}/${queueItem.operation}.`
    );
  }

  const response = await fetchJson(`${API_BASE_URL}/units.php`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(queueItem.payload),
  });

  if (!response.ok || response.body?.success !== true) {
    return {
      processed: 1,
      succeeded: 0,
      failed: 1,
      response,
    };
  }

  const remote = response.body.data ?? response.body;
  const serverId = remote?.serverId ?? remote?.id ?? null;

  if (serverId == null) {
    throw new Error("Backend units.php response did not include serverId/id.");
  }

  await applyUnitMirrorAndMarkDone(page, {
    unitId: queueItem.localId ?? injected.unitId,
    queueId: injected.queueId,
    remote,
    serverId,
  });

  return {
    processed: 1,
    succeeded: 1,
    failed: 0,
    responseStatus: response.status,
    serverId,
  };
}

async function applyUnitMirrorAndMarkDone(page, mirror) {
  if (mirror.unitId == null || mirror.unitId === "" || mirror.queueId == null || mirror.queueId === "") {
    throw new Error("Missing unitId/queueId before IndexedDB read.");
  }

  return await page.evaluate(
    async ({ dbName, dbVersion, mirror }) => {
      function assertKey(key, label) {
        if (key === undefined || key === null || key === "") {
          throw new Error(`Missing ${label} before IndexedDB read.`);
        }
      }

      function openDb() {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName, dbVersion);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
      }

      function waitTransaction(tx) {
        return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve(undefined);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      }

      function get(store, key, label) {
        assertKey(key, label);
        return new Promise((resolve, reject) => {
          const request = store.get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      function put(store, value) {
        return new Promise((resolve, reject) => {
          const request = store.put(value);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      const db = await openDb();
      const tx = db.transaction(["units", "sync_queue"], "readwrite");
      const units = tx.objectStore("units");
      const queue = tx.objectStore("sync_queue");

      if (mirror.unitId === undefined || mirror.unitId === null || mirror.unitId === "" || mirror.queueId === undefined || mirror.queueId === null || mirror.queueId === "") {
        throw new Error("Missing unitId/queueId before IndexedDB read.");
      }

      const unit = await get(units, mirror.unitId, "unitId");
      const queueItem = await get(queue, mirror.queueId, "queueId");

      if (!unit) {
        throw new Error(`Local unit ${mirror.unitId} was not found.`);
      }

      if (!queueItem) {
        throw new Error(`Queue item ${mirror.queueId} was not found.`);
      }

      const mirroredUnit = {
        ...unit,
        serverId: mirror.serverId,
      };

      if (typeof mirror.remote?.name === "string") {
        mirroredUnit.name = mirror.remote.name;
      }

      if (Object.prototype.hasOwnProperty.call(mirror.remote ?? {}, "shortName")) {
        mirroredUnit.shortName = mirror.remote.shortName;
      }

      if (typeof mirror.remote?.itemCount === "number") {
        mirroredUnit.itemCount = mirror.remote.itemCount;
      }

      await put(units, mirroredUnit);
      await put(queue, {
        ...queueItem,
        status: "done",
        lastError: null,
        updatedAt: Date.now(),
      });
      await waitTransaction(tx);
      db.close();
    },
    { dbName: DB_NAME, dbVersion: DB_VERSION, mirror },
  );
}
async function readQueueItem(page, queueId) {
  if (queueId == null || queueId === "") {
    throw new Error("Missing queueId before IndexedDB read.");
  }

  return await page.evaluate(
    async ({ dbName, dbVersion, queueId }) => {
      function assertKey(key, label) {
        if (key === undefined || key === null || key === "") {
          throw new Error(`Missing ${label} before IndexedDB read.`);
        }
      }

      function openDb() {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName, dbVersion);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
      }

      function get(store, key, label) {
        assertKey(key, label);
        return new Promise((resolve, reject) => {
          const request = store.get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      const db = await openDb();
      const tx = db.transaction(["sync_queue"], "readonly");
      const queueItem = await get(tx.objectStore("sync_queue"), queueId, "queueId");
      db.close();

      return { queueItem };
    },
    { dbName: DB_NAME, dbVersion: DB_VERSION, queueId },
  );
}
async function readLocalState(page, unitId, queueId) {
  if (unitId == null || unitId === "" || queueId == null || queueId === "") {
    throw new Error("Missing unitId/queueId before IndexedDB read.");
  }

  return await page.evaluate(
    async ({ dbName, dbVersion, unitId, queueId }) => {
      function assertKey(key, label) {
        if (key === undefined || key === null || key === "") {
          throw new Error(`Missing ${label} before IndexedDB read.`);
        }
      }

      function openDb() {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName, dbVersion);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
      }

      function get(store, key, label) {
        assertKey(key, label);
        return new Promise((resolve, reject) => {
          const request = store.get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }

      if (unitId === undefined || unitId === null || unitId === "" || queueId === undefined || queueId === null || queueId === "") {
        throw new Error("Missing unitId/queueId before IndexedDB read.");
      }

      const db = await openDb();
      const tx = db.transaction(["units", "sync_queue"], "readonly");
      const unit = await get(tx.objectStore("units"), unitId, "unitId");
      const queueItem = await get(tx.objectStore("sync_queue"), queueId, "queueId");
      db.close();

      return { unit, queueItem };
    },
    { dbName: DB_NAME, dbVersion: DB_VERSION, unitId, queueId },
  );
}
async function findBackendUnit(unitName, serverId) {
  const response = await fetchJson(`${API_BASE_URL}/units.php`);

  if (!response.ok || response.body?.success !== true || !Array.isArray(response.body.data)) {
    return { response, unit: null };
  }

  const unit = response.body.data.find((candidate) => {
    return String(candidate.id) === String(serverId) || candidate.name === unitName;
  }) ?? null;

  return { response, unit };
}

async function main() {
  console.log(`APP_URL: ${APP_URL}`);
  console.log(`API_BASE_URL: ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);

  const playwright = await loadPlaywright();
  if (!playwright) return;

  await verifyBackendHealth();

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const pageResponse = await page.goto(APP_URL, { waitUntil: "networkidle" });
    if (!pageResponse || !pageResponse.ok()) {
      logFail("open app", {
        status: pageResponse?.status() ?? null,
        url: APP_URL,
      });
      return;
    }
    logPass("open app", { status: pageResponse.status(), url: APP_URL });

    console.log("Using Node API_BASE_URL for backend verification:", API_BASE_URL);
    console.log("Runtime API override is not required. Using direct IndexedDB injection for this dev test.");
    const injected = await injectUnitAndQueue(page);
    logPass("inject local unit and pending sync_queue row", injected);

    const syncResult = await simulateUnitsReplay(page, injected);
    const state = await readLocalState(page, injected.unitId, injected.queueId);
    const serverId = state.unit?.serverId ?? null;
    const queueStatus = state.queueItem?.status ?? null;
    const backend = await findBackendUnit(injected.unitName, serverId);
    const backendUnitId = backend.unit?.id ?? backend.unit?.serverId ?? null;

    const report = {
      simulatedReplayResult: syncResult,
      localUnitId: injected.unitId,
      serverId,
      backendUnitId,
      queueStatus,
      localUnit: state.unit,
      queueItem: state.queueItem,
    };

    if (syncResult?.processed >= 1 && syncResult?.succeeded >= 1) {
      logPass("simulated units replay", syncResult);
    } else {
      logFail("simulated units replay", report);
    }

    if (queueStatus === "done") {
      logPass("queue row marked done", { queueStatus });
    } else {
      logFail("queue row marked done", report);
    }

    if (serverId != null) {
      logPass("local unit has serverId", { localUnitId: injected.unitId, serverId });
    } else {
      logFail("local unit has serverId", report);
    }

    if (backend.unit) {
      logPass("backend units.php contains synced unit", {
        backendUnitId,
        name: backend.unit.name,
      });
    } else {
      logFail("backend units.php contains synced unit", {
        backendResponseStatus: backend.response.status,
        backendResponseBody: backend.response.body,
        expectedName: injected.unitName,
        expectedServerId: serverId,
      });
    }
  } catch (error) {
    logFail("units sync mirror test crashed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  } finally {
    await browser.close();
  }

  console.log("");
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  logFail("test runner crashed", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  console.log("");
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  process.exitCode = 1;
});