#!/usr/bin/env node

/*
 * Dev-only auto-sync eligibility evaluator.
 *
 * Read-only: does not call syncEngine.processPending(), replay queue rows,
 * apply hydration, mutate IndexedDB/backend rows, or start any automatic sync.
 *
 * Windows PowerShell:
 *   $env:APP_URL="http://localhost:5173"
 *   $env:API_BASE_URL="http://localhost/jawad-bro/api"
 *   npm.cmd run sync:evaluate-auto-sync
 */

import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const APP_URL = process.env.APP_URL || "http://localhost:5173";
const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro/api").replace(/\/+$/, "");
const USER_DATA_DIR = process.env.SYNC_TOOLS_USER_DATA_DIR || resolve(tmpdir(), "jawad-bro-sync-tools-profile");
const FAILED_QUEUE_THRESHOLD = Number(process.env.AUTO_SYNC_FAILED_QUEUE_THRESHOLD || 0);
const FAILED_REPLAY_THRESHOLD = Number(process.env.AUTO_SYNC_FAILED_REPLAY_THRESHOLD || 0);
const PENDING_QUEUE_THRESHOLD = Number(process.env.AUTO_SYNC_PENDING_QUEUE_THRESHOLD || 1000);

function addBlocker(blockers, code, message, details = undefined) {
  blockers.push({ code, message, ...(details ? { details } : {}) });
}

function addWarning(warnings, code, message, details = undefined) {
  warnings.push({ code, message, ...(details ? { details } : {}) });
}

function extractJsonFromOutput(output) {
  const text = String(output || "");
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in command output.");
  return JSON.parse(text.slice(start));
}

function runReadOnlyScript(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    windowsHide: true,
  });

  const combinedOutput = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.error) {
    return { ok: false, error: result.error.message };
  }

  try {
    const parsed = extractJsonFromOutput(combinedOutput);
    return { ok: result.status === 0 && parsed.ok !== false, status: result.status, report: parsed };
  } catch (error) {
    return {
      ok: false,
      status: result.status,
      error: error instanceof Error ? error.message : String(error),
      outputPreview: combinedOutput.slice(0, 1000),
    };
  }
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    return null;
  }
}

async function readAuthTokenState() {
  const playwright = await loadPlaywright();
  if (!playwright) {
    return {
      ok: false,
      tokenPresent: false,
      error: "Playwright is not installed. Install it with npm i -D playwright and npx playwright install chromium.",
    };
  }

  const context = await playwright.chromium.launchPersistentContext(USER_DATA_DIR, { headless: true });
  const page = await context.newPage();

  try {
    const pageResponse = await page.goto(APP_URL, { waitUntil: "networkidle" });
    if (!pageResponse || !pageResponse.ok()) {
      return { ok: false, tokenPresent: false, error: "Failed to open app.", status: pageResponse?.status() ?? null };
    }

    return await page.evaluate(() => {
      const token = localStorage.getItem("jawadBro.authToken") || null;
      let posActivity = { active: false, detectable: true, source: null, startedAt: null };

      try {
        const rawPOSActivity = localStorage.getItem("jawadBro.posActivityState");
        if (rawPOSActivity) {
          const parsed = JSON.parse(rawPOSActivity);
          posActivity = {
            active: Boolean(parsed?.active),
            detectable: true,
            source: typeof parsed?.source === "string" ? parsed.source : null,
            startedAt: typeof parsed?.startedAt === "number" ? parsed.startedAt : null,
          };
        }
      } catch {
        posActivity = { active: false, detectable: false, source: null, startedAt: null };
      }

      return {
        ok: true,
        tokenPresent: Boolean(token),
        token,
        posActivity,
      };
    });
  } finally {
    await context.close();
  }
}

async function fetchJson(url, token = null) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    const text = await response.text();
    let body = null;
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { parseError: "Response was not JSON." };
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      body,
      authStatus: response.headers.get("x-auth-status"),
      authEnforcement: response.headers.get("x-auth-enforcement"),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: { message: error instanceof Error ? error.message : String(error) },
      authStatus: null,
      authEnforcement: null,
    };
  }
}

function summarizeQueueHealth(reconciliationReport) {
  const summary = reconciliationReport?.summaryCounts ?? {};
  const byStatus = reconciliationReport?.byStatus?.syncQueue ?? {};
  const totals = reconciliationReport?.totals ?? {};
  return {
    ok: true,
    totalRows: totals.queueRows ?? null,
    pendingRows: Number(byStatus.pending ?? 0),
    failedRows: Number(byStatus.failed ?? 0),
    doneRows: Number(byStatus.done ?? 0),
    orphanQueueRows: Number(summary.orphanQueueRows ?? 0),
    orphanedPendingRows: Number(summary.orphanedPendingRows ?? 0),
  };
}

