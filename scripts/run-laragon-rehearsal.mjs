#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const args = process.argv.slice(2);
const copyEnabled = args.includes("--copy");
const apiUrlArg = args.find((arg) => arg.startsWith("--api-url="));
const targetArg = args.find((arg) => arg.startsWith("--target="));
const basePathArg = args.find((arg) => arg.startsWith("--base-path="));
const apiUrl = (apiUrlArg ? apiUrlArg.slice("--api-url=".length) : process.env.LARAGON_REHEARSAL_API_URL || "http://localhost/jawad-bro-rehearsal/api").replace(/\/+$/, "");
const targetRoot = resolve(targetArg ? targetArg.slice("--target=".length) : process.env.LARAGON_REHEARSAL_TARGET || "C:/laragon/www/jawad-bro-rehearsal");
const basePath = basePathArg ? basePathArg.slice("--base-path=".length) : process.env.LARAGON_REHEARSAL_BASE_PATH || "/jawad-bro-rehearsal/";
const offlineLoginEnabled = process.env.LARAGON_REHEARSAL_ALLOW_OFFLINE_LOGIN === "true";
const packageRoot = join(root, "deployment-package");
const frontendSource = join(packageRoot, "frontend");
const apiSource = join(packageRoot, "api");
const reportJsonPath = join(root, "laragon-rehearsal-run-report.json");
const reportMdPath = join(root, "laragon-rehearsal-run-report.md");

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    ...options,
  });
  return {
    command,
    args: commandArgs,
    status: result.status,
    ok: result.status === 0,
    error: result.error ? String(result.error.message || result.error) : null,
    stdoutPreview: (result.stdout || "").slice(-4000),
    stderrPreview: (result.stderr || "").slice(-4000),
  };
}

function npmRun(scriptName, extraEnv = {}) {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const commandArgs = process.platform === "win32" ? ["/c", "npm.cmd", "run", scriptName] : ["run", scriptName];
  return run(command, commandArgs, { env: { ...process.env, ...extraEnv } });
}

async function checkEndpoint(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    const text = await response.text().catch(() => "");
    return {
      url,
      reachable: true,
      status: response.status,
      ok: response.status >= 200 && response.status < 500,
      bodyPreview: text.slice(0, 200),
    };
  } catch (error) {
    return {
      url,
      reachable: false,
      status: null,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function countFiles(path) {
  if (!existsSync(path)) return 0;
  let count = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) walk(full);
      else count += 1;
    }
  };
  walk(path);
  return count;
}


function copyDirectoryContents(source, target) {
  if (!existsSync(source)) throw new Error(`Missing copy source: ${source}`);
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
}

