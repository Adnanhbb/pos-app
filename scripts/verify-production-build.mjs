#!/usr/bin/env node

/*
 * Production build/release verification.
 *
 * Verification only: runs a local production build, checks generated dist/
 * artifacts and required release-prep assets, and prints a safe summary. It
 * does not deploy, change runtime sync behavior, trigger replay, enable
 * auto-sync, or add background workers/listeners.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const DIST_DIR = resolve(PROJECT_ROOT, "dist");
const SAFE_BUILD_API_BASE_URL = process.env.VITE_API_BASE_URL || "https://api.example.com";
const SAFE_BUILD_BASE_PATH = process.env.VITE_BASE_PATH || "/";
const REQUESTED_DEV_BACKDOOR = process.env.VITE_ENABLE_DEV_BACKDOOR === "true";
const REQUESTED_OFFLINE_LOGIN = process.env.VITE_ALLOW_OFFLINE_LOGIN === "true";
const MAX_SCAN_FILE_BYTES = 2 * 1024 * 1024;

const requiredEnvVars = [
  "VITE_API_BASE_URL",
  "VITE_ENABLE_DEV_BACKDOOR",
  "VITE_ALLOW_OFFLINE_LOGIN",
  "CRUD_AUTH_ENFORCEMENT",
  "REPLAY_WORKER_TOKEN",
  "DB_HOST",
  "DB_NAME",
  "DB_USER",
  "DB_PASS",
];

const requiredDocs = [
  "docs/production-deployment-checklist.md",
  "docs/production-deployment-readiness-audit.md",
  "docs/deployment-and-environment-hardening-strategy.md",
  "docs/hosting-agnostic-deployment-rehearsal.md",
  "docs/local-production-rehearsal-laragon.md",
  "docs/client-handover-operational-checklist.md",
  "docs/release-candidate-client-handover-audit.md",
  "docs/offline-first-sync-architecture-status.md",
  "docs/sync-roadmap-and-status.md",
  "docs/backup-restore-migration-strategy.md",
  "docs/backup-disaster-recovery-handover.md",
  "docs/developer-control-panel-architecture.md",
  "docs/production-operational-tooling-strategy.md",
];

const requiredScripts = [
  "scripts/export-indexeddb-backup.mjs",
  "scripts/export-mysql-backup.mjs",
  "scripts/validate-backup-file.mjs",
  "scripts/evaluate-auto-sync-eligibility.mjs",
  "scripts/report-sync-queue.mjs",
  "scripts/report-sync-reconciliation.mjs",
];

const requiredFrontendFiles = [
  "src/DeveloperControlPanel.tsx",
  "src/api/authSession.ts",
  "src/api/authToken.ts",
  "src/api/authDiagnostics.ts",
];

const requiredBackendAuthFiles = [
  "api/lib/auth.php",
  "api/login.php",
  "api/logout.php",
  "api/session.php",
];

function addIssue(list, code, message, details = undefined) {
  list.push({ code, message, ...(details ? { details } : {}) });
}

function readPackageJson() {
  return JSON.parse(readFileSync(resolve(PROJECT_ROOT, "package.json"), "utf8"));
}

function runBuild() {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32" ? ["/c", "npm.cmd", "run", "build"] : ["run", "build"];
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 30 * 1024 * 1024,
    env: {
      ...process.env,
      VITE_API_BASE_URL: SAFE_BUILD_API_BASE_URL,
      VITE_BASE_PATH: SAFE_BUILD_BASE_PATH,
      VITE_ENABLE_DEV_BACKDOOR: "false",
      VITE_ALLOW_OFFLINE_LOGIN: REQUESTED_OFFLINE_LOGIN ? "true" : "false",
    },
  });

  return {
    ok: result.status === 0,
    command,
    args,
    status: result.status,
    error: result.error?.message ?? null,
    stdoutPreview: (result.stdout || "").slice(-3000),
    stderrPreview: (result.stderr || "").slice(-3000),
  };
}

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(fullPath));
    else files.push(fullPath);
  }

  return files;
}

function checkDist(errors, warnings) {
  if (!existsSync(DIST_DIR)) {
    addIssue(errors, "dist_missing", "dist/ folder is missing after build.");
    return { exists: false, fileCount: 0, totalBytes: 0, indexHtml: false, assetFiles: 0, localhostMatches: [] };
  }

  const files = walkFiles(DIST_DIR);
  const indexHtml = existsSync(join(DIST_DIR, "index.html"));
  const assetFiles = files.filter((file) => file.includes(`${join("dist", "assets")}`)).length;
  const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);

  if (!indexHtml) addIssue(errors, "dist_index_missing", "dist/index.html is missing.");
  if (assetFiles === 0) addIssue(errors, "dist_assets_missing", "dist/assets files are missing.");

  const leakagePatterns = [
    /http:\/\/localhost/i,
    /http:\/\/127\.0\.0\.1/i,
    /localhost\/jawad-bro/i,
    /127\.0\.0\.1:5173/i,
  ];
  const localhostMatches = [];

  for (const file of files) {
    const stat = statSync(file);
    if (stat.size > MAX_SCAN_FILE_BYTES) continue;
    const text = readFileSync(file, "utf8");
    if (leakagePatterns.some((pattern) => pattern.test(text))) {
      localhostMatches.push(file.replace(`${PROJECT_ROOT}\\`, ""));
    }
  }

  if (localhostMatches.length > 0) {
    addIssue(errors, "localhost_leakage", "Production build output contains localhost/local API references.", { files: localhostMatches.slice(0, 20) });
  }

  const html = indexHtml ? readFileSync(join(DIST_DIR, "index.html"), "utf8") : "";
  if (html.includes("/src/")) addIssue(warnings, "dist_source_reference", "dist/index.html appears to reference source paths.");

  return { exists: true, fileCount: files.length, totalBytes, indexHtml, assetFiles, localhostMatches };
}

function checkRequiredFiles(paths, errors, category) {
  const missing = paths.filter((relativePath) => !existsSync(resolve(PROJECT_ROOT, relativePath)));
  if (missing.length > 0) addIssue(errors, `${category}_missing`, `Required ${category} files are missing.`, { missing });
  return { checked: paths.length, missing };
}

function checkEnvTemplate(errors, warnings) {
  const envPath = resolve(PROJECT_ROOT, ".env.production.example");
  if (!existsSync(envPath)) {
    addIssue(errors, "env_template_missing", ".env.production.example is missing.");
    return { exists: false, documentedVariables: [], missingVariables: requiredEnvVars };
  }

  const content = readFileSync(envPath, "utf8");
  const documentedVariables = requiredEnvVars.filter((name) => content.includes(`${name}=`));
  const missingVariables = requiredEnvVars.filter((name) => !content.includes(`${name}=`));

  if (missingVariables.length > 0) {
    addIssue(errors, "env_template_incomplete", ".env.production.example is missing required documented variables.", { missingVariables });
  }

  if (/DB_PASS\s*=\s*$/m.test(content)) {
    addIssue(warnings, "env_db_pass_blank", "DB_PASS placeholder is blank; production must use a real secret in hosting config.");
  }

  if (/^VITE_ENABLE_DEV_BACKDOOR\s*=\s*true\s*$/mi.test(content)) {
    addIssue(errors, "env_dev_backdoor_enabled", ".env.production.example must keep VITE_ENABLE_DEV_BACKDOOR=false for client builds.");
  }

  if (!/^VITE_ALLOW_OFFLINE_LOGIN\s*=\s*false\s*$/mi.test(content)) {
    addIssue(errors, "env_offline_login_default", ".env.production.example must keep VITE_ALLOW_OFFLINE_LOGIN=false so offline access requires an explicit client build decision.");
  }

  return { exists: true, documentedVariables, missingVariables };
}

function checkPackageScripts(packageJson, errors) {
  const scripts = packageJson.scripts || {};
  const required = ["build", "backup:indexeddb:export", "backup:mysql:export", "backup:validate"];
  const missing = required.filter((name) => !scripts[name]);
  if (missing.length > 0) addIssue(errors, "package_scripts_missing", "Required package scripts are missing.", { missing });
  return { checked: required.length, missing };
}

function main() {
  const errors = [];
  const warnings = [];
  const packageJson = readPackageJson();

  if (REQUESTED_DEV_BACKDOOR) {
    console.error(JSON.stringify({
      ok: false,
      verificationOnly: true,
      deployed: false,
      autoSyncEnabled: false,
      runtimeSyncBehaviorChanged: false,
      errors: [{
        code: "dev_backdoor_enabled",
        message: "Refusing production verification while VITE_ENABLE_DEV_BACKDOOR=true. Client builds must use database-backed support users.",
      }],
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const build = runBuild();
  if (!build.ok) addIssue(errors, "build_failed", "npm.cmd run build failed.", { status: build.status, stdoutPreview: build.stdoutPreview, stderrPreview: build.stderrPreview });

  const dist = checkDist(errors, warnings);
  const envTemplate = checkEnvTemplate(errors, warnings);
  const docs = checkRequiredFiles(requiredDocs, errors, "docs");
  const scripts = checkRequiredFiles(requiredScripts, errors, "scripts");
  const frontendFoundation = checkRequiredFiles(requiredFrontendFiles, errors, "frontend_foundation");
  const backendAuth = checkRequiredFiles(requiredBackendAuthFiles, errors, "backend_auth_foundation");
  const packageScripts = checkPackageScripts(packageJson, errors);

  if (!SAFE_BUILD_API_BASE_URL.startsWith("https://")) {
    addIssue(warnings, "api_base_not_https", "VITE_API_BASE_URL used for verification is not HTTPS.", { VITE_API_BASE_URL: SAFE_BUILD_API_BASE_URL });
  }
  if (!SAFE_BUILD_BASE_PATH.startsWith("/")) {
    addIssue(errors, "base_path_invalid", "VITE_BASE_PATH used for verification must start with /.", { VITE_BASE_PATH: SAFE_BUILD_BASE_PATH });
  }
  if (REQUESTED_OFFLINE_LOGIN) {
    addIssue(warnings, "offline_login_explicitly_enabled", "VITE_ALLOW_OFFLINE_LOGIN=true was explicitly requested. Confirm the single-client device offline-access policy and legacy local credential risk before release.");
  }

  const result = {
    ok: errors.length === 0,
    verificationOnly: true,
    deployed: false,
    autoSyncEnabled: false,
    runtimeSyncBehaviorChanged: false,
    builtWith: {
      VITE_API_BASE_URL: SAFE_BUILD_API_BASE_URL,
      VITE_BASE_PATH: SAFE_BUILD_BASE_PATH,
      VITE_ENABLE_DEV_BACKDOOR: "false",
      VITE_ALLOW_OFFLINE_LOGIN: REQUESTED_OFFLINE_LOGIN ? "true" : "false",
    },
    app: {
      name: packageJson.name ?? null,
      version: packageJson.version ?? null,
    },
    build,
    dist,
    envTemplate,
    requiredAssets: {
      docs,
      scripts,
      frontendFoundation,
      backendAuth,
      packageScripts,
    },
    summary: {
      errors: errors.length,
      warnings: warnings.length,
    },
    errors,
    warnings,
    notes: [
      "Verification/preparation only: no deployment is performed.",
      "The script runs a local production build and inspects generated dist/ output.",
      "No replay, hydration, auto-sync, CI/CD automation, listeners, workers, or startup behavior is added.",
    ],
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main();
