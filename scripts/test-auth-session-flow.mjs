#!/usr/bin/env node

/* Dev-only backend login/session lifecycle tests. */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `auth-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const username = `login_${runId}`;
const devUsername = `dev_${runId}`;
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
$devUsername = getenv('AUTH_SESSION_DEV_USERNAME');
$password = getenv('AUTH_SESSION_PASSWORD');
$pdo->exec("CREATE TABLE IF NOT EXISTS users (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, client_id VARCHAR(100) NULL UNIQUE, username VARCHAR(100) NOT NULL UNIQUE, name VARCHAR(180) NOT NULL, mobile VARCHAR(50) NULL, role VARCHAR(80) NOT NULL, password_hash VARCHAR(255) NOT NULL, is_active TINYINT(1) NOT NULL DEFAULT 1, is_deleted TINYINT(1) NOT NULL DEFAULT 0, deleted_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
$statement = $pdo->prepare("INSERT INTO users (client_id, username, name, mobile, role, password_hash, is_active, is_deleted) VALUES (:client_id, :username, :name, '03000000000', 'admin', :password_hash, 1, 0)");
$statement->execute(['client_id' => $runId, 'username' => $username, 'name' => 'Login Test User', 'password_hash' => password_hash($password, PASSWORD_DEFAULT)]);
$userId = (int) $pdo->lastInsertId();
$devStatement = $pdo->prepare("INSERT INTO users (client_id, username, name, mobile, role, password_hash, is_active, is_deleted) VALUES (:client_id, :username, 'Login Test Developer', '03000000001', 'Dev', :password_hash, 1, 0)");
$devStatement->execute(['client_id' => $runId . '-dev', 'username' => $devUsername, 'password_hash' => password_hash($password, PASSWORD_DEFAULT)]);
echo json_encode(['ok' => true, 'userId' => $userId, 'devUserId' => (int) $pdo->lastInsertId()], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
`;
}