function makeMarkdown(report) {
  const lines = [];
  lines.push("# Laragon Rehearsal Run Report");
  lines.push("");
  lines.push(`Generated: ${report.createdAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- ok: ${report.ok}`);
  lines.push(`- copyEnabled: ${report.copyEnabled}`);
  lines.push(`- apiUrl: ${report.apiUrl}`);
  lines.push(`- basePath: ${report.basePath}`);
  lines.push(`- offlineLoginExplicitlyEnabled: ${report.offlineLoginExplicitlyEnabled}`);
  lines.push(`- targetRoot: ${report.targetRoot}`);
  lines.push(`- deploymentPerformed: ${report.deploymentPerformed}`);
  lines.push(`- uploadPerformed: ${report.uploadPerformed}`);
  lines.push(`- autoSyncEnabled: ${report.autoSyncEnabled}`);
  lines.push(`- runtimeBehaviorChanged: ${report.runtimeBehaviorChanged}`);
  lines.push("");
  lines.push("## Steps");
  lines.push("");
  for (const step of report.steps) lines.push(`- ${step.ok ? "PASS" : "FAIL"}: ${step.name}`);
  lines.push("");
  lines.push("## Endpoint Checks");
  lines.push("");
  for (const endpoint of report.endpointChecks) lines.push(`- ${endpoint.reachable ? "REACHABLE" : "UNREACHABLE"}: ${endpoint.url} (${endpoint.status ?? "no status"})`);
  lines.push("");
  lines.push("## Manual Checks Still Required");
  lines.push("");
  for (const item of report.manualChecksStillRequired) lines.push(`- ${item}`);
  lines.push("");
  lines.push("This runner does not mutate MySQL, IndexedDB, replay queues, stock, accounting, auth tokens, or business data. It does not enable auto-sync or deploy to real hosting.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function addStep(steps, name, ok, details = {}) {
  steps.push({ name, ok: Boolean(ok), details });
}

async function main() {

  const steps = [];
  const warnings = [];
  const manualChecksStillRequired = [
    "Create/import the local MySQL rehearsal database manually if not already prepared.",
    "Verify frontend visually in the browser.",
    "Verify invoice print layout manually.",
    "Verify login/session with a known local test/admin user.",
    "Verify low-risk CRUD sync with deliberate test data only.",
    "Approve any manual replay before clicking Run Manual Replay.",
    "Review accounting/business effects manually; this runner does not create transactions.",
    "Approve rollback steps manually; this runner does not restore/import/delete data.",
  ];

  const packageRun = npmRun("deployment:package", {
    VITE_API_BASE_URL: apiUrl,
    VITE_BASE_PATH: basePath,
    VITE_ALLOW_OFFLINE_LOGIN: offlineLoginEnabled ? "true" : "false",
  });
  addStep(steps, "regenerate deployment package with local rehearsal API URL", packageRun.ok, { status: packageRun.status, error: packageRun.error });

  const verifierRun = npmRun("rehearsal:local-production", { LARAGON_REHEARSAL_ALLOW_LOCAL_RUNTIME_URLS: "1" });
  addStep(steps, "run existing read-only local production rehearsal verifier", verifierRun.ok, { status: verifierRun.status, error: verifierRun.error });

  const packageManifestPath = join(packageRoot, "deployment-manifest.json");
  let manifest = null;
  if (existsSync(packageManifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(packageManifestPath, "utf8"));
    } catch (error) {
      warnings.push(`Could not parse deployment manifest: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  addStep(steps, "deployment package exists", existsSync(packageRoot), { packageRoot });
  addStep(steps, "frontend package files exist", existsSync(join(frontendSource, "index.html")) && existsSync(join(frontendSource, "assets")), { frontendSource });
  addStep(steps, "API package files exist", existsSync(join(apiSource, "health.php")) && existsSync(join(apiSource, "login.php")) && existsSync(join(apiSource, "session.php")), { apiSource });
  addStep(steps, "deployment manifest API URL matches rehearsal URL", manifest?.build?.VITE_API_BASE_URL === apiUrl, { manifestApiUrl: manifest?.build?.VITE_API_BASE_URL ?? null, expected: apiUrl });
  addStep(steps, "deployment manifest base path matches rehearsal subfolder", manifest?.build?.VITE_BASE_PATH === basePath, { manifestBasePath: manifest?.build?.VITE_BASE_PATH ?? null, expected: basePath });

  const targetExistsBeforeCopy = existsSync(targetRoot);
  addStep(steps, "Laragon target path checked", true, { targetRoot, exists: targetExistsBeforeCopy });

  let copySummary = { copyEnabled, copied: false, frontendFiles: 0, apiFiles: 0 };
  if (copyEnabled) {
    mkdirSync(targetRoot, { recursive: true });
    copyDirectoryContents(frontendSource, targetRoot);
    copyDirectoryContents(apiSource, join(targetRoot, "api"));
    copySummary = {
      copyEnabled,
      copied: true,
      frontendFiles: countFiles(frontendSource),
      apiFiles: countFiles(apiSource),
      targetRoot,
      apiTarget: join(targetRoot, "api"),
    };
    addStep(steps, "copy package files into Laragon target", true, copySummary);
  } else {
    addStep(steps, "copy package files into Laragon target", true, { skipped: true, reason: "--copy not provided" });
  }

  const endpointChecks = [
    await checkEndpoint(`${apiUrl}/health.php`),
    await checkEndpoint(`${apiUrl}/login.php`),
    await checkEndpoint(`${apiUrl}/session.php`),
  ];

  if (endpointChecks.some((check) => !check.reachable)) {
    warnings.push("One or more Laragon API endpoints are not reachable. This is expected before copying files, starting Laragon, or configuring the rehearsal DB/API path.");
  }
  if (endpointChecks.some((check) => check.reachable && (check.status < 200 || check.status >= 400))) {
    warnings.push("One or more Laragon API endpoints responded with a non-success status. This can be expected for login/session GET checks without credentials; review any unexpected status before manual business testing.");
  }

  const failedSteps = steps.filter((step) => !step.ok);
  const report = {
    createdAt: new Date().toISOString(),
    ok: failedSteps.length === 0,
    localRehearsalOnly: true,
    setupChecksOnly: true,
    deploymentPerformed: false,
    uploadPerformed: false,
    realHostingTouched: false,
    autoSyncEnabled: false,
    runtimeBehaviorChanged: false,
    backgroundSyncAdded: false,
    businessDataMutated: false,
    mysqlMutated: false,
    indexedDbMutated: false,
    replayTriggered: false,
    destructiveActionRun: false,
    apiUrl,
    basePath,
    offlineLoginExplicitlyEnabled: offlineLoginEnabled,
    targetRoot,
    copyEnabled,
    copySummary,
    steps,
    endpointChecks,
    warnings,
    manualChecksStillRequired,
    reportFiles: {
      json: relative(root, reportJsonPath).replaceAll("\\", "/"),
      markdown: relative(root, reportMdPath).replaceAll("\\", "/"),
    },
  };

  writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(reportMdPath, makeMarkdown(report), "utf8");

  console.log(JSON.stringify({
    ok: report.ok,
    localRehearsalOnly: report.localRehearsalOnly,
    copyEnabled: report.copyEnabled,
    deploymentPerformed: report.deploymentPerformed,
    uploadPerformed: report.uploadPerformed,
    autoSyncEnabled: report.autoSyncEnabled,
    runtimeBehaviorChanged: report.runtimeBehaviorChanged,
    apiUrl: report.apiUrl,
    basePath: report.basePath,
    offlineLoginExplicitlyEnabled: report.offlineLoginExplicitlyEnabled,
    targetRoot: report.targetRoot,
    steps: {
      total: report.steps.length,
      failed: failedSteps.length,
    },
    endpointChecks: report.endpointChecks.map(({ url, reachable, status }) => ({ url, reachable, status })),
    warnings: report.warnings,
    reportFiles: report.reportFiles,
  }, null, 2));

  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
