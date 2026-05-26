#!/usr/bin/env node

/* Dev-only backend login/session lifecycle tests. */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `auth-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const username = `login_${runId}`;
const password = `Pass-${runId}-123`;
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

function redact(value) {
  return JSON.parse(JSON.stringify(value, (key, val) => {
    if (/token|password|hash/i.test(key)) return "[redacted]";
    return val;
  }));
}

function pass(name) {
  passed += 1;
  console.log(`PASS ${name}`);
}

function fail(name, details, message) {
  failed += 1;
  console.error(`FAIL ${name}${message ? `: ${message}` : ""}`);
  if (details !== undefined) console.error(JSON.stringify(redact(details), null, 2));
}

function check(name, details, predicate, message) {
  if (predicate(details)) {
    pass(name);
    return true;
  }
  fail(name, details, message);
  return false;
}

async function request(file, { method = "GET", body, token, query = "" } = {}) {
  const headers = {
    Accept: "application/json",
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const response = await fetch(`${API_BASE_URL}/${file}.php${query}`, {
    method,
    headers,
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
      authStatus: response.headers.get("x-auth-status"),
      actorType: response.headers.get("x-auth-actor-type"),
      actorId: response.headers.get("x-auth-actor-id"),
      actorRole: response.headers.get("x-auth-actor-role"),
      enforcement: response.headers.get("x-auth-enforcement"),
    },
  };
}

function phpSetupCode() {
  return String.raw`
require_once getcwd() . '/api/config/database.php';
$pdo = get_pdo();
$runId = getenv('AUTH_SESSION_RUN_ID');
$username = getenv('AUTH_SESSION_USERNAME');
$password = getenv('AUTH_SESSION_PASSWORD');
$pdo->exec("CREATE TABLE IF NOT EXISTS users (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, client_id VARCHAR(100) NULL UNIQUE, username VARCHAR(100) NOT NULL UNIQUE, name VARCHAR(180) NOT NULL, mobile VARCHAR(50) NULL, role VARCHAR(80) NOT NULL, password_hash VARCHAR(255) NOT NULL, is_active TINYINT(1) NOT NULL DEFAULT 1, is_deleted TINYINT(1) NOT NULL DEFAULT 0, deleted_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
$statement = $pdo->prepare("INSERT INTO users (client_id, username, name, mobile, role, password_hash, is_active, is_deleted) VALUES (:client_id, :username, :name, '03000000000', 'admin', :password_hash, 1, 0)");
$statement->execute(['client_id' => $runId, 'username' => $username, 'name' => 'Login Test User', 'password_hash' => password_hash($password, PASSWORD_DEFAULT)]);
echo json_encode(['ok' => true, 'userId' => (int) $pdo->lastInsertId()], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
`;
}

function createTestUser() {
  const result = spawnSync(findPhpBinary(), ["-r", phpSetupCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, AUTH_SESSION_RUN_ID: runId, AUTH_SESSION_USERNAME: username, AUTH_SESSION_PASSWORD: password },
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

function hasNoPasswordLeak(value) {
  const text = JSON.stringify(value);
  return !text.includes(password) && !/password_hash|Password/.test(text);
}

async function main() {
  console.log(`Testing auth session flow against ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);

  const health = await request("health");
  check("backend health reachable", health, (value) => value.status === 200 && value.body?.success === true, "health.php did not return success");

  const setup = createTestUser();
  check("test user prepared with hashed password", { ok: setup.ok, userId: setup.userId }, (value) => value.ok === true && Number.isInteger(value.userId), "could not prepare user");
  if (setup.ok !== true) {
    console.log(`Summary: ${passed} passed, ${failed} failed`);
    process.exitCode = 1;
    return;
  }

  const invalidLogin = await request("login", { method: "POST", body: { username, password: `${password}-wrong` } });
  check("invalid login rejected safely", invalidLogin, (value) => value.status === 401 && value.body?.success === false, "invalid password should be rejected");
  check("invalid login does not leak password fields", invalidLogin, hasNoPasswordLeak, "invalid response leaked sensitive fields");

  const login = await request("login", { method: "POST", body: { username, password } });
  const token = login.body?.data?.token;
  check("successful login returns bearer token", { status: login.status, tokenPresent: Boolean(token), actor: login.body?.data?.actor }, (value) => value.status === 200 && value.tokenPresent === true && value.actor?.username === username, "login did not return expected token/actor");
  check("successful login returns safe actor only", login, (value) => hasNoPasswordLeak(value) && value.body?.data?.actor?.actorType === "user", "login leaked sensitive actor fields");

  const session = await request("session", { token });
  check("session endpoint accepts login token", { status: session.status, actor: session.body?.data?.actor }, (value) => value.status === 200 && value.actor?.username === username, "session did not return logged-in actor");
  check("session response has no password leakage", session, hasNoPasswordLeak, "session leaked sensitive fields");

  const crud = await request("brands", {
    method: "POST",
    token,
    body: { localId: `${runId}-brand`, name: `Auth Session Brand ${runId}`, itemCount: 0 },
  });
  check("authenticated CRUD request carries token and remains allowed", crud, (value) => value.status === 201 && value.body?.success === true && value.headers.authStatus === "valid" && value.headers.actorType === "user", "CRUD request was not audited as valid auth");

  const logout = await request("logout", { method: "POST", token, body: {} });
  check("logout revokes token safely", logout, (value) => value.status === 200 && value.body?.success === true && value.body?.data?.loggedOut === true, "logout failed");

  const sessionAfterLogout = await request("session", { token });
  check("session token rejected after logout", sessionAfterLogout, (value) => value.status === 401 && value.body?.success === false, "revoked token should not authenticate");
  check("logout/session responses do not leak token", { logout, sessionAfterLogout }, (value) => !JSON.stringify(redact(value)).includes(token), "token leaked after redaction guard");

  console.log(`Summary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  fail("test runner crashed", { message: String(error?.message || error), stack: error?.stack }, "unexpected error");
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  process.exitCode = 1;
});