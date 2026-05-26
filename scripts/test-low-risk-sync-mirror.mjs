#!/usr/bin/env node

/*
 * Low-risk sync mirror test helper.
 *
 * Windows PowerShell:
 *   $env:APP_URL="http://localhost:5173"
 *   $env:API_BASE_URL="http://localhost/jawad-bro/api"
 *   npm run test:sync:low-risk
 *
 * Requirements:
 *   npm i -D playwright
 *   npx playwright install chromium
 *
 * Simulated replay path used; this validates backend contract + local mirror
 * mechanics, not actual syncEngine.processPending.
 */

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const DB_NAME = "POSDatabase";
const DB_VERSION = 20;
const runId = `low-risk-sync-mirror-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const entities = [
  {
    label: "units",
    entity: "units",
    endpoint: "units.php",
    store: "units",
    makeRecord: () => ({ name: `Mirror Unit ${runId}`, shortName: "mu", itemCount: 0 }),
    mirrorFields: ["name", "shortName", "itemCount"],
  },
  {
    label: "taxes",
    entity: "taxes",
    endpoint: "taxes.php",
    store: "taxes",
    makeRecord: () => ({ name: `Mirror Tax ${runId}`, value: 7, type: "percentage" }),
    mirrorFields: ["name", "value", "type"],
  },
  {
    label: "discounts",
    entity: "discounts",
    endpoint: "discounts.php",
    store: "discounts",
    makeRecord: () => ({ name: `Mirror Discount ${runId}`, value: 5, type: "amount" }),
    mirrorFields: ["name", "value", "type"],
  },
  {
    label: "brands",
    entity: "brands",
    endpoint: "brands.php",
    store: "brands",
    makeRecord: () => ({ name: `Mirror Brand ${runId}`, itemCount: 0 }),
    mirrorFields: ["name", "itemCount"],
  },
  {
    label: "categories",
    entity: "categories",
    endpoint: "categories.php",
    store: "categories",
    makeRecord: () => ({ name: `Mirror Category ${runId}`, itemCount: 0 }),
    mirrorFields: ["name", "itemCount"],
  },
  {
    label: "expenses",
    entity: "expenses",
    endpoint: "expenses.php",
    store: "expenses",
    makeRecord: () => ({
      date: "2026-05-18",
      category: `Mirror Expense ${runId}`,
      amount: 123,
      description: "Mirror expense test",
      isDeleted: false,
      deletedAt: null,
    }),
    mirrorFields: ["date", "category", "amount", "description"],
  },
  {
    label: "customers",
    entity: "customers",
    endpoint: "customers.php",
    store: "customers",
    makeRecord: () => ({
      name: `Mirror Customer ${runId}`,
      mobile: "03000000000",
      cnic: "12345",
      address: "Mirror customer address",
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
    label: "suppliers",
    entity: "suppliers",
    endpoint: "suppliers.php",
    store: "suppliers",
    makeRecord: () => ({
      name: `Mirror Supplier ${runId}`,
      mobile: "03111111111",
      cnic: "54321",
      address: "Mirror supplier address",
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
    label: "users",
    entity: "users",
    endpoint: "users.php",
    store: "users",
    makeRecord: () => ({
      Name: `Mirror User ${runId}`,
      Mobile: "03222222222",
      Role: "admin",
      Username: `mirror-user-${runId}`.slice(0, 90),
      Password: `MirrorPass-${runId}`,
      isDeleted: false,
      deletedAt: null,
    }),
    mirrorFields: ["Name", "Username", "Mobile", "Role"],
    preserveFields: ["Password"],
  },
  {
    label: "settings",
    entity: "settings",
    endpoint: "settings.php",
    store: "settings",
    makeRecord: () => ({
      businessName: `Mirror Business ${runId}`,
      email: `mirror-${runId}@example.com`,
      contact: "03333333333",
      address: "Mirror settings address",
      printer: "pos",
      language: "en",
      logo: "/images/logo.png",
      cylBPrice: "10",
      cylSPrice: "20",
      cylDPrice: "30",
      cylWPrice: "40",
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
    label: "held",
    entity: "held",
    endpoint: "held.php",
    store: "held",
    makeRecord: () => ({
      invoiceNo: `MIR-HELD-${runId}`.slice(0, 95),
      date: "2026-05-19",
      transactionType: "Sale",
      customerId: null,
      supplierId: null,
      customerName: `Mirror Held Customer ${runId}`,
      supplierName: "",
      subtotal: 100,
      discount: 0,
      tax: 0,
      grandTotal: 100,
      paid: 100,
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

function formatDetails(details) {
  if (typeof details === "string") return details;
  return JSON.stringify(details, null, 2);
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

async function injectLocalRowAndQueue(page, config, entityIndex) {
  const localId = Date.now() + entityIndex + Math.floor(Math.random() * 100000);
  const record = {
    ...config.makeRecord(),
    id: localId,
    localId,
  };

  return await page.evaluate(
    async ({ dbName, dbVersion, config, record }) => {
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

      const now = Date.now();
      const tx = db.transaction([config.store, "sync_queue"], "readwrite");
      const entityStore = tx.objectStore(config.store);
      const queueStore = tx.objectStore("sync_queue");
      const localId = record.localId;
      await add(entityStore, record);
      const localRecord = await get(entityStore, localId, "localId");
      const payload = { ...localRecord, id: localId, localId };
      const queueId = await add(queueStore, {
        entity: config.entity,
        operation: "create",
        localId,
        serverId: null,
        payload,
        createdAt: now,
        updatedAt: now,
        retryCount: 0,
        lastError: null,
        status: "pending",
      });

      await waitTransaction(tx);
      db.close();

      return {
        localId,
        queueId,
        marker: record.name ?? record.Name ?? record.businessName ?? record.invoiceNo ?? record.category ?? record.Username,
        name: record.name,
        category: record.category,
        payload,
      };
    },
    {
      dbName: DB_NAME,
      dbVersion: DB_VERSION,
      config: pickSerializableConfig(config),
      record,
    },
  );
}

function pickSerializableConfig(config) {
  return {
    entity: config.entity,
    endpoint: config.endpoint,
    store: config.store,
    mirrorFields: config.mirrorFields,
    preserveFields: config.preserveFields ?? [],
  };
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

      return queueItem;
    },
    { dbName: DB_NAME, dbVersion: DB_VERSION, queueId },
  );
}

async function simulateReplayAndMirror(page, config, injected) {
  console.log("Simulated replay path used; this validates backend contract + local mirror mechanics, not actual syncEngine.processPending.");
  console.log({ entity: config.entity, localId: injected.localId, queueId: injected.queueId, name: injected.name });

  const queueItem = await readQueueItem(page, injected.queueId);

  if (!queueItem) {
    throw new Error(`${config.entity}: queued item ${injected.queueId} was not found.`);
  }

  if (queueItem.entity !== config.entity || queueItem.operation !== "create") {
    throw new Error(`${config.entity}: expected ${config.entity}/create queue item, got ${queueItem.entity}/${queueItem.operation}.`);
  }

  const response = await fetchJson(`${API_BASE_URL}/${config.endpoint}`, {
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
    throw new Error(`${config.entity}: backend response did not include serverId/id.`);
  }

  await applyMirrorAndMarkDone(page, config, {
    localId: queueItem.localId ?? injected.localId,
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

async function applyMirrorAndMarkDone(page, config, mirror) {
  if (mirror.localId == null || mirror.localId === "" || mirror.queueId == null || mirror.queueId === "") {
    throw new Error(`${config.entity}: missing localId/queueId before IndexedDB read.`);
  }

  return await page.evaluate(
    async ({ dbName, dbVersion, config, mirror }) => {
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
      const tx = db.transaction([config.store, "sync_queue"], "readwrite");
      const entityStore = tx.objectStore(config.store);
      const queueStore = tx.objectStore("sync_queue");
      const localRow = await get(entityStore, mirror.localId, "localId");
      const queueItem = await get(queueStore, mirror.queueId, "queueId");

      if (!localRow) {
        throw new Error(`${config.entity}: local row ${mirror.localId} was not found.`);
      }

      if (!queueItem) {
        throw new Error(`${config.entity}: queue item ${mirror.queueId} was not found.`);
      }

      const mirroredRow = {
        ...localRow,
        serverId: mirror.serverId,
      };

      for (const field of config.mirrorFields) {
        if (Object.prototype.hasOwnProperty.call(mirror.remote ?? {}, field)) {
          mirroredRow[field] = mirror.remote[field];
        }
      }

      await put(entityStore, mirroredRow);
      await put(queueStore, {
        ...queueItem,
        status: "done",
        lastError: null,
        updatedAt: Date.now(),
      });
      await waitTransaction(tx);
      db.close();
    },
    {
      dbName: DB_NAME,
      dbVersion: DB_VERSION,
      config: pickSerializableConfig(config),
      mirror,
    },
  );
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
    const row = response.body.data ?? null;
    return { response, row };
  }

  if (!Array.isArray(response.body.data)) {
    return { response, row: null };
  }

  const row = response.body.data.find((candidate) => {
    return (
      String(candidate.id) === String(serverId) ||
      candidate.name === marker ||
      candidate.category === marker
    );
  }) ?? null;

  return { response, row };
}

async function testEntity(page, config, entityIndex) {
  try {
    const injected = await injectLocalRowAndQueue(page, config, entityIndex);
    logPass(`${config.entity}: inject local row and pending sync_queue row`, injected);

    const replayResult = await simulateReplayAndMirror(page, config, injected);
    const state = await readLocalState(page, config, injected.localId, injected.queueId);
    const serverId = state.localRow?.serverId ?? null;
    const queueStatus = state.queueItem?.status ?? null;
    const backend = await findBackendRow(config, injected.marker, serverId, injected.localId);
    const backendId = backend.row?.id ?? backend.row?.serverId ?? null;

    const expectedPayload = injected.payload ?? {};
    const mirrorMismatches = (config.mirrorFields ?? []).filter((field) => {
      if (!Object.prototype.hasOwnProperty.call(expectedPayload, field)) return false;
      return String(state.localRow?.[field]) !== String(expectedPayload[field]);
    });
    const preservedMismatches = (config.preserveFields ?? []).filter((field) => {
      return String(state.localRow?.[field]) !== String(expectedPayload[field]);
    });

    const report = {
      replayResult,
      localId: injected.localId,
      serverId,
      backendId,
      queueStatus,
      localRow: state.localRow,
      queueItem: state.queueItem,
      mirrorMismatches,
      preservedMismatches,
    };

    if (replayResult?.processed === 1 && replayResult?.succeeded === 1) {
      logPass(`${config.entity}: simulated replay`, replayResult);
    } else {
      logFail(`${config.entity}: simulated replay`, report);
    }

    if (queueStatus === "done") {
      logPass(`${config.entity}: queue row marked done`, { queueStatus });
    } else {
      logFail(`${config.entity}: queue row marked done`, report);
    }

    if (serverId != null) {
      logPass(`${config.entity}: local row has serverId`, { localId: injected.localId, serverId });
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
        backendId,
        name: backend.row.name,
      });
    } else {
      logFail(`${config.entity}: backend endpoint contains synced row`, {
        backendResponseStatus: backend.response.status,
        backendResponseBody: backend.response.body,
        expectedMarker: injected.marker,
        expectedServerId: serverId,
      });
    }
  } catch (error) {
    logFail(`${config.entity}: test crashed`, {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
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

    for (const [entityIndex, config] of entities.entries()) {
      await testEntity(page, config, entityIndex);
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