#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const packageRoot = join(root, "deployment-package");
const jsonReportPath = join(root, "deployment-rehearsal-report.json");
const markdownReportPath = join(root, "deployment-rehearsal-report.md");
const maxScanBytes = 2 * 1024 * 1024;
const allowLocalRuntimeUrls = process.env.LARAGON_REHEARSAL_ALLOW_LOCAL_RUNTIME_URLS === "1";

const requiredPackagePaths = [
  "deployment-package",
  "deployment-package/deployment-manifest.json",
  "deployment-package/frontend/index.html",
  "deployment-package/frontend/assets",
  "deployment-package/api",
  "deployment-package/api/health.php",
  "deployment-package/api/login.php",
  "deployment-package/api/session.php",
  "deployment-package/api/logout.php",
  "deployment-package/api/sql/schema.sql",
  "deployment-package/.env.production.example",
];

const requiredDocs = [
  "docs/local-production-rehearsal-laragon.md",
  "docs/hosting-agnostic-deployment-rehearsal.md",
  "docs/production-deployment-checklist.md",
  "docs/deployment-and-environment-hardening-strategy.md",
  "docs/sync-roadmap-and-status.md",
];

const requiredScripts = [
  "scripts/verify-production-build.mjs",
  "scripts/create-deployment-package.mjs",
  "scripts/export-indexeddb-backup.mjs",
  "scripts/export-mysql-backup.mjs",
  "scripts/validate-backup-file.mjs",
];

const requiredSourceFiles = [
  "src/DeveloperControlPanel.tsx",
];

const forbiddenPackagedPaths = [
  /^deployment-package[\\/]node_modules(?:[\\/]|$)/,
  /^deployment-package[\\/]backups(?:[\\/]|$)/,
  /^deployment-package[\\/]releases(?:[\\/]|$)/,
  /^deployment-package[\\/]\.git(?:[\\/]|$)/,
  /^deployment-package[\\/]logs(?:[\\/]|$)/,
  /^deployment-package[\\/]tsconfig\.tsbuildinfo$/,
  /^deployment-package[\\/]\.env$/,
  /^deployment-package[\\/]\.env\.local$/,
  /^deployment-package[\\/]\.env\.production$/,
  /^deployment-package[\\/]\.env\.development$/,
];

const localhostPatterns = [
  /http:\/\/localhost/i,
  /https:\/\/localhost/i,
  /localhost\/jawad-bro/i,
  /127\.0\.0\.1/i,
  /laragon/i,
];

