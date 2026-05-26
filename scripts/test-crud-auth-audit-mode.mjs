#!/usr/bin/env node

/* Dev-only CRUD optional auth audit mode tests. */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const runId = `crud-auth-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function pass(name, details) {
  passed += 1;
  console.log(`PASS ${name}`);
  if (details !== undefined) console.log(JSON.stringify(details, null, 2));
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

async function request(file, { method = "GET", body, headers = {}, query = "" } = {}) {
  const response = await fetch(`${API_BASE_URL}/${file}.php${query}`, {
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
      authStatus: response.headers.get("x-auth-status"),
      actorType: response.headers.get("x-auth-actor-type"),
      actorId: response.headers.get("x-auth-actor-id"),
      actorRole: response.headers.get("x-auth-actor-role"),
    },
  };
}

function phpSetupCode() {
  return String.raw`
require_once getcwd() . '/api/config/database.php';
require_once getcwd() . '/api/lib/auth.php';
$pdo = get_pdo();
$runId = getenv('CRUD_AUTH_AUDIT_RUN_ID') ?: ('crud-auth-audit-' . time());
$token = $runId . '-valid-token';
$actorId = $runId . '-device';
$pdo->exec("CREATE TABLE IF NOT EXISTS api_auth_tokens (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, token_hash CHAR(64) NOT NULL UNIQUE, actor_type VARCHAR(50) NOT NULL, actor_id VARCHAR(150) NOT NULL, role VARCHAR(80) NOT NULL, label VARCHAR(180) NULL, is_active TINYINT(1) NOT NULL DEFAULT 1, expires_at DATETIME NULL, last_used_at DATETIME NULL, revoked_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_api_auth_tokens_actor (actor_type, actor_id), INDEX idx_api_auth_tokens_role (role), INDEX idx_api_auth_tokens_active (is_active)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
$statement = $pdo->prepare("INSERT INTO api_auth_tokens (token_hash, actor_type, actor_id, role, label, is_active) VALUES (:hash, 'device', :actor_id, 'admin', 'CRUD optional auth audit test token', 1)");
$statement->execute(['hash' => hash_auth_token($token), 'actor_id' => $actorId]);
echo json_encode(['ok' => true, 'token' => $token, 'actorId' => $actorId], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
`;
}

function createValidToken() {
  const result = spawnSync(findPhpBinary(), ["-r", phpSetupCode()], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, CRUD_AUTH_AUDIT_RUN_ID: runId },
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

function success(response) {
  return response.ok && response.body?.success === true;
}

async function main() {
  console.log(`Testing CRUD optional auth audit mode against ${API_BASE_URL}`);
  console.log(`Run id: ${runId}`);

  const health = await request("health");
  check("backend health reachable", health, (value) => value.status === 200 && value.body?.success === true, "health.php did not return success");

  const tokenSetup = createValidToken();
  check("valid auth token prepared", { ok: tokenSetup.ok, actorId: tokenSetup.actorId }, (value) => value.ok === true && Boolean(value.actorId), "could not prepare test auth token");
  if (tokenSetup.ok !== true) {
    console.log(`Summary: ${passed} passed, ${failed} failed`);
    process.exitCode = 1;
    return;
  }

  const noAuth = await request("brands", {
    method: "POST",
    body: {
      localId: `${runId}-no-auth`,
      name: `Auth Audit No Auth ${runId}`,
      itemCount: 0,
    },
  });
  check("request without auth still works", noAuth, (value) => value.status === 201 && success(value), "missing auth should not be enforced yet");
  check("request without auth is auditable as absent", noAuth, (value) => value.headers.authAuditMode === "optional" && value.headers.authStatus === "absent", "missing auth status was not exposed safely");

  const validAuth = await request("brands", {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenSetup.token}` },
    body: {
      localId: `${runId}-valid-auth`,
      name: `Auth Audit Valid Auth ${runId}`,
      itemCount: 0,
    },
  });
  check("request with valid auth still works", validAuth, (value) => value.status === 201 && success(value), "valid auth request failed");
  check("request with valid auth is auditable as valid", validAuth, (value) => value.headers.authAuditMode === "optional" && value.headers.authStatus === "valid" && value.headers.actorType === "device" && value.headers.actorRole === "admin" && value.headers.actorId === tokenSetup.actorId, "valid auth metadata was not exposed safely");

  const invalidAuth = await request("brands", {
    method: "POST",
    headers: { Authorization: "Bearer definitely-invalid-token" },
    body: {
      localId: `${runId}-invalid-auth`,
      name: `Auth Audit Invalid Auth ${runId}`,
      itemCount: 0,
    },
  });
  check("request with invalid auth still works for now", invalidAuth, (value) => value.status === 201 && success(value), "invalid auth should not be enforced yet");
  check("request with invalid auth is auditable as invalid", invalidAuth, (value) => value.headers.authAuditMode === "optional" && value.headers.authStatus === "invalid" && !value.headers.actorId, "invalid auth status was not exposed safely");

  check("raw token not returned in response bodies", { noAuth, validAuth, invalidAuth }, (value) => !JSON.stringify(value).includes(tokenSetup.token), "raw token leaked into response/test output");

  console.log(`Summary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  fail("test runner crashed", { message: String(error?.message || error), stack: error?.stack }, "unexpected error");
  console.log(`Summary: ${passed} passed, ${failed} failed`);
  process.exitCode = 1;
});