function summarizeReconciliationHealth(reconciliationReport) {
  const summary = reconciliationReport?.summaryCounts ?? {};
  return {
    ok: true,
    missingServerIds: Number(summary.missingServerIds ?? 0),
    orphanQueueRows: Number(summary.orphanQueueRows ?? 0),
    orphanedPendingRows: Number(summary.orphanedPendingRows ?? 0),
    duplicateServerIds: Number(summary.duplicateServerIds ?? 0),
    missingBackendRows: Number(summary.missingBackendRows ?? 0),
    failedReplayRows: Number(summary.failedReplayRows ?? 0),
    stuckReplayRows: Number(summary.stuckReplayRows ?? 0),
    countMismatchWarnings: Number(summary.countMismatchWarnings ?? 0),
  };
}

function summarizeHydrationHealth(planReport, manualReviewReport) {
  const planSummary = planReport?.summary ?? {};
  const manualSummary = manualReviewReport?.summary ?? {};
  const actionCounts = planSummary.actionCounts ?? {};
  const updateCounts = planSummary.updateClassificationCounts ?? {};
  const byDisposition = manualSummary.byDisposition ?? {};
  const byCategory = manualSummary.byCategory ?? {};
  const totalManualReviewRows = Number(manualSummary.totalManualReviewRows ?? actionCounts.manualReviewRequired ?? 0);
  const likelyDevTestDataRows = Number(manualSummary.likelyDevTestDataRows ?? 0);
  const nonDevManualReviewRows = Math.max(0, totalManualReviewRows - likelyDevTestDataRows);

  return {
    ok: true,
    createLocalFromRemote: Number(actionCounts.createLocalFromRemote ?? 0),
    updateLocalFromRemote: Number(actionCounts.updateLocalFromRemote ?? 0),
    possibleConflict: Number(actionCounts.possibleConflict ?? 0),
    manualReviewRequired: Number(actionCounts.manualReviewRequired ?? totalManualReviewRows),
    remoteNewerCandidates: Number(updateCounts.remoteNewerCandidates ?? 0),
    conflictCandidates: Number(updateCounts.conflictCandidates ?? 0),
    localNewerRows: Number(updateCounts.localNewerRows ?? 0),
    totalManualReviewRows,
    likelyDevTestDataRows,
    nonDevManualReviewRows,
    reviewForHydration: Number(byDisposition.reviewForHydration ?? 0),
    reviewForCleanup: Number(byDisposition.reviewForCleanup ?? 0),
    authSecuritySensitive: Number(byCategory["auth/security-sensitive"] ?? 0),
  };
}

