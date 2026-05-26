#!/usr/bin/env node

/* Dev-only CRUD auth enforcement flag tests. */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const apiRoot = resolve(projectRoot, "api");
const APP_URL = process.env.APP_URL || "http://localhost:5173";
const DB_NAME = "POSDatabase";
const DB_VERSION = 20;
const runId = `crud-auth-enforcement-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let passed = 0;
let failed = 0;

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

function pass(name) {
  passed += 1;
  console.log(`PASS ${name}`);
}

function fail(name, details, message) {
  failed += 1;
  console.error(`FAIL ${name}${message ? `: ${message}` : ""}`);
  if (details !== undefined) console.error(JSON.stringify(details, null, 2));
}

function check(name, details, predicate, message) {
  if (predicate(details)) {
    pass(name);
    return true;
  }
  fail(name, details, message);
  return false;
}

function phpSetupCode() {
  return String.raw`
require_once getcwd() . '/api/config/database.php';
require_once getcwd() . '/api/lib/auth.php';
$pdo = get_pdo();
$runId = getenv('CRUD_AUTH_ENFORCEMENT_TEST_RUN_ID') ?: ('crud-auth-enforcement-' . time());
$token = $runId . '-valid-token';
$actorId = $runId . '-device';
$pdo->exec("CREATE TABLE IF NOT EXISTS api_auth_tokens (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, token_hash CHAR(64) NOT NULL UNIQUE, actor_type VARCHAR(50) NOT NULL, actor_id VARCHAR(150) NOT NULL, role VARCHAR(80) NOT NULL, label VARCHAR(180) NULL, is_active TINYINT(1) NOT NULL DEFAULT 1, expires_at DATETIME NULL, last_used_at DATETIME NULL, revoked_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_api_auth_tokens_actor (actor_type, actor_id), INDEX idx_api_auth_tokens_role (role), INDEX idx_api_auth_tokens_active (is_active)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
$statement = $pdo->prepare("INSERT INTO api_auth_tokens (token_hash, actor_type, actor_id, role, label, is_active) VALUES (:hash, 'device', :actor_id, 'admin', 'CRUD enforcement flag test token', 1)");
$statement->execute(['hash' => hash_auth_token($token), 'actor_id' => $actorId]);
echo json_encode(['ok' => true, 'token' => $token, 'actorId' => $actorId], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
`;
}

function createValidToken() {
  const result = spawnSync(findPhpBinary(), ["-r", phpSetupCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, CRUD_AUTH_ENFORCEMENT_TEST_RUN_ID: runId },
    windowsHide: true,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) return { ok: false, status: result.status, stdout: result.stdout, stderr: result.stderr };

  try {
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    return { ok: false, parseError: String(error), stdout: result.stdout, stderr: result.stderr };
  }
}

async function request(baseUrl, file, { method = "GET", headers = {}, body } = {}) {
  const response = await fetch(`${baseUrl}/${file}.php`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text.trim() ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return {
    status: response.status,
    ok: response.ok,
    body: data,
    headers: {
      authAuditMode: response.headers.get("x-auth-audit-mode"),
      authEnforcement: response.headers.get("x-auth-enforcement"),
      authStatus: response.headers.get("x-auth-status"),
      actorType: response.headers.get("x-auth-actor-type"),
      actorId: response.headers.get("x-auth-actor-id"),
      actorRole: response.headers.get("x-auth-actor-role"),
    },
  };
}

async function waitForServer(baseUrl) {
  const deadline = Date.now() + 10000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await request(baseUrl, "health");
      if (response.status === 200 && response.body?.success === true) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`PHP test server did not become ready: ${String(lastError?.message || lastError || "timeout")}`);
}

async function withPhpServer(enforcementValue, callback) {
  const port = 19000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(findPhpBinary(), ["-S", `127.0.0.1:${port}`, "-t", apiRoot], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CRUD_AUTH_ENFORCEMENT: enforcementValue,
    },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });

  let stderr = "";
  server.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForServer(baseUrl);
    return await callback(baseUrl);
  } finally {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
    if (stderr.includes("Fatal error")) {
      console.error(stderr);
    }
  }
}

function brandPayload(suffix) {
  return {
    localId: `${runId}-${suffix}`,
    name: `CRUD Auth Enforcement ${suffix} ${runId}`,
    itemCount: 0,
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

async function installApiBaseFetchProxy(page, apiBaseUrl) {
  await page.addInitScript((apiBase) => {
    const cleanApiBase = String(apiBase).replace(/\/+$/, "");
    const originalFetch = window.fetch.bind(window);

    window.fetch = (input, init) => {
      const inputUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      let rewritten = input;

      if (typeof inputUrl === "string") {
        const url = new URL(inputUrl, window.location.origin);
        if (url.pathname.startsWith("/api/")) {
          rewritten = `${cleanApiBase}${url.pathname.slice(4)}${url.search}`;
        } else if (url.pathname.startsWith("/jawad-bro/api/")) {
          rewritten = `${cleanApiBase}/${url.pathname.slice("/jawad-bro/api/".length)}${url.search}`;
        }
      }

      return originalFetch(rewritten, init);
    };
  }, apiBaseUrl);
}

async function validateOfflineQueueAndAuthFailure(baseUrl) {
  const playwright = await loadPlaywright();
  if (!playwright) return;

  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await installApiBaseFetchProxy(page, baseUrl);
    const response = await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    check("enforcement validation: app opens for local IndexedDB checks", { status: response?.status(), url: APP_URL }, (value) => value.status === 200, "app did not open");

    const injected = await page.evaluate(
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

        localStorage.removeItem("jawadBro.authToken");
        const db = await openDb();
        const stores = Array.from(db.objectStoreNames);
        if (!stores.includes("brands") || !stores.includes("sync_queue")) {
          throw new Error(`Required stores missing. Found stores: ${stores.join(", ")}`);
        }

        const localId = Date.now() + Math.floor(Math.random() * 100000);
        const record = {
          id: localId,
          localId,
          name: `Offline Enforcement Brand ${runId}`,
          itemCount: 0,
        };
        const tx = db.transaction(["brands", "sync_queue"], "readwrite");
        await add(tx.objectStore("brands"), record);
        const localRecord = await get(tx.objectStore("brands"), localId);
        const queueId = await add(tx.objectStore("sync_queue"), {
          entity: "brands",
          operation: "create",
          localId,
          serverId: null,
          payload: { ...record, id: localId, localId },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          retryCount: 0,
          lastError: null,
          status: "pending",
          testRunId: runId,
        });
        await waitTransaction(tx);
        db.close();

        return { localId, queueId, payload: { ...record, id: localId, localId }, localRecordExists: Boolean(localRecord), tokenPresent: Boolean(localStorage.getItem("jawadBro.authToken")) };
      },
      { dbName: DB_NAME, dbVersion: DB_VERSION, runId }
    );

    check("enforcement validation: offline local IndexedDB write still succeeds", injected, (value) => value.localRecordExists === true && value.tokenPresent === false, "local row was not written without token");
    check("enforcement validation: queued sync row can be created offline", injected, (value) => Number.isInteger(value.queueId) && Number.isInteger(value.localId), "queue row was not created");

    const replayApiFailure = await request(baseUrl, "brands", {
      method: "POST",
      body: injected.payload ?? { localId: injected.localId, name: `Offline Enforcement Brand ${runId}`, itemCount: 0 },
    });

    check(
      "enforcement validation: replay API call returns safe auth failure",
      replayApiFailure,
      (value) => value?.status === 401 && value?.body?.success === false && value?.headers?.authEnforcement === "enabled" && value?.headers?.authStatus === "absent" && !JSON.stringify(value).includes("Authorization") && !JSON.stringify(value).includes("Bearer"),
      "auth-enforced replay API call did not return safe 401 diagnostics"
    );

    const queueAfterReplay = await page.evaluate(
      async ({ dbName, dbVersion, queueId }) => {
        function openDb() {
          return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, dbVersion);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
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
        const row = await get(db.transaction("sync_queue", "readonly").objectStore("sync_queue"), queueId);
        db.close();
        return row ? { status: row.status, retryCount: row.retryCount, lastError: row.lastError } : null;
      },
      { dbName: DB_NAME, dbVersion: DB_VERSION, queueId: injected.queueId }
    );

    check("enforcement validation: auth failure does not mark queued row done", queueAfterReplay, (value) => value?.status === "pending" && value?.lastError === null, "auth failure validation should leave local pending row untouched");
  } finally {
    await browser.close();
  }
}
function tokenLeaked(value, token) {
  return JSON.stringify(value).includes(token);
}

async function main() {
  console.log(`Testing CRUD auth enforcement flag`);
  console.log(`Run id: ${runId}`);

  const tokenSetup = createValidToken();
  check("valid auth token prepared", { ok: tokenSetup.ok, actorId: tokenSetup.actorId }, (value) => value.ok === true && Boolean(value.actorId), "could not prepare test auth token");
  if (tokenSetup.ok !== true) {
    console.log(`Summary: ${passed} passed, ${failed} failed`);
    process.exitCode = 1;
    return;
  }

  await withPhpServer("off", async (baseUrl) => {
    const health = await request(baseUrl, "health");
    check("health remains public when enforcement off", health, (value) => value.status === 200 && value.body?.success === true, "health failed with enforcement off");

    const missing = await request(baseUrl, "brands", { method: "POST", body: brandPayload("off-missing") });
    check("enforcement off: missing auth still allowed", missing, (value) => value.status === 201 && value.body?.success === true && value.headers.authEnforcement === "disabled" && value.headers.authStatus === "absent", "missing auth was not allowed in audit mode");

    const invalid = await request(baseUrl, "brands", { method: "POST", headers: { Authorization: "Bearer invalid-token" }, body: brandPayload("off-invalid") });
    check("enforcement off: invalid auth still allowed", invalid, (value) => value.status === 201 && value.body?.success === true && value.headers.authEnforcement === "disabled" && value.headers.authStatus === "invalid", "invalid auth was not allowed in audit mode");
  });

  await withPhpServer("on", async (baseUrl) => {
    const health = await request(baseUrl, "health");
    check("health remains public when enforcement on", health, (value) => value.status === 200 && value.body?.success === true, "health failed with enforcement on");

    const missing = await request(baseUrl, "brands", { method: "POST", body: brandPayload("on-missing") });
    check("enforcement on: missing auth rejected", missing, (value) => value.status === 401 && value.body?.success === false && value.headers.authEnforcement === "enabled" && value.headers.authStatus === "absent", "missing auth was not rejected");

    const invalid = await request(baseUrl, "brands", { method: "POST", headers: { Authorization: "Bearer invalid-token" }, body: brandPayload("on-invalid") });
    check("enforcement on: invalid auth rejected", invalid, (value) => value.status === 401 && value.body?.success === false && value.headers.authEnforcement === "enabled" && value.headers.authStatus === "invalid", "invalid auth was not rejected");

    const valid = await request(baseUrl, "brands", { method: "POST", headers: { Authorization: `Bearer ${tokenSetup.token}` }, body: brandPayload("on-valid") });
    check("enforcement on: valid auth accepted", valid, (value) => value.status === 201 && value.body?.success === true && value.headers.authEnforcement === "enabled" && value.headers.authStatus === "valid" && value.headers.actorId === tokenSetup.actorId, "valid auth was not accepted");

    check("enforcement responses do not leak token", { missing, invalid, valid }, (value) => !tokenLeaked(value, tokenSetup.token), "raw token leaked in response data");

    await validateOfflineQueueAndAuthFailure(baseUrl);
  });

  console.log(`Summary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  fail("test runner crashed", { message: String(error?.message || error), stack: error?.stack }, "unexpected error");
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  process.exitCode = 1;
});
