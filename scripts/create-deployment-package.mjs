#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const packageRoot = join(repoRoot, "deployment-package");
const frontendTarget = join(packageRoot, "frontend");
const backendTarget = join(packageRoot, "api");
const docsTarget = join(packageRoot, "docs");

const buildApiBaseUrl = process.env.VITE_API_BASE_URL || "https://api.example.com";
const buildBasePath = process.env.VITE_BASE_PATH || "/";
const buildDevBackdoorEnabled = process.env.VITE_ENABLE_DEV_BACKDOOR === "true";
const buildOfflineLoginEnabled = process.env.VITE_ALLOW_OFFLINE_LOGIN === "true";
const buildCommand = process.platform === "win32" ? "cmd.exe" : "npm";
const buildArgs = process.platform === "win32" ? ["/c", "npm.cmd", "run", "build"] : ["run", "build"];
const buildCommandLabel = process.platform === "win32" ? "npm.cmd run build" : "npm run build";
const createdAt = new Date().toISOString();

const excludedFolders = [
  "node_modules",
  "backups",
  "releases",
  ".git",
  "deployment-package",
  "logs",
  "dist-ssr",
];

const excludedFiles = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "tsconfig.tsbuildinfo",
];

const deploymentDocs = [
  "docs/production-deployment-checklist.md",
  "docs/production-deployment-readiness-audit.md",
  "docs/deployment-and-environment-hardening-strategy.md",
  "docs/hosting-agnostic-deployment-rehearsal.md",
  "docs/local-production-rehearsal-laragon.md",
  "docs/client-handover-operational-checklist.md",
  "docs/release-candidate-client-handover-audit.md",
  "docs/offline-first-sync-architecture-status.md",
  "docs/production-operational-tooling-strategy.md",
  "docs/developer-control-panel-architecture.md",
  "docs/backup-restore-migration-strategy.md",
  "docs/backup-disaster-recovery-handover.md",
  "docs/backup-and-restore-audit.md",
  "docs/auto-sync-eligibility-gate.md",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    ...options,
  });

  return {
    command,
    args,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? String(result.error.message || result.error) : null,
  };
}