async function main() {
  const blockers = [];
  const warnings = [];
  const now = new Date().toISOString();

  const authTokenState = await readAuthTokenState();
  const token = authTokenState.ok && authTokenState.tokenPresent ? authTokenState.token : null;
  const health = await fetchJson(`${API_BASE_URL}/health.php`);
  const session = token ? await fetchJson(`${API_BASE_URL}/session.php`, token) : null;
  const authProbe = await fetchJson(`${API_BASE_URL}/units.php`, token);

  const reconciliationResult = runReadOnlyScript("scripts/report-sync-reconciliation.mjs");
  const hydrationPlanResult = runReadOnlyScript("scripts/plan-hydration-actions.mjs");
  const manualReviewResult = runReadOnlyScript("scripts/report-hydration-manual-review.mjs");
  const staleLockResult = runReadOnlyScript("scripts/report-stale-replay-locks.mjs");

  const queueHealth = reconciliationResult.ok ? summarizeQueueHealth(reconciliationResult.report) : { ok: false, error: reconciliationResult.error };
  const reconciliationHealth = reconciliationResult.ok ? summarizeReconciliationHealth(reconciliationResult.report) : { ok: false, error: reconciliationResult.error };
  const hydrationHealth = hydrationPlanResult.ok && manualReviewResult.ok
    ? summarizeHydrationHealth(hydrationPlanResult.report, manualReviewResult.report)
    : { ok: false, error: hydrationPlanResult.error || manualReviewResult.error || "Hydration diagnostics unavailable." };
  const replayLockHealth = staleLockResult.ok
    ? {
        ok: true,
        totalProcessingRows: Number(staleLockResult.report.totalProcessingRows ?? 0),
        staleLockRows: Number(staleLockResult.report.staleLockRows ?? 0),
        thresholdMinutes: staleLockResult.report.thresholdMinutes ?? null,
      }
    : { ok: false, error: staleLockResult.error };

  const authCheck = {
    ok: Boolean(token && session?.ok && session?.body?.success !== false),
    tokenPresent: Boolean(authTokenState.tokenPresent),
    sessionStatus: session?.status ?? null,
    sessionValid: Boolean(session?.ok && session?.body?.success !== false),
    authProbeStatus: authProbe.status,
    authStatus: authProbe.authStatus ?? "unknown",
    authEnforcement: authProbe.authEnforcement ?? "unknown",
  };

  const backendReachable = {
    ok: Boolean(health.ok),
    healthStatus: health.status,
    healthSuccess: health.body?.success ?? null,
  };

  const activePOSTransaction = {
    ok: authTokenState.posActivity?.detectable !== false && !authTokenState.posActivity?.active,
    active: Boolean(authTokenState.posActivity?.active),
    status: authTokenState.posActivity?.detectable === false ? "unknown" : authTokenState.posActivity?.active ? "active" : "idle",
    detectable: authTokenState.posActivity?.detectable !== false,
    startedAt: authTokenState.posActivity?.startedAt ?? null,
    startedAtIso: authTokenState.posActivity?.startedAt ? new Date(authTokenState.posActivity.startedAt).toISOString() : null,
    source: authTokenState.posActivity?.source ?? null,
  };

  if (!authTokenState.ok) addBlocker(blockers, "auth_state_unavailable", "Could not inspect frontend auth token state.", { error: authTokenState.error });
  if (!authCheck.tokenPresent) addBlocker(blockers, "auth_missing", "No frontend bearer token is present.");
  if (authCheck.tokenPresent && !authCheck.sessionValid) addBlocker(blockers, "auth_invalid", "Bearer token session is not currently valid.", { sessionStatus: authCheck.sessionStatus });
  if (authCheck.authEnforcement === "unknown" || authCheck.authEnforcement === null) addBlocker(blockers, "auth_enforcement_unknown", "CRUD auth enforcement state could not be determined.");

  if (!backendReachable.ok) addBlocker(blockers, "backend_unreachable", "Backend health endpoint is not reachable.", { healthStatus: backendReachable.healthStatus });

  if (!queueHealth.ok) {
    addBlocker(blockers, "queue_health_unavailable", "Local sync queue health could not be evaluated.", { error: queueHealth.error });
  } else {
    if (queueHealth.pendingRows > PENDING_QUEUE_THRESHOLD) addBlocker(blockers, "pending_queue_threshold_exceeded", "Pending queue rows exceed threshold.", { pendingRows: queueHealth.pendingRows, threshold: PENDING_QUEUE_THRESHOLD });
    if (queueHealth.failedRows > FAILED_QUEUE_THRESHOLD) addBlocker(blockers, "failed_queue_rows", "Failed local queue rows exceed threshold.", { failedRows: queueHealth.failedRows, threshold: FAILED_QUEUE_THRESHOLD });
    if (queueHealth.orphanQueueRows > 0) addBlocker(blockers, "orphan_queue_rows", "Queue rows reference missing or unsafe local data.", { orphanQueueRows: queueHealth.orphanQueueRows });
    if (queueHealth.orphanedPendingRows > 0) addBlocker(blockers, "orphaned_pending_rows", "Pending queue rows reference missing local rows.", { orphanedPendingRows: queueHealth.orphanedPendingRows });
  }

  if (!replayLockHealth.ok) {
    addBlocker(blockers, "replay_lock_health_unavailable", "Replay lock health could not be evaluated.", { error: replayLockHealth.error });
  } else if (replayLockHealth.staleLockRows > 0) {
    addBlocker(blockers, "stale_replay_locks", "Stale replay locks exist.", { staleLockRows: replayLockHealth.staleLockRows });
  }

  if (!reconciliationHealth.ok) {
    addBlocker(blockers, "reconciliation_unavailable", "Reconciliation diagnostics could not be evaluated.", { error: reconciliationHealth.error });
  } else {
    if (reconciliationHealth.duplicateServerIds > 0) addBlocker(blockers, "duplicate_server_ids", "Duplicate local serverId values exist.", { duplicateServerIds: reconciliationHealth.duplicateServerIds });
    if (reconciliationHealth.missingBackendRows > 0) addBlocker(blockers, "missing_backend_rows", "Local rows with serverId are missing backend rows.", { missingBackendRows: reconciliationHealth.missingBackendRows });
    if (reconciliationHealth.stuckReplayRows > 0) addBlocker(blockers, "stuck_replay_rows", "Stuck replay rows exist.", { stuckReplayRows: reconciliationHealth.stuckReplayRows });
    if (reconciliationHealth.failedReplayRows > FAILED_REPLAY_THRESHOLD) addBlocker(blockers, "failed_replay_rows", "Failed backend replay rows exceed threshold.", { failedReplayRows: reconciliationHealth.failedReplayRows, threshold: FAILED_REPLAY_THRESHOLD });
    if (reconciliationHealth.missingServerIds > 0) addWarning(warnings, "missing_server_ids", "Local rows without serverId still need manual review before broad automation.", { missingServerIds: reconciliationHealth.missingServerIds });
    if (reconciliationHealth.countMismatchWarnings > 0) addWarning(warnings, "count_mismatch_warnings", "Local/backend count mismatches exist and may be harmless cache/test data.", { countMismatchWarnings: reconciliationHealth.countMismatchWarnings });
  }

  if (!hydrationHealth.ok) {
    addBlocker(blockers, "hydration_health_unavailable", "Hydration planner/manual-review diagnostics could not be evaluated.", { error: hydrationHealth.error });
  } else {
    if (hydrationHealth.createLocalFromRemote > 0) addBlocker(blockers, "pending_create_local_hydration", "Hydration planner still has createLocalFromRemote actions.", { createLocalFromRemote: hydrationHealth.createLocalFromRemote });
    if (hydrationHealth.updateLocalFromRemote > 0 || hydrationHealth.remoteNewerCandidates > 0) addBlocker(blockers, "pending_update_hydration", "Hydration planner has update candidates, but update apply is not implemented.", { updateLocalFromRemote: hydrationHealth.updateLocalFromRemote, remoteNewerCandidates: hydrationHealth.remoteNewerCandidates });
    if (hydrationHealth.possibleConflict > 0 || hydrationHealth.conflictCandidates > 0) addBlocker(blockers, "hydration_conflicts", "Hydration conflicts or possible conflicts exist.", { possibleConflict: hydrationHealth.possibleConflict, conflictCandidates: hydrationHealth.conflictCandidates });
    if (hydrationHealth.reviewForHydration > 0 || hydrationHealth.nonDevManualReviewRows > 0) addBlocker(blockers, "hydration_manual_review_required", "Hydration manual-review rows remain that are not classified as pure dev/test noise.", { reviewForHydration: hydrationHealth.reviewForHydration, nonDevManualReviewRows: hydrationHealth.nonDevManualReviewRows });
    if (hydrationHealth.authSecuritySensitive > 0) addWarning(warnings, "auth_sensitive_hydration_rows", "Auth/security-sensitive hydration rows are present and must stay manual.", { authSecuritySensitive: hydrationHealth.authSecuritySensitive });
  }

  if (!activePOSTransaction.detectable) {
    addWarning(warnings, "active_pos_transaction_unknown", "Active POS transaction/cart state is not detectable from this read-only script yet.");
    addBlocker(blockers, "active_pos_transaction_unknown", "Auto-sync must remain blocked until active POS transaction state is detectable and idle.");
  } else if (activePOSTransaction.active) {
    addBlocker(blockers, "active_pos_transaction_active", "A POS cart/invoice workflow is currently active.", {
      source: activePOSTransaction.source,
      startedAt: activePOSTransaction.startedAt,
      startedAtIso: activePOSTransaction.startedAtIso,
    });
  }

  const checks = {
    auth: authCheck,
    backendReachable,
    queueHealth,
    replayLockHealth,
    reconciliationHealth,
    hydrationHealth,
    activePOSTransaction,
  };

  const result = {
    ok: true,
    readOnly: true,
    autoSyncStarted: false,
    replayTriggered: false,
    hydrationApplied: false,
    allowed: blockers.length === 0,
    evaluatedAt: now,
    APP_URL,
    API_BASE_URL,
    thresholds: {
      failedQueueRows: FAILED_QUEUE_THRESHOLD,
      failedReplayRows: FAILED_REPLAY_THRESHOLD,
      pendingQueueRows: PENDING_QUEUE_THRESHOLD,
    },
    blockers,
    warnings,
    checks,
    notes: [
      "Read-only evaluator only: no IndexedDB rows, backend rows, queue rows, replay rows, or hydration rows were changed.",
      "This script does not call syncEngine.processPending() and does not start auto-sync.",
      "Safe metadata only: tokens, passwords, payload bodies, and full records are not printed.",
    ],
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.allowed) process.exitCode = 0;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    readOnly: true,
    autoSyncStarted: false,
    replayTriggered: false,
    hydrationApplied: false,
    allowed: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});


