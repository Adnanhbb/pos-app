#!/usr/bin/env node

/*
 * Safe sync_queue issue archive tool.
 *
 * Default mode is dry-run. Apply requires --apply. It only changes failed
 * sync_queue rows classified as old incomplete records. It never replays,
 * deletes rows, calls backend APIs, mutates MySQL, or prints payload bodies.
 */

import {
  APP_URL,
  DB_NAME,
  DB_VERSION,
  PROFILE_TARGET,
  USER_DATA_DIR,
  buildIssueReport,
  loadPlaywright,
} from "./review-sync-queue-issues.mjs";

const APPLY = process.argv.includes("--apply");
const INCLUDE_BUSINESS_TEST_RECORDS = process.argv.includes("--include-business-test-records");
const IDS_ARG = process.argv.find((arg) => arg.startsWith("--ids="));

function argValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return null;
}

const REASON_ARG = argValue("reason");

function parseIds() {
  if (!IDS_ARG) return null;
  const ids = IDS_ARG.slice("--ids=".length)
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  return Array.from(new Set(ids));
}

async function applyArchive(archiveRecords) {
  const { chromium } = await loadPlaywright();
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, { headless: true });

  try {
    const page = await context.newPage();
    await page.goto(APP_URL, { waitUntil: "networkidle", timeout: 20000 });
    return await page.evaluate(
      async ({ dbName, dbVersion, archiveRecords }) => {
        function openDb() {
          return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, dbVersion);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });
        }

        function requestResult(request) {
          return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result ?? null);
            request.onerror = () => reject(request.error);
          });
        }

        function transactionDone(tx) {
          return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(null);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });
        }

        const db = await openDb();
        const archived = [];
        const skipped = [];

        try {
          if (!Array.from(db.objectStoreNames).includes("sync_queue")) {
            return { archived, skipped: archiveRecords.map((record) => ({ id: record.id, reason: "sync_queue_missing" })) };
          }

          const tx = db.transaction("sync_queue", "readwrite");
          const store = tx.objectStore("sync_queue");

          for (const record of archiveRecords) {
            const id = record.id;
            const row = await requestResult(store.get(id));
            if (!row) {
              skipped.push({ id, reason: "not_found" });
              continue;
            }

            if (row.status !== "failed") {
              skipped.push({ id, reason: "not_failed" });
              continue;
            }

            await requestResult(store.put({
              ...row,
              status: "archived",
              archivedAt: Date.now(),
              archivedReason: record.archivedReason,
              archivedFromStatus: row.status,
              archivedByRole: record.archivedByRole,
              updatedAt: Date.now(),
            }));
            archived.push(id);
          }

          await transactionDone(tx);
          return { archived, skipped };
        } finally {
          db.close();
        }
      },
      { dbName: DB_NAME, dbVersion: DB_VERSION, archiveRecords }
    );
  } finally {
    await context.close();
  }
}

async function main() {
  const selectedIds = parseIds();
  const before = await buildIssueReport();
  let staleCandidates = before.issues.filter((issue) => issue.archivable && issue.id != null);
  let businessTestCandidates = [];

  if (INCLUDE_BUSINESS_TEST_RECORDS) {
    if (!REASON_ARG || !REASON_ARG.trim()) {
      throw new Error("--include-business-test-records requires --reason.");
    }

    businessTestCandidates = before.issues.filter((issue) =>
      issue.id != null &&
      issue.status === "failed" &&
      issue.category === "business_transaction_needs_support"
    );
  }

  if (selectedIds) {
    const selectedSet = new Set(selectedIds);
    staleCandidates = staleCandidates.filter((issue) => selectedSet.has(issue.id));
    businessTestCandidates = businessTestCandidates.filter((issue) => selectedSet.has(issue.id));
  }

  const archiveRecords = [
    ...staleCandidates.map((issue) => ({
      id: issue.id,
      archivedReason: "Reviewed stale sync issue via explicit archive tool.",
      archivedByRole: "cli",
    })),
    ...businessTestCandidates.map((issue) => ({
      id: issue.id,
      archivedReason: REASON_ARG.trim(),
      archivedByRole: "Dev",
    })),
  ];
  const candidateIds = archiveRecords.map((record) => record.id);
  const blocked = before.issues.filter((issue) => !candidateIds.includes(issue.id));
  const dryRun = {
    mode: APPLY ? "apply" : "dry-run",
    appUrl: APP_URL,
    profile: {
      label: PROFILE_TARGET.label,
      source: PROFILE_TARGET.source,
      chromeProfileName: PROFILE_TARGET.chromeProfileName ?? null,
      userDataDir: PROFILE_TARGET.userDataDir,
      liveBrowserProfile: PROFILE_TARGET.liveBrowserProfile,
    },
    warnings: PROFILE_TARGET.warning ? [PROFILE_TARGET.warning] : [],
    totalFailedRows: before.totalFailedRows,
    candidateRows: archiveRecords.length,
    staleCandidateRows: staleCandidates.length,
    businessTestCandidateRows: businessTestCandidates.length,
    blockedRows: blocked.length,
    includeBusinessTestRecords: INCLUDE_BUSINESS_TEST_RECORDS,
    reason: INCLUDE_BUSINESS_TEST_RECORDS ? REASON_ARG : null,
    candidateIds,
    candidates: [...staleCandidates, ...businessTestCandidates].map((issue) => ({
      id: issue.id,
      entity: issue.entity,
      operation: issue.operation,
      friendlyReason: issue.friendlyReason,
      category: issue.category,
      invoiceNo: issue.invoiceNo,
      transactionType: issue.transactionType,
    })),
    blocked: blocked.map((issue) => ({
      id: issue.id,
      entity: issue.entity,
      operation: issue.operation,
      category: issue.category,
      invoiceNo: issue.invoiceNo,
      transactionType: issue.transactionType,
      reasonCodes: issue.reasonCodes,
    })),
    safety: {
      deletesQueueRows: false,
      marksSynced: false,
      replaysRows: false,
      mutatesMysql: false,
      printsPayloadBodies: false,
      applyRequiresFlag: true,
      businessRowsRequireExplicitFlag: true,
      businessRowsRequireReason: true,
    },
  };

  if (!APPLY) {
    console.log("Safe sync_queue archive dry-run. No IndexedDB changes are applied.");
    console.log(`Profile: ${PROFILE_TARGET.label} (${PROFILE_TARGET.userDataDir})`);
    if (PROFILE_TARGET.warning) console.log(`Warning: ${PROFILE_TARGET.warning}`);
    console.log(JSON.stringify(dryRun, null, 2));
    return;
  }

  if (candidateIds.length === 0) {
    console.log(JSON.stringify({
      ...dryRun,
      applied: false,
      reason: "no_archive_candidates",
    }, null, 2));
    return;
  }

  const result = await applyArchive(archiveRecords);
  const after = await buildIssueReport();
  console.log(JSON.stringify({
    ...dryRun,
    applied: true,
    archived: result.archived,
    skipped: result.skipped,
    after: {
      totalFailedRows: after.totalFailedRows,
      archivableRows: after.archivableRows,
      needsSupportRows: after.needsSupportRows,
      archivedRowsAreNotSynced: true,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    deletesQueueRows: false,
    marksSynced: false,
    replaysRows: false,
    mutatesMysql: false,
  }, null, 2));
  process.exitCode = 1;
});
