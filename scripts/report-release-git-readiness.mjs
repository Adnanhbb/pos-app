#!/usr/bin/env node

/*
 * Release git readiness report.
 *
 * Audit/report only: reads git status and release metadata, prints a safe
 * commit/tag readiness summary, and does not commit, tag, push, deploy, or
 * change runtime behavior.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const LATEST_CHECKPOINT = "production-build-verification-before-deployment";
const SUGGESTED_COMMIT_MESSAGE = "chore: prepare production release verification baseline";
const SUGGESTED_TAG = "production-build-verification-before-deployment";

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    windowsHide: true,
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    error: result.error?.message ?? null,
  };
}

function parsePorcelain(statusText) {
  if (!statusText) return [];

  return statusText.split(/\r?\n/).filter(Boolean).map((line) => {
    const indexStatus = line.slice(0, 1);
    const worktreeStatus = line.slice(1, 2);
    const rawPath = line.slice(3).trim();
    const [from, to] = rawPath.includes(" -> ") ? rawPath.split(" -> ") : [null, rawPath];

    return {
      status: line.slice(0, 2),
      indexStatus,
      worktreeStatus,
      path: to,
      ...(from ? { from } : {}),
    };
  });
}

function isGeneratedArtifact(path) {
  return path.startsWith("dist/")
    || path.startsWith("dist\\")
    || path.startsWith("backups/")
    || path.startsWith("backups\\")
    || path.startsWith("releases/")
    || path.startsWith("releases\\")
    || path.endsWith(".tsbuildinfo")
    || path === "package-lock.json";
}

function isLikelyCommitCandidate(path) {
  return path.startsWith("docs/")
    || path.startsWith("docs\\")
    || path.startsWith("scripts/")
    || path.startsWith("scripts\\")
    || path.startsWith("src/")
    || path.startsWith("src\\")
    || path.startsWith("api/")
    || path.startsWith("api\\")
    || path === "package.json"
    || path === ".env.production.example"
    || path === ".env.example";
}

function groupChanges(changes) {
  const changed = changes.filter((entry) => entry.status !== "??");
  const untracked = changes.filter((entry) => entry.status === "??");
  const generatedArtifacts = changes.filter((entry) => isGeneratedArtifact(entry.path));
  const commitCandidates = changes.filter((entry) => isLikelyCommitCandidate(entry.path) && !isGeneratedArtifact(entry.path));

  const byTopLevel = {};
  for (const entry of changes) {
    const top = entry.path.split(/[\\/]/)[0] || entry.path;
    byTopLevel[top] = (byTopLevel[top] ?? 0) + 1;
  }

  return {
    changed,
    untracked,
    generatedArtifacts,
    commitCandidates,
    byTopLevel,
  };
}

function latestReleaseManifest() {
  const manifestPath = resolve(PROJECT_ROOT, "releases", "release-manifest-2026-05-25T17-03-53-150Z.json");
  if (!existsSync(manifestPath)) return null;

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return {
      path: "releases/release-manifest-2026-05-25T17-03-53-150Z.json",
      generatedAt: manifest.generatedAt ?? null,
      commit: manifest.git?.commit ?? null,
      dirty: Boolean(manifest.git?.dirty),
      autoSyncEnabled: Boolean(manifest.autoSyncEnabled),
    };
  } catch {
    return {
      path: "releases/release-manifest-2026-05-25T17-03-53-150Z.json",
      parseError: true,
    };
  }
}

function main() {
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const latestCommitHash = runGit(["rev-parse", "HEAD"]);
  const latestCommitShort = runGit(["rev-parse", "--short", "HEAD"]);
  const latestCommitMessage = runGit(["log", "-1", "--pretty=%s"]);
  const status = runGit(["status", "--porcelain"]);
  const tagExact = runGit(["describe", "--tags", "--exact-match"]);

  const changes = parsePorcelain(status.stdout);
  const grouped = groupChanges(changes);
  const releaseManifest = latestReleaseManifest();

  const result = {
    ok: true,
    auditOnly: true,
    committed: false,
    tagged: false,
    pushed: false,
    deployed: false,
    autoSyncEnabled: false,
    branch: branch.ok ? branch.stdout : null,
    latestCommit: {
      hash: latestCommitHash.ok ? latestCommitHash.stdout : null,
      shortHash: latestCommitShort.ok ? latestCommitShort.stdout : null,
      message: latestCommitMessage.ok ? latestCommitMessage.stdout : null,
      exactTag: tagExact.ok ? tagExact.stdout : null,
    },
    workingTree: {
      clean: changes.length === 0,
      dirty: changes.length > 0,
      totalChangedEntries: changes.length,
      changedTrackedCount: grouped.changed.length,
      untrackedCount: grouped.untracked.length,
      byTopLevel: grouped.byTopLevel,
    },
    changedFilesSummary: grouped.changed.map((entry) => ({ status: entry.status, path: entry.path })).slice(0, 250),
    untrackedFilesSummary: grouped.untracked.map((entry) => ({ status: entry.status, path: entry.path })).slice(0, 250),
    generatedArtifactsProbablyExcludeFromGit: grouped.generatedArtifacts.map((entry) => ({ status: entry.status, path: entry.path })).slice(0, 250),
    docsScriptsAndSourceProbablyCommit: grouped.commitCandidates.map((entry) => ({ status: entry.status, path: entry.path })).slice(0, 250),
    releaseManifest,
    releaseReadiness: {
      latestCheckpoint: LATEST_CHECKPOINT,
      suggestedCommitMessage: SUGGESTED_COMMIT_MESSAGE,
      suggestedTag: SUGGESTED_TAG,
      readyToTagWithoutReview: changes.length === 0,
      recommendation: changes.length === 0
        ? "Working tree is clean; verify release notes, then commit/tag workflow can proceed manually."
        : "Working tree is dirty; review generated artifacts vs source/docs/scripts before committing or tagging.",
    },
    notes: [
      "Audit/report only: no commit, tag, push, deploy, or runtime behavior change was performed.",
      "Generated backup/release/dist artifacts should usually be reviewed before deciding whether to include them in git.",
      "No file contents, secrets, payloads, tokens, passwords, or DB values are printed by this report.",
    ],
  };

  console.log(JSON.stringify(result, null, 2));
}

main();