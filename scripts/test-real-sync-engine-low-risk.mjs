#!/usr/bin/env node

/*
 * Dev-only real syncEngine replay test.
 *
 * This test intentionally calls syncEngine.processPending() manually from a
 * Playwright browser context. It does not add auto-sync, listeners, intervals,
 * startup hooks, or production wiring.
 *
 * Windows PowerShell:
 *   $env:APP_URL="http://localhost:5173"
 *   $env:API_BASE_URL="http://localhost/jawad-bro/api"
 *   npm run test:sync:real-low-risk
 */

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const DB_NAME = "POSDatabase";
const DB_VERSION = 20;
const runId = `real-sync-engine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const entities = [
  {
    entity: "units",
    endpoint: "units.php",
    store: "units",
    operation: "create",
    makeRecord: () => ({ name: `Real Unit ${runId}`, shortName: "ru", itemCount: 0 }),
    mirrorFields: ["name", "shortName", "itemCount"],
  },
  {
    entity: "taxes",
    endpoint: "taxes.php",
    store: "taxes",
    operation: "create",
    makeRecord: () => ({ name: `Real Tax ${runId}`, value: 11, type: "percentage" }),
    mirrorFields: ["name", "value", "type"],
  },
  {
    entity: "customers",
    endpoint: "customers.php",
    store: "customers",
    operation: "create",
    makeRecord: () => ({
      name: `Real Customer ${runId}`,
      mobile: "03444444444",
      cnic: "11111",
      address: "Real sync customer address",
      invoices: 0,
      payable: 0,
      paid: 0,
      balance: 0,
      isDeleted: false,
      deletedAt: null,
    }),
    mirrorFields: ["name", "mobile", "cnic", "address", "isDeleted", "deletedAt"],
    preserveFields: ["invoices", "payable", "paid", "balance"],
  },
  {
    entity: "users",
    endpoint: "users.php",
    store: "users",
    operation: "create",
    makeRecord: () => ({
      Name: `Real User ${runId}`,
      Mobile: "03555555555",
      Role: "admin",
      Username: `real-user-${runId}`.slice(0, 90),
      Password: `RealPass-${runId}`,
      isDeleted: false,
      deletedAt: null,
    }),
    mirrorFields: ["Name", "Username", "Mobile", "Role"],
    preserveFields: ["Password"],
  },
  {
    entity: "settings",
    endpoint: "settings.php",
    store: "settings",
    operation: "update",
    makeRecord: () => ({
      businessName: `Real Business ${runId}`,
      email: `real-${runId}@example.com`,
      contact: "03666666666",
      address: "Real sync settings address",
      printer: "pos",
      language: "en",
      logo: "/images/logo.png",
      cylBPrice: "100",
      cylSPrice: "200",
      cylDPrice: "300",
      cylWPrice: "400",
    }),
    mirrorFields: [
      "businessName",
      "email",
      "contact",
      "address",
      "printer",
      "language",
      "logo",
      "cylBPrice",
      "cylSPrice",
      "cylDPrice",
      "cylWPrice",
    ],
  },
  {
    entity: "held",
    endpoint: "held.php",
    store: "held",
    operation: "create",
    makeRecord: () => ({
      invoiceNo: `REAL-HELD-${runId}`.slice(0, 95),
      date: "2026-05-19",
      transactionType: "Sale",
      customerId: null,
      supplierId: null,
      customerName: `Real Held Customer ${runId}`,
      supplierName: "",
      subtotal: 150,
      discount: 0,
      tax: 0,
      grandTotal: 150,
      paid: 150,
      discountMode: "flat",
      discountValue: 0,
      taxMode: "flat",
      taxValue: 0,
    }),
    mirrorFields: [
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

function sanitizeForLog(value) {
  if (Array.isArray(value)) return value.map(sanitizeForLog);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        if (["Password", "password", "password_hash"].includes(key)) {
          return [key, "[redacted]"];
        }

        return [key, sanitizeForLog(entry)];
      })
    );
  }

  return value;
}

function formatDetails(details) {
  if (typeof details === "string") return details;
  return JSON.stringify(sanitizeForLog(details), null, 2);
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

function pickSerializableConfig(config) {
  return {
    entity: config.entity,
    endpoint: config.endpoint,
    store: config.store,
    operation: config.operation,
    mirrorFields: config.mirrorFields,
    preserveFields: config.preserveFields ?? [],
  };
}

async function installApiBaseFetchProxy(page) {
  await page.addInitScript((apiBaseUrl) => {
    const apiBase = String(apiBaseUrl).replace(/\/+$/, "");
    const originalFetch = window.fetch.bind(window);

    window.fetch = (input, init) => {
      const inputUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      const originApiPrefix = `${window.location.origin}/api/`;
      let rewritten = input;

      if (typeof inputUrl === "string" && inputUrl.startsWith("/api/")) {
        rewritten = `${apiBase}${inputUrl.slice(4)}`;
      } else if (typeof inputUrl === "string" && inputUrl.startsWith(originApiPrefix)) {
        rewritten = `${apiBase}/${inputUrl.slice(originApiPrefix.length)}`;
      }

      return originalFetch(rewritten, init);
    };
  }, API_BASE_URL);
}

async function injectLocalRowAndQueue(page, config, entityIndex) {
  const localId = Date.now() + entityIndex + Math.floor(Math.random() * 100000);
  const record = {
    ...config.makeRecord(),
    id: localId,
    localId,
  };

  return await page.evaluate(
    async ({ dbName, dbVersion, config, record, entityIndex, runId }) => {
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

      function add(store, value) {
        return new Promise((resolve, reject) => {
          const request = store.add(value);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
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
      const stores = Array.from(db.objectStoreNames);

      if (!stores.includes(config.store) || !stores.includes("sync_queue")) {
        throw new Error(`Required stores missing for ${config.entity}. Found stores: ${stores.join(", ")}`);
      }

      const tx = db.transaction([config.store, "sync_queue"], "readwrite");
      const entityStore = tx.objectStore(config.store);
      const queueStore = tx.objectStore("sync_queue");
      const localId = record.localId;
      await add(entityStore, record);
      const localRecord = await get(entityStore, localId, "localId");
      const payload = { ...localRecord, id: localId, localId };
      const queueId = await add(queueStore, {
        entity: config.entity,
        operation: config.operation,
        localId,
        serverId: null,
        payload,
        createdAt: -Date.now() + entityIndex,
        updatedAt: Date.now(),
        retryCount: 0,
        lastError: null,
        status: "pending",
        testRunId: runId,
      });

      await waitTransaction(tx);
      db.close();

      return {
        localId,
        queueId,
        marker: record.name ?? record.Name ?? record.businessName ?? record.invoiceNo ?? record.category ?? record.Username,
        payload,
      };
    },
    {
      dbName: DB_NAME,
      dbVersion: DB_VERSION,
      config: pickSerializableConfig(config),
      record,
      entityIndex,
      runId,
    },
  );
}

async function callRealSyncEngine(page, limit) {
  return await page.evaluate(async (syncLimit) => {
    const mainScript = Array.from(document.scripts)
      .map((script) => script.src)
      .find((src) => src.includes("/src/main."));
    const appBase = mainScript
      ? mainScript.split("/src/")[0]
      : window.location.origin;
    const mod = await import(
      `${appBase}/src/services/syncEngine.ts`
    );
    return await mod.syncEngine.processPending(syncLimit);
  }, limit);
}

async function readLocalState(page, config, localId, queueId) {
  if (localId == null || localId === "" || queueId == null || queueId === "") {
    throw new Error(`${config.entity}: missing localId/queueId before IndexedDB read.`);
  }

  return await page.evaluate(
    async ({ dbName, dbVersion, config, localId, queueId }) => {
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
      const tx = db.transaction([config.store, "sync_queue"], "readonly");
      const localRow = await get(tx.objectStore(config.store), localId, "localId");
      const queueItem = await get(tx.objectStore("sync_queue"), queueId, "queueId");
      db.close();

      return { localRow, queueItem };
    },
    {
      dbName: DB_NAME,
      dbVersion: DB_VERSION,
      config: pickSerializableConfig(config),
      localId,
      queueId,
    },
  );
}

async function findBackendRow(config, marker, serverId, localId) {
  const url = config.entity === "settings"
    ? `${API_BASE_URL}/${config.endpoint}?id=${encodeURIComponent(String(localId))}`
    : `${API_BASE_URL}/${config.endpoint}`;
  const response = await fetchJson(url);

  if (!response.ok || response.body?.success !== true) {
    return { response, row: null };
  }

  if (config.entity === "settings") {
    return { response, row: response.body.data ?? null };
  }

  if (!Array.isArray(response.body.data)) {
    return { response, row: null };
  }

  const row = response.body.data.find((candidate) => {
    return (
      String(candidate.id) === String(serverId) ||
      candidate.name === marker ||
      candidate.Name === marker ||
      candidate.Username === marker ||
      candidate.username === marker ||
      candidate.businessName === marker ||
      candidate.invoiceNo === marker ||
      candidate.category === marker
    );
  }) ?? null;

  return { response, row };
}

async function main() {
  console.log("Dev-only real syncEngine replay test. This is not auto-sync.");
  console.log(`APP_URL: ${APP_URL}`);
  console.log(`API_BASE_URL: ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);

  const playwright = await loadPlaywright();
  if (!playwright) return;

  await verifyBackendHealth();

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  await installApiBaseFetchProxy(page);

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

    const injected = [];
    for (const [entityIndex, config] of entities.entries()) {
      const row = await injectLocalRowAndQueue(page, config, entityIndex);
      injected.push({ config, row });
      logPass(`${config.entity}: inject local row and pending sync_queue row`, row);
    }

    const syncResult = await callRealSyncEngine(page, entities.length);
    const diagnosticsOk =
      syncResult &&
      syncResult.processed === entities.length &&
      syncResult.succeeded === entities.length &&
      syncResult.failed === 0 &&
      Array.isArray(syncResult.errors) &&
      syncResult.errors.length === 0;

    if (diagnosticsOk) {
      logPass("actual syncEngine.processPending diagnostics", syncResult);
    } else {
      logFail("actual syncEngine.processPending diagnostics", syncResult);
    }

    for (const { config, row } of injected) {
      const state = await readLocalState(page, config, row.localId, row.queueId);
      const serverId = state.localRow?.serverId ?? null;
      const queueStatus = state.queueItem?.status ?? null;
      const backend = await findBackendRow(config, row.marker, serverId, row.localId);
      const expectedPayload = row.payload ?? {};
      const mirrorMismatches = (config.mirrorFields ?? []).filter((field) => {
        if (!Object.prototype.hasOwnProperty.call(expectedPayload, field)) return false;
        return String(state.localRow?.[field]) !== String(expectedPayload[field]);
      });
      const preservedMismatches = (config.preserveFields ?? []).filter((field) => {
        return String(state.localRow?.[field]) !== String(expectedPayload[field]);
      });

      const report = {
        localId: row.localId,
        queueId: row.queueId,
        serverId,
        queueStatus,
        localRow: state.localRow,
        queueItem: state.queueItem,
        backendStatus: backend.response.status,
        backendBody: backend.response.body,
        mirrorMismatches,
        preservedMismatches,
      };

      if (queueStatus === "done") {
        logPass(`${config.entity}: queue row marked done`, { queueStatus });
      } else {
        logFail(`${config.entity}: queue row marked done`, report);
      }

      if (serverId != null) {
        logPass(`${config.entity}: local row has serverId`, { localId: row.localId, serverId });
      } else {
        logFail(`${config.entity}: local row has serverId`, report);
      }

      if (mirrorMismatches.length === 0) {
        logPass(`${config.entity}: local safe mirror fields match payload`, {
          checkedFields: config.mirrorFields ?? [],
        });
      } else {
        logFail(`${config.entity}: local safe mirror fields match payload`, report);
      }

      if ((config.preserveFields ?? []).length === 0 || preservedMismatches.length === 0) {
        logPass(`${config.entity}: preserved local-only fields unchanged`, {
          checkedFields: config.preserveFields ?? [],
        });
      } else {
        logFail(`${config.entity}: preserved local-only fields unchanged`, report);
      }

      if (backend.row) {
        logPass(`${config.entity}: backend endpoint contains synced row`, {
          backendId: backend.row.id ?? backend.row.serverId ?? null,
          marker: row.marker,
        });
      } else {
        logFail(`${config.entity}: backend endpoint contains synced row`, report);
      }
    }
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