function requirePath(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing required ${label}: ${relative(repoRoot, path)}`);
  }
}

function safeCopyDirectory(source, target) {
  cpSync(source, target, {
    recursive: true,
    force: true,
    filter: (src) => {
      const rel = relative(repoRoot, src).replaceAll("\\", "/");
      const base = src.split(/[\\/]/).pop() || "";
      if (!rel) return true;
      if (excludedFolders.some((folder) => rel === folder || rel.startsWith(`${folder}/`))) return false;
      if (excludedFiles.includes(base)) return false;
      if (base.endsWith(".log")) return false;
      return true;
    },
  });
}

function copyDoc(path) {
  const source = join(repoRoot, path);
  if (!existsSync(source)) return null;
  const target = join(docsTarget, path.replace(/^docs[\\/]/, ""));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { force: true });
  return path;
}

function getGitValue(args) {
  const result = run("git", args);
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  return value || null;
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        walk(full);
      } else {
        files.push(relative(root, full).replaceAll("\\", "/"));
      }
    }
  };
  walk(root);
  return files.sort();
}

function scanForbiddenPackagePaths() {
  const forbidden = [];
  for (const file of listFiles(packageRoot)) {
    const normalized = file.replaceAll("\\", "/");
    if (/^node_modules\//.test(normalized)) forbidden.push({ file, reason: "node_modules" });
    if (/^backups\//.test(normalized)) forbidden.push({ file, reason: "backups" });
    if (/^releases\//.test(normalized)) forbidden.push({ file, reason: "releases" });
    if (/^\.git\//.test(normalized)) forbidden.push({ file, reason: ".git" });
    if (/\.log$/i.test(normalized)) forbidden.push({ file, reason: "log file" });
    if (/(^|\/)\.env($|\.)/.test(normalized) && normalized !== ".env.production.example") {
      forbidden.push({ file, reason: "real env file" });
    }
    if (/tsconfig\.tsbuildinfo$/i.test(normalized)) forbidden.push({ file, reason: "tsbuildinfo" });
  }
  return forbidden;
}

function main() {
  if (buildDevBackdoorEnabled) {
    throw new Error("Refusing to create a client deployment package while VITE_ENABLE_DEV_BACKDOOR=true. Use a database-backed support user.");
  }

  const build = run(buildCommand, buildArgs, {
    env: {
      ...process.env,
      VITE_API_BASE_URL: buildApiBaseUrl,
      VITE_BASE_PATH: buildBasePath,
      VITE_ENABLE_DEV_BACKDOOR: "false",
      VITE_ALLOW_OFFLINE_LOGIN: buildOfflineLoginEnabled ? "true" : "false",
    },
  });

  if (build.status !== 0) {
    console.error(JSON.stringify({ ok: false, step: "build", status: build.status, error: build.error, stdout: build.stdout.slice(-4000), stderr: build.stderr.slice(-4000) }, null, 2));
    process.exit(1);
  }

  const distPath = join(repoRoot, "dist");
  const apiPath = join(repoRoot, "api");
  const envExamplePath = join(repoRoot, ".env.production.example");

  requirePath(distPath, "frontend dist build");
  requirePath(join(distPath, "index.html"), "dist/index.html");
  requirePath(apiPath, "backend api folder");
  requirePath(envExamplePath, ".env.production.example");

  rmSync(packageRoot, { recursive: true, force: true });
  mkdirSync(packageRoot, { recursive: true });
  mkdirSync(docsTarget, { recursive: true });

  safeCopyDirectory(distPath, frontendTarget);
  safeCopyDirectory(apiPath, backendTarget);
  cpSync(envExamplePath, join(packageRoot, ".env.production.example"), { force: true });

  const includedDocs = deploymentDocs.map(copyDoc).filter(Boolean);
  const includedFolders = ["frontend", "api", "docs"];
  const sqlFiles = listFiles(backendTarget).filter((file) => file.toLowerCase().endsWith(".sql"));
  const forbiddenPackagePaths = scanForbiddenPackagePaths();

  if (forbiddenPackagePaths.length > 0) {
    console.error(JSON.stringify({ ok: false, step: "package-safety-scan", forbiddenPackagePaths }, null, 2));
    process.exit(1);
  }

  const manifest = {
    format: "jawad-bro-deployment-package-manifest",
    createdAt,
    deploymentPerformed: false,
    uploadPerformed: false,
    autoSyncEnabled: false,
    runtimeSyncBehaviorChanged: false,
    build: {
      command: buildCommandLabel,
      status: build.status,
      VITE_API_BASE_URL: buildApiBaseUrl,
      VITE_BASE_PATH: buildBasePath,
      VITE_ENABLE_DEV_BACKDOOR: "false",
      VITE_ALLOW_OFFLINE_LOGIN: buildOfflineLoginEnabled ? "true" : "false",
    },
    git: {
      commit: getGitValue(["rev-parse", "HEAD"]),
      shortCommit: getGitValue(["rev-parse", "--short", "HEAD"]),
      tag: getGitValue(["describe", "--tags", "--exact-match"]),
      branch: getGitValue(["branch", "--show-current"]),
      dirty: Boolean(getGitValue(["status", "--porcelain"])),
    },
    includedFolders,
    includedFiles: [".env.production.example", "deployment-manifest.json"],
    includedDocs,
    sqlFiles,
    excludedFolders,
    excludedFiles,
    safety: {
      realSecretsIncluded: false,
      backupsIncluded: false,
      releasesIncluded: false,
      nodeModulesIncluded: false,
      logsIncluded: false,
      localEnvIncluded: false,
      tsbuildInfoIncluded: false,
      devBackdoorEnabled: false,
      offlineLoginExplicitlyEnabled: buildOfflineLoginEnabled,
      forbiddenPackagePaths,
    },
    counts: {
      frontendFiles: listFiles(frontendTarget).length,
      apiFiles: listFiles(backendTarget).length,
      docsFiles: listFiles(docsTarget).length,
      sqlFiles: sqlFiles.length,
    },
    notes: [
      "Local dry-run package only; no upload or deployment was performed.",
      "Configure real secrets on the server or hosting control panel; they are not packaged.",
      "Auto-sync remains disabled and gated.",
    ],
  };

  writeFileSync(join(packageRoot, "deployment-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    ok: true,
    dryRunPackageOnly: true,
    deploymentPerformed: false,
    uploadPerformed: false,
    runtimeSyncBehaviorChanged: false,
    autoSyncEnabled: false,
    packagePath: packageRoot,
    manifestPath: join(packageRoot, "deployment-manifest.json"),
    includedFolders,
    excludedFolders,
    excludedFiles,
    counts: manifest.counts,
    git: manifest.git,
    safety: manifest.safety,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
}
