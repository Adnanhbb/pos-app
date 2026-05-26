#!/usr/bin/env node

/*
 * Release manifest generator.
 *
 * Preparation only: writes a release manifest JSON under releases/. It does not
 * deploy, mutate runtime data, trigger replay, enable auto-sync, or add CI/CD.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const RELEASES_DIR = resolve(PROJECT_ROOT, "releases");

const docs = [
  "docs/offline-first-sync-architecture-status.md",
  "docs/sync-roadmap-and-status.md",
  "docs/deployment-and-environment-hardening-strategy.md",
  "docs/production-deployment-checklist.md",
  "docs/production-operational-tooling-strategy.md",
  "docs/developer-control-panel-architecture.md",
  "docs/backup-restore-migration-strategy.md",
  "docs/release-checkpoint-backup-export-validation.md",
  "docs/release-checkpoint-developer-control-panel-foundation.md",
];

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.status !== 0) return null;
  const output = result.stdout.trim();
  return output || null;
}

function readPackageJson() {
  return JSON.parse(readFileSync(resolve(PROJECT_ROOT, "package.json"), "utf8"));
}

function fileStatus(paths) {
  return paths.map((path) => ({
    path,
    exists: existsSync(resolve(PROJECT_ROOT, path)),
  }));
}

function main() {
  if (!existsSync(RELEASES_DIR)) mkdirSync(RELEASES_DIR, { recursive: true });

  const now = new Date();
  const packageJson = readPackageJson();
  const commit = runGit(["rev-parse", "HEAD"]);
  const shortCommit = runGit(["rev-parse", "--short", "HEAD"]);
  const tag = runGit(["describe", "--tags", "--exact-match"]);
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const dirtyStatus = runGit(["status", "--short"]);

  const manifest = {
    manifestFormat: "jawad-bro-release-manifest",
    manifestVersion: 1,
    generatedAt: now.toISOString(),
    preparationOnly: true,
    deployed: false,
    autoSyncEnabled: false,
    runtimeSyncBehaviorChanged: false,
    ciCdAutomationAdded: false,
    git: {
      commit,
      shortCommit,
      tag,
      branch,
      dirty: Boolean(dirtyStatus),
      dirtyStatusPreview: dirtyStatus ? dirtyStatus.split(/\r?\n/).slice(0, 50) : [],
    },
    app: {
      name: packageJson.name ?? null,
      version: packageJson.version ?? null,
      private: packageJson.private ?? null,
      homepage: packageJson.homepage ?? null,
    },
    includedDocsAndChecklists: fileStatus(docs),
    toolingStatus: {
      productionBuildVerifier: existsSync(resolve(PROJECT_ROOT, "scripts/verify-production-build.mjs")),
      releaseManifestGenerator: true,
      indexedDbBackupExport: existsSync(resolve(PROJECT_ROOT, "scripts/export-indexeddb-backup.mjs")),
      mysqlBackupExport: existsSync(resolve(PROJECT_ROOT, "scripts/export-mysql-backup.mjs")),
      backupValidation: existsSync(resolve(PROJECT_ROOT, "scripts/validate-backup-file.mjs")),
      developerControlPanel: existsSync(resolve(PROJECT_ROOT, "src/DeveloperControlPanel.tsx")),
      authSessionFoundation: ["api/login.php", "api/logout.php", "api/session.php", "api/lib/auth.php"].every((path) => existsSync(resolve(PROJECT_ROOT, path))),
    },
    syncArchitectureStatusSummary: {
      localFirstIndexedDb: true,
      manualReplayAvailable: true,
      manualReplayGated: true,
      backendReplayChainComplete: true,
      hydrationApplyLimitedToCreateLocal: true,
      updateHydrationApplyImplemented: false,
      conflictResolutionImplemented: false,
      autoSyncImplemented: false,
      backgroundWorkersImplemented: false,
      pollingOrStartupReplayImplemented: false,
      developerControlPanelReadOnlyFoundation: true,
    },
    authEnforcementStatusExpectations: {
      crudAuthEnforcementFlagExists: true,
      defaultExpectation: "off/audit-only until staged production validation passes",
      productionTemplate: ".env.production.example",
      replayAuthFoundation: true,
      frontendTokenPlumbing: true,
    },
    releasePreparationStatus: {
      deploymentChecklist: "docs/production-deployment-checklist.md",
      environmentTemplate: ".env.production.example",
      backupValidationRequiredBeforeRollout: true,
      autoSyncShouldRemainDisabledInitially: true,
      replayShouldRemainManualGatedInitially: true,
      dangerousToolingAdminOnly: true,
    },
    knownBlockersAndWarnings: [
      "Auto-sync remains disabled and must stay gated.",
      "Restore/import tooling is not implemented.",
      "Update hydration and conflict resolution are not implemented.",
      "Production CRUD auth enforcement should remain staged/default-off until validation passes.",
      "Release manifest generation does not deploy or verify hosting state.",
      "Dirty git status should be reviewed before tagging a production release.",
    ],
    notes: [
      "Manifest is a release preparation artifact only.",
      "Run npm.cmd run release:verify before using this manifest for deployment notes.",
      "No deployment, replay, hydration, auto-sync, background worker, listener, startup replay, or CI/CD behavior is created by this script.",
    ],
  };

  const filePath = resolve(RELEASES_DIR, `release-manifest-${timestampForFile(now)}.json`);
  writeFileSync(filePath, JSON.stringify(manifest, null, 2), "utf8");

  console.log(JSON.stringify({
    ok: true,
    preparationOnly: true,
    deployed: false,
    manifestPath: filePath,
    generatedAt: manifest.generatedAt,
    git: manifest.git,
    app: manifest.app,
    toolingStatus: manifest.toolingStatus,
    autoSyncEnabled: false,
    warnings: manifest.knownBlockersAndWarnings,
  }, null, 2));
}

main();