function createTestUser() {
  const result = spawnSync(findPhpBinary(), ["-r", phpSetupCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, AUTH_SESSION_RUN_ID: runId, AUTH_SESSION_USERNAME: username, AUTH_SESSION_DEV_USERNAME: devUsername, AUTH_SESSION_PASSWORD: password },
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
  check("test users prepared with hashed passwords", { ok: setup.ok, userId: setup.userId, devUserId: setup.devUserId }, (value) => value.ok === true && Number.isInteger(value.userId) && Number.isInteger(value.devUserId), "could not prepare users");
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

  const adminUsers = await request("users", { token });
  const adminUserRows = Array.isArray(adminUsers.body?.data) ? adminUsers.body.data : [];
  check(
    "Admin user list hides exact Dev accounts",
    { status: adminUsers.status, usernames: adminUserRows.map((row) => row?.username) },
    (value) => value.status === 200 && value.usernames.includes(username) && !value.usernames.includes(devUsername),
    "Admin could see a Dev account"
  );

  const adminDirectDev = await request("users", { token, query: `?id=${setup.devUserId}` });
  check(
    "Admin direct lookup cannot discover Dev account",
    adminDirectDev,
    (value) => value.status === 404 && value.body?.success === false,
    "Admin direct Dev lookup was not blocked"
  );

  const adminUpdateDev = await request("users", {
    method: "PUT",
    token,
    query: `?id=${setup.devUserId}`,
    body: { name: "Blocked Admin Dev Edit" },
  });
  check(
    "Admin cannot edit Dev account",
    adminUpdateDev,
    (value) => value.status === 404 && value.body?.success === false,
    "Admin Dev update was not blocked"
  );

  const adminDeleteDev = await request("users", {
    method: "DELETE",
    token,
    query: `?id=${setup.devUserId}`,
  });
  check(
    "Admin cannot delete Dev account",
    adminDeleteDev,
    (value) => value.status === 404 && value.body?.success === false,
    "Admin Dev deletion was not blocked"
  );

  const adminCreateDev = await request("users", {
    method: "POST",
    token,
    body: {
      username: `blocked_${devUsername}`,
      name: "Blocked Dev Creation",
      role: "Dev",
      password,
    },
  });
  check(
    "Admin cannot create Dev account",
    adminCreateDev,
    (value) => value.status === 403 && value.body?.success === false,
    "Admin Dev creation was not blocked"
  );

  const logout = await request("logout", { method: "POST", token, body: {} });
  check("logout revokes token safely", logout, (value) => value.status === 200 && value.body?.success === true && value.body?.data?.loggedOut === true, "logout failed");

  const sessionAfterLogout = await request("session", { token });
  check("session token rejected after logout", sessionAfterLogout, (value) => value.status === 401 && value.body?.success === false, "revoked token should not authenticate");
  check("logout/session responses do not leak token", { logout, sessionAfterLogout }, (value) => !JSON.stringify(redact(value)).includes(token), "token leaked after redaction guard");

  const devLogin = await request("login", { method: "POST", body: { username: devUsername, password } });
  const devToken = devLogin.body?.data?.token;
  check("DB-backed Dev support user can login normally", { status: devLogin.status, tokenPresent: Boolean(devToken), actor: devLogin.body?.data?.actor }, (value) => value.status === 200 && value.tokenPresent === true && value.actor?.Role === "Dev", "Dev login did not return the expected role");

  const devUsers = await request("users", { token: devToken });
  const devUserRows = Array.isArray(devUsers.body?.data) ? devUsers.body.data : [];
  check(
    "Dev user can view all user roles",
    { status: devUsers.status, usernames: devUserRows.map((row) => row?.username) },
    (value) => value.status === 200 && value.usernames.includes(username) && value.usernames.includes(devUsername),
    "Dev did not receive the full user list"
  );
  check("user-management responses do not leak password hashes", { adminUsers, devUsers }, hasNoPasswordLeak, "users endpoint leaked password fields");

  await request("logout", { method: "POST", token: devToken, body: {} });

  const authRepository = readFileSync(resolve(projectRoot, "src/repositories/authRepository.ts"), "utf8");
  const app = readFileSync(resolve(projectRoot, "src/App.tsx"), "utf8");
  const loginSource = readFileSync(resolve(projectRoot, "src/Login.tsx"), "utf8");
  const staffRepository = readFileSync(resolve(projectRoot, "src/repositories/staffRepository.ts"), "utf8");
  const staffPage = readFileSync(resolve(projectRoot, "src/Staff.tsx"), "utf8");
  const firstDevSetup = readFileSync(resolve(projectRoot, "api/setup/create-first-dev.php"), "utf8");
  const envTemplate = readFileSync(resolve(projectRoot, ".env.production.example"), "utf8");
  check("online backend rejection cannot fall back to local login", authRepository, (value) => value.includes("if (!isBackendUnavailable(error))") && value.includes("Remote login rejected; local fallback was not attempted.") && value.includes("clearLocalLoginState();") && value.includes("return null;"), "remote rejection guard is missing");
  check("offline local fallback requires explicit build opt-in", authRepository, (value) => value.includes('VITE_ALLOW_OFFLINE_LOGIN === "true"') && value.includes("Remote login unavailable; explicit offline login is disabled."), "offline login opt-in guard is missing");
  check("startup restore validates backend session before trusting local markers", { app, authRepository }, (value) => value.app.includes("restoreStartupSession") && !value.app.includes("if (id && username && role") && value.authRepository.includes("clearLocalLoginState()"), "startup still trusts marker-only login");
  check("frontend backdoor and offline login both default disabled", { loginSource, envTemplate }, (value) => value.loginSource.includes('VITE_ENABLE_DEV_BACKDOOR === "true"') && /^VITE_ENABLE_DEV_BACKDOOR=false$/m.test(value.envTemplate) && /^VITE_ALLOW_OFFLINE_LOGIN=false$/m.test(value.envTemplate), "production auth defaults are not safe");
  check("Admin local Staff repository hides and protects Dev users", staffRepository, (value) => value.includes('actorCanManageDevUsers() ? null : "Dev"') && value.includes('user.Role === "Dev"') && value.includes("assertDevUserAccess"), "local Dev account boundary is missing");
  check("Staff repository uses authenticated users API as the online listing source", staffRepository, (value) => value.includes('entityApi.list<RemoteUserResponse>("users")') && value.includes("extractRemoteUserList(response)") && value.includes("cacheRemoteUserProfiles(remoteUsers)"), "Staff listing is not API-first");
  check("Staff repository caches backend profiles by serverId then normalized username", staffRepository, (value) => value.includes("const byServerId") && value.includes("const byUsername = byServerId") && value.includes("normalizeUsername(user.Username) === username"), "safe user cache matching is missing");
  check("Backend-only Staff profiles never become local offline credentials", staffRepository, (value) => value.includes('Password: existing?.Password ?? ""') && !value.includes("password_hash"), "Staff cache may hydrate backend credentials");
  check("Staff offline listing falls back to IndexedDB only after connectivity failure", staffRepository, (value) => value.includes("isNetworkUnavailable(error)") && value.includes("getUsersPaged(") && value.indexOf("entityApi.list<RemoteUserResponse>") < value.indexOf("getUsersPaged("), "Staff offline fallback policy is missing");
  check("Staff API rejection is surfaced before any contradictory local write", staffRepository, (value) => (value.match(/if \(!isNetworkUnavailable\(error\)\) \{\s*throw error;\s*\}/g) || []).length >= 4, "Staff writes still fall back after backend rejection");
  check("Staff page exposes Dev role controls only to Dev", staffPage, (value) => value.includes('currentRole === "Dev"') && value.includes('{isDevRole && <option value="Dev">Dev</option>}'), "Staff role control is not Dev-only");
  check("Staff page surfaces safe list and write errors", staffPage, (value) => value.includes("getStaffErrorMessage") && value.includes("setLoadError(getStaffErrorMessage(error))") && value.includes("alert(getStaffErrorMessage(error))"), "Staff API errors are not visible to the user");
  check("one-time Dev creator is CLI-only and hashes safely", firstDevSetup, (value) => value.includes("PHP_SAPI !== 'cli'") && value.includes("password_hash($password, PASSWORD_DEFAULT)") && value.includes("'role' => 'Dev'") && !value.includes("passwordHash ."), "first Dev setup safeguards are missing");

  console.log(`Summary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  fail("test runner crashed", { message: String(error?.message || error), stack: error?.stack }, "unexpected error");
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  process.exitCode = 1;
});
