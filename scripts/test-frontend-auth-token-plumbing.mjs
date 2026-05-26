#!/usr/bin/env node

/* Dev-only static check for frontend auth token plumbing. */

import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;

function check(name, condition, details = null) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
    return;
  }

  failed += 1;
  console.error(`FAIL ${name}`);
  if (details) console.error(JSON.stringify(details, null, 2));
}

const authToken = readFileSync("src/api/authToken.ts", "utf8");
const client = readFileSync("src/api/client.ts", "utf8");
const authDiagnostics = readFileSync("src/api/authDiagnostics.ts", "utf8");
const syncEngine = readFileSync("src/services/syncEngine.ts", "utf8");
const settings = readFileSync("src/Settings.tsx", "utf8");
const authSession = readFileSync("src/api/authSession.ts", "utf8");
const authRepository = readFileSync("src/repositories/authRepository.ts", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const dashboard = readFileSync("src/Dashboard.tsx", "utf8");

check("auth token helper exports getAuthToken", authToken.includes("export function getAuthToken"));
check("auth token helper exports setAuthToken", authToken.includes("export function setAuthToken"));
check("auth token helper exports clearAuthToken", authToken.includes("export function clearAuthToken"));
check("auth token helper uses localStorage only behind window guard", authToken.includes("typeof window") && authToken.includes("window.localStorage"));
check("API client imports getAuthToken", client.includes('import { getAuthToken } from "./authToken";'));
check("API client sends Authorization bearer only when token exists", client.includes("const authToken = getAuthToken()") && client.includes("headers.Authorization = `Bearer ${authToken}`"));
check("syncEngine maps 401/403 to safe auth messages", syncEngine.includes("Authentication required. Sign in again") && syncEngine.includes("You do not have permission"));
check("manual replay UI displays safe auth status only", settings.includes("Auth: action required") && settings.includes("Status: {error.status}"));
check("auth diagnostics detects token presence without exposing token", authDiagnostics.includes("tokenPresent: Boolean(token)") && !authDiagnostics.includes("return token"));
check("auth diagnostics parses enforcement and auth headers", authDiagnostics.includes("x-auth-enforcement") && authDiagnostics.includes("x-auth-status"));
check("settings displays dev-only auth diagnostics", settings.includes("Auth Diagnostics") && settings.includes("Token Present") && settings.includes("Backend Enforcement") && settings.includes("Last Replay Auth"));
check("auth session helper posts login credentials to login.php", authSession.includes("/login.php") && authSession.includes("setAuthToken(token)"));
check("auth session helper clears token on logout", authSession.includes("/logout.php") && authSession.includes("clearAuthToken()"));
check("auth session helper can fetch session safely", authSession.includes("/session.php") && authSession.includes("fetchCurrentSession"));
check("authRepository uses remote login while preserving local fallback", authRepository.includes("loginWithPassword") && authRepository.includes("falling back to local login") && authRepository.includes("validateUser(username, password, role)"));
check("authRepository logout clears token and local login state", authRepository.includes("logoutSession") && authRepository.includes("clearAuthToken()") && authRepository.includes("loggedInUserId"));
check("Dashboard logout uses shared App logout instead of reload-only local cleanup", dashboard.includes("onLogout();") && dashboard.includes("setCurrentUser(null)") && !dashboard.includes("window.location.reload()"));
check("App restores token-backed session without sync replay", app.includes("getCurrentSession") && !app.includes("processPending"));
check("syncEngine marks auth failures with safe status metadata", syncEngine.includes("authError") && syncEngine.includes("getErrorStatus(error)") && syncEngine.includes("isAuthError(error)"));
check("syncEngine does not auto-logout on auth failure", !syncEngine.includes("clearAuthToken") && !syncEngine.includes("logout()"));
const manualReplayBody = settings.slice(settings.indexOf("const runManualSyncReplay"), settings.indexOf("useEffect", settings.indexOf("const runManualSyncReplay")));
check("manual replay validates auth gate before processPending", manualReplayBody.includes("validateManualReplayAuthGate") && manualReplayBody.indexOf("validateManualReplayAuthGate") < manualReplayBody.indexOf("syncEngine.processPending"));
check("manual replay blocks when auth gate is not allowed", settings.includes("if (!authGate.allowed)") && settings.includes("setSyncError(authGate.message)") && settings.includes("return;"));
check("manual replay auth gate supports required safe states", settings.includes("authenticated") && settings.includes("unauthenticated") && settings.includes("authUnknown") && settings.includes("enforcementDisabled"));
check("manual replay UI shows auth gate result and session validation timestamp", settings.includes("Replay Auth Gate") && settings.includes("Session Checked At") && settings.includes("Gate Result"));
check("manual replay auth gate uses session.php through auth session helper", settings.includes("fetchCurrentSession") && authSession.includes("/session.php"));check("manual replay UI prevents duplicate clicks while running", settings.includes("if (syncRunning) return") && settings.includes("disabled={syncRunning}"));
check("manual replay UI does not add retry intervals or online listeners", !settings.includes("setInterval") && !settings.includes("addEventListener"));
check("no password storage was added to auth token helper", !/password/i.test(authToken));

console.log(`Summary: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;