const obviousBackgroundSyncPatterns = [
  { pattern: /setInterval\s*\([^)]*processPending/is, label: "setInterval processPending" },
  { pattern: /setTimeout\s*\([^)]*processPending/is, label: "setTimeout processPending" },
  { pattern: /addEventListener\s*\(\s*["']online["'][\s\S]{0,400}processPending/is, label: "online listener processPending" },
  { pattern: /addEventListener\s*\(\s*["']offline["'][\s\S]{0,400}processPending/is, label: "offline listener processPending" },
  { pattern: /navigator\.serviceWorker[\s\S]{0,600}processPending/is, label: "service worker processPending" },
];

const manualChecks = [
  "Visual UI verification on the local Laragon URL",
  "Invoice print verification with the intended printer/browser settings",
  "Real accounting effect review by an operator/accountant before production use",
  "Real replay approval by an authorized operator; no automatic replay",
  "Rollback approval and ownership",
  "Real hosting domain, SSL/TLS, DB credentials, CORS, and server environment checks",
  "Production PHP/MySQL version confirmation",
  "Server backup retention and log access confirmation",
];

function toRepoPath(path) {
  return relative(root, path).replaceAll("\\", "/");
}

function existsRepo(path) {
  return existsSync(join(root, path));
}

function listFiles(start) {
  const fullStart = join(root, start);
  if (!existsSync(fullStart)) return [];
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        walk(full);
      } else {
        files.push(toRepoPath(full));
      }
    }
  };
  walk(fullStart);
  return files.sort();
}

function isTextLike(file) {
  const extension = extname(file).toLowerCase();
  return [".html", ".js", ".css", ".json", ".md", ".php", ".sql", ".txt", ".example", ""].includes(extension) || file.endsWith(".env.production.example");
}

function readSmallText(repoPath) {
  const full = join(root, repoPath);
  const stats = statSync(full);
  if (stats.size > maxScanBytes || !isTextLike(repoPath)) return null;
  return readFileSync(full, "utf8");
}

function check(name, pass, details = {}) {
  return { name, pass: Boolean(pass), details };
}

function scanPackageForbiddenPaths() {
  const files = listFiles("deployment-package");
  const matches = [];
  for (const file of files) {
    for (const pattern of forbiddenPackagedPaths) {
      if (pattern.test(file)) matches.push(file);
    }
    if (/\.log$/i.test(file)) matches.push(file);
  }
  return [...new Set(matches)].sort();
}

function scanLocalhostLeakage() {
  const files = listFiles("deployment-package");
  const runtimeMatches = [];
  const documentationMatches = [];
  const environmentConfigMatches = [];

  for (const file of files) {
    const text = readSmallText(file);
    if (!text) continue;
    for (const pattern of localhostPatterns) {
      if (pattern.test(text)) {
        const match = { file, pattern: String(pattern) };
        if (file.startsWith("deployment-package/docs/") || file.endsWith(".env.production.example")) {
          documentationMatches.push(match);
        } else if (file === "deployment-package/api/config/cors.php") {
          environmentConfigMatches.push(match);
        } else {
          runtimeMatches.push(match);
        }
      }
    }
  }

  return { runtimeMatches, documentationMatches, environmentConfigMatches };
}

function scanSourceForBackgroundSync() {
  const files = listFiles("src").filter((file) => /\.(ts|tsx|js|jsx)$/.test(file));
  const matches = [];
  for (const file of files) {
    const text = readSmallText(file);
    if (!text) continue;
    for (const { pattern, label } of obviousBackgroundSyncPatterns) {
      if (pattern.test(text)) matches.push({ file, label });
    }
  }
  return matches;
}

function scanAutoSyncSignals() {
  const files = ["package.json", ...listFiles("src"), ...listFiles("api")].filter((file) => /\.(json|ts|tsx|js|jsx|php)$/.test(file));
  const findings = [];
  for (const file of files) {
    const text = readSmallText(file);
    if (!text) continue;
    if (/autoSyncEnabled\s*[:=]\s*true/i.test(text)) findings.push({ file, signal: "autoSyncEnabled true" });
    if (/AUTO_SYNC\s*=\s*true/i.test(text)) findings.push({ file, signal: "AUTO_SYNC true" });
  }
  return findings;
}

function scanDangerousRestoreImportTooling() {
  const scripts = listFiles("scripts");
  const dangerousNames = scripts.filter((file) => /(^|[\\/])(restore|import|delete|drop|truncate).+\.mjs$/i.test(file));
  const gatedApplyScripts = scripts.filter((file) => {
    const text = readSmallText(file);
    return text && /--apply/.test(text) && /(repair|archive|cleanup|reset|hydrate)/i.test(file);
  });
  return { dangerousNames, gatedApplyScripts };
}

function parseManifest() {
  const path = "deployment-package/deployment-manifest.json";
  if (!existsRepo(path)) return null;
  try {
    return JSON.parse(readFileSync(join(root, path), "utf8"));
  } catch (error) {
    return { parseError: error instanceof Error ? error.message : String(error) };
  }
}

function makeMarkdown(report) {
  const lines = [];
  lines.push("# Local Production Rehearsal Report");
  lines.push("");
  lines.push(`Generated: ${report.timestamp}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- ok: ${report.ok}`);
  lines.push(`- passed: ${report.summary.passed}`);
  lines.push(`- failed: ${report.summary.failed}`);
  lines.push(`- warnings: ${report.warnings.length}`);
  lines.push(`- readOnly: ${report.readOnly}`);
  lines.push(`- deploymentPerformed: ${report.deploymentPerformed}`);
  lines.push(`- runtimeBehaviorChanged: ${report.runtimeBehaviorChanged}`);
  lines.push(`- autoSyncEnabled: ${report.autoSyncEnabled}`);
  lines.push("");
  lines.push("## Checks");
  lines.push("");
  for (const result of report.checks) {
    lines.push(`- ${result.pass ? "PASS" : "FAIL"}: ${result.name}`);
  }
  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("## Warnings");
    lines.push("");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
    lines.push("");
    lines.push("Warning labels:");
    lines.push("");
    lines.push("- ACCEPTABLE LOCAL REHEARSAL: expected in Laragon/local checklist context; not a local blocker.");
    lines.push("- REAL HOSTING REVIEW REQUIRED: safe for local rehearsal, but must be changed or approved before real hosting upload.");
    lines.push("- BLOCKING FAILURE: represented by failed checks, not warnings.");
  }
  lines.push("");
  lines.push("## Manual Checks Still Required");
  lines.push("");
  for (const item of report.nextManualChecksRequired) lines.push(`- ${item}`);
  lines.push("");
  lines.push("This verifier does not deploy, upload, mutate IndexedDB/MySQL, trigger replay, apply hydration, restore/import data, enable auto-sync, or change runtime behavior.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main() {
  const checks = [];
  const warnings = [];
  const manifest = parseManifest();
  const forbiddenPackagePaths = scanPackageForbiddenPaths();
  const localhostLeakage = scanLocalhostLeakage();
  const backgroundSyncMatches = scanSourceForBackgroundSync();
  const autoSyncSignals = scanAutoSyncSignals();
  const dangerousTooling = scanDangerousRestoreImportTooling();
  const packagedEnvTemplate = existsRepo("deployment-package/.env.production.example")
    ? readFileSync(join(root, "deployment-package/.env.production.example"), "utf8")
    : "";
  const packagedDevBackdoorEnabled =
    manifest?.build?.VITE_ENABLE_DEV_BACKDOOR === true ||
    manifest?.build?.VITE_ENABLE_DEV_BACKDOOR === "true" ||
    manifest?.safety?.devBackdoorEnabled === true ||
    /^VITE_ENABLE_DEV_BACKDOOR\s*=\s*true\s*$/mi.test(packagedEnvTemplate);

  checks.push(check("deployment-package folder exists", existsRepo("deployment-package")));
  checks.push(check("deployment manifest exists and parses", Boolean(manifest && !manifest.parseError), { manifestSummary: manifest ? { autoSyncEnabled: manifest.autoSyncEnabled, deploymentPerformed: manifest.deploymentPerformed, uploadPerformed: manifest.uploadPerformed } : null }));
  checks.push(check("frontend production build files exist", existsRepo("deployment-package/frontend/index.html") && existsRepo("deployment-package/frontend/assets")));
  checks.push(check("API folder/files exist in package", existsRepo("deployment-package/api/health.php") && existsRepo("deployment-package/api/login.php") && existsRepo("deployment-package/api/session.php")));
  checks.push(check("schema.sql exists in package", existsRepo("deployment-package/api/sql/schema.sql")));
  checks.push(check(".env.production.example exists in package", existsRepo("deployment-package/.env.production.example")));
  checks.push(check("required deployment docs exist", requiredDocs.every(existsRepo), { missing: requiredDocs.filter((path) => !existsRepo(path)) }));
  checks.push(check("release verification script exists", existsRepo("scripts/verify-production-build.mjs")));
  checks.push(check("backup/export/validation scripts exist", ["scripts/export-indexeddb-backup.mjs", "scripts/export-mysql-backup.mjs", "scripts/validate-backup-file.mjs"].every(existsRepo)));
  checks.push(check("Developer Control Panel file exists", existsRepo("src/DeveloperControlPanel.tsx")));
  checks.push(check("forbidden generated/secret package paths absent", forbiddenPackagePaths.length === 0, { forbiddenPackagePaths }));
  checks.push(check("no runtime localhost/dev URL leakage in deployment-package", localhostLeakage.runtimeMatches.length === 0 || allowLocalRuntimeUrls, { runtimeMatches: localhostLeakage.runtimeMatches, allowedForLaragonRehearsal: allowLocalRuntimeUrls }));
  checks.push(check("auto-sync is not enabled", autoSyncSignals.length === 0 && manifest?.autoSyncEnabled !== true, { autoSyncSignals, manifestAutoSyncEnabled: manifest?.autoSyncEnabled ?? null }));
  checks.push(check("no obvious background sync startup code enabled", backgroundSyncMatches.length === 0, { backgroundSyncMatches }));
  checks.push(check("dangerous restore/import tooling absent", dangerousTooling.dangerousNames.length === 0, { dangerousNames: dangerousTooling.dangerousNames }));
  checks.push(check("known apply tools remain explicit/gated", dangerousTooling.gatedApplyScripts.every((file) => /--apply/.test(readSmallText(file) || "")), { gatedApplyScripts: dangerousTooling.gatedApplyScripts }));
  checks.push(check("developer backdoor disabled in deployment package", !packagedDevBackdoorEnabled, { packagedDevBackdoorEnabled }));

  if (allowLocalRuntimeUrls && localhostLeakage.runtimeMatches.length > 0) {
    warnings.push(`[ACCEPTABLE LOCAL REHEARSAL] Runtime package contains the Laragon API URL: ${localhostLeakage.runtimeMatches.length} match(es). This is allowed only because LARAGON_REHEARSAL_ALLOW_LOCAL_RUNTIME_URLS=1 was set by the local Laragon runner; regenerate without this allowance before real hosting upload.`);
  }
  if (localhostLeakage.documentationMatches.length > 0) {
    warnings.push(`[ACCEPTABLE LOCAL REHEARSAL] Localhost/Laragon examples found only in package documentation or env template: ${localhostLeakage.documentationMatches.length} match(es). These are acceptable for local rehearsal and are not blockers; review them when preparing a real-hosting package.`);
  }
  if (localhostLeakage.environmentConfigMatches.length > 0) {
    warnings.push(`[REAL HOSTING REVIEW REQUIRED] Localhost/Laragon origins found in packaged CORS/environment config: ${localhostLeakage.environmentConfigMatches.length} match(es). They are acceptable for Laragon rehearsal, but must be replaced with the real production domain/SSL origin or explicitly approved before real hosting upload.`);
  }
  if (manifest?.dirty) warnings.push("[REAL HOSTING REVIEW REQUIRED] Deployment package manifest reports dirty git state. Acceptable for local rehearsal, but commit/tag intentionally before real release packaging.");
  if (dangerousTooling.gatedApplyScripts.length > 0) warnings.push(`[REAL HOSTING REVIEW REQUIRED] Explicit --apply maintenance tools exist and must remain manual/operator gated: ${dangerousTooling.gatedApplyScripts.length} script(s).`);

  const failed = checks.filter((result) => !result.pass);
  const report = {
    timestamp: new Date().toISOString(),
    ok: failed.length === 0,
    readOnly: true,
    deploymentPerformed: false,
    uploadPerformed: false,
    runtimeBehaviorChanged: false,
    autoSyncEnabled: false,
    mutatedIndexedDB: false,
    mutatedMySQL: false,
    replayTriggered: false,
    hydrationApplied: false,
    restoreImportPerformed: false,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
    checks,
    warnings,
    nextManualChecksRequired: manualChecks,
    reportFiles: {
      json: toRepoPath(jsonReportPath),
      markdown: toRepoPath(markdownReportPath),
    },
  };

  writeFileSync(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownReportPath, makeMarkdown(report), "utf8");

  console.log(JSON.stringify({
    ok: report.ok,
    readOnly: report.readOnly,
    deploymentPerformed: report.deploymentPerformed,
    runtimeBehaviorChanged: report.runtimeBehaviorChanged,
    autoSyncEnabled: report.autoSyncEnabled,
    summary: report.summary,
    warnings: report.warnings,
    reportFiles: report.reportFiles,
  }, null, 2));

  if (!report.ok) process.exit(1);
}

